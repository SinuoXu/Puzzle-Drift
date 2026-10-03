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
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [resetUsername, setResetUsername] = useState("");
  const [resetResult, setResetResult] = useState("");
  const [registrationOpen, setRegistrationOpenValue] = useState<boolean | null>(null);

  useEffect(() => {
    void fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      setAddress(data.shipping_address ?? "");
      setAvatar(data.avatar_url ?? null);
      setQr(data.payment_qr_url ?? null);
    });

    if (user.is_admin) {
      void fetch("/api/admin/registration", { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error ?? "读取注册设置失败。");
          setRegistrationOpenValue(Boolean(data.registration_open));
        })
        .catch((error) => {
          setMessage(error instanceof Error ? error.message : "读取注册设置失败。");
        });
    }
  }, [user.is_admin]);

  async function save(update: Record<string, string>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "保存失败。");
      setMessage("已保存");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined, kind: "avatar" | "payment_qr") {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const url = await uploadImage(file, kind);
      await save(kind === "avatar" ? { avatar_url: url } : { payment_qr_url: url });
      if (kind === "avatar") setAvatar(url);
      else setQr(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败。");
    } finally {
      setBusy(false);
    }
  }

  async function changePin() {
    if (
      newPin.length !== 6 ||
      confirmPin.length !== 6
    ) {
      setMessage("新 PIN 必须是 6 位数字。");
      return;
    }

    if (newPin !== confirmPin) {
      setMessage("两次输入的新 PIN 不一致。");
      return;
    }

    if (
      currentPin.length !== 0 &&
      currentPin.length !== 6
    ) {
      setMessage("当前 PIN 必须是 6 位数字。");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/session",
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            current_pin: currentPin,
            new_pin: newPin,
          }),
        },
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ?? "修改 PIN 失败。",
        );
      }

      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");

      setMessage(
        "PIN 已修改。其他设备上的旧登录状态已失效。",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "修改 PIN 失败。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetPin() {
    const response = await fetch("/api/admin/reset-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: resetUsername }),
    });
    const data = await response.json().catch(() => ({}));
    setResetResult(
      response.ok
        ? `临时 PIN：${data.pin}。请私下告知本人。`
        : data.error ?? "重置失败。",
    );
  }

  async function toggleRegistration() {
    if (registrationOpen === null) return;

    setBusy(true);
    setMessage("");

    try {
      const next = !registrationOpen;
      const response = await fetch("/api/admin/registration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "修改注册设置失败。");
      setRegistrationOpenValue(Boolean(data.registration_open));
      setMessage(data.registration_open ? "已重新开放新成员注册" : "已关闭新成员注册");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修改注册设置失败。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="sidebarCard profilePanel">
    <h3>我的资料</h3>

    <div className="ownerLine">
      <Avatar name={user.username} url={avatar} size={48} />
      <strong>{user.username}</strong>
    </div>

    <label>
      头像
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => void upload(e.target.files?.[0], "avatar")}
      />
    </label>

    <label>
      收货地址
      <textarea
        rows={3}
        maxLength={500}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
    </label>

    <button
      className="secondaryButton"
      disabled={busy}
      onClick={() => void save({ shipping_address: address })}
    >
      保存地址
    </button>

    <label>
      收款码
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => void upload(e.target.files?.[0], "payment_qr")}
      />
    </label>

    {qr && <img src={qr} alt="我的收款码" style={{ width: 120, maxWidth: "100%" }} />}

    <section className="pinChangeBlock">
      <h4>修改 PIN</h4>

      <p>
        记得当前 PIN 时可以自行修改。
        如果已经忘记，请联系管理员生成临时 PIN。
      </p>

      <label>
        当前 PIN
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="current-password"
          value={currentPin}
          onChange={(event) =>
            setCurrentPin(
              event.target.value.replace(
                /\D/g,
                "",
              ),
            )
          }
          placeholder="6 位数字"
        />
      </label>

      <label>
        新 PIN
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="new-password"
          value={newPin}
          onChange={(event) =>
            setNewPin(
              event.target.value.replace(
                /\D/g,
                "",
              ),
            )
          }
          placeholder="新的 6 位数字"
        />
      </label>

      <label>
        再输入一次新 PIN
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="new-password"
          value={confirmPin}
          onChange={(event) =>
            setConfirmPin(
              event.target.value.replace(
                /\D/g,
                "",
              ),
            )
          }
          placeholder="再次输入新的 PIN"
        />
      </label>

      <button
        className="secondaryButton"
        disabled={
          busy ||
          newPin.length !== 6 ||
          confirmPin.length !== 6 ||
          newPin !== confirmPin ||
          (
            currentPin.length !== 0 &&
            currentPin.length !== 6
          )
        }
        onClick={() => void changePin()}
      >
        {busy
          ? "正在修改…"
          : "修改 PIN"}
      </button>
    </section>

    {user.is_admin && (
      <section className="adminBlock">
        <h4>管理员：成员注册</h4>

        <p>
          当前：
          <strong>
            {registrationOpen === null
              ? " 正在读取…"
              : registrationOpen
                ? " 开放"
                : " 已关闭"}
          </strong>
        </p>

        <button
          className={registrationOpen === false ? "primaryButton" : "secondaryButton"}
          disabled={busy || registrationOpen === null}
          onClick={() => void toggleRegistration()}
        >
          {registrationOpen === false ? "重新开放注册" : "关闭新用户注册"}
        </button>

        <h4>管理员：恢复成员 PIN</h4>
        <input
          value={resetUsername}
          onChange={(e) => setResetUsername(e.target.value)}
          placeholder="用户名"
        />
        <button className="secondaryButton" onClick={() => void resetPin()}>
          生成临时 PIN
        </button>

        {resetResult && <p>{resetResult}</p>}
      </section>
    )}

    {message && <p>{message}</p>}
  </section>;
}
