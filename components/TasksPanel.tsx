"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";
import { uploadImage } from "@/lib/client-image";

export type Task = {
  id: string;
  puzzle_id: string;
  puzzle_name: string;
  kind: string;
  amount_cents: number | null;
  return_home?: boolean;
  shipment_group_id?: string | null;
  merged_puzzle_names?: string[];
  destination?: {
    username: string;
    shipping_address: string | null;
  } | null;
  payee?: {
    username: string;
    payment_qr_url: string | null;
  } | null;
};

type MergeCandidate = {
  id: string;
  recipient_id: string;
  destination: {
    username: string;
    shipping_address: string | null;
  } | null;
  puzzles: {
    puzzle_id: string;
    puzzle_name: string;
  }[];
};

type MergedGroup = {
  id: string;
  puzzle_ids: string[];
  puzzle_names: string[];
  recipient_id: string;
  destination: {
    username: string;
    shipping_address: string | null;
  } | null;
  shipping_done: boolean;
  fee_done: boolean;
  amount_cents: number | null;
};

type Payload = {
  tasks: Task[];
  merge_candidates: MergeCandidate[];
  merged_groups: MergedGroup[];
};

const labels: Record<string, string> = {
  receive: "收货留存",
  ship: "发货留存",
  shipping_fee: "填写发货邮费",
  pay_shipping: "支付邮费",
  pay_return: "支付回家邮费",
};

function cacheKey(userId: string) {
  return `puzzle-drift:tasks-v2:${userId}`;
}

function readCache(
  userId: string,
): Payload | null {
  try {
    const value =
      window.localStorage.getItem(
        cacheKey(userId),
      );

    if (!value) return null;

    const parsed = JSON.parse(value);

    if (
      !Array.isArray(parsed.tasks) ||
      !Array.isArray(
        parsed.merge_candidates,
      ) ||
      !Array.isArray(
        parsed.merged_groups,
      )
    ) {
      return null;
    }

    return parsed as Payload;
  } catch {
    return null;
  }
}

function writeCache(
  userId: string,
  payload: Payload,
) {
  try {
    window.localStorage.setItem(
      cacheKey(userId),
      JSON.stringify(payload),
    );
  } catch {
    // Ignore private-browser storage failures.
  }
}

function todayString() {
  const now = new Date();

  const local = new Date(
    now.getTime() -
      now.getTimezoneOffset() *
        60_000,
  );

  return local
    .toISOString()
    .slice(0, 10);
}

export function TasksPanel({
  userId,
  refreshKey,
  onOpenPuzzle,
  onChanged,
}: {
  userId: string;
  refreshKey: number;
  onOpenPuzzle: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [tasks, setTasks] =
    useState<Task[]>([]);

  const [
    mergeCandidates,
    setMergeCandidates,
  ] = useState<MergeCandidate[]>([]);

  const [
    mergedGroups,
    setMergedGroups,
  ] = useState<MergedGroup[]>([]);

  const [error, setError] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [
    selectingCandidate,
    setSelectingCandidate,
  ] =
    useState<MergeCandidate | null>(
      null,
    );

  const [
    selectedPuzzleIds,
    setSelectedPuzzleIds,
  ] = useState<Set<string>>(
    new Set(),
  );

  const [
    activeGroup,
    setActiveGroup,
  ] =
    useState<MergedGroup | null>(
      null,
    );

  const [busy, setBusy] =
    useState(false);

  /*
   * Shared shipping-retention form.
   */
  const [shipDate, setShipDate] =
    useState(todayString());

  const [shipFiles, setShipFiles] =
    useState<File[]>([]);

  const [shipNote, setShipNote] =
    useState("");

  /*
   * Shared fee / individual fee form.
   */
  const [feeAmount, setFeeAmount] =
    useState("");

  const [tracking, setTracking] =
    useState("");

  const [receiptFile, setReceiptFile] =
    useState<File | null>(null);

  const [
    individualFeeTask,
    setIndividualFeeTask,
  ] = useState<Task | null>(null);

  useEffect(() => {
    let active = true;

    const cached =
      readCache(userId);

    if (cached) {
      setTasks(cached.tasks);
      setMergeCandidates(
        cached.merge_candidates,
      );
      setMergedGroups(
        cached.merged_groups,
      );
      setLoading(false);
    } else {
      setLoading(true);
    }

    void fetch(
      `/api/tasks?revision=${refreshKey}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const data =
          await response
            .json()
            .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.error ??
              "读取待办失败。",
          );
        }

        return {
          tasks:
            data.tasks ?? [],
          merge_candidates:
            data.merge_candidates ??
            [],
          merged_groups:
            data.merged_groups ?? [],
        } as Payload;
      })
      .then((payload) => {
        if (!active) return;

        setTasks(payload.tasks);
        setMergeCandidates(
          payload.merge_candidates,
        );
        setMergedGroups(
          payload.merged_groups,
        );

        writeCache(
          userId,
          payload,
        );

        setError("");
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "读取待办失败。",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [userId, refreshKey]);

  async function paid(id: string) {
    const response = await fetch(
      "/api/tasks",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({ id }),
      },
    );

    if (!response.ok) {
      setError("标记支付失败。");
      return;
    }

    await onChanged();
  }

  function openMergePicker(
    candidate: MergeCandidate,
  ) {
    setSelectingCandidate(
      candidate,
    );

    setSelectedPuzzleIds(
      new Set(
        candidate.puzzles.map(
          (puzzle) =>
            puzzle.puzzle_id,
        ),
      ),
    );
  }

  async function createGroup() {
    if (
      !selectingCandidate ||
      selectedPuzzleIds.size < 2
    ) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        "/api/shipping-groups",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            puzzle_ids:
              [...selectedPuzzleIds],
          }),
        },
      );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ??
            "创建合并发货失败。",
        );
      }

      setSelectingCandidate(null);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "创建合并发货失败。",
      );
    } finally {
      setBusy(false);
    }
  }

  function openMergedGroup(
    group: MergedGroup,
  ) {
    setActiveGroup(group);
    setShipDate(todayString());
    setShipFiles([]);
    setShipNote("");
    setFeeAmount("");
    setTracking("");
    setReceiptFile(null);
  }

  async function cancelMergedGroup() {
    if (!activeGroup) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/shipping-groups/${activeGroup.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            action: "cancel",
          }),
        },
      );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ??
            "取消合并失败。",
        );
      }

      setActiveGroup(null);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "取消合并失败。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitMergedShipping(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (
      !activeGroup ||
      shipFiles.length === 0
    ) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const urls =
        await Promise.all(
          shipFiles.map((file) =>
            uploadImage(
              file,
              "shipped",
            ),
          ),
        );

      const response = await fetch(
        `/api/shipping-groups/${activeGroup.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            action: "shipping",
            date: shipDate,
            photo_urls: urls,
            note: shipNote,
          }),
        },
      );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ??
            "合并发货留存失败。",
        );
      }

      setActiveGroup(null);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "合并发货留存失败。",
      );
    } finally {
      setBusy(false);
    }
  }

  function parseAmount():
    | number
    | null {
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(
        feeAmount,
      )
    ) {
      return null;
    }

    const [yuan, fen = ""] =
      feeAmount.split(".");

    const amount =
      Number(yuan) * 100 +
      Number(
        fen.padEnd(2, "0"),
      );

    return Number.isSafeInteger(amount) &&
      amount > 0
      ? amount
      : null;
  }

  async function submitMergedFee(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (!activeGroup) return;

    const amount =
      parseAmount();

    if (!amount) {
      setError(
        "请输入正确的邮费金额。",
      );
      return;
    }

    setBusy(true);
    setError("");

    try {
      const receiptUrl =
        receiptFile
          ? await uploadImage(
              receiptFile,
              "receipt",
            )
          : null;

      const response = await fetch(
        `/api/shipping-groups/${activeGroup.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            action: "fee",
            amount_cents:
              amount,
            tracking_number:
              tracking,
            receipt_url:
              receiptUrl,
          }),
        },
      );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ??
            "合并邮费提交失败。",
        );
      }

      setActiveGroup(null);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "合并邮费提交失败。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitIndividualFee(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (!individualFeeTask) return;

    const amount =
      parseAmount();

    if (!amount) {
      setError(
        "请输入正确的邮费金额。",
      );
      return;
    }

    setBusy(true);
    setError("");

    try {
      const receiptUrl =
        receiptFile
          ? await uploadImage(
              receiptFile,
              "receipt",
            )
          : null;

      const response = await fetch(
        `/api/puzzles/${individualFeeTask.puzzle_id}/fee`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            amount_cents:
              amount,
            tracking_number:
              tracking,
            receipt_url:
              receiptUrl,
            return_home:
              individualFeeTask.return_home ===
              true,
          }),
        },
      );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ??
            "填写邮费失败。",
        );
      }

      setIndividualFeeTask(null);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "填写邮费失败。",
      );
    } finally {
      setBusy(false);
    }
  }

  function openIndividualFee(
    task: Task,
  ) {
    setIndividualFeeTask(task);
    setFeeAmount("");
    setTracking("");
    setReceiptFile(null);
  }

  const visibleCount =
    tasks.length +
    mergedGroups.length;

  return (
    <section>
      <h2>
        我的待办{" "}
        <small>
          ({visibleCount})
        </small>
      </h2>

      {error && (
        <div className="errorBox">
          {error}
        </div>
      )}

      {loading &&
        visibleCount === 0 && (
          <div className="emptyPanel">
            正在读取待办…
          </div>
        )}

      {!loading &&
        !error &&
        visibleCount === 0 && (
          <div className="emptyPanel">
            目前没有待办。
          </div>
        )}

      <div className="taskList">
        {mergedGroups.map(
          (group) => (
            <article
              className="sidebarCard mergedTaskCard"
              key={`group-${group.id}`}
            >
              <h3>
                合并发货 ·{" "}
                {group.puzzle_names.length} 张拼图
              </h3>

              <p className="mergedPuzzleNames">
                {group.puzzle_names.join(
                  "、",
                )}
              </p>

              {group.destination && (
                <div>
                  <p>
                    寄给：
                    {
                      group.destination
                        .username
                    }
                  </p>

                  <p>
                    {group.destination
                      .shipping_address ||
                      "对方还没有填写地址"}
                  </p>

                  {group.destination
                    .shipping_address && (
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          group.destination
                            ?.shipping_address ??
                            "",
                        )
                      }
                    >
                      复制地址
                    </button>
                  )}
                </div>
              )}

              <div className="mergedTaskStatus">
                <span
                  className={
                    group.shipping_done
                      ? "done"
                      : ""
                  }
                >
                  {group.shipping_done
                    ? "✓ 发货留存"
                    : "○ 发货留存"}
                </span>

                <span
                  className={
                    group.fee_done
                      ? "done"
                      : ""
                  }
                >
                  {group.fee_done
                    ? "✓ 邮费"
                    : "○ 邮费"}
                </span>
              </div>

              <button
                className="primaryButton"
                type="button"
                onClick={() =>
                  openMergedGroup(
                    group,
                  )
                }
              >
                处理合并发货
              </button>
            </article>
          ),
        )}

        {tasks.map((task) => {
          const candidate =
            task.kind ===
            "shipping_fee"
              ? mergeCandidates.find(
                  (item) =>
                    item.puzzles.some(
                      (puzzle) =>
                        puzzle.puzzle_id ===
                        task.puzzle_id,
                    ),
                )
              : undefined;

          const title =
            task.kind ===
              "pay_shipping" &&
            task.merged_puzzle_names &&
            task.merged_puzzle_names
              .length > 1
              ? `支付合并邮费 · ${task.merged_puzzle_names.join("、")}`
              : `${
                  labels[task.kind] ??
                  task.kind
                } · ${
                  task.puzzle_name
                }`;

          return (
            <article
              className="sidebarCard"
              key={task.id}
            >
              <h3>{title}</h3>

              {task.destination && (
                <div>
                  <p>
                    寄给：
                    {
                      task.destination
                        .username
                    }
                  </p>

                  <p>
                    {task.destination
                      .shipping_address ||
                      "对方还没有填写地址"}
                  </p>

                  {task.destination
                    .shipping_address && (
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          task.destination
                            ?.shipping_address ??
                            "",
                        )
                      }
                    >
                      复制地址
                    </button>
                  )}
                </div>
              )}

              {task.amount_cents !==
                null && (
                <p>
                  金额：¥
                  {(
                    task.amount_cents /
                    100
                  ).toFixed(2)}
                </p>
              )}

              {task.payee && (
                <div>
                  <p>
                    收款人：
                    {
                      task.payee
                        .username
                    }
                  </p>

                  {task.payee
                    .payment_qr_url ? (
                    <img
                      src={
                        task.payee
                          .payment_qr_url
                      }
                      alt="收款码"
                      style={{
                        width: 150,
                        maxWidth:
                          "100%",
                      }}
                    />
                  ) : (
                    <p>
                      收款人未设置收款码
                    </p>
                  )}
                </div>
              )}

              <div className="modalActions alignLeft taskActions">
                <button
                  className="primaryButton"
                  type="button"
                  onClick={() =>
                    onOpenPuzzle(
                      task.puzzle_id,
                    )
                  }
                >
                  查看拼图
                </button>

                {task.kind ===
                  "shipping_fee" && (
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() =>
                      openIndividualFee(
                        task,
                      )
                    }
                  >
                    填写邮费
                  </button>
                )}

                {candidate && (
                  <button
                    className="mergeShippingButton"
                    type="button"
                    onClick={() =>
                      openMergePicker(
                        candidate,
                      )
                    }
                  >
                    可合并发货
                  </button>
                )}

                {task.kind.startsWith(
                  "pay_",
                ) && (
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() =>
                      void paid(task.id)
                    }
                  >
                    我已支付
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Choose puzzles to merge */}
      {selectingCandidate && (
        <div
          className="modalBackdrop"
          onMouseDown={() =>
            setSelectingCandidate(null)
          }
        >
          <div
            className="modalCard modalNarrow mergeShipmentModal"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">
                  Combined shipping
                </p>
                <h2>选择合并发货</h2>
              </div>

              <button
                type="button"
                className="iconButton"
                onClick={() =>
                  setSelectingCandidate(
                    null,
                  )
                }
              >
                ×
              </button>
            </div>

            <p>
              这些拼图的下一棒都是{" "}
              <strong>
                {
                  selectingCandidate
                    .destination
                    ?.username
                }
              </strong>
              。
            </p>

            <div className="mergePuzzleChoices">
              {selectingCandidate.puzzles.map(
                (puzzle) => (
                  <label
                    className="mergePuzzleChoice"
                    key={
                      puzzle.puzzle_id
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selectedPuzzleIds.has(
                        puzzle.puzzle_id,
                      )}
                      onChange={(
                        event,
                      ) => {
                        const next =
                          new Set(
                            selectedPuzzleIds,
                          );

                        if (
                          event.target
                            .checked
                        ) {
                          next.add(
                            puzzle.puzzle_id,
                          );
                        } else {
                          next.delete(
                            puzzle.puzzle_id,
                          );
                        }

                        setSelectedPuzzleIds(
                          next,
                        );
                      }}
                    />

                    <span>
                      {
                        puzzle.puzzle_name
                      }
                    </span>
                  </label>
                ),
              )}
            </div>

            <p className="actionHint">
              至少选择 2 张。确认后，它们的发货留存和邮费会合并成一个待办。
            </p>

            <div className="modalActions">
              <button
                className="secondaryButton"
                type="button"
                onClick={() =>
                  setSelectingCandidate(
                    null,
                  )
                }
              >
                取消
              </button>

              <button
                className="primaryButton"
                type="button"
                disabled={
                  busy ||
                  selectedPuzzleIds.size <
                    2
                }
                onClick={() =>
                  void createGroup()
                }
              >
                {busy
                  ? "处理中…"
                  : `合并 ${selectedPuzzleIds.size} 张`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actual combined-shipping workflow */}
      {activeGroup && (
        <div
          className="modalBackdrop"
          onMouseDown={() =>
            setActiveGroup(null)
          }
        >
          <div
            className="modalCard modalWide mergeShipmentModal"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">
                  Combined shipping
                </p>
                <h2>
                  合并发货 ·{" "}
                  {
                    activeGroup
                      .puzzle_names
                      .length
                  }{" "}
                  张
                </h2>
              </div>

              <button
                type="button"
                className="iconButton"
                onClick={() =>
                  setActiveGroup(null)
                }
              >
                ×
              </button>
            </div>

            <p className="mergedPuzzleNames">
              {activeGroup.puzzle_names.join(
                "、",
              )}
            </p>

            {activeGroup.destination && (
              <div className="destinationBox">
                <strong>
                  收件人：
                  {
                    activeGroup
                      .destination
                      .username
                  }
                </strong>

                <p>
                  {activeGroup
                    .destination
                    .shipping_address ||
                    "地址尚未填写"}
                </p>
              </div>
            )}

            <p className="mergeOrderHint">
              发货留存和邮费可以按任意顺序完成。
            </p>

            <div className="mergedShippingForms">
              <section className="mergedShippingStep">
                <h3>
                  {activeGroup.shipping_done
                    ? "✓ 发货留存已完成"
                    : "发货留存"}
                </h3>

                {!activeGroup.shipping_done && (
                  <form
                    className="formStack"
                    onSubmit={
                      submitMergedShipping
                    }
                  >
                    <label>
                      <span>
                        发货日期
                      </span>

                      <input
                        type="date"
                        value={shipDate}
                        onChange={(
                          event,
                        ) =>
                          setShipDate(
                            event.target
                              .value,
                          )
                        }
                      />
                    </label>

                    <label>
                      <span>
                        发货图片 *
                      </span>

                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(
                          event,
                        ) =>
                          setShipFiles(
                            Array.from(
                              event.target
                                .files ??
                                [],
                            ),
                          )
                        }
                      />
                    </label>

                    <label>
                      <span>备注</span>

                      <textarea
                        rows={2}
                        maxLength={1000}
                        value={shipNote}
                        onChange={(
                          event,
                        ) =>
                          setShipNote(
                            event.target
                              .value,
                          )
                        }
                      />
                    </label>

                    <button
                      className="primaryButton"
                      disabled={
                        busy ||
                        shipFiles.length ===
                          0
                      }
                    >
                      提交共享发货留存
                    </button>
                  </form>
                )}
              </section>

              <section className="mergedShippingStep">
                <h3>
                  {activeGroup.fee_done
                    ? "✓ 邮费已填写"
                    : "合并邮费"}
                </h3>

                {!activeGroup.fee_done && (
                  <form
                    className="formStack"
                    onSubmit={
                      submitMergedFee
                    }
                  >
                    <label>
                      <span>
                        总邮费（元）*
                      </span>

                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={feeAmount}
                        onChange={(
                          event,
                        ) =>
                          setFeeAmount(
                            event.target
                              .value,
                          )
                        }
                      />
                    </label>

                    <label>
                      <span>
                        运单号（选填）
                      </span>

                      <input
                        maxLength={120}
                        value={tracking}
                        onChange={(
                          event,
                        ) =>
                          setTracking(
                            event.target
                              .value,
                          )
                        }
                      />
                    </label>

                    <label>
                      <span>
                        运费截图（选填）
                      </span>

                      <input
                        type="file"
                        accept="image/*"
                        onChange={(
                          event,
                        ) =>
                          setReceiptFile(
                            event.target
                              .files?.[0] ??
                              null,
                          )
                        }
                      />
                    </label>

                    <button
                      className="primaryButton"
                      disabled={busy}
                    >
                      提交合并邮费
                    </button>
                  </form>
                )}
              </section>
            </div>

            {!activeGroup.shipping_done &&
              !activeGroup.fee_done && (
                <div className="modalActions alignLeft">
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy}
                    onClick={() =>
                      void cancelMergedGroup()
                    }
                  >
                    取消合并
                  </button>
                </div>
              )}
          </div>
        </div>
      )}

      {/* Individual fee, useful even if shipping retention was done first */}
      {individualFeeTask && (
        <div
          className="modalBackdrop"
          onMouseDown={() =>
            setIndividualFeeTask(null)
          }
        >
          <div
            className="modalCard modalNarrow"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="modalHeader">
              <div>
                <p className="eyebrow">
                  Shipping fee
                </p>
                <h2>
                  填写邮费
                </h2>
                <p>
                  {
                    individualFeeTask
                      .puzzle_name
                  }
                </p>
              </div>

              <button
                type="button"
                className="iconButton"
                onClick={() =>
                  setIndividualFeeTask(
                    null,
                  )
                }
              >
                ×
              </button>
            </div>

            <form
              className="formStack"
              onSubmit={
                submitIndividualFee
              }
            >
              <label>
                <span>
                  邮费（元）*
                </span>

                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={feeAmount}
                  onChange={(event) =>
                    setFeeAmount(
                      event.target.value,
                    )
                  }
                />
              </label>

              <label>
                <span>
                  运单号（选填）
                </span>

                <input
                  value={tracking}
                  maxLength={120}
                  onChange={(event) =>
                    setTracking(
                      event.target.value,
                    )
                  }
                />
              </label>

              <label>
                <span>
                  运费截图（选填）
                </span>

                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setReceiptFile(
                      event.target
                        .files?.[0] ??
                        null,
                    )
                  }
                />
              </label>

              <button
                className="primaryButton"
                disabled={busy}
              >
                {busy
                  ? "提交中…"
                  : "提交邮费"}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
