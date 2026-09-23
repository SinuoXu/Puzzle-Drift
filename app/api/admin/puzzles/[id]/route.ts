import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getImageStore,
  imageKeyFromPublicUrl,
} from "@/lib/edgeone-store";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function adminAndPuzzleId(
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getReadyUser();
  const { id } = await context.params;
  return { admin, id };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { admin, id } = await adminAndPuzzleId(context);

  if (!admin?.is_admin) {
    return NextResponse.json(
      { error: "只有管理员可以强制结束拼图。" },
      { status: 403 },
    );
  }

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "无效的拼图。" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);

  if (body?.action !== "force_end") {
    return NextResponse.json({ error: "无效操作。" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin().rpc(
    "v03_admin_force_retire",
    {
      p_puzzle_id: id,
      p_admin_id: admin.id,
    },
  );

  if (error || !data) {
    return NextResponse.json(
      { error: "强制结束失败。" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { admin, id } = await adminAndPuzzleId(context);

  if (!admin?.is_admin) {
    return NextResponse.json(
      { error: "只有管理员可以删除拼图。" },
      { status: 403 },
    );
  }

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "无效的拼图。" }, { status: 400 });
  }

  const db = getSupabaseAdmin();

  // Collect all Blob URLs before database deletion.
  const [puzzleResult, journeyResult, taskResult] = await Promise.all([
    db
      .from("puzzles")
      .select("cover_url")
      .eq("id", id)
      .maybeSingle(),

    db
      .from("puzzle_journey")
      .select(
        "received_photo_url, received_photo_urls, shipping_photo_url, shipping_photo_urls",
      )
      .eq("puzzle_id", id),

    db
      .from("puzzle_tasks")
      .select("receipt_url")
      .eq("puzzle_id", id),
  ]);

  const imageUrls = new Set<string>();

  function add(value: unknown) {
    if (typeof value === "string" && value) imageUrls.add(value);
  }

  add(puzzleResult.data?.cover_url);

  for (const journey of journeyResult.data ?? []) {
    add(journey.received_photo_url);
    add(journey.shipping_photo_url);

    for (const url of Array.isArray(journey.received_photo_urls)
      ? journey.received_photo_urls
      : []) {
      add(url);
    }

    for (const url of Array.isArray(journey.shipping_photo_urls)
      ? journey.shipping_photo_urls
      : []) {
      add(url);
    }
  }

  for (const task of taskResult.data ?? []) {
    add(task.receipt_url);
  }

  const { data, error } = await db.rpc("v03_admin_delete_puzzle", {
    p_puzzle_id: id,
    p_admin_id: admin.id,
  });

  if (error || !data) {
    return NextResponse.json(
      { error: "删除拼图失败。" },
      { status: 400 },
    );
  }

  const store = getImageStore();

  await Promise.allSettled(
    [...imageUrls]
      .map((url) => imageKeyFromPublicUrl(url))
      .filter((key): key is string => Boolean(key))
      .map((key) => store.delete(key)),
  );

  return NextResponse.json({ ok: true });
}
