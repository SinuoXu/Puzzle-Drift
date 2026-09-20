"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type User = { id: string; username: string };
type ListItem = {
  id: string;
  content: string;
  created_by: string;
  created_at: string;
  creator_username: string;
};

function formatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export default function Home() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState("");
  const [items, setItems] = useState<ListItem[]>([]);
  const [newItem, setNewItem] = useState("");
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        if (!cancelled && response.ok) {
          const data = await response.json();
          setUser(data.user);
        }
      } catch {
        // Keep the login screen available if bootstrap fails.
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const response = await fetch("/api/items", { cache: "no-store" });

      if (response.status === 401) {
        setUser(null);
        setItems([]);
        return;
      }

      if (!response.ok) return;

      const data = await response.json();
      setItems(data.items ?? []);
    } catch {
      // A transient polling failure should not clear the current page.
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    void loadItems();
    const timer = window.setInterval(() => void loadItems(), 4000);
    return () => window.clearInterval(timer);
  }, [user, loadItems]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    if (!username.trim()) return;

    setLoggingIn(true);
    setError("");

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "进入失败。");

      setUser(data.user);
      setUsername("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "进入失败。");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    setError("");
    try {
      await fetch("/api/session", { method: "DELETE" });
    } finally {
      setUser(null);
      setItems([]);
      setNewItem("");
    }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const value = newItem.trim();
    if (!value) return;

    setAdding(true);
    setError("");

    try {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "添加失败。");

      setNewItem("");
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败。");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(item: ListItem) {
    const confirmed = window.confirm(`确定删除“${item.content}”吗？`);
    if (!confirmed) return;

    setDeletingId(item.id);
    setError("");

    try {
      const response = await fetch("/api/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });

      if (response.status !== 204) {
        let message = "删除失败。";
        try {
          const data = await response.json();
          message = data.error ?? message;
        } catch {
          // Ignore malformed error bodies.
        }
        throw new Error(message);
      }

      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败。");
    } finally {
      setDeletingId(null);
    }
  }

  if (booting) {
    return (
      <main className="centerPage">
        <div className="brandMark">🧩</div>
        <p className="muted">Puzzle Drift</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="centerPage">
        <section className="loginCard">
          <div className="brandMark">🧩</div>
          <h1>Puzzle Drift</h1>
          <p className="subtitle">拼图漂流</p>

          <form onSubmit={handleLogin} className="loginForm">
            <label htmlFor="username">你的名字</label>
            <input
              id="username"
              type="text"
              autoComplete="nickname"
              maxLength={24}
              placeholder="例如：徐思诺"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
            />
            <button type="submit" disabled={loggingIn || !username.trim()}>
              {loggingIn ? "进入中…" : "进入 Puzzle Drift"}
            </button>
          </form>

          <p className="loginHint">
            第一次使用这个名字会自动创建用户。以后在这台设备打开网站会自动进入。
          </p>

          {error && <div className="errorBox">{error}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <div className="smallBrand">🧩 Puzzle Drift</div>
        <div className="userArea">
          <span>{user.username}</span>
          <button type="button" className="textButton" onClick={handleLogout}>
            退出
          </button>
        </div>
      </header>

      <section className="content">
        <div className="titleRow">
          <div>
            <h1>我们的 List</h1>
            <p>共 {items.length} 项 · 自动同步</p>
          </div>
        </div>

        <form className="addForm" onSubmit={handleAdd}>
          <input
            type="text"
            maxLength={200}
            value={newItem}
            placeholder="添加一项……"
            onChange={(event) => setNewItem(event.target.value)}
          />
          <button type="submit" disabled={adding || !newItem.trim()}>
            {adding ? "添加中…" : "＋ 添加"}
          </button>
        </form>

        {error && <div className="errorBox">{error}</div>}

        <div className="list">
          {items.length === 0 && (
            <div className="emptyState">
              <div>🧩</div>
              <p>这里还没有东西。</p>
              <span>添加第一项吧。</span>
            </div>
          )}

          {items.map((item) => (
            <article key={item.id} className="listItem">
              <div className="itemMain">
                <div className="itemContent">{item.content}</div>
                <div className="itemMeta">
                  {item.creator_username} · {formatTime(item.created_at)}
                </div>
              </div>

              <button
                type="button"
                className="deleteButton"
                disabled={deletingId === item.id}
                onClick={() => void handleDelete(item)}
              >
                {deletingId === item.id ? "删除中…" : "删除"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
