"use client";

import { useEffect, useState } from "react";

type Task = { id: string; puzzle_id: string; puzzle_name: string; kind: string; amount_cents: number | null; destination?: { username: string; shipping_address: string | null } | null; payee?: { username: string; payment_qr_url: string | null } | null };
const labels: Record<string, string> = { receive: "收货留存", ship: "发货留存", shipping_fee: "填写发货邮费", pay_shipping: "支付邮费", pay_return: "支付回家邮费" };

export function TasksPanel({ refreshKey, onOpenPuzzle, onChanged }: { refreshKey: number; onOpenPuzzle: (id: string) => void; onChanged: () => Promise<void> }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/tasks", { cache: "no-store" }).then((r) => r.json()).then((d) => setTasks(d.tasks ?? [])); }, [refreshKey]);
  async function paid(id: string) {
    const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) { setError("标记支付失败。"); return; }
    setTasks((old) => old.filter((task) => task.id !== id));
    await onChanged();
  }
  return <section><h2>我的待办 <small>({tasks.length})</small></h2>
    {error && <div className="errorBox">{error}</div>}
    {tasks.length === 0 && <div className="emptyPanel">目前没有待办。</div>}
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
