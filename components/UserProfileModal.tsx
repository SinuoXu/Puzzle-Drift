"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import type { User } from "@/lib/types";

type Profile = {
  id: string;
  username: string;
  avatar_url: string | null;
  shipping_address: string | null;
  payment_qr_url: string | null;
  is_admin: boolean;
};

export function UserProfileModal({
  userId,
  currentUser,
  onClose,
  onDeleted,
}: {
  userId: string;
  currentUser: User;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch(`/api/users/${userId}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error ?? "读取主页失败。");
        }

        setProfile(data.profile);
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "读取主页失败。",
        );
      });
  }, [userId]);

  async function deleteMember() {
    if (!profile || busy) return;

    const confirmed = window.confirm(
      `删除成员「${profile.username}」？\n\n` +
      `该账号和登录状态会被删除；如果此成员拥有拼图，这些拼图及相关的排队、待办、动态和图片也会一起删除。\n\n` +
      `如果此成员当前正在持有别人的拼图，或还有未完成待办，系统会拒绝删除，以避免破坏漂流流程。\n\n` +
      `此操作无法恢复。`
    );

    if (!confirmed) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/users/${profile.id}`,
        { method: "DELETE" },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "删除成员失败。");
      }

      await onDeleted();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "删除成员失败。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div
        className="modalCard modalNarrow"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modalHeader">
          <div className="ownerLine">
            <Avatar
              name={profile?.username ?? "?"}
              url={profile?.avatar_url}
              size={48}
            />
            <h2>{profile?.username ?? "用户主页"}</h2>
          </div>

          <button
            className="iconButton"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {error && <div className="errorBox">{error}</div>}

        {profile && (
          <div className="formStack">
            <section>
              <h3>收货地址</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>
                {profile.shipping_address || "还没有填写地址"}
              </p>

              {profile.shipping_address && (
                <button
                  className="secondaryButton"
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      profile.shipping_address ?? "",
                    )
                  }
                >
                  复制地址
                </button>
              )}
            </section>

            <section>
              <h3>收款码</h3>

              {profile.payment_qr_url ? (
                <img
                  src={profile.payment_qr_url}
                  alt={`${profile.username}的收款码`}
                  style={{
                    width: 220,
                    maxWidth: "100%",
                  }}
                />
              ) : (
                <p>还没有上传收款码</p>
              )}
            </section>

            {currentUser.is_admin &&
              currentUser.id !== profile.id &&
              !profile.is_admin && (
                <section className="adminDangerZone">
                  <p>管理员操作</p>

                  <button
                    type="button"
                    className="dangerButton"
                    disabled={busy}
                    onClick={() => void deleteMember()}
                  >
                    {busy ? "删除中…" : "删除成员"}
                  </button>
                </section>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
