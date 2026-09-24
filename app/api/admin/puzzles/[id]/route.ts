import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getImageStore,
  imageKeyFromPublicUrl,
} from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function userAndPuzzle(
  context: { params: Promise<{ id: string }> },
) {
  const user = await getReadyUser();
  const { id } = await context.params;

  if (!user || !UUID_RE.test(id)) {
    return {
      user,
      id,
      puzzle: null,
    };
  }

  const { data: puzzle } =
    await getSupabaseAdmin()
      .from("puzzles")
      .select("id, owner_id, name, cover_url")
      .eq("id", id)
      .maybeSingle();

  return {
    user,
    id,
    puzzle,
  };
}

function canManage(
  user: any,
  puzzle: any,
) {
  return Boolean(
    user &&
    puzzle &&
    (
      user.is_admin ||
      puzzle.owner_id === user.id
    ),
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const {
    user,
    id,
    puzzle,
  } = await userAndPuzzle(context);

  if (!user) {
    return NextResponse.json(
      { error: "未登录。" },
      { status: 401 },
    );
  }

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "无效的拼图。" },
      { status: 400 },
    );
  }

  if (!puzzle) {
    return NextResponse.json(
      { error: "拼图不存在。" },
      { status: 404 },
    );
  }

  if (!canManage(user, puzzle)) {
    return NextResponse.json(
      { error: "只有图主或管理员可以结束拼图。" },
      { status: 403 },
    );
  }

  const body = await request
    .json()
    .catch(() => null);

  if (body?.action !== "force_end") {
    return NextResponse.json(
      { error: "无效操作。" },
      { status: 400 },
    );
  }

  const { data, error } =
    await getSupabaseAdmin().rpc(
      "v03_admin_force_retire",
      {
        p_puzzle_id: id,
        p_admin_id: user.id,
      },
    );

  if (error || !data) {
    return NextResponse.json(
      {
        error:
          error?.message ??
          "强制结束失败。",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const {
    user,
    id,
    puzzle,
  } = await userAndPuzzle(context);

  if (!user) {
    return NextResponse.json(
      { error: "未登录。" },
      { status: 401 },
    );
  }

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "无效的拼图。" },
      { status: 400 },
    );
  }

  if (!puzzle) {
    return NextResponse.json(
      { error: "拼图不存在。" },
      { status: 404 },
    );
  }

  if (!canManage(user, puzzle)) {
    return NextResponse.json(
      { error: "只有图主或管理员可以删除拼图。" },
      { status: 403 },
    );
  }

  const db = getSupabaseAdmin();

  const [journeyResult, taskResult] =
    await Promise.all([
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
    if (typeof value === "string" && value) {
      imageUrls.add(value);
    }
  }

  add(puzzle.cover_url);

  for (const journey of journeyResult.data ?? []) {
    add(journey.received_photo_url);
    add(journey.shipping_photo_url);

    for (
      const url of Array.isArray(
        journey.received_photo_urls,
      )
        ? journey.received_photo_urls
        : []
    ) {
      add(url);
    }

    for (
      const url of Array.isArray(
        journey.shipping_photo_urls,
      )
        ? journey.shipping_photo_urls
        : []
    ) {
      add(url);
    }
  }

  for (const task of taskResult.data ?? []) {
    add(task.receipt_url);
  }

  const { data, error } =
    await db.rpc(
      "v03_admin_delete_puzzle",
      {
        p_puzzle_id: id,
        p_admin_id: user.id,
      },
    );

  if (error || !data) {
    return NextResponse.json(
      {
        error:
          error?.message ??
          "删除拼图失败。",
      },
      { status: 400 },
    );
  }

  const store = getImageStore();

  await Promise.allSettled(
    [...imageUrls]
      .map((url) =>
        imageKeyFromPublicUrl(url),
      )
      .filter(
        (key): key is string =>
          Boolean(key),
      )
      .map((key) => store.delete(key)),
  );

  return NextResponse.json({ ok: true });
}
