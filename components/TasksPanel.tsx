"use client";

import { useEffect, useState } from "react";

export type Task = { id: string; puzzle_id: string; puzzle_name: string; kind: string; amount_cents: number | null; destination?: { username: string; shipping_address: string | null } | null; payee?: { username: string; payment_qr_url: string | null } | null };
const labels: Record<string, string> = { receive: "收货留存", ship: "发货留存", shipping_fee: "填写发货邮费", pay_shipping: "支付邮费", pay_return: "支付回家邮费" };
const fetchedRevision = new Map<string, number>();

function cacheKey(userId: string) { return `puzzle-drift:tasks:${userId}`; }

function readCache(userId: string): Task[] | null {
  try {
    const value = window.localStorage.getItem(cacheKey(userId));
    if (!value) return null;
    const parsed = JSON.parse(value) as { tasks?: unknown };
    return Array.isArray(parsed.tasks) ? parsed.tasks as Task[] : null;
  } catch { return null; }
}

function writeCache(userId: string, tasks: Task[]) {
  try { window.localStorage.setItem(cacheKey(userId), JSON.stringify({ tasks, savedAt: Date.now() })); } catch { /* Storage can be unavailable in private browsing. */ }
}

export function TasksPanel({ userId, refreshKey, onOpenPuzzle, onChanged }: { userId: string; refreshKey: number; onOpenPuzzle: (id: string) => void; onChanged: () => Promise<void> }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const cached = readCache(userId);
    if (cached) { setTasks(cached); setLoading(false); }
    else setLoading(true);
    if (fetchedRevision.get(userId) === refreshKey) return () => { active = false; };
    void fetch(`/api/tasks?revision=${refreshKey}`).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "读取待办失败。");
      return data.tasks as Task[];
    }).then((rows) => { if (active) { const next = rows ?? []; setTasks(next); writeCache(userId, next); fetchedRevision.set(userId, refreshKey); setError(""); } })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "读取待办失败。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, refreshKey]);
  async function paid(id: string) {
    const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) { setError("标记支付失败。"); return; }
    setTasks((old) => { const next = old.filter((task) => task.id !== id); writeCache(userId, next); return next; });
    await onChanged();
  }
  return <section><h2>我的待办 <small>({tasks.length})</small></h2>
    {error && <div className="errorBox">{error}</div>}
    {loading && <div className="emptyPanel">正在读取待办…</div>}
    {!loading && !error && tasks.length === 0 && <div className="emptyPanel">目前没有待办。</div>}
    <div className="taskList">{tasks.map((task) => <article className="sidebarCard" key={task.id}>
      <h3>{labels[task.kind] ?? task.kind} · {task.puzzle_name}</h3>
      {task.destination && <div><p>寄给：{task.destination.username}</p><p>{task.destination.shipping_address || "对方还没有填写地址"}</p><button className="secondaryButton" onClick={() => void navigator.clipboard.writeText(task.destination?.shipping_address ?? "")}>复制地址</button></div>}
      {task.amount_cents !== null && <p>金额：¥{(task.amount_cents / 100).toFixed(2)}</p>}
      {task.payee && <div><p>收款人：{task.payee.username}</p>{task.payee.payment_qr_url ? <img src={task.payee.payment_qr_url} alt="收款码" style={{ width: 150, maxWidth: "100%" }} /> : <p>收款人未设置收款码</p>}</div>}
      <div className="modalActions alignLeft"><button className="primaryButton" onClick={() => onOpenPuzzle(task.puzzle_id)}>查看拼图</button>
      {task.kind.startsWith("pay_") && <button className="secondaryButton" onClick={() => void paid(task.id)}>我已支付</button>}</div>
    </article>)}</div>
  </section>;
}
