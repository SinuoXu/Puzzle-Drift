import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { isUploadedImageUrl } from "@/lib/image-url";
import {
  createStateBackup,
  getImageStore,
  imageKeyFromPublicUrl,
  isoNow,
  mutateState,
  nextActivityId,
  uuid,
} from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addTask(
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getReadyUser();

  if (!user) {
    return NextResponse.json(
      { error: "未登录。" },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  if (!body || typeof body.action !== "string") {
    return NextResponse.json(
      { error: "请求格式不正确。" },
      { status: 400 },
    );
  }

  /*
   * Cancel / rollback merged shipping.
   *
   * Safe cases:
   * - nothing submitted yet
   * - fee submitted, but recipient has not paid
   * - shipping submitted, but recipient has not received
   * - both partially progressed, while neither downstream action happened
   */
  /*
   * Cancel merged shipping.
   *
   * Simple rule:
   * always restore the selected puzzles to their
   * pre-merged independent shipping state.
   */
  if (body.action === "cancel") {
    try {
      const backupKey =
        await createStateBackup(
          `before-cancel-shipment-${id}`,
        );

      const result =
        await mutateState((state) => {
          const groupIndex =
            state.shipment_groups.findIndex(
              (group) =>
                group.id === id &&
                group.sender_id === user.id,
            );

          /*
           * Idempotent for weak-network retries.
           */
          if (groupIndex < 0) {
            return {
              already_cancelled: true,
              image_urls: [] as string[],
            };
          }

          const group =
            state.shipment_groups[
              groupIndex
            ];

          const imageUrls =
            new Set<string>();

          const addImage = (
            value: unknown,
          ) => {
            if (
              typeof value === "string" &&
              value
            ) {
              imageUrls.add(value);
            }
          };

          /*
           * Shared images / receipt will no longer be used.
           */
          for (
            const url of
            group.shipping_photo_urls ??
            []
          ) {
            addImage(url);
          }

          addImage(
            group.receipt_url,
          );

          /*
           * Remove the single merged payment task.
           * Whether it was open or done does not matter:
           * cancelling means the merged fee is discarded.
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

            const turn =
              state.puzzle_journey.find(
                (row) =>
                  row.id ===
                  item.turn_journey_id,
              );

            const recipientJourney =
              state.puzzle_journey.find(
                (row) =>
                  row.id ===
                  item.recipient_journey_id,
              );

            /*
             * Restore original sender turn.
             */
            if (turn) {
              for (
                const url of
                turn.shipping_photo_urls ??
                []
              ) {
                addImage(url);
              }

              turn.status = "current";
              turn.shipped_on = null;
              turn.shipping_photo_url =
                null;
              turn.shipping_photo_urls =
                [];
              turn.shipping_note = "";
            }

            /*
             * Put the next person back into waiting.
             * We intentionally keep this simple and reset the
             * journey to its pre-shipping state.
             */
            if (recipientJourney) {
              recipientJourney.status =
                "waiting";

              recipientJourney.received_on =
                null;
              recipientJourney.received_photo_url =
                null;
              recipientJourney.received_photo_urls =
                [];
              recipientJourney.receiving_note =
                "";

              recipientJourney.shipped_on =
                null;
              recipientJourney.shipping_photo_url =
                null;
              recipientJourney.shipping_photo_urls =
                [];
              recipientJourney.shipping_note =
                "";

              /*
               * These tasks only exist because the puzzle
               * advanced to this recipient.
               */
              state.puzzle_tasks =
                state.puzzle_tasks.filter(
                  (task) =>
                    !(
                      task.journey_id ===
                        recipientJourney.id &&
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
             * Puzzle returns to the cancelling sender.
             */
            if (puzzle) {
              puzzle.current_holder_id =
                user.id;
              puzzle.in_transit = false;
              puzzle.updated_at =
                isoNow();
            }

            /*
             * Restore sender's individual ship task.
             */
            if (turn) {
              let shipTask =
                state.puzzle_tasks.find(
                  (task) =>
                    task.puzzle_id ===
                      item.puzzle_id &&
                    task.journey_id ===
                      turn.id &&
                    task.user_id ===
                      user.id &&
                    task.kind ===
                      "ship",
                );

              if (!shipTask) {
                addTask(state, {
                  puzzle_id:
                    item.puzzle_id,
                  journey_id:
                    turn.id,
                  user_id:
                    user.id,
                  kind: "ship",
                });

                shipTask =
                  state.puzzle_tasks[
                    state.puzzle_tasks.length -
                      1
                  ];
              }

              shipTask.status = "open";
              shipTask.completed_at =
                null;

              delete shipTask
                .shipment_group_id;

              /*
               * Restore sender's individual fee task.
               */
              let feeTask =
                state.puzzle_tasks.find(
                  (task) =>
                    task.puzzle_id ===
                      item.puzzle_id &&
                    task.journey_id ===
                      turn.id &&
                    task.user_id ===
                      user.id &&
                    task.kind ===
                      "shipping_fee",
                );

              if (!feeTask) {
                addTask(state, {
                  puzzle_id:
                    item.puzzle_id,
                  journey_id:
                    turn.id,
                  user_id:
                    user.id,
                  kind:
                    "shipping_fee",
                });

                feeTask =
                  state.puzzle_tasks[
                    state.puzzle_tasks.length -
                      1
                  ];
              }

              addImage(
                feeTask.receipt_url,
              );

              feeTask.status = "open";
              feeTask.completed_at =
                null;
              feeTask.amount_cents =
                null;
              feeTask.tracking_number =
                "";
              feeTask.receipt_url =
                null;

              delete feeTask
                .shipment_group_id;
            }
          }

          /*
           * Remove activity generated specifically by the
           * merged shipping action.
           */
          state.puzzle_activity =
            state.puzzle_activity.filter(
              (activity) =>
                !(
                  activity.payload
                    ?.shipment_group_id ===
                  group.id
                ),
            );

          /*
           * The merge itself is now gone.
           */
          state.shipment_groups.splice(
            groupIndex,
            1,
          );

          return {
            already_cancelled: false,
            image_urls:
              [...imageUrls],
          };
        });

      /*
       * Best-effort cleanup of the shared merged-shipment
       * images and receipt.
       */
      const imageStore =
        getImageStore();

      const keys =
        new Set(
          result.image_urls
            .map((url) =>
              imageKeyFromPublicUrl(
                url,
              ),
            )
            .filter(
              (
                key,
              ): key is string =>
                Boolean(key),
            ),
        );

      await Promise.allSettled(
        [...keys].map((key) =>
          imageStore.delete(key),
        ),
      );

      return NextResponse.json({
        ok: true,
        restored: true,
        already_cancelled:
          result.already_cancelled,
        backup_key: backupKey,
      });
    } catch (error) {
      console.error(
        "Cancel merged shipment failed",
        error,
      );

      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "取消合并失败。",
        },
        { status: 400 },
      );
    }
  }

  /*
   * Shared shipping retention.
   */
  if (body.action === "shipping") {
    const date = body.date;

    const urls: string[] = Array.isArray(body.photo_urls)
      ? body.photo_urls.filter(
          (url: unknown): url is string =>
            typeof url === "string",
        )
      : [];

    const note =
      typeof body.note === "string"
        ? body.note.normalize("NFKC").trim()
        : "";

    if (
      typeof date !== "string" ||
      !DATE_RE.test(date)
    ) {
      return NextResponse.json(
        { error: "请选择发货日期。" },
        { status: 400 },
      );
    }

    if (
      urls.length < 1 ||
      urls.length > 12 ||
      !urls.every(
        (url) =>
          typeof url === "string" &&
          isUploadedImageUrl(
            url,
            "shipped",
            user.id,
          ),
      )
    ) {
      return NextResponse.json(
        { error: "请上传正确的发货留存图片。" },
        { status: 400 },
      );
    }

    if (Array.from(note).length > 1000) {
      return NextResponse.json(
        { error: "备注最多 1000 字。" },
        { status: 400 },
      );
    }

    try {
      const result = await mutateState((state) => {
        const group =
          state.shipment_groups.find(
            (row) =>
              row.id === id &&
              row.sender_id === user.id,
          );

        if (!group) {
          throw new Error("找不到这个合并发货。");
        }

        /*
         * Makes this action idempotent.
         */
        if (group.shipping_done) {
          return group;
        }

        for (const item of group.items ?? []) {
          const puzzle =
            state.puzzles.find(
              (row) =>
                row.id === item.puzzle_id,
            );

          const turn =
            state.puzzle_journey.find(
              (row) =>
                row.id ===
                item.turn_journey_id,
            );

          const recipientJourney =
            state.puzzle_journey.find(
              (row) =>
                row.id ===
                item.recipient_journey_id,
            );

          if (
            !puzzle ||
            !turn ||
            !recipientJourney
          ) {
            throw new Error(
              "有拼图的流转记录发生了变化，请重新检查。",
            );
          }

          if (
            turn.user_id !== user.id ||
            turn.status !== "current" ||
            turn.shipped_on
          ) {
            throw new Error(
              `《${puzzle.name}》已经不能按当前合并方案发货。`,
            );
          }

          const immediateNext =
            state.puzzle_journey
              .filter(
                (row) =>
                  row.puzzle_id ===
                    puzzle.id &&
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

          if (
            !immediateNext ||
            immediateNext.id !==
              recipientJourney.id ||
            recipientJourney.user_id !==
              group.recipient_id
          ) {
            throw new Error(
              `《${puzzle.name}》的下一棒已经变化，请取消合并后重新操作。`,
            );
          }
        }

        /*
         * All validations passed. Now update every puzzle
         * atomically using the same photos/date/note.
         */
        for (const item of group.items ?? []) {
          const puzzle =
            state.puzzles.find(
              (row) =>
                row.id === item.puzzle_id,
            )!;

          const turn =
            state.puzzle_journey.find(
              (row) =>
                row.id ===
                item.turn_journey_id,
            )!;

          const recipientJourney =
            state.puzzle_journey.find(
              (row) =>
                row.id ===
                item.recipient_journey_id,
            )!;

          turn.shipped_on = date;
          turn.shipping_photo_url =
            urls[0] ?? null;
          turn.shipping_photo_urls =
            [...urls];
          turn.shipping_note = note;
          turn.status = "completed";

          recipientJourney.status =
            "current";

          puzzle.current_holder_id =
            recipientJourney.user_id;
          puzzle.in_transit = true;
          puzzle.updated_at = isoNow();

          state.puzzle_activity.push({
            id: nextActivityId(state),
            type: "shipped",
            puzzle_id: puzzle.id,
            actor_id: user.id,
            payload: {
              shipped_on: date,
              shipment_group_id:
                group.id,
            },
            created_at: isoNow(),
          });

          for (const task of state.puzzle_tasks) {
            if (
              task.puzzle_id ===
                puzzle.id &&
              task.journey_id ===
                turn.id &&
              task.kind === "ship" &&
              task.status === "open"
            ) {
              task.status = "done";
              task.completed_at = isoNow();
              task.shipment_group_id =
                group.id;
            }
          }

          const existingReceive =
            state.puzzle_tasks.some(
              (task) =>
                task.journey_id ===
                  recipientJourney.id &&
                task.kind ===
                  "receive" &&
                task.status !==
                  "cancelled",
            );

          if (!existingReceive) {
            addTask(state, {
              puzzle_id: puzzle.id,
              journey_id:
                recipientJourney.id,
              user_id:
                recipientJourney.user_id,
              kind: "receive",
            });
          }
        }

        group.shipping_done = true;
        group.shipping_date = date;
        group.shipping_photo_urls =
          [...urls];
        group.shipping_note = note;
        group.updated_at = isoNow();

        return group;
      });

      return NextResponse.json({
        ok: true,
        group: result,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "合并发货留存失败。",
        },
        { status: 400 },
      );
    }
  }

  /*
   * Shared shipping fee.
   */
  if (body.action === "fee") {
    const amount = Number(body.amount_cents);

    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > 10_000_000
    ) {
      return NextResponse.json(
        { error: "请填写正确的邮费金额。" },
        { status: 400 },
      );
    }

    const tracking =
      typeof body.tracking_number === "string"
        ? body.tracking_number
            .normalize("NFKC")
            .trim()
            .slice(0, 120)
        : "";

    const receiptUrl =
      typeof body.receipt_url === "string"
        ? body.receipt_url
        : null;

    if (
      receiptUrl &&
      !isUploadedImageUrl(
        receiptUrl,
        "receipt",
        user.id,
      )
    ) {
      return NextResponse.json(
        { error: "运费截图地址不正确。" },
        { status: 400 },
      );
    }

    try {
      const result = await mutateState((state) => {
        const group =
          state.shipment_groups.find(
            (row) =>
              row.id === id &&
              row.sender_id === user.id,
          );

        if (!group) {
          throw new Error("找不到这个合并发货。");
        }

        /*
         * Also idempotent.
         */
        if (group.fee_done) {
          return group;
        }

        for (const item of group.items ?? []) {
          const feeTask =
            state.puzzle_tasks.find(
              (task) =>
                task.puzzle_id ===
                  item.puzzle_id &&
                task.journey_id ===
                  item.turn_journey_id &&
                task.user_id === user.id &&
                task.kind ===
                  "shipping_fee" &&
                task.status === "open",
            );

          if (!feeTask) {
            throw new Error(
              "有拼图的邮费已经被单独处理，不能继续合并。",
            );
          }

          const recipientJourney =
            state.puzzle_journey.find(
              (row) =>
                row.id ===
                item.recipient_journey_id,
            );

          if (
            !recipientJourney ||
            recipientJourney.user_id !==
              group.recipient_id ||
            recipientJourney.status ===
              "cancelled"
          ) {
            throw new Error(
              "收件人流转状态已经变化。",
            );
          }
        }

        for (const item of group.items ?? []) {
          const feeTask =
            state.puzzle_tasks.find(
              (task) =>
                task.puzzle_id ===
                  item.puzzle_id &&
                task.journey_id ===
                  item.turn_journey_id &&
                task.user_id === user.id &&
                task.kind ===
                  "shipping_fee" &&
                task.status === "open",
            )!;

          feeTask.status = "done";
          feeTask.completed_at = isoNow();
          feeTask.shipment_group_id =
            group.id;

          /*
           * The real combined amount lives on the group /
           * one recipient payment task. Do not treat it as
           * N separate postal charges.
           */
          feeTask.amount_cents = null;
          feeTask.tracking_number =
            tracking;
          feeTask.receipt_url =
            receiptUrl;
        }

        const existingPayment =
          state.puzzle_tasks.find(
            (task) =>
              task.kind ===
                "pay_shipping" &&
              task.shipment_group_id ===
                group.id &&
              task.status !==
                "cancelled",
          );

        if (!existingPayment) {
          const first =
            group.items[0];

          addTask(state, {
            puzzle_id:
              first.puzzle_id,
            journey_id:
              first.recipient_journey_id,
            user_id:
              group.recipient_id,
            payee_id:
              user.id,
            kind: "pay_shipping",
            amount_cents: amount,
            tracking_number:
              tracking,
            receipt_url:
              receiptUrl,
            shipment_group_id:
              group.id,
            merged_puzzle_ids:
              [...group.puzzle_ids],
          });
        }

        group.fee_done = true;
        group.amount_cents = amount;
        group.tracking_number =
          tracking;
        group.receipt_url =
          receiptUrl;
        group.updated_at = isoNow();

        return group;
      });

      return NextResponse.json({
        ok: true,
        group: result,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "合并邮费提交失败。",
        },
        { status: 400 },
      );
    }
  }

  return NextResponse.json(
    { error: "未知操作。" },
    { status: 400 },
  );
}
