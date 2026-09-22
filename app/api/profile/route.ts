import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isUploadedImageUrl } from "@/lib/image-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().from("app_users")
    .select("avatar_url, shipping_address, payment_qr_url")
    .eq("id", user.id).single();
  if (error) return NextResponse.json({ error: "读取资料失败。" }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const input = await request.json().catch(() => null);
  if (!input || typeof input !== "object") return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
  const update: Record<string, string | null> = {};
  for (const key of ["avatar_url", "shipping_address", "payment_qr_url"] as const) {
    if (!(key in input)) continue;
    const value = input[key];
    if (typeof value !== "string" || value.length > (key === "shipping_address" ? 500 : 1000)) {
      return NextResponse.json({ error: "资料格式不正确。" }, { status: 400 });
    }
    if (key !== "shipping_address" && value && !isUploadedImageUrl(value, key === "avatar_url" ? "avatar" : "payment_qr", user.id)) {
      return NextResponse.json({ error: "图片地址不正确。" }, { status: 400 });
    }
    update[key] = value.trim() || null;
  }
  const { error } = await getSupabaseAdmin().from("app_users").update(update).eq("id", user.id);
  if (error) return NextResponse.json({ error: "保存资料失败。" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
