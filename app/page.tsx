"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Avatar } from "@/components/Avatar";
import { NewPuzzleModal } from "@/components/NewPuzzleModal";
import { PuzzleCard } from "@/components/PuzzleCard";
import { PuzzleDetailModal } from "@/components/PuzzleDetailModal";
import { ProfilePanel } from "@/components/ProfilePanel";
import { TasksPanel } from "@/components/TasksPanel";
import { UserProfileModal } from "@/components/UserProfileModal";
import { getRealtimeClient } from "@/lib/realtime-client";
import type { Puzzle, Snapshot, User } from "@/lib/types";

type Tab = "tasks" | "feed" | "library" | "mine";
type LibraryFilter = "all" | "drifting" | "idle" | "retired";

function LoginScreen({ onLogin }: { onLogin: (user: User) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim()) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, pin }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "进入失败。");
      await onLogin(data.user as User);
    } catch (err) {
      setError(err instanceof Error ? err.message : "进入失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="brandIcon">🧩</div>
        <p className="eyebrow">PUZZLE LIBRARY · DRIFT TOGETHER</p>
        <h1>Puzzle Drift</h1>
        <p className="loginSubtitle">拼图漂流库</p>

        <form onSubmit={submit} className="loginForm">
          <label>
            <span>你的用户名</span>
            <input
              value={username}
              maxLength={24}
              autoFocus
              autoComplete="nickname"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="例如：nono"
            />
          </label>
          <label><span>6 位数字 PIN</span><input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value)} placeholder="6 位数字" /></label>
          <button className="primaryButton largeButton" type="submit" disabled={busy || !username.trim() || pin.length !== 6}>
            {busy ? "进入中…" : "进入 Puzzle Drift"}
          </button>
        </form>

        <p className="loginHint">同一浏览器会记住你一年。旧账号请在已登录的原设备设置 PIN。</p>
        {error && <div className="errorBox">{error}</div>}
      </section>
    </main>
  );
}

function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="pageHeading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export default function Home() {
  const [booting, setBooting] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>("feed");
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showNewPuzzle, setShowNewPuzzle] = useState(false);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("all");
  const [owner, setOwner] = useState("all");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [globalError, setGlobalError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadSnapshot = useCallback(async (silent = false) => {
    try {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      if (response.status === 401) {
        setSnapshot(null);
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "读取数据失败。");
      setSnapshot(data as Snapshot);
      setRefreshKey((value) => value + 1);
      if (!silent) setGlobalError("");
    } catch (err) {
      if (!silent) setGlobalError(err instanceof Error ? err.message : "读取数据失败。");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadSnapshot(true);
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSnapshot]);

  useEffect(() => {
    if (!snapshot) return;

    const realtime = getRealtimeClient();
    if (realtime) {
      const channel = realtime
        .channel("puzzle-drift-sync")
        .on("broadcast", { event: "invalidate" }, () => {
          void loadSnapshot(true);
        })
        .subscribe();
      channelRef.current = channel;

      return () => {
        channelRef.current = null;
        void realtime.removeChannel(channel);
      };
    }

    return;
  }, [Boolean(snapshot), loadSnapshot]);

  // Fallback consistency check. Realtime normally updates immediately; polling catches missed events.
  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setInterval(() => void loadSnapshot(true), 10_000);
    return () => window.clearInterval(timer);
  }, [Boolean(snapshot), loadSnapshot]);

  const broadcastInvalidate = useCallback(async () => {
    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "invalidate",
        payload: { at: Date.now() },
      });
    } catch {
      // Polling remains as a fallback if realtime is unavailable.
    }
  }, []);

  const mutationCompleted = useCallback(async () => {
    await loadSnapshot();
    await broadcastInvalidate();
  }, [loadSnapshot, broadcastInvalidate]);

  const selectedPuzzle = useMemo(
    () => snapshot?.puzzles.find((puzzle) => puzzle.id === selectedPuzzleId) ?? null,
    [snapshot, selectedPuzzleId]
  );

  const brands = useMemo(() => {
    if (!snapshot) return [];
    return Array.from(new Set(snapshot.puzzles.map((p) => p.brand).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [snapshot]);

  const filteredPuzzles = useMemo(() => {
    if (!snapshot) return [];
    const keyword = search.trim().toLowerCase();

    return snapshot.puzzles.filter((puzzle) => {
      if (brand !== "all" && puzzle.brand !== brand) return false;
      if (owner !== "all" && puzzle.owner_id !== owner) return false;
      if (libraryFilter === "drifting" && puzzle.drift_state !== "drifting") return false;
      if (libraryFilter === "idle" && puzzle.drift_state !== "idle") return false;
      if (libraryFilter === "retired" && puzzle.drift_state !== "retired") return false;
      if (keyword && !`${puzzle.name} ${puzzle.brand}`.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [snapshot, search, brand, owner, libraryFilter]);

  if (booting) {
    return (
      <main className="loadingPage">
        <div className="brandIcon">🧩</div>
        <span>Puzzle Drift</span>
      </main>
    );
  }

  if (!snapshot) {
    return <LoginScreen onLogin={async () => loadSnapshot()} />;
  }

  const { user, puzzles, activities } = snapshot;
  const myOwned = puzzles.filter((puzzle) => puzzle.owner_id === user.id);
  const myHolding = puzzles.filter((puzzle) => puzzle.current_holder_id === user.id && puzzle.owner_id !== user.id);
  const myQueued = puzzles.filter((puzzle) => puzzle.journey.some((row) => row.user_id === user.id && row.status === "waiting"));

  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    setSnapshot(null);
    setSelectedPuzzleId(null);
  }

  return (
    <main className="appShell">
      <header className="topNav">
        <button className="brandButton" type="button" onClick={() => setTab("feed")}>
          <span>🧩</span>
          <div>
            <strong>Puzzle Drift</strong>
            <small>拼图漂流库</small>
          </div>
        </button>

        <nav className="desktopTabs" aria-label="主导航">
          <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>我的待办</button>
          <button className={tab === "feed" ? "active" : ""} onClick={() => setTab("feed")}>消息中心</button>
          <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>漂流中心</button>
          <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>个人中心</button>
        </nav>

        <div className="userChip">
          <Avatar name={user.username} url={user.avatar_url} size={32} onOpen={() => setSelectedUserId(user.id)} />
          <div>
            <strong>{user.username}</strong>
            <small>{user.is_admin ? "管理员" : "成员"}</small>
          </div>
          <button type="button" onClick={logout}>退出</button>
        </div>
      </header>

      <nav className="mobileTabs" aria-label="移动端导航">
        <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>待办</button>
        <button className={tab === "feed" ? "active" : ""} onClick={() => setTab("feed")}>消息</button>
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>图库</button>
        <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>我的</button>
      </nav>

      <div className="appContent">
        {globalError && <div className="errorBox globalError">{globalError}</div>}
        {tab === "tasks" && <TasksPanel refreshKey={refreshKey} onOpenPuzzle={setSelectedPuzzleId} onChanged={mutationCompleted} />}

        {tab === "feed" && (
          <section>
            <SectionTitle
              title="消息中心"
              subtitle="新图、排队、收货和发货都会自动同步到这里。"
            />

            <div className="feedLayout">
              <div>
                <ActivityFeed activities={activities} onOpenPuzzle={setSelectedPuzzleId} onOpenUser={setSelectedUserId} />
              </div>
              <aside className="sidebarCard">
                <p className="eyebrow">实时状态</p>
                <h3>{puzzles.length} 张拼图</h3>
                <div className="statsGrid">
                  <div><strong>{puzzles.filter((p) => p.drift_state === "drifting").length}</strong><span>正在漂</span></div>
                  <div><strong>{puzzles.reduce((sum, p) => sum + p.waiting_count, 0)}</strong><span>排队中</span></div>
                </div>
                <p className="sidebarNote">页面变更会通过实时消息通知其他在线设备；即使实时连接中断，也会每 10 秒自动校准一次。</p>
              </aside>
            </div>
          </section>
        )}

        {tab === "library" && (
          <section>
            <SectionTitle
              title="漂流中心"
              subtitle="所有人的拼图都在同一个图库里。"
            />

            <div className="filterBar">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索图名或品牌…" />
              <select value={libraryFilter} onChange={(event) => setLibraryFilter(event.target.value as LibraryFilter)}>
                <option value="all">全部状态</option>
                <option value="drifting">正在漂</option>
                <option value="idle">目前没在漂</option>
                <option value="retired">退役</option>
              </select>
              <select value={brand} onChange={(event) => setBrand(event.target.value)}>
                <option value="all">全部品牌</option>
                {brands.map((item) => <option value={item} key={item}>{item}</option>)}
              </select>
              <select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="all">全部图主</option>{Array.from(new Map(puzzles.map((p) => [p.owner_id, p.owner_name])).entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
            </div>

            {filteredPuzzles.length > 0 ? (
              <div className="puzzleGrid">
                {filteredPuzzles.map((puzzle) => <PuzzleCard key={puzzle.id} puzzle={puzzle} onOpen={setSelectedPuzzleId} onOpenUser={setSelectedUserId} />)}
              </div>
            ) : (
              <div className="emptyPanel">没有找到符合条件的拼图。</div>
            )}
          </section>
        )}

        {tab === "mine" && (
          <section>
            <SectionTitle
              title="个人中心"
              subtitle={`${user.username} 的拼图、持有和排队。`}
              action={<button className="primaryButton" type="button" onClick={() => setShowNewPuzzle(true)}>＋ 上传我的拼图</button>}
            />

            <div className="mySection">
              <ProfilePanel user={user} onChanged={mutationCompleted} />
            </div>

            <div className="mySection">
              <div className="subHeading"><h3>我的拼图</h3><span>{myOwned.length}</span></div>
              {myOwned.length > 0 ? <div className="puzzleGrid compactGrid">{myOwned.map((p) => <PuzzleCard key={p.id} puzzle={p} onOpen={setSelectedPuzzleId} onOpenUser={setSelectedUserId} />)}</div> : <div className="emptyPanel smallEmpty">你还没有发布拼图。</div>}
            </div>

            <div className="mySection">
              <div className="subHeading"><h3>我正在持有</h3><span>{myHolding.length}</span></div>
              {myHolding.length > 0 ? <div className="puzzleGrid compactGrid">{myHolding.map((p) => <PuzzleCard key={p.id} puzzle={p} onOpen={setSelectedPuzzleId} onOpenUser={setSelectedUserId} />)}</div> : <div className="emptyPanel smallEmpty">目前没有别人的拼图在你手里。</div>}
            </div>

            <div className="mySection">
              <div className="subHeading"><h3>我的排队</h3><span>{myQueued.length}</span></div>
              {myQueued.length > 0 ? <div className="puzzleGrid compactGrid">{myQueued.map((p) => <PuzzleCard key={p.id} puzzle={p} onOpen={setSelectedPuzzleId} onOpenUser={setSelectedUserId} />)}</div> : <div className="emptyPanel smallEmpty">你还没有排队。</div>}
            </div>
          </section>
        )}
      </div>

      {showNewPuzzle && (
        <NewPuzzleModal
          onClose={() => setShowNewPuzzle(false)}
          onCreated={mutationCompleted}
        />
      )}

      {selectedPuzzle && (
        <PuzzleDetailModal
          puzzle={selectedPuzzle}
          currentUser={user}
          onClose={() => setSelectedPuzzleId(null)}
          onChanged={mutationCompleted}
          onOpenUser={setSelectedUserId}
        />
      )}
      {selectedUserId && <UserProfileModal userId={selectedUserId} onClose={() => setSelectedUserId(null)} />}
    </main>
  );
}
