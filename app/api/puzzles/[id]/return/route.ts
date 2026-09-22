import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const { id } = await context.params;
  const { error } = await getSupabaseAdmin().rpc("v03_prepare_return", { p_puzzle_id: id, p_user_id: user.id });
  if (error) return NextResponse.json({ error: "当前不能寄回图主。" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
