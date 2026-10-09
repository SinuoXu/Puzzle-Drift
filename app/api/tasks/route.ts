import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readState } from "@/lib/edgeone-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getReadyUser();

  if (!user) {
    return NextResponse.json(
      { error: "未登录。" },
      { status: 401 },
    );
  }

  const state = await readState();

  const userMap = new Map(
    state.app_users.map((row) => [
      row.id,
      row,
    ]),
  );

  const puzzleMap = new Map(
    state.puzzles.map((row) => [
      row.id,
      row,
    ]),
  );

  const journeyMap = new Map(
    state.puzzle_journey.map((row) => [
      row.id,
      row,
    ]),
  );

  const activeGroups =
    state.shipment_groups.filter(
      (group) =>
        group.sender_id === user.id &&
        (!group.shipping_done ||
          !group.fee_done),
    );

  const groupedPuzzleIds = new Set<string>();

  for (const group of activeGroups) {
    for (const puzzleId of
      group.puzzle_ids ?? []) {
      groupedPuzzleIds.add(puzzleId);
    }
  }

  const openTasks = state.puzzle_tasks
    .filter(
      (task) =>
        task.user_id === user.id &&
        task.status === "open",
    )
    .sort((a, b) =>
      String(a.created_at).localeCompare(
        String(b.created_at),
      ),
    );

  function immediateNext(
    puzzleId: string,
    turn: any,
  ) {
    return state.puzzle_journey
      .filter(
        (row) =>
          row.puzzle_id === puzzleId &&
          row.status !== "cancelled" &&
          Number(row.seq) >
            Number(turn?.seq ?? -1),
      )
      .sort(
        (a, b) =>
          Number(a.seq) -
          Number(b.seq),
      )[0] ?? null;
  }

  /*
   * Candidate groups:
   * open shipping-fee tasks where the sender still holds
   * each puzzle and the immediate next user is identical.
   */
  const candidateBuckets =
    new Map<string, any[]>();

  const seenCandidatePuzzles =
    new Set<string>();

  for (const task of openTasks) {
    if (task.kind !== "shipping_fee") continue;
    if (
      groupedPuzzleIds.has(task.puzzle_id) ||
      seenCandidatePuzzles.has(task.puzzle_id)
    ) {
      continue;
    }

    const puzzle =
      puzzleMap.get(task.puzzle_id);

    const turn =
      journeyMap.get(task.journey_id);

    if (
      !puzzle ||
      !turn ||
      turn.user_id !== user.id ||
      turn.status !== "current" ||
      turn.shipped_on
    ) {
      continue;
    }

    if (
      !turn.is_owner_start &&
      !turn.received_on
    ) {
      continue;
    }

    const next =
      state.puzzle_journey
        .filter(
          (row) =>
            row.puzzle_id ===
              task.puzzle_id &&
            row.status ===
              "waiting" &&
            Number(row.seq) >
              Number(turn.seq),
        )
        .sort(
          (a, b) =>
            Number(a.seq) -
            Number(b.seq),
        )[0];

    if (!next) continue;

    seenCandidatePuzzles.add(
      task.puzzle_id,
    );

    const bucket =
      candidateBuckets.get(
        next.user_id,
      ) ?? [];

    bucket.push({
      puzzle_id: puzzle.id,
      puzzle_name:
        puzzle.name ?? "拼图",
    });

    candidateBuckets.set(
      next.user_id,
      bucket,
    );
  }

  const mergeCandidates =
    [...candidateBuckets.entries()]
      .filter(
        ([, puzzles]) =>
          puzzles.length >= 2,
      )
      .map(([recipientId, puzzles]) => {
        const recipient =
          userMap.get(recipientId);

        return {
          id: recipientId,
          recipient_id:
            recipientId,
          destination: recipient
            ? {
                username:
                  recipient.username,
                shipping_address:
                  recipient.shipping_address ??
                  null,
              }
            : null,
          puzzles,
        };
      });

  /*
   * Hide the individual ship / shipping_fee cards belonging
   * to an active group. The group replaces those cards.
   */
  const visibleTasks =
    openTasks.filter(
      (task) =>
        !(
          groupedPuzzleIds.has(
            task.puzzle_id,
          ) &&
          (
            task.kind === "ship" ||
            task.kind === "shipping_fee"
          )
        ),
    );

  const tasks = visibleTasks.map((task) => {
    const puzzle =
      puzzleMap.get(task.puzzle_id);

    const turn =
      journeyMap.get(task.journey_id);

    let destination:
      | {
          username: string;
          shipping_address: string | null;
        }
      | null = null;

    let returnHome = false;

    if (
      task.kind === "ship" ||
      task.kind === "shipping_fee"
    ) {
      const next =
        immediateNext(
          task.puzzle_id,
          turn,
        );

      const recipientId =
        next?.user_id ??
        puzzle?.owner_id ??
        null;

      const recipient =
        recipientId
          ? userMap.get(recipientId)
          : null;

      destination = recipient
        ? {
            username:
              recipient.username,
            shipping_address:
              recipient.shipping_address ??
              null,
          }
        : null;

      returnHome = Boolean(
        turn &&
        !turn.is_owner_start &&
        !next &&
        puzzle?.current_holder_id ===
          puzzle?.owner_id &&
        puzzle?.availability ===
          "retired",
      );
    }

    const payee =
      task.payee_id
        ? userMap.get(task.payee_id)
        : null;

    const mergedIds =
      Array.isArray(
        task.merged_puzzle_ids,
      )
        ? task.merged_puzzle_ids
        : [];

    return {
      ...task,

      puzzle_name:
        puzzle?.name ?? "拼图",

      destination,

      return_home: returnHome,

      payee: payee
        ? {
            username:
              payee.username,
            payment_qr_url:
              payee.payment_qr_url ??
              null,
          }
        : null,

      merged_puzzle_names:
        mergedIds
          .map(
            (id: string) =>
              puzzleMap.get(id)?.name,
          )
          .filter(Boolean),
    };
  });

  const mergedGroups =
    activeGroups.map((group) => {
      const recipient =
        userMap.get(
          group.recipient_id,
        );

      return {
        id: group.id,
        puzzle_ids:
          group.puzzle_ids ?? [],
        puzzle_names:
          (group.puzzle_ids ?? [])
            .map(
              (id: string) =>
                puzzleMap.get(id)?.name,
            )
            .filter(Boolean),
        recipient_id:
          group.recipient_id,
        destination: recipient
          ? {
              username:
                recipient.username,
              shipping_address:
                recipient.shipping_address ??
                null,
            }
          : null,
        shipping_done:
          Boolean(group.shipping_done),
        fee_done:
          Boolean(group.fee_done),
        amount_cents:
          group.amount_cents ?? null,
      };
    });

  return NextResponse.json(
    {
      tasks,
      merge_candidates:
        mergeCandidates,
      merged_groups:
        mergedGroups,
    },
    {
      headers: {
        "Cache-Control":
          "private, max-age=15, stale-while-revalidate=30",
        Vary: "Cookie",
      },
    },
  );
}

export async function POST(
  request: NextRequest,
) {
  const user = await getReadyUser();

  if (!user) {
    return NextResponse.json(
      { error: "未登录。" },
      { status: 401 },
    );
  }

  const input = await request
    .json()
    .catch(() => null);

  if (
    !input ||
    typeof input.id !== "string"
  ) {
    return NextResponse.json(
      { error: "无效待办。" },
      { status: 400 },
    );
  }

  const { data, error } =
    await getSupabaseAdmin().rpc(
      "v03_mark_paid",
      {
        p_task_id: input.id,
        p_user_id: user.id,
      },
    );

  if (error || !data) {
    return NextResponse.json(
      { error: "更新待办失败。" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
