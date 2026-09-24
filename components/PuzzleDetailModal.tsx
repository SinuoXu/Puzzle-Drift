"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ImageLightbox } from "@/components/ImageLightbox";
import { BrandInput } from "@/components/BrandInput";
import {
  canonicalizeKnownBrand,
  isKnownBrand,
} from "@/lib/brands";
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
  onOpenUser,
  brands,
}: {
  puzzle: Puzzle;
  currentUser: User;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOpenUser: (id: string) => void;
  brands: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(puzzle.name);
  const [brand, setBrand] = useState(puzzle.brand);
  const [description, setDescription] = useState(puzzle.description);
  const [pieceCount, setPieceCount] = useState(String(puzzle.piece_count ?? ""));
  const [hasBox, setHasBox] = useState(puzzle.has_box);
  const [hasSheet, setHasSheet] = useState(puzzle.has_sheet);
  const [coverPreview, setCoverPreview] = useState(false);
  const [availability, setAvailability] = useState(puzzle.availability);

  const [comments, setComments] = useState<{
    id: string;
    user_id: string;
    username: string;
    content: string;
    created_at: string;
  }[]>([]);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);

  const [likes, setLikes] = useState<{
    id: string;
    user_id: string;
    username: string;
    avatar_url: string | null;
    created_at: string;
  }[]>([]);
  const [likeBusy, setLikeBusy] = useState(false);

  const [retentionMode, setRetentionMode] = useState<"received" | "shipped" | null>(null);
  const [retentionDate, setRetentionDate] = useState(todayString());
  const [retentionNote, setRetentionNote] = useState("");
  const [retentionFiles, setRetentionFiles] = useState<File[]>([]);
  const [history, setHistory] = useState<Record<string, { received_photo_urls: string[]; receiving_note: string; shipping_photo_urls: string[]; shipping_note: string }>>({});
  const [handoffs, setHandoffs] = useState<{ id: string; from_user_id: string; to_user_id: string; return_home: boolean; created_at: string }[]>([]);
  const [feeOpen, setFeeOpen] = useState(false);
  const [returnHome, setReturnHome] = useState(false);
  const [feeAmount, setFeeAmount] = useState("");
  const [tracking, setTracking] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [feeDestination, setFeeDestination] = useState<{ username: string; shipping_address: string | null } | null>(null);

  useEffect(() => {
    void fetch(`/api/puzzles/${puzzle.id}/history`, { cache: "no-store" }).then((r) => r.json())
      .then((data) => { setHistory(Object.fromEntries((data.history ?? []).map((row: { id: string }) => [row.id, row]))); setHandoffs(data.handoffs ?? []); });
  }, [puzzle.id, puzzle.updated_at]);

  useEffect(() => {
    let active = true;

    void fetch(
      `/api/puzzles/${puzzle.id}/comments`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.error ?? "读取留言失败。",
          );
        }

        if (active) {
          setComments(data.comments ?? []);
        }
      })
      .catch(() => {
        // Comments are secondary content.
      });

    return () => {
      active = false;
    };
  }, [puzzle.id, puzzle.updated_at]);

  useEffect(() => {
    let active = true;

    void fetch(
      `/api/puzzles/${puzzle.id}/likes`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.error ?? "读取喜欢失败。",
          );
        }

        if (active) {
          setLikes(data.likes ?? []);
        }
      })
      .catch(() => {
        // Likes are secondary content.
      });

    return () => {
      active = false;
    };
  }, [puzzle.id]);

  useEffect(() => {
    if (!feeOpen) return;
    setFeeDestination(null);
    void fetch("/api/tasks", { cache: "no-store" }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "读取地址失败。");
      const task = (data.tasks ?? []).find((row: { puzzle_id: string; kind: string }) => row.puzzle_id === puzzle.id && row.kind === "shipping_fee");
      setFeeDestination(task?.destination ?? null);
    }).catch((err) => setError(err instanceof Error ? err.message : "读取地址失败。"));
  }, [feeOpen, puzzle.id]);

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
  const canShip = Boolean(myCurrent && !myCurrent.is_owner_start && nextWaiting && myCurrent.received_on && !myCurrent.shipped_on);
  const canReturn = Boolean(myCurrent && !myCurrent.is_owner_start && myCurrent.received_on && !nextWaiting && puzzle.availability !== "retired");

  const summary = useMemo(() => {
    if (puzzle.availability === "retired") return "退役";
    return puzzle.in_transit ? "正在漂 · 运输中" : "正在漂";
  }, [puzzle]);

  const likedByMe = likes.some(
    (row) => row.user_id === currentUser.id,
  );

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

  async function moveQueue(direction: -1 | 1) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/puzzles/${puzzle.id}/queue`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "调整失败。");
      if (!data.moved) throw new Error(direction === -1 ? "已经是排队中的第一位。" : "已经是排队中的最后一位。");
      await onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : "调整失败。"); }
    finally { setBusy(false); }
  }

  async function handoff(returnHome: boolean) {
    if (!window.confirm(returnHome ? "确认已将拼图面交还给图主？此流程没有留存和邮费待办。" : "确认已将拼图面交给下一棒？此流程没有留存和邮费待办。")) return;
    try { await call(`/api/puzzles/${puzzle.id}/handoff`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ return_home: returnHome }) }); }
    catch { /* error shown */ }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();

    const finalBrand =
      canonicalizeKnownBrand(brand);

    if (
      finalBrand &&
      !isKnownBrand(finalBrand, brands)
    ) {
      const confirmed = window.confirm(
        `目前还没有品牌「${finalBrand}」。

确定要作为一个新品牌保存吗？`,
      );

      if (!confirmed) return;
    }

    try {
      await call(`/api/puzzles/${puzzle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          brand: finalBrand,
          description,
          piece_count: Number(pieceCount),
          has_box: hasBox,
          has_sheet: hasSheet,
          ...(puzzle.availability === "retired" ? {} : { availability }),
        }),
      });
      setEditing(false);
    } catch {
      // error already shown
    }
  }

  async function forceEnd() {
    if (!window.confirm(`强制结束《${puzzle.name}》？所有未完成待办和排队将被取消，拼图会显示为退役。`)) return;
    try {
      await call(`/api/admin/puzzles/${puzzle.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "force_end" }),
      });
    } catch {
      // Error is already displayed in the modal.
    }
  }

  async function deletePuzzle() {
    if (!window.confirm(`删除《${puzzle.name}》？这会删除这张拼图、流转记录、待办、相关消息以及关联图片，不能恢复。`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/puzzles/${puzzle.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "删除拼图失败。");
      await onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除拼图失败。");
    } finally {
      setBusy(false);
    }
  }

  async function submitRetention(event: FormEvent) {
    event.preventDefault();
    if (!retentionMode || retentionFiles.length === 0 || !retentionDate) return;

    setBusy(true);
    setError("");
    try {
      const photoUrls = await Promise.all(retentionFiles.map((file) => uploadImage(file, retentionMode)));
      const response = await fetch(`/api/puzzles/${puzzle.id}/retention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: retentionMode,
          date: retentionDate,
          photo_urls: photoUrls,
          note: retentionNote,
          return_home: returnHome,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "提交留存失败。");

      setRetentionMode(null);
      setRetentionFiles([]);
      setRetentionNote("");
      setRetentionDate(todayString());
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交留存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function submitFee(event: FormEvent) {
    event.preventDefault();
    if (!/^\d+(?:\.\d{1,2})?$/.test(feeAmount)) { setError("邮费最多保留两位小数。"); return; }
    const [yuan, fen = ""] = feeAmount.split(".");
    const amount = Number(yuan) * 100 + Number(fen.padEnd(2, "0"));
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError("请输入正确的邮费金额。"); return; }
    setBusy(true); setError("");
    try {
      if (returnHome) {
        const prepared = await fetch(`/api/puzzles/${puzzle.id}/return`, { method: "POST" });
        if (!prepared.ok) throw new Error((await prepared.json()).error ?? "不能寄回图主。");
      }
      const receiptUrl = receiptFile ? await uploadImage(receiptFile, "receipt") : null;
      const response = await fetch(`/api/puzzles/${puzzle.id}/fee`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_cents: amount, tracking_number: tracking, receipt_url: receiptUrl, return_home: returnHome }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "填写邮费失败。");
      setFeeOpen(false); setFeeAmount(""); setTracking(""); setReceiptFile(null);
      await onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : "填写邮费失败。"); }
    finally { setBusy(false); }
  }

  async function toggleLike() {
    if (likeBusy) return;

    const nextLiked = !likedByMe;

    setLikeBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/puzzles/${puzzle.id}/likes`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            liked: nextLiked,
          }),
        },
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ?? "操作失败。",
        );
      }

      if (nextLiked) {
        setLikes((old) => {
          if (
            old.some(
              (row) =>
                row.user_id === currentUser.id,
            )
          ) {
            return old;
          }

          return [
            ...old,
            {
              id: `local-${currentUser.id}`,
              user_id: currentUser.id,
              username: currentUser.username,
              avatar_url:
                currentUser.avatar_url ?? null,
              created_at:
                new Date().toISOString(),
            },
          ];
        });
      } else {
        setLikes((old) =>
          old.filter(
            (row) =>
              row.user_id !== currentUser.id,
          ),
        );
      }

      await onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "喜欢失败。",
      );
    } finally {
      setLikeBusy(false);
    }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();

    const content = commentText.trim();

    if (!content || commentBusy) return;

    setCommentBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/puzzles/${puzzle.id}/comments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content }),
        },
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ?? "留言失败。",
        );
      }

      setComments((old) => [
        ...old,
        data.comment,
      ]);

      setCommentText("");
      setCommentOpen(false);

      await onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "留言失败。",
      );
    } finally {
      setCommentBusy(false);
    }
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modalCard modalWide" onMouseDown={(event) => event.stopPropagation()}>
        <div className="detailTop">
          <div className="detailCoverColumn">
            <button
              type="button"
              className="detailCoverButton"
              onClick={() => setCoverPreview(true)}
              aria-label="预览原图"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="detailCover"
                src={puzzle.cover_url}
                alt={puzzle.name}
              />
            </button>
          </div>

          <div className="detailInfo">
            <div className="modalHeader detailHeader">
              <div>
                <p className="eyebrow">{puzzle.brand || "未填写品牌"}</p>
                <h2>{puzzle.name}</h2>
              </div>
              <button type="button" className="iconButton" onClick={onClose} aria-label="关闭">×</button>
            </div>

            <div className="puzzleSocialBar">
              <button
                type="button"
                className={`likeButton ${likedByMe ? "liked" : ""}`}
                disabled={likeBusy}
                onClick={() => void toggleLike()}
                aria-label={likedByMe ? "取消喜欢" : "喜欢"}
              >
                <span className="heartIcon">
                  {likedByMe ? "♥" : "♡"}
                </span>
                <span>
                  {likes.length > 0
                    ? likes.length
                    : "喜欢"}
                </span>
              </button>

              {likes.length > 0 && (
                <div className="likeAvatars">
                  {likes.slice(0, 8).map((like) => (
                    <button
                      type="button"
                      className="likeAvatarButton"
                      key={like.user_id}
                      title={like.username}
                      onClick={() =>
                        onOpenUser(like.user_id)
                      }
                    >
                      <Avatar
                        name={like.username}
                        url={like.avatar_url}
                        size={24}
                      />
                    </button>
                  ))}

                  {likes.length > 8 && (
                    <span className="moreLikes">
                      +{likes.length - 8}
                    </span>
                  )}
                </div>
              )}

              <button
                type="button"
                className="commentToggleCompact"
                onClick={() =>
                  setCommentOpen((value) => !value)
                }
              >
                留言
                {comments.length > 0
                  ? ` ${comments.length}`
                  : ""}
              </button>
            </div>

            {(commentOpen || comments.length > 0) && (
              <div className="compactCommentArea">
                {commentOpen && (
                  <form
                    className="compactCommentForm"
                    onSubmit={submitComment}
                  >
                    <input
                      maxLength={300}
                      value={commentText}
                      placeholder="写一句留言…"
                      onChange={(event) =>
                        setCommentText(
                          event.target.value,
                        )
                      }
                    />

                    <button
                      type="submit"
                      className="primaryButton"
                      disabled={
                        commentBusy ||
                        !commentText.trim()
                      }
                    >
                      {commentBusy
                        ? "…"
                        : "发送"}
                    </button>
                  </form>
                )}

                {comments.length > 0 && (
                  <div className="compactCommentList">
                    {comments.map((comment) => (
                      <div
                        className="compactCommentRow"
                        key={comment.id}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            onOpenUser(
                              comment.user_id,
                            )
                          }
                        >
                          {comment.username}:
                        </button>
                        <span>
                          {comment.content}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="ownerLine ownerLineLarge">
              <Avatar name={puzzle.owner_name} url={puzzle.owner_avatar_url} size={34} onOpen={() => onOpenUser(puzzle.owner_id)} />
              <span>图主 <strong>{puzzle.owner_name}</strong></span>
            </div>

            <div className="detailStatus">
              <span className={puzzle.drift_state === "drifting" ? "dot dotGreen" : "dot"} />
              {summary}
            </div>

            <div className="puzzleMeta puzzleMetaDetail">
              <span>{puzzle.piece_count ? `${puzzle.piece_count} 片` : "片数未填"}</span>
              <span>{puzzle.has_box ? "有盒" : "无盒"}</span>
              <span>{puzzle.has_sheet ? "有图纸" : "无图纸"}</span>
            </div>

            {puzzle.description && <p className="detailDescription">{puzzle.description}</p>}

            <div className="detailActions">
              {canJoin && (
                <button type="button" className="primaryButton" disabled={busy} onClick={joinQueue}>加入排队</button>
              )}
              {myWaiting && (
                <button type="button" className="secondaryButton" disabled={busy} onClick={leaveQueue}>退出排队</button>
              )}
              {myWaiting && <><button type="button" className="secondaryButton" disabled={busy} onClick={() => void moveQueue(-1)}>往前一位</button><button type="button" className="secondaryButton" disabled={busy} onClick={() => void moveQueue(1)}>往后一位</button></>}
              {canReceive && (
                <button type="button" className="secondaryButton" onClick={() => setRetentionMode("received")}>上传收货留存</button>
              )}
              {canShip && (
                <button type="button" className="primaryButton" onClick={() => { setReturnHome(false); setRetentionMode("shipped"); }}>上传发货留存并交给下一棒</button>
              )}
              {myCurrent && nextWaiting && <button type="button" className="secondaryButton" onClick={() => { setReturnHome(false); setFeeOpen(true); }}>填写发货邮费</button>}
              {myCurrent && nextWaiting && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void handoff(false)}>面交给下一棒</button>}
              {canReturn && <button type="button" className="secondaryButton" onClick={() => { setReturnHome(true); setFeeOpen(true); }}>寄回图主并填写回家邮费</button>}
              {canReturn && <button type="button" className="secondaryButton" onClick={() => { setReturnHome(true); setRetentionMode("shipped"); }}>上传寄回留存</button>}
              {canReturn && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void handoff(true)}>面交还给图主</button>}
              {(canShip || canReturn) && <span className="actionHint">先填写邮费，再上传发货留存。</span>}
            </div>
          </div>
        </div>

        {error && <div className="errorBox detailError">{error}</div>}

        {feeOpen && <form className="retentionPanel" onSubmit={submitFee}>
          <h3>{returnHome ? "回家邮费" : "发货邮费"}</h3>
          <div className="destinationBox"><strong>收件人：{feeDestination?.username ?? "正在读取…"}</strong><p>{feeDestination?.shipping_address ?? "地址尚未填写，请先联系收件人。"}</p>{feeDestination?.shipping_address && <button type="button" className="secondaryButton" onClick={() => void navigator.clipboard.writeText(feeDestination.shipping_address ?? "")}>复制地址</button>}</div>
          <label><span>金额（元）*</span><input type="number" min="0.01" step="0.01" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} required /></label>
          <label><span>运单号（选填）</span><input maxLength={120} value={tracking} onChange={(e) => setTracking(e.target.value)} /></label>
          <label><span>运费截图（选填）</span><input type="file" accept="image/*" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} /></label>
          <div className="modalActions alignLeft"><button type="button" className="secondaryButton" onClick={() => setFeeOpen(false)}>取消</button><button className="primaryButton" disabled={busy}>提交邮费</button></div>
        </form>}

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
              <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => setRetentionFiles(Array.from(event.target.files ?? []))} />
            </label>

            <label>
              <span>备注</span>
              <textarea rows={3} maxLength={1000} value={retentionNote} onChange={(event) => setRetentionNote(event.target.value)} placeholder="可选" />
            </label>

            <div className="modalActions alignLeft">
              <button type="button" className="secondaryButton" onClick={() => setRetentionMode(null)}>取消</button>
              <button type="submit" className="primaryButton" disabled={busy || retentionFiles.length === 0 || !retentionDate}>
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
                  <Avatar name={row.username} url={row.avatar_url} size={38} onOpen={() => onOpenUser(row.user_id)} />
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
                  {(history[row.id]?.received_photo_urls ?? []).map((url, i) => <a href={url} target="_blank" rel="noreferrer" key={`r${i}`}>收货图 {i + 1}</a>)}
                  {history[row.id]?.receiving_note && <span>{history[row.id].receiving_note}</span>}
                  {(history[row.id]?.shipping_photo_urls ?? []).map((url, i) => <a href={url} target="_blank" rel="noreferrer" key={`s${i}`}>发货图 {i + 1}</a>)}
                  {history[row.id]?.shipping_note && <span>{history[row.id].shipping_note}</span>}
                </div>
              </div>
            ))}
          </div>
          {handoffs.length > 0 && <div className="journeyList"><h4>面交记录</h4>{handoffs.map((handoff) => <p key={handoff.id}>
            {puzzle.journey.find((row) => row.user_id === handoff.from_user_id)?.username ?? "成员"} → {puzzle.journey.find((row) => row.user_id === handoff.to_user_id)?.username ?? "成员"}
            {handoff.return_home ? "（交还图主）" : ""} · {new Date(handoff.created_at).toLocaleDateString("zh-CN")}
          </p>)}</div>}
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
                  <BrandInput
                    value={brand}
                    onChange={setBrand}
                    brands={brands}
                  />
                </label>

                <label>
                  <span>片数</span>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    step={1}
                    value={pieceCount}
                    onChange={(event) => setPieceCount(event.target.value)}
                  />
                </label>

                <div className="featureChecks editWide">
                  <label className="checkboxRow">
                    <input
                      type="checkbox"
                      checked={hasBox}
                      onChange={(event) => setHasBox(event.target.checked)}
                    />
                    <span>有盒</span>
                  </label>

                  <label className="checkboxRow">
                    <input
                      type="checkbox"
                      checked={hasSheet}
                      onChange={(event) => setHasSheet(event.target.checked)}
                    />
                    <span>有图纸</span>
                  </label>
                </div>

                <label className="editWide">
                  <span>介绍</span>
                  <textarea rows={3} value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} />
                </label>
                {puzzle.availability !== "retired" && <label>
                  <span>漂流状态</span>
                  <select value={availability} onChange={(event) => setAvailability(event.target.value as Puzzle["availability"])}>
                    <option value="active">开放漂流</option>
                    <option value="paused">暂停漂流</option>
                  </select>
                </label>}
                <div className="modalActions editWide alignLeft">
                  <button type="button" className="secondaryButton" onClick={() => setEditing(false)}>取消</button>
                  <button type="submit" className="primaryButton" disabled={busy}>保存</button>
                </div>
              </form>
            )}
            <div className="adminDangerZone">
              <p>
                {currentUser.is_admin
                  ? "管理员 / 图主管理"
                  : "图主管理"}
              </p>

              {puzzle.availability !== "retired" && (
                <button
                  type="button"
                  className="dangerButton"
                  disabled={busy}
                  onClick={() => void forceEnd()}
                >
                  强制结束拼图
                </button>
              )}

              <button
                type="button"
                className="dangerButton"
                disabled={busy}
                onClick={() => void deletePuzzle()}
              >
                删除拼图
              </button>
            </div>
          </section>
        )}

      </div>

      {coverPreview && (
        <ImageLightbox
          src={puzzle.cover_url}
          alt={puzzle.name}
          onClose={() => setCoverPreview(false)}
        />
      )}
    </div>
  );
}
