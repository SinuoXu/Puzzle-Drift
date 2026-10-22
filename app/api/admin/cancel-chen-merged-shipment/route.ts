import { NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import {
  createStateBackup,
  isoNow,
  mutateState,
  readState,
  uuid,
} from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function addOpenTask(
  state: any,
  input: Record<string, any>,
) {
  state.puzzle_tasks.push({
    id: uuid(),
    status: "open",
    payee_id: null,
    amount_cents: null,
    tracking_number: null,
    receipt_url: null,
    created_at: isoNow(),
    completed_at: null,
    ...input,
  });
}

function restoreTask(
  state: any,
  input: {
    puzzle_id: string;
    journey_id: string;
    user_id: string;
    kind: "ship" | "shipping_fee";
  },
) {
  let task =
    state.puzzle_tasks.find(
      (row: any) =>
        row.puzzle_id ===
          input.puzzle_id &&
        row.journey_id ===
          input.journey_id &&
        row.user_id ===
          input.user_id &&
        row.kind === input.kind,
    );

  if (!task) {
    addOpenTask(state, input);

    task =
      state.puzzle_tasks[
        state.puzzle_tasks.length - 1
      ];
  }

  task.status = "open";
  task.completed_at = null;

  delete task.shipment_group_id;

  if (
    input.kind ===
    "shipping_fee"
  ) {
    task.amount_cents = null;
    task.tracking_number = "";
    task.receipt_url = null;
  }
}

export async function POST() {
  const admin =
    await getReadyUser();

  if (!admin?.is_admin) {
    return NextResponse.json(
      {
        error:
          "只有管理员可以执行这个修复。",
      },
      { status: 403 },
    );
  }

  try {
    /*
     * First inspect without changing anything.
     */
    const snapshot =
      await readState();

    const chenUsers =
      snapshot.app_users.filter(
        (row) =>
          typeof row.username ===
            "string" &&
          row.username
            .normalize("NFKC")
            .trim() === "陳",
      );

    if (
      chenUsers.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "没有找到用户名为「陳」的成员。",
        },
        { status: 404 },
      );
    }

    if (
      chenUsers.length > 1
    ) {
      return NextResponse.json(
        {
          error:
            "发现多个用户名为「陳」的成员，已停止操作。",
        },
        { status: 409 },
      );
    }

    const chen =
      chenUsers[0];

    /*
     * Same definition currently used by /api/tasks:
     * at least one part of the merged shipment is unfinished.
     */
    const groups =
      snapshot.shipment_groups.filter(
        (group) =>
          group.sender_id ===
            chen.id &&
          (
            !group.shipping_done ||
            !group.fee_done
          ),
      );

    if (
      groups.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "「陳」目前没有活动中的合并发货。",
        },
        { status: 404 },
      );
    }

    if (
      groups.length > 1
    ) {
      return NextResponse.json(
        {
          error:
            `「陳」目前有 ${groups.length} 组合并发货，无法确定要取消哪一组，已停止操作。`,
        },
        { status: 409 },
      );
    }

    const targetGroup =
      groups[0];

    const puzzleNames =
      (targetGroup.puzzle_ids ?? [])
        .map(
          (id: string) =>
            snapshot.puzzles.find(
              (puzzle) =>
                puzzle.id === id,
            )?.name,
        )
        .filter(
          (
            value: unknown,
          ): value is string =>
            typeof value ===
            "string",
        );

    /*
     * Full state backup BEFORE mutation.
     */
    const backupKey =
      await createStateBackup(
        `before-admin-cancel-chen-${targetGroup.id}`,
      );

    await mutateState((state) => {
      const groupIndex =
        state.shipment_groups.findIndex(
          (group) =>
            group.id ===
              targetGroup.id &&
            group.sender_id ===
              chen.id,
        );

      if (groupIndex < 0) {
        throw new Error(
          "合并发货状态刚刚发生变化，请重新操作。",
        );
      }

      const group =
        state.shipment_groups[
          groupIndex
        ];

      /*
       * Delete the single combined payment task,
       * regardless of its current status.
       */
      state.puzzle_tasks =
        state.puzzle_tasks.filter(
          (task) =>
            !(
              task.kind ===
                "pay_shipping" &&
              task.shipment_group_id ===
                group.id
            ),
        );

      for (
        const item of
        group.items ?? []
      ) {
        const puzzle =
          state.puzzles.find(
            (row) =>
              row.id ===
                item.puzzle_id,
          );

        const senderJourney =
          state.puzzle_journey.find(
            (row) =>
              row.id ===
                item.turn_journey_id,
          );

        const nextJourney =
          state.puzzle_journey.find(
            (row) =>
              row.id ===
                item.recipient_journey_id,
          );

        /*
         * Restore 陳's journey to current holder.
         */
        if (senderJourney) {
          senderJourney.status =
            "current";

          senderJourney.shipped_on =
            null;

          senderJourney.shipping_photo_url =
            null;

          senderJourney.shipping_photo_urls =
            [];

          senderJourney.shipping_note =
            "";
        }

        /*
         * Restore next person to waiting.
         * Clear anything created after the merged shipment.
         */
        if (nextJourney) {
          nextJourney.status =
            "waiting";

          nextJourney.received_on =
            null;

          nextJourney.received_photo_url =
            null;

          nextJourney.received_photo_urls =
            [];

          nextJourney.receiving_note =
            "";

          nextJourney.shipped_on =
            null;

          nextJourney.shipping_photo_url =
            null;

          nextJourney.shipping_photo_urls =
            [];

          nextJourney.shipping_note =
            "";

          /*
           * Remove tasks that only exist because
           * the puzzle was advanced to the next holder.
           */
          state.puzzle_tasks =
            state.puzzle_tasks.filter(
              (task) =>
                !(
                  task.journey_id ===
                    nextJourney.id &&
                  [
                    "receive",
                    "ship",
                    "shipping_fee",
                  ].includes(
                    task.kind,
                  )
                ),
            );
        }

        /*
         * Puzzle becomes held by 陳 again.
         */
        if (puzzle) {
          puzzle.current_holder_id =
            chen.id;

          puzzle.in_transit =
            false;

          puzzle.updated_at =
            isoNow();
        }

        /*
         * Restore the two independent sender tasks.
         */
        if (senderJourney) {
          restoreTask(state, {
            puzzle_id:
              item.puzzle_id,
            journey_id:
              senderJourney.id,
            user_id:
              chen.id,
            kind: "ship",
          });

          restoreTask(state, {
            puzzle_id:
              item.puzzle_id,
            journey_id:
              senderJourney.id,
            user_id:
              chen.id,
            kind: "shipping_fee",
          });
        }
      }

      /*
       * Remove activities generated by this merged shipment.
       */
      state.puzzle_activity =
        state.puzzle_activity.filter(
          (activity) =>
            activity.payload
              ?.shipment_group_id !==
            group.id,
        );

      /*
       * Finally delete the merge itself.
       */
      state.shipment_groups.splice(
        groupIndex,
        1,
      );
    });

    return NextResponse.json({
      ok: true,
      username: chen.username,
      group_id:
        targetGroup.id,
      puzzle_names:
        puzzleNames,
      backup_key:
        backupKey,
    });
  } catch (error) {
    console.error(
      "Admin cancel Chen merged shipment failed",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "修复失败。",
      },
      { status: 500 },
    );
  }
}
