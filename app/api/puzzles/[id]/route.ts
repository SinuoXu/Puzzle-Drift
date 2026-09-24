import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { canonicalizeKnownBrand } from "@/lib/brands";

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
  const user = await getReadyUser();
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
    const update: Record<string, string | number | boolean> = {};

    if ("name" in input) {
      const name = cleanText(input.name, 80);
      if (!name) return NextResponse.json({ error: "拼图名称不能为空且最多 80 字。" }, { status: 400 });
      update.name = name;
    }

    if ("brand" in input) {
      const brand = cleanText(input.brand, 80);
      if (brand === null) return NextResponse.json({ error: "品牌最多 80 字。" }, { status: 400 });
      update.brand = canonicalizeKnownBrand(brand);
    }

    if ("description" in input) {
      const description = cleanText(input.description, 1000);
      if (description === null) return NextResponse.json({ error: "介绍最多 1000 字。" }, { status: 400 });
      update.description = description;
    }

    if ("piece_count" in input) {
      const pieceCount = Number(input.piece_count);
      if (!Number.isSafeInteger(pieceCount) || pieceCount <= 0 || pieceCount > 100000) {
        return NextResponse.json({ error: "请填写正确的拼图片数。" }, { status: 400 });
      }
      update.piece_count = pieceCount;
    }

    if ("has_box" in input) {
      if (typeof input.has_box !== "boolean") {
        return NextResponse.json({ error: "盒子状态格式不正确。" }, { status: 400 });
      }
      update.has_box = input.has_box;
    }

    if ("has_sheet" in input) {
      if (typeof input.has_sheet !== "boolean") {
        return NextResponse.json({ error: "图纸状态格式不正确。" }, { status: 400 });
      }
      update.has_sheet = input.has_sheet;
    }

    if ("availability" in input) {
      if (typeof input.availability !== "string" || !["active", "paused"].includes(input.availability)) {
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
  void _request;
  void context;
  return NextResponse.json({ error: "为保护历史数据，v0.3 不提供删除拼图。" }, { status: 405 });
}
