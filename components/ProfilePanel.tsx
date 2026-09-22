"use client";

import { useEffect, useState } from "react";
import { uploadImage } from "@/lib/client-image";
import { Avatar } from "@/components/Avatar";
import type { User } from "@/lib/types";

export function ProfilePanel({ user, onChanged }: { user: User; onChanged: () => Promise<void> }) {
  const [address, setAddress] = useState("");
  const [avatar, setAvatar] = useState<string | null>(user.avatar_url);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pin, setPin] = useState("");
  const [resetUsername, setResetUsername] = useState("");
  const [resetResult, setResetResult] = useState("");

  useEffect(() => {
    void fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      setAddress(data.shipping_address ?? "");
      setAvatar(data.avatar_url ?? null);
      setQr(data.payment_qr_url ?? null);
    });
  }, []);

  async function save(update: Record<string, string>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) });
      if (!response.ok) throw new Error((await response.json()).error ?? "保存失败。");
      setMessage("已保存");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally { setBusy(false); }
  }

  async function upload(file: File | undefined, kind: "avatar" | "payment_qr") {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const url = await uploadImage(file, kind);
      await save(kind === "avatar" ? { avatar_url: url } : { payment_qr_url: url });
      if (kind === "avatar") setAvatar(url); else setQr(url);
    } catch (error) { setMessage(error instanceof Error ? error.message : "上传失败。"); }
    finally { setBusy(false); }
  }

  async function savePin() {
    const response = await fetch("/api/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? "PIN 已设置" : data.error ?? "设置 PIN 失败。");
    if (response.ok) setPin("");
  }

  async function resetPin() {
    const response = await fetch("/api/admin/reset-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: resetUsername }) });
    const data = await response.json().catch(() => ({}));
    setResetResult(response.ok ? `临时 PIN：${data.pin}。请私下告知本人。` : data.error ?? "重置失败。");
  }

  return <section className="sidebarCard profilePanel">
    <h3>我的资料</h3>
    <div className="ownerLine"><Avatar name={user.username} url={avatar} size={48} /><strong>{user.username}</strong></div>
    <label>头像 <input type="file" accept="image/*" disabled={busy} onChange={(e) => void upload(e.target.files?.[0], "avatar")} /></label>
    <label>收货地址 <textarea rows={3} maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
    <button className="secondaryButton" disabled={busy} onClick={() => void save({ shipping_address: address })}>保存地址</button>
    <label>收款码 <input type="file" accept="image/*" disabled={busy} onChange={(e) => void upload(e.target.files?.[0], "payment_qr")} /></label>
    {qr && <img src={qr} alt="我的收款码" style={{ width: 120, maxWidth: "100%" }} />}
    <label>旧账号设置 6 位 PIN <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} /></label>
    <button className="secondaryButton" disabled={pin.length !== 6} onClick={() => void savePin()}>设置 PIN</button>
    {user.is_admin && <section><h4>管理员：恢复成员 PIN</h4><input value={resetUsername} onChange={(e) => setResetUsername(e.target.value)} placeholder="用户名" /><button className="secondaryButton" onClick={() => void resetPin()}>生成临时 PIN</button>{resetResult && <p>{resetResult}</p>}</section>}
    {message && <p>{message}</p>}
  </section>;
}
