import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getReadyUser();
  if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const { id } = await context.params;
  const input = await request.json().catch(() => ({}));
  const { data, error } = await getSupabaseAdmin().rpc("v03_handoff", {
    p_puzzle_id: id, p_user_id: user.id, p_return: input.return_home === true,
  });
  if (error) return NextResponse.json({ error: "当前不能面交；如果已经填写邮费，请按邮寄流程完成。" }, { status: 400 });
  return NextResponse.json({ ok: true, next_holder_id: data });
}
