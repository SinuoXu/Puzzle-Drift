"use client";

import { FormEvent, useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { uploadImage } from "@/lib/client-image";
import type { Puzzle, User } from "@/lib/types";

function todayString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function rowStateLabel(status: string) {
  if (status === "current") return "当前持有";
  if (status === "waiting") return "排队中";
  if (status === "completed") return "已完成";
  return "已退出";
}

export function PuzzleDetailModal({
  puzzle,
  currentUser,
  onClose,
  onChanged,
}: {
  puzzle: Puzzle;
  currentUser: User;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(puzzle.name);
  const [brand, setBrand] = useState(puzzle.brand);
  const [description, setDescription] = useState(puzzle.description);
  const [availability, setAvailability] = useState(puzzle.availability);

  const [retentionMode, setRetentionMode] = useState<"received" | "shipped" | null>(null);
  const [retentionDate, setRetentionDate] = useState(todayString());
  const [retentionNote, setRetentionNote] = useState("");
  const [retentionFile, setRetentionFile] = useState<File | null>(null);

  const activeJourney = puzzle.journey.filter((row) => row.status !== "cancelled");
  const myWaiting = puzzle.journey.find((row) => row.user_id === currentUser.id && row.status === "waiting");
  const myCurrent = puzzle.journey.find((row) => row.user_id === currentUser.id && row.status === "current");
  const nextWaiting = puzzle.journey.find((row) => row.status === "waiting");

  const canManage = currentUser.is_admin || puzzle.owner_id === currentUser.id;
  const canJoin =
    puzzle.availability === "active" &&
    puzzle.owner_id !== currentUser.id &&
    !puzzle.journey.some((row) => row.user_id === currentUser.id && ["waiting", "current"].includes(row.status));

  const canReceive = Boolean(myCurrent && !myCurrent.is_owner_start && !myCurrent.received_on);
  const canShip = Boolean(myCurrent && nextWaiting && !myCurrent.shipped_on);

  const summary = useMemo(() => {
    if (puzzle.availability === "paused") return "暂停漂流";
    if (puzzle.availability === "retired") return "结束漂流";
    if (puzzle.drift_state === "drifting") return `目前在 ${puzzle.current_holder_name} 手里`;
    if (puzzle.drift_state === "waiting_to_ship") return `图主 ${puzzle.owner_name} 手里，已有下一棒`;
    return `目前在图主 ${puzzle.owner_name} 手里`;
  }, [puzzle]);

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, init);
      const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "操作失败。");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败。");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function joinQueue() {
    try {
      await call(`/api/puzzles/${puzzle.id}/queue`, { method: "POST" });
    } catch {
      // error already shown
    }
  }

  async function leaveQueue() {
    try {
      await call(`/api/puzzles/${puzzle.id}/queue`, { method: "DELETE" });
    } catch {
      // error already shown
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    try {
      await call(`/api/puzzles/${puzzle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, brand, description, availability }),
      });
      setEditing(false);
    } catch {
      // error already shown
    }
  }

  async function deletePuzzle() {
    if (!window.confirm(`确定删除《${puzzle.name}》吗？这会同时删除它的排队和漂流记录。`)) return;
    try {
      await call(`/api/puzzles/${puzzle.id}`, { method: "DELETE" });
      onClose();
    } catch {
      // error already shown
    }
  }

  async function submitRetention(event: FormEvent) {
    event.preventDefault();
    if (!retentionMode || !retentionFile || !retentionDate) return;

    setBusy(true);
    setError("");
    try {
      const photoUrl = await uploadImage(retentionFile, retentionMode);
      const response = await fetch(`/api/puzzles/${puzzle.id}/retention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: retentionMode,
          date: retentionDate,
          photo_url: photoUrl,
          note: retentionNote,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "提交留存失败。");

      setRetentionMode(null);
      setRetentionFile(null);
      setRetentionNote("");
      setRetentionDate(todayString());
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交留存失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modalCard modalWide" onMouseDown={(event) => event.stopPropagation()}>
        <div className="detailTop">
          <div className="detailCoverColumn">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="detailCover" src={puzzle.cover_url} alt={puzzle.name} />
          </div>

          <div className="detailInfo">
            <div className="modalHeader detailHeader">
              <div>
                <p className="eyebrow">{puzzle.brand || "未填写品牌"}</p>
                <h2>{puzzle.name}</h2>
              </div>
              <button type="button" className="iconButton" onClick={onClose} aria-label="关闭">×</button>
            </div>

            <div className="ownerLine ownerLineLarge">
              <Avatar name={puzzle.owner_name} size={34} />
              <span>图主 <strong>{puzzle.owner_name}</strong></span>
            </div>

            <div className="detailStatus">
              <span className={puzzle.drift_state === "drifting" ? "dot dotGreen" : "dot"} />
              {summary}
            </div>

            {puzzle.description && <p className="detailDescription">{puzzle.description}</p>}

            <div className="detailActions">
              {canJoin && (
                <button type="button" className="primaryButton" disabled={busy} onClick={joinQueue}>加入排队</button>
              )}
              {myWaiting && (
                <button type="button" className="secondaryButton" disabled={busy} onClick={leaveQueue}>退出排队</button>
              )}
              {canReceive && (
                <button type="button" className="secondaryButton" onClick={() => setRetentionMode("received")}>上传收货留存</button>
              )}
              {canShip && (
                <button type="button" className="primaryButton" onClick={() => setRetentionMode("shipped")}>上传发货留存并交给下一棒</button>
              )}
              {myCurrent && !nextWaiting && (
                <span className="actionHint">目前没有下一棒，暂时不用发货。</span>
              )}
            </div>
          </div>
        </div>

        {error && <div className="errorBox detailError">{error}</div>}

        {retentionMode && (
          <form className="retentionPanel" onSubmit={submitRetention}>
            <div>
              <h3>{retentionMode === "received" ? "收货留存" : "发货留存"}</h3>
              <p>{retentionMode === "shipped" ? "提交后，下一位排队用户会立即变成绿色的“当前持有”。" : "上传收到拼图时的照片和日期。"}</p>
            </div>

            <label>
              <span>日期</span>
              <input type="date" value={retentionDate} onChange={(event) => setRetentionDate(event.target.value)} />
            </label>

            <label>
              <span>照片 *</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setRetentionFile(event.target.files?.[0] ?? null)} />
            </label>

            <label>
              <span>备注</span>
              <textarea rows={3} maxLength={1000} value={retentionNote} onChange={(event) => setRetentionNote(event.target.value)} placeholder="可选" />
            </label>

            <div className="modalActions alignLeft">
              <button type="button" className="secondaryButton" onClick={() => setRetentionMode(null)}>取消</button>
              <button type="submit" className="primaryButton" disabled={busy || !retentionFile || !retentionDate}>
                {busy ? "提交中…" : "确认提交"}
              </button>
            </div>
          </form>
        )}

        <section className="detailSection">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">Queue</p>
              <h3>漂流队伍</h3>
            </div>
            <span>{puzzle.waiting_count} 人等待</span>
          </div>

          <div className="journeyList">
            {activeJourney.map((row) => (
              <div className={`journeyRow journey-${row.status}`} key={row.id}>
                <div className="journeyIdentity">
                  <Avatar name={row.username} size={38} />
                  <div>
                    <strong>{row.username}</strong>
                    <span>{row.is_owner_start ? "图主" : `第 ${row.seq} 棒`}</span>
                  </div>
                </div>

                <div className="journeyState">
                  <span className="journeyBadge">{rowStateLabel(row.status)}</span>
                  {row.received_on && <span>收货 {row.received_on}</span>}
                  {row.shipped_on && <span>发货 {row.shipped_on}</span>}
                </div>

                <div className="retentionLinks">
                  {row.received_photo_url && (
                    <a href={row.received_photo_url} target="_blank" rel="noreferrer">收货留存</a>
                  )}
                  {row.shipping_photo_url && (
                    <a href={row.shipping_photo_url} target="_blank" rel="noreferrer">发货留存</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {canManage && (
          <section className="detailSection managerSection">
            <div className="sectionHeading">
              <div>
                <p className="eyebrow">Owner tools</p>
                <h3>{currentUser.is_admin && puzzle.owner_id !== currentUser.id ? "管理员" : "图主管理"}</h3>
              </div>
              {!editing && <button type="button" className="textButton" onClick={() => setEditing(true)}>编辑</button>}
            </div>

            {editing && (
              <form className="editGrid" onSubmit={saveEdit}>
                <label>
                  <span>名称</span>
                  <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                </label>
                <label>
                  <span>品牌</span>
                  <input value={brand} maxLength={80} onChange={(event) => setBrand(event.target.value)} />
                </label>
                <label className="editWide">
                  <span>介绍</span>
                  <textarea rows={3} value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} />
                </label>
                <label>
                  <span>漂流状态</span>
                  <select value={availability} onChange={(event) => setAvailability(event.target.value as Puzzle["availability"])}>
                    <option value="active">开放漂流</option>
                    <option value="paused">暂停漂流</option>
                    <option value="retired">结束漂流</option>
                  </select>
                </label>
                <div className="modalActions editWide alignLeft">
                  <button type="button" className="secondaryButton" onClick={() => setEditing(false)}>取消</button>
                  <button type="submit" className="primaryButton" disabled={busy}>保存</button>
                  <button type="button" className="dangerButton" disabled={busy} onClick={deletePuzzle}>删除拼图</button>
                </div>
              </form>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
