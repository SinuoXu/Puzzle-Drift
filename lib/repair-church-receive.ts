import { createHash } from "node:crypto";
import type { EdgeState } from "./edgeone-store";

// One-time repair for the physical delivery confirmed by nono. No dates,
// photographs, postage or payment records are inferred by this repair.
export const CHURCH_REPAIR = {
  puzzleId: "dfb29c17-f464-47d2-8b50-3757713bd294",
  puzzleName: "圣伊格内修斯教会",
  ownerId: "03b33ea4-505a-4239-9aeb-d11b3886dc46",
  recipientId: "438f2c0d-d631-42dd-b57b-b3fa340805a6",
  auditKey: "church_receive_holder_repair_v1",
} as const;

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function inspectChurchRepair(state: EdgeState) {
  const puzzle = state.puzzles.find((row) => row.id === CHURCH_REPAIR.puzzleId);
  const owner = state.app_users.find((row) => row.id === CHURCH_REPAIR.ownerId);
  const recipient = state.app_users.find((row) => row.id === CHURCH_REPAIR.recipientId);
  if (!puzzle || puzzle.name !== CHURCH_REPAIR.puzzleName ||
      puzzle.owner_id !== CHURCH_REPAIR.ownerId || owner?.username !== "唐女士" ||
      recipient?.username !== "nono" || !recipient.is_admin) {
    throw new Error("拼图或成员身份不符，已停止修复。");
  }
  const audit = state.metadata?.[CHURCH_REPAIR.auditKey];
  if (audit) return { alreadyRepaired: true as const, audit };

  const journey = state.puzzle_journey.filter((row) => row.puzzle_id === puzzle.id);
  const current = journey.filter((row) => row.status === "current");
  const waiting = journey.filter((row) => row.status === "waiting")
    .sort((a, b) => Number(a.seq) - Number(b.seq));
  const sender = current[0];
  const receiver = waiting[0];
  if (puzzle.availability !== "active" || puzzle.current_holder_id !== owner.id ||
      puzzle.in_transit || current.length !== 1 || sender?.user_id !== owner.id ||
      !sender.is_owner_start || sender.shipped_on || receiver?.user_id !== recipient.id ||
      receiver.is_owner_start || receiver.received_on || receiver.shipped_on ||
      journey.some((row) => row.user_id === recipient.id && row.status === "completed") ||
      (Array.isArray(receiver.received_photo_urls) && receiver.received_photo_urls.length) ||
      receiver.received_photo_url) {
    throw new Error("流转状态已经变化或已有留存，已停止修复。");
  }
  if (state.shipment_groups.some((group) =>
    (group.puzzle_ids ?? []).includes(puzzle.id) && (!group.shipping_done || !group.fee_done))) {
    throw new Error("这张图在活动合并发货中，需先核对合并记录。");
  }
  if (state.puzzle_handoffs.some((row) => row.puzzle_id === puzzle.id)) {
    throw new Error("已有面交记录，需先人工核对。");
  }
  const tasks = state.puzzle_tasks.filter((row) => row.puzzle_id === puzzle.id);
  const receives = tasks.filter((row) => row.journey_id === receiver.id && row.kind === "receive");
  if (receives.length > 1 || receives.some((row) => row.user_id !== recipient.id || row.status !== "open") ||
      tasks.some((row) => row.journey_id === receiver.id && ["ship", "shipping_fee"].includes(row.kind))) {
    throw new Error("收货待办与流转记录不一致，已停止修复。");
  }
  return {
    alreadyRepaired: false as const,
    fingerprint: digest({ puzzle, journey, tasks }),
    puzzle, sender, receiver, tasks,
    receiveTask: receives[0] ?? null,
  };
}

export function applyChurchRepair(state: EdgeState, fingerprint: string, backupKey: string, now: string, taskId: string) {
  const plan = inspectChurchRepair(state);
  if (plan.alreadyRepaired) return plan.audit;
  if (plan.fingerprint !== fingerprint) throw new Error("核对后数据有变化，请重新核对再修复。");
  const { puzzle, sender, receiver, tasks, receiveTask } = plan;
  sender.status = "completed";
  receiver.status = "current";
  puzzle.current_holder_id = CHURCH_REPAIR.recipientId;
  puzzle.in_transit = false;
  puzzle.updated_at = now;

  // Leave the previous sender's postage/payment tasks intact. Only the obsolete
  // ship task is cancelled; the audit explains why no shipping date is present.
  const cancelledShipTaskIds: string[] = [];
  for (const task of tasks) {
    if (task.journey_id === sender.id && task.kind === "ship" && task.status === "open") {
      task.status = "cancelled";
      task.completed_at = now;
      cancelledShipTaskIds.push(task.id);
    }
  }
  if (!receiveTask) state.puzzle_tasks.push({
    id: taskId, puzzle_id: puzzle.id, journey_id: receiver.id,
    user_id: CHURCH_REPAIR.recipientId, kind: "receive", status: "open",
    payee_id: null, amount_cents: null, tracking_number: null, receipt_url: null,
    created_at: now, completed_at: null,
  });
  const audit = {
    puzzle_id: puzzle.id, from_user_id: sender.user_id, to_user_id: receiver.user_id,
    sender_journey_id: sender.id, receiver_journey_id: receiver.id,
    receive_task_id: receiveTask?.id ?? taskId, cancelled_ship_task_ids: cancelledShipTaskIds,
    reason: "nono 已确认实物收到；仅恢复持有人及收货留存入口，未代填任何留存或邮费。",
    repaired_at: now, backup_key: backupKey,
  };
  state.metadata = { ...(state.metadata ?? {}), [CHURCH_REPAIR.auditKey]: audit };
  return audit;
}
