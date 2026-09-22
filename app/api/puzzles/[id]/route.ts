import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim();
  if (Array.from(text).length > max) return null;
  return text;
}

async function canManagePuzzle(id: string) {
  const user = await getCurrentUser();
  if (!user) return { user: null, puzzle: null };

  const db = getSupabaseAdmin();
  const { data: puzzle, error } = await db
    .from("puzzles")
    .select("id, owner_id")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return { user, puzzle };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "无效的拼图 ID。" }, { status: 400 });

    const { user, puzzle } = await canManagePuzzle(id);
    if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
    if (!puzzle) return NextResponse.json({ error: "拼图不存在。" }, { status: 404 });
    if (puzzle.owner_id !== user.id && !user.is_admin) {
      return NextResponse.json({ error: "只有图主或管理员可以编辑。" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const update: Record<string, string> = {};

    if ("name" in input) {
      const name = cleanText(input.name, 80);
      if (!name) return NextResponse.json({ error: "拼图名称不能为空且最多 80 字。" }, { status: 400 });
      update.name = name;
    }

    if ("brand" in input) {
      const brand = cleanText(input.brand, 80);
      if (brand === null) return NextResponse.json({ error: "品牌最多 80 字。" }, { status: 400 });
      update.brand = brand;
    }

    if ("description" in input) {
      const description = cleanText(input.description, 1000);
      if (description === null) return NextResponse.json({ error: "介绍最多 1000 字。" }, { status: 400 });
      update.description = description;
    }

    if ("availability" in input) {
      if (typeof input.availability !== "string" || !["active", "paused", "retired"].includes(input.availability)) {
        return NextResponse.json({ error: "开放状态不正确。" }, { status: 400 });
      }
      update.availability = input.availability;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "没有可更新的内容。" }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const { error } = await db.from("puzzles").update(update).eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/puzzles/[id] failed", error);
    return NextResponse.json({ error: "更新拼图失败。" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "无效的拼图 ID。" }, { status: 400 });

    const { user, puzzle } = await canManagePuzzle(id);
    if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
    if (!puzzle) return NextResponse.json({ error: "拼图不存在。" }, { status: 404 });
    if (puzzle.owner_id !== user.id && !user.is_admin) {
      return NextResponse.json({ error: "只有图主或管理员可以删除。" }, { status: 403 });
    }

    const db = getSupabaseAdmin();
    const { error } = await db.from("puzzles").delete().eq("id", id);
    if (error) throw new Error(error.message);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("DELETE /api/puzzles/[id] failed", error);
    return NextResponse.json({ error: "删除拼图失败。" }, { status: 500 });
  }
}
