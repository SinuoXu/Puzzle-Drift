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
  const taskRows = tasks ?? [];
  const userIds = [...new Set(taskRows.map((task) => task.payee_id).filter(Boolean))];
  const puzzleIds = [...new Set(taskRows.map((task) => task.puzzle_id))];
  const [puzzlesResult, journeysResult] = await Promise.all([
    puzzleIds.length ? db.from("puzzles").select("id, name, owner_id").in("id", puzzleIds) : Promise.resolve({ data: [], error: null }),
    puzzleIds.length ? db.from("puzzle_journey").select("id, puzzle_id, user_id, seq, status").in("puzzle_id", puzzleIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (puzzlesResult.error || journeysResult.error) return NextResponse.json({ error: "读取待办详情失败。" }, { status: 500 });

  const puzzles = puzzlesResult.data ?? [];
  const journeys = journeysResult.data ?? [];
  const puzzleMap = new Map(puzzles.map((puzzle) => [puzzle.id, puzzle]));
  const journeyMap = new Map(journeys.map((journey) => [journey.id, journey]));
  const recipientIds = new Set(userIds as string[]);
  for (const task of taskRows) {
    if (task.kind !== "ship" && task.kind !== "shipping_fee") continue;
    const turn = task.journey_id ? journeyMap.get(task.journey_id) : null;
    const next = journeys
      .filter((row) => row.puzzle_id === task.puzzle_id && row.status === "waiting" && row.seq > (turn?.seq ?? -1))
      .sort((a, b) => a.seq - b.seq)[0];
    recipientIds.add(next?.user_id ?? puzzleMap.get(task.puzzle_id)?.owner_id ?? "");
  }
  recipientIds.delete("");
  const { data: people, error: peopleError } = recipientIds.size ? await db.from("app_users")
    .select("id, username, payment_qr_url, shipping_address").in("id", [...recipientIds]) : { data: [], error: null };
  if (peopleError) return NextResponse.json({ error: "读取待办联系人失败。" }, { status: 500 });
  const peopleMap = new Map((people ?? []).map((person) => [person.id, person]));

  const enriched = taskRows.map((task) => {
    let destination: { username: string; shipping_address: string | null } | null = null;
    if (task.kind === "ship" || task.kind === "shipping_fee") {
      const turn = task.journey_id ? journeyMap.get(task.journey_id) : null;
      const next = journeys
        .filter((row) => row.puzzle_id === task.puzzle_id && row.status === "waiting" && row.seq > (turn?.seq ?? -1))
        .sort((a, b) => a.seq - b.seq)[0];
      const recipient = peopleMap.get(next?.user_id ?? puzzleMap.get(task.puzzle_id)?.owner_id ?? "");
      destination = recipient ? { username: recipient.username, shipping_address: recipient.shipping_address ?? null } : null;
    }
    const payee = task.payee_id ? peopleMap.get(task.payee_id) ?? null : null;
    return { ...task, puzzle_name: puzzleMap.get(task.puzzle_id)?.name ?? "拼图", payee: payee ? { username: payee.username, payment_qr_url: payee.payment_qr_url ?? null } : null, destination };
  });
  return NextResponse.json({ tasks: enriched }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60", Vary: "Cookie" } });
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
