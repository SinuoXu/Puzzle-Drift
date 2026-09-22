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
  const { data: reset, error } = await db.rpc("v03_reset_pin", { p_user_id: target.id, p_hash: await hash(pin, 12) });
  if (error || !reset) return NextResponse.json({ error: "重置失败。" }, { status: 500 });
  return NextResponse.json({ pin }, { headers: { "Cache-Control": "no-store" } });
}
