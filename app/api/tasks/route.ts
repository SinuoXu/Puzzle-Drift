import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export async function GET() {
  const user = await getReadyUser();
  if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const db = getSupabaseAdmin();
  const { data: tasks, error } = await db.from("puzzle_tasks")
    .select("id, puzzle_id, journey_id, kind, amount_cents, payee_id, created_at")
    .eq("user_id", user.id).eq("status", "open").order("created_at");
  if (error) return NextResponse.json({ error: "读取待办失败。" }, { status: 500 });
  const userIds = [...new Set((tasks ?? []).map((task) => task.payee_id).filter(Boolean))];
  const puzzleIds = [...new Set((tasks ?? []).map((task) => task.puzzle_id))];
  const { data: puzzleNames } = puzzleIds.length ? await db.from("puzzles").select("id, name").in("id", puzzleIds) : { data: [] };
  const puzzleNameMap = new Map((puzzleNames ?? []).map((puzzle) => [puzzle.id, puzzle.name]));
  const { data: payees } = userIds.length ? await db.from("app_users")
    .select("id, username, payment_qr_url").in("id", userIds) : { data: [] };
  const payeeMap = new Map((payees ?? []).map((payee) => [payee.id, payee]));
  const enriched = await Promise.all((tasks ?? []).map(async (task) => {
    let destination: { username: string; shipping_address: string | null } | null = null;
    if (task.kind === "ship" || task.kind === "shipping_fee") {
      const { data: turn } = await db.from("puzzle_journey").select("seq").eq("id", task.journey_id).single();
      const { data: next } = await db.from("puzzle_journey").select("user_id").eq("puzzle_id", task.puzzle_id)
        .eq("status", "waiting").gt("seq", turn?.seq ?? -1).order("seq").limit(1).maybeSingle();
      let recipientId = next?.user_id;
      if (!recipientId) {
        const { data: puzzle } = await db.from("puzzles").select("owner_id").eq("id", task.puzzle_id).single();
        recipientId = puzzle?.owner_id;
      }
      if (recipientId) {
        const { data: recipient } = await db.from("app_users").select("username, shipping_address").eq("id", recipientId).single();
        destination = recipient ?? null;
      }
    }
    return { ...task, puzzle_name: puzzleNameMap.get(task.puzzle_id) ?? "拼图", payee: task.payee_id ? payeeMap.get(task.payee_id) ?? null : null, destination };
  }));
  return NextResponse.json({ tasks: enriched }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getReadyUser();
  if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const input = await request.json().catch(() => null);
  if (!input || typeof input.id !== "string") return NextResponse.json({ error: "无效待办。" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("v03_mark_paid", { p_task_id: input.id, p_user_id: user.id });
  if (error || !data) return NextResponse.json({ error: "更新待办失败。" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
