"use client";

import { FormEvent, useEffect, useState } from "react";

export default function MigratePage() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/migrate", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setReady(Boolean(data.ready)))
      .catch(() => setReady(false));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!secret || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "迁移失败。");
      setMessage(`迁移完成：${data.images_migrated ?? 0} 张图片已复制。现在可以回到首页测试登录和拼图流程。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "迁移失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "56px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Supabase → EdgeOne 迁移</h1>
      <p>此页面只用于一次性迁移。迁移成功并完成验证后，请从 EdgeOne 项目中删除三个迁移环境变量。</p>
      {ready === false && <p style={{ color: "#b42318" }}>迁移环境变量还没有配置完整。</p>}
      {ready === null && <p>正在检查迁移配置…</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 24 }}>
        <label>
          迁移口令
          <input
            type="password"
            value={secret}
            onChange={(e: any) => setSecret(e.target.value)}
            autoComplete="off"
            style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 8, padding: 12 }}
          />
        </label>
        <button type="submit" disabled={!ready || busy || !secret} style={{ padding: 12, cursor: "pointer" }}>
          {busy ? "迁移中，请不要关闭页面…" : "开始迁移"}
        </button>
      </form>
      {message && <p style={{ color: "#067647", marginTop: 20 }}>{message}</p>}
      {error && <p style={{ color: "#b42318", marginTop: 20 }}>{error}</p>}
    </main>
  );
}
