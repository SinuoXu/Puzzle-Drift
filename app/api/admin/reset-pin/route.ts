import { randomInt } from "node:crypto";
import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin?.is_admin) return NextResponse.json({ error: "无权操作。" }, { status: 403 });
  const input = await request.json().catch(() => null);
  const username = typeof input?.username === "string" ? input.username.normalize("NFKC").trim().toLowerCase() : "";
  if (!username) return NextResponse.json({ error: "请输入用户名。" }, { status: 400 });
  const db = getSupabaseAdmin();
  const { data: target, error: lookupError } = await db.from("app_users").select("id").eq("username_normalized", username).maybeSingle();
  if (lookupError || !target) return NextResponse.json({ error: "找不到该用户。" }, { status: 404 });
  const pin = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const { error } = await db.from("app_users").update({ pin_hash: await hash(pin, 12), pin_failed_count: 0, pin_locked_until: null }).eq("id", target.id);
  if (error) return NextResponse.json({ error: "重置失败。" }, { status: 500 });
  await db.from("app_sessions").delete().eq("user_id", target.id);
  return NextResponse.json({ pin }, { headers: { "Cache-Control": "no-store" } });
}
