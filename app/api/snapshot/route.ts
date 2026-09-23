import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "未登录。" }, { status: 401 });
    }

    if (currentUser.profile_required) return NextResponse.json({ error: "请先完成个人资料。", needs_profile: true, user: currentUser }, { status: 403 });

    const db = getSupabaseAdmin();

    const [usersResult, puzzlesResult, journeyResult, activityResult] = await Promise.all([
      db.from("app_users").select("id, username, avatar_url, is_admin"),
      db
        .from("puzzles")
        .select("id, name, brand, description, cover_url, piece_count, has_box, has_sheet, owner_id, current_holder_id, availability, in_transit, created_at, updated_at")
        .order("created_at", { ascending: false }),
      db
        .from("puzzle_journey")
        .select(
          "id, puzzle_id, user_id, seq, status, is_owner_start, joined_at, received_on, shipped_on"
        )
        .order("seq", { ascending: true }),
      db
        .from("puzzle_activity")
        .select("id, type, puzzle_id, actor_id, payload, created_at")
        .order("created_at", { ascending: false })
        .limit(80),
    ]);

    if (usersResult.error) throw new Error(usersResult.error.message);
    if (puzzlesResult.error) throw new Error(puzzlesResult.error.message);
    if (journeyResult.error) throw new Error(journeyResult.error.message);
    if (activityResult.error) throw new Error(activityResult.error.message);

    const users: any[] = (usersResult.data ?? []) as any[];
    const userMap = new Map<string, any>(
      users.map((user: any) => [user.id, user])
    );

    const rawPuzzles: any[] = (puzzlesResult.data ?? []) as any[];
    const puzzleMap = new Map<string, any>(
      rawPuzzles.map((puzzle: any) => [puzzle.id, puzzle])
    );

    const journeyRows: any[] = (journeyResult.data ?? []) as any[];
    const journeyByPuzzle = new Map<string, any[]>();

    for (const entry of journeyRows) {
      const list = journeyByPuzzle.get(entry.puzzle_id) ?? [];
      list.push(entry);
      journeyByPuzzle.set(entry.puzzle_id, list);
    }

    const puzzles = rawPuzzles.map((puzzle: any) => {
      const owner = userMap.get(puzzle.owner_id);
      const holder = userMap.get(puzzle.current_holder_id);
      const rawJourney = journeyByPuzzle.get(puzzle.id) ?? [];
      const waitingCount = rawJourney.filter((entry: any) => entry.status === "waiting").length;

      const driftState = puzzle.availability === "retired" ? "retired" : "drifting";

      return {
        ...puzzle,
        owner_name: owner?.username ?? "未知用户",
        owner_avatar_url: owner?.avatar_url ?? null,
        current_holder_name: holder?.username ?? "未知用户",
        drift_state: driftState,
        waiting_count: waitingCount,
        journey: rawJourney.map((entry: any) => {
          const user = userMap.get(entry.user_id);
          return {
            id: entry.id,
            user_id: entry.user_id,
            username: user?.username ?? "未知用户",
            avatar_url: user?.avatar_url ?? null,
            seq: entry.seq,
            status: entry.status,
            is_owner_start: entry.is_owner_start,
            joined_at: entry.joined_at,
            received_on: entry.received_on,
            shipped_on: entry.shipped_on,
          };
        }),
      };
    });

    const activityRows: any[] = (activityResult.data ?? []) as any[];
    const activities = activityRows.map((activity: any) => {
      const actor = activity.actor_id ? userMap.get(activity.actor_id) : null;
      const puzzle = puzzleMap.get(activity.puzzle_id);
      return {
        id: activity.id,
        type: activity.type,
        puzzle_id: activity.puzzle_id,
        puzzle_name: puzzle?.name ?? "已删除拼图",
        actor_id: activity.actor_id,
        actor_name: actor?.username ?? "系统",
        actor_avatar_url: actor?.avatar_url ?? null,
        payload: activity.payload ?? {},
        created_at: activity.created_at,
      };
    });

    return NextResponse.json(
      {
        user: currentUser,
        puzzles,
        activities,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("GET /api/snapshot failed", error);
    return NextResponse.json({ error: "读取数据失败。" }, { status: 500 });
  }
}
