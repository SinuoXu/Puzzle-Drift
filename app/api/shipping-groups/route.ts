import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import {
  isoNow,
  mutateState,
  uuid,
} from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getReadyUser();

  if (!user) {
    return NextResponse.json(
      { error: "未登录。" },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);

  const puzzleIds: string[] = Array.isArray(body?.puzzle_ids)
    ? Array.from(
        new Set<string>(
          body.puzzle_ids.filter(
            (value: unknown): value is string =>
              typeof value === "string",
          ),
        ),
      )
    : [];

  if (puzzleIds.length < 2) {
    return NextResponse.json(
      { error: "合并发货至少需要选择 2 张拼图。" },
      { status: 400 },
    );
  }

  if (puzzleIds.length > 20) {
    return NextResponse.json(
      { error: "一次最多合并 20 张拼图。" },
      { status: 400 },
    );
  }

  try {
    const group = await mutateState((state) => {
      let recipientId: string | null = null;

      const items: {
        puzzle_id: string;
        turn_journey_id: string;
        recipient_journey_id: string;
      }[] = [];

      for (const puzzleId of puzzleIds) {
        const puzzle = state.puzzles.find(
          (row) => row.id === puzzleId,
        );

        if (!puzzle || puzzle.availability === "retired") {
          throw new Error("有拼图已经不存在或已经退役。");
        }

        const existingGroup =
          state.shipment_groups.find(
            (item) =>
              Array.isArray(item.puzzle_ids) &&
              item.puzzle_ids.includes(puzzleId) &&
              (!item.shipping_done || !item.fee_done),
          );

        if (existingGroup) {
          throw new Error(
            `《${puzzle.name}》已经在另一个合并发货中。`,
          );
        }

        const turn = state.puzzle_journey.find(
          (row) =>
            row.puzzle_id === puzzleId &&
            row.user_id === user.id &&
            row.status === "current",
        );

        if (!turn || turn.shipped_on) {
          throw new Error(
            `《${puzzle.name}》目前不能发货。`,
          );
        }

        if (!turn.is_owner_start && !turn.received_on) {
          throw new Error(
            `《${puzzle.name}》需要先完成收货留存。`,
          );
        }

        const next = state.puzzle_journey
          .filter(
            (row) =>
              row.puzzle_id === puzzleId &&
              row.status === "waiting" &&
              Number(row.seq) > Number(turn.seq),
          )
          .sort(
            (a, b) =>
              Number(a.seq) - Number(b.seq),
          )[0];

        if (!next) {
          throw new Error(
            `《${puzzle.name}》目前没有下一棒。`,
          );
        }

        if (
          recipientId !== null &&
          recipientId !== next.user_id
        ) {
          throw new Error(
            "只能合并寄给同一个人的拼图。",
          );
        }

        recipientId = next.user_id;

        const feeTask = state.puzzle_tasks.find(
          (task) =>
            task.puzzle_id === puzzleId &&
            task.journey_id === turn.id &&
            task.user_id === user.id &&
            task.kind === "shipping_fee" &&
            task.status === "open",
        );

        if (!feeTask) {
          throw new Error(
            `《${puzzle.name}》的邮费已经处理，不能再加入合并发货。`,
          );
        }

        items.push({
          puzzle_id: puzzleId,
          turn_journey_id: turn.id,
          recipient_journey_id: next.id,
        });
      }

      if (!recipientId) {
        throw new Error("找不到收件人。");
      }

      const group = {
        id: uuid(),
        sender_id: user.id,
        recipient_id: recipientId,
        puzzle_ids: [...puzzleIds],
        items,
        shipping_done: false,
        fee_done: false,
        shipping_date: null,
        shipping_photo_urls: [],
        shipping_note: "",
        amount_cents: null,
        tracking_number: "",
        receipt_url: null,
        created_at: isoNow(),
        updated_at: isoNow(),
      };

      state.shipment_groups.push(group);

      return group;
    });

    return NextResponse.json(
      { group },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "创建合并发货失败。",
      },
      { status: 400 },
    );
  }
}
