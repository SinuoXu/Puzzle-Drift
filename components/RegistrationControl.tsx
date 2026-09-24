"use client";

import { useEffect, useState } from "react";
import { BrandMaintenance } from "@/components/BrandMaintenance";

export function RegistrationControl() {
  const [open, setOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setError("");

    try {
      const response = await fetch("/api/admin/registration", {
        cache: "no-store",
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "读取注册设置失败。");
      }

      setOpen(Boolean(data.registration_open));
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取注册设置失败。");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle() {
    if (open === null || busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/admin/registration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open: !open }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "修改注册设置失败。");
      }

      setOpen(Boolean(data.registration_open));
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改注册设置失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="registrationControl">
      <div>
        <span>新成员注册</span>
        <strong>
          {open === null
            ? "读取中…"
            : open
              ? "已开放"
              : "已关闭"}
        </strong>
      </div>

      <button
        type="button"
        className={open === false ? "primaryButton" : "secondaryButton"}
        disabled={busy || open === null}
        onClick={() => void toggle()}
      >
        {busy
          ? "处理中…"
          : open === false
            ? "重新开放注册"
            : "关闭新用户注册"}
      </button>

      {error && <p>{error}</p>}

      <div className="adminMiniDivider" />

      <BrandMaintenance />
    </section>
  );
}
