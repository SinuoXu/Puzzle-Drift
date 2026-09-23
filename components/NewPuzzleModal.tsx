"use client";

import { FormEvent, useState } from "react";
import { uploadImage } from "@/lib/client-image";

export function NewPuzzleModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [pieceCount, setPieceCount] = useState("");
  const [hasBox, setHasBox] = useState(false);
  const [hasSheet, setHasSheet] = useState(false);
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pieces = Number(pieceCount);
  const piecesValid =
    Number.isSafeInteger(pieces) &&
    pieces > 0 &&
    pieces <= 100_000;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !cover || !piecesValid) return;

    setBusy(true);
    setError("");

    try {
      const coverUrl = await uploadImage(cover, "cover");
      const response = await fetch("/api/puzzles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          brand,
          description,
          cover_url: coverUrl,
          piece_count: pieces,
          has_box: hasBox,
          has_sheet: hasSheet,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "发布失败。");

      await onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modalCard modalNarrow" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <p className="eyebrow">我的拼图</p>
            <h2>发布新拼图</h2>
          </div>
          <button type="button" className="iconButton" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <form className="formStack" onSubmit={submit}>
          <label>
            <span>拼图名称 *</span>
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="例如：星夜" />
          </label>

          <label>
            <span>品牌</span>
            <input value={brand} maxLength={80} onChange={(event) => setBrand(event.target.value)} placeholder="例如：HEYE" />
          </label>

          <label>
            <span>片数 *</span>
            <input
              type="number"
              min={1}
              max={100000}
              step={1}
              inputMode="numeric"
              value={pieceCount}
              onChange={(event) => setPieceCount(event.target.value)}
              placeholder="例如：1000"
            />
          </label>

          <div className="featureChecks">
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

          <label>
            <span>封面图 *</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setCover(event.target.files?.[0] ?? null)} />
          </label>

          <label>
            <span>备注 / 介绍</span>
            <textarea value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} placeholder="可选" rows={4} />
          </label>

          {error && <div className="errorBox">{error}</div>}

          <div className="modalActions">
            <button type="button" className="secondaryButton" onClick={onClose}>取消</button>
            <button type="submit" className="primaryButton" disabled={busy || !name.trim() || !cover || !piecesValid}>
              {busy ? "发布中…" : "发布拼图"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
