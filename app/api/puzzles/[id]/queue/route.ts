import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function friendlyRpcError(message: string): string {
  if (message.includes("already in this queue")) return "你已经在这个拼图的队列里了。";
  if (message.includes("owner cannot queue")) return "图主不需要排自己的拼图。";
  if (message.includes("not open for queueing")) return "这个拼图目前没有开放排队。";
  if (message.includes("Puzzle not found")) return "拼图不存在。";
  return "排队操作失败。";
}

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "无效的拼图 ID。" }, { status: 400 });

    const user = await getReadyUser();
    if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });

    const db = getSupabaseAdmin();
    const { data, error } = await db.rpc("v03_join_queue", {
      p_puzzle_id: id,
      p_user_id: user.id,
    });

    if (error) return NextResponse.json({ error: friendlyRpcError(error.message) }, { status: 400 });
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    console.error("POST queue failed", error);
    return NextResponse.json({ error: "排队操作失败。" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "无效的拼图 ID。" }, { status: 400 });

    const user = await getReadyUser();
    if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });

    const db = getSupabaseAdmin();
    const { data, error } = await db.rpc("v03_cancel_queue", {
      p_puzzle_id: id,
      p_user_id: user.id,
    });

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "你当前不在等待队列里。" }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE queue failed", error);
    return NextResponse.json({ error: "退出排队失败。" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getReadyUser();
  if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "无效的拼图 ID。" }, { status: 400 });
  const input = await request.json().catch(() => null);
  if (input?.direction !== -1 && input?.direction !== 1) return NextResponse.json({ error: "方向不正确。" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("v03_move_queue", {
    p_puzzle_id: id, p_user_id: user.id, p_direction: input.direction,
  });
  if (error) return NextResponse.json({ error: "当前排队位置不能调整，可能已经安排邮寄。" }, { status: 400 });
  return NextResponse.json({ moved: data });
}
