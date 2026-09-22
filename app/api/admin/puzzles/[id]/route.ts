import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

async function adminAndPuzzleId(context: { params: Promise<{ id: string }> }) {
  const admin = await getReadyUser();
  const { id } = await context.params;
  return { admin, id };
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { admin, id } = await adminAndPuzzleId(context);
  if (!admin?.is_admin) return NextResponse.json({ error: "只有管理员可以强制结束拼图。" }, { status: 403 });
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "无效的拼图。" }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (body?.action !== "force_end") return NextResponse.json({ error: "无效操作。" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin().rpc("v03_admin_force_retire", {
    p_puzzle_id: id,
    p_admin_id: admin.id,
  });
  if (error || !data) return NextResponse.json({ error: "强制结束失败。" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { admin, id } = await adminAndPuzzleId(context);
  if (!admin?.is_admin) return NextResponse.json({ error: "只有管理员可以删除拼图。" }, { status: 403 });
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "无效的拼图。" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin().rpc("v03_admin_delete_puzzle", {
    p_puzzle_id: id,
    p_admin_id: admin.id,
  });
  if (error || !data) return NextResponse.json({ error: "删除拼图失败。" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
