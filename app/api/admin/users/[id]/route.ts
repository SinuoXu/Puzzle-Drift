import { NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import {
  getImageStore,
  imageKeyFromPublicUrl,
  mutateState,
} from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getReadyUser();

  if (!admin?.is_admin) {
    return NextResponse.json(
      { error: "只有管理员可以删除成员。" },
      { status: 403 },
    );
  }

  const { id } = await context.params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "无效的成员 ID。" },
      { status: 400 },
    );
  }

  if (id === admin.id) {
    return NextResponse.json(
      { error: "不能删除当前登录的管理员账号。" },
      { status: 409 },
    );
  }

  const result = await mutateState((state) => {
    const target = state.app_users.find(
      (row) => row.id === id,
    );

    if (!target) {
      return {
        ok: false as const,
        status: 404,
        error: "成员不存在。",
      };
    }

    if (target.is_admin) {
      return {
        ok: false as const,
        status: 409,
        error: "不能通过成员列表删除管理员账号。",
      };
    }

    /*
     * Puzzles owned by this member are allowed to cascade-delete.
     */
    const ownedPuzzleIds = new Set(
      state.puzzles
        .filter((puzzle) => puzzle.owner_id === id)
        .map((puzzle) => puzzle.id),
    );

    /*
     * But deleting somebody who is CURRENTLY holding another
     * person's active puzzle could destroy the active flow.
     */
    const activeHeldPuzzle = state.puzzles.find(
      (puzzle) =>
        puzzle.owner_id !== id &&
        puzzle.current_holder_id === id &&
        puzzle.availability !== "retired",
    );

    if (activeHeldPuzzle) {
      return {
        ok: false as const,
        status: 409,
        error:
          `无法删除：该成员目前正在持有《${activeHeldPuzzle.name ?? "一张拼图"}》。` +
          "请先完成这张拼图的交接或结束流程。",
      };
    }

    /*
     * Do not silently erase an unpaid / unfinished obligation
     * belonging to another person's puzzle.
     */
    const blockingTask = state.puzzle_tasks.find(
      (task) =>
        task.status === "open" &&
        !ownedPuzzleIds.has(task.puzzle_id) &&
        (
          task.user_id === id ||
          task.payee_id === id
        ),
    );

    if (blockingTask) {
      const puzzle = state.puzzles.find(
        (row) => row.id === blockingTask.puzzle_id,
      );

      return {
        ok: false as const,
        status: 409,
        error:
          `无法删除：该成员在《${puzzle?.name ?? "某张拼图"}》中还有未完成待办。` +
          "请先处理待办后再删除成员。",
      };
    }

    const imageUrls = new Set<string>();

    function addImage(value: unknown) {
      if (typeof value === "string" && value) {
        imageUrls.add(value);
      }
    }

    /*
     * Profile images.
     */
    addImage(target.avatar_url);
    addImage(target.payment_qr_url);

    /*
     * Collect images belonging to puzzles that will disappear.
     */
    for (const puzzle of state.puzzles) {
      if (ownedPuzzleIds.has(puzzle.id)) {
        addImage(puzzle.cover_url);
      }
    }

    for (const journey of state.puzzle_journey) {
      if (!ownedPuzzleIds.has(journey.puzzle_id)) continue;

      addImage(journey.received_photo_url);
      addImage(journey.shipping_photo_url);

      for (
        const url of Array.isArray(journey.received_photo_urls)
          ? journey.received_photo_urls
          : []
      ) {
        addImage(url);
      }

      for (
        const url of Array.isArray(journey.shipping_photo_urls)
          ? journey.shipping_photo_urls
          : []
      ) {
        addImage(url);
      }
    }

    for (const task of state.puzzle_tasks) {
      if (ownedPuzzleIds.has(task.puzzle_id)) {
        addImage(task.receipt_url);
      }
    }

    /*
     * Remember non-owned puzzles where this person appeared.
     * Waiting / completed / cancelled history may be removed.
     */
    const affectedPuzzleIds = new Set(
      state.puzzle_journey
        .filter(
          (row) =>
            row.user_id === id &&
            !ownedPuzzleIds.has(row.puzzle_id),
        )
        .map((row) => row.puzzle_id),
    );

    const targetJourneyIds = new Set(
      state.puzzle_journey
        .filter((row) => row.user_id === id)
        .map((row) => row.id),
    );

    /*
     * Cascade-delete puzzles owned by the member, plus direct
     * references to the deleted member elsewhere.
     */
    state.puzzle_tasks = state.puzzle_tasks.filter(
      (row) =>
        !ownedPuzzleIds.has(row.puzzle_id) &&
        row.user_id !== id &&
        row.payee_id !== id &&
        !targetJourneyIds.has(row.journey_id),
    );

    state.puzzle_handoffs = state.puzzle_handoffs.filter(
      (row) =>
        !ownedPuzzleIds.has(row.puzzle_id) &&
        row.from_user_id !== id &&
        row.to_user_id !== id,
    );

    state.puzzle_activity = state.puzzle_activity.filter(
      (row) =>
        !ownedPuzzleIds.has(row.puzzle_id) &&
        row.actor_id !== id,
    );

    state.puzzle_comments = state.puzzle_comments.filter(
      (row) =>
        !ownedPuzzleIds.has(row.puzzle_id) &&
        row.user_id !== id,
    );

    state.puzzle_journey = state.puzzle_journey.filter(
      (row) =>
        !ownedPuzzleIds.has(row.puzzle_id) &&
        row.user_id !== id,
    );

    state.puzzles = state.puzzles.filter(
      (row) => !ownedPuzzleIds.has(row.id),
    );

    state.app_sessions = state.app_sessions.filter(
      (row) => row.user_id !== id,
    );

    state.list_items = state.list_items.filter(
      (row) =>
        row.user_id !== id &&
        row.owner_id !== id &&
        row.created_by !== id,
    );

    state.app_users = state.app_users.filter(
      (row) => row.id !== id,
    );

    /*
     * If the deleted member was only waiting for an owner's
     * puzzle and nobody is waiting anymore, remove now-useless
     * owner shipping tasks.
     */
    for (const puzzleId of affectedPuzzleIds) {
      const current = state.puzzle_journey.find(
        (row) =>
          row.puzzle_id === puzzleId &&
          row.status === "current",
      );

      const stillWaiting = state.puzzle_journey.some(
        (row) =>
          row.puzzle_id === puzzleId &&
          row.status === "waiting",
      );

      if (current?.is_owner_start && !stillWaiting) {
        for (const task of state.puzzle_tasks) {
          if (
            task.puzzle_id === puzzleId &&
            task.journey_id === current.id &&
            task.status === "open" &&
            ["ship", "shipping_fee"].includes(task.kind)
          ) {
            task.status = "cancelled";
            task.completed_at = new Date().toISOString();
          }
        }
      }
    }

    return {
      ok: true as const,
      status: 200,
      imageUrls: [...imageUrls],
      deletedUsername: target.username,
    };
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  /*
   * Database state is already safely committed.
   * Blob deletion is best-effort afterwards.
   */
  const keys = new Set(
    result.imageUrls
      .map((url) => imageKeyFromPublicUrl(url))
      .filter((key): key is string => Boolean(key)),
  );

  const store = getImageStore();

  await Promise.allSettled(
    [...keys].map((key) => store.delete(key)),
  );

  return NextResponse.json({
    ok: true,
    username: result.deletedUsername,
  });
}
