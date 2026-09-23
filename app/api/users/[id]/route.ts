import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const { id } = await context.params;
  const { data, error } = await getSupabaseAdmin().from("app_users")
    .select("id, username, avatar_url, shipping_address, payment_qr_url, is_admin")
    .eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "读取主页失败。" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "用户不存在。" }, { status: 404 });
  return NextResponse.json({ profile: data }, { headers: { "Cache-Control": "no-store" } });
}
