import { NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getReadyUser();
  if (!admin?.is_admin) return NextResponse.json({ error: "只有管理员可以删除消息。" }, { status: 403 });

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "无效的消息。" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin().rpc("v03_admin_delete_activity", {
    p_activity_id: Number(id),
    p_admin_id: admin.id,
  });
  if (error || !data) return NextResponse.json({ error: "删除消息失败。" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
