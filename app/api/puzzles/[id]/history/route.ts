import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const { id } = await context.params;
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("puzzle_journey")
    .select("id, received_photo_urls, receiving_note, shipping_photo_urls, shipping_note")
    .eq("puzzle_id", id).order("seq");
  if (error) return NextResponse.json({ error: "读取留存失败。" }, { status: 500 });
  const { data: handoffs, error: handoffError } = await db.from("puzzle_handoffs")
    .select("id, from_user_id, to_user_id, return_home, created_at").eq("puzzle_id", id).order("created_at");
  if (handoffError) return NextResponse.json({ error: "读取面交记录失败。" }, { status: 500 });
  return NextResponse.json({ history: data, handoffs }, { headers: { "Cache-Control": "no-store" } });
}
