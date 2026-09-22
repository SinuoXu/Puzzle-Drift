"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { uploadImage } from "@/lib/client-image";
import type { User } from "@/lib/types";

export function OnboardingPanel({ user, onCompleted, onLogout }: { user: User; onCompleted: () => Promise<void>; onLogout: () => Promise<void> }) {
  const [address, setAddress] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(user.avatar_url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File | undefined, kind: "avatar" | "payment_qr") {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const url = await uploadImage(file, kind);
      if (kind === "avatar") setAvatar(url); else setQr(url);
    } catch (err) { setError(err instanceof Error ? err.message : "上传失败。"); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!address.trim() || !qr) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shipping_address: address, payment_qr_url: qr, ...(avatar ? { avatar_url: avatar } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.needs_profile) throw new Error(data.error ?? "请填写地址和收款码。");
      await onCompleted();
    } catch (err) { setError(err instanceof Error ? err.message : "保存失败。"); }
    finally { setBusy(false); }
  }

  return <main className="loginPage"><section className="loginCard profilePanel">
    <h1>完善个人资料</h1>
    <p>首次进入前，请填写收货地址并上传收款码。头像可选，未上传时显示字母头像。</p>
    <div className="ownerLine"><Avatar name={user.username} url={avatar} size={48} /><strong>{user.username}</strong></div>
    <label>头像（选填）<input type="file" accept="image/*" disabled={busy} onChange={(e) => void upload(e.target.files?.[0], "avatar")} /></label>
    <label>收货地址 *<textarea rows={3} maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
    <label>收款码 *<input type="file" accept="image/*" disabled={busy} onChange={(e) => void upload(e.target.files?.[0], "payment_qr")} /></label>
    {qr && <img src={qr} alt="我的收款码" style={{ width: 120 }} />}
    {error && <div className="errorBox">{error}</div>}
    <button className="primaryButton" disabled={busy || !address.trim() || !qr} onClick={() => void save()}>{busy ? "保存中…" : "保存并进入"}</button>
    <button className="secondaryButton" disabled={busy} onClick={() => void onLogout()}>退出登录</button>
  </section></main>;
}
