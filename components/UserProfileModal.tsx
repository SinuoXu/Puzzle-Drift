"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";

type Profile = { username: string; avatar_url: string | null; shipping_address: string | null; payment_qr_url: string | null };

export function UserProfileModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch(`/api/users/${userId}`, { cache: "no-store" }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "读取主页失败。");
      setProfile(data.profile);
    }).catch((e) => setError(e instanceof Error ? e.message : "读取主页失败。"));
  }, [userId]);
  return <div className="modalBackdrop" onMouseDown={onClose}>
    <div className="modalCard modalNarrow" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modalHeader"><div className="ownerLine"><Avatar name={profile?.username ?? "?"} url={profile?.avatar_url} size={48} /><h2>{profile?.username ?? "用户主页"}</h2></div><button className="iconButton" onClick={onClose}>×</button></div>
      {error && <div className="errorBox">{error}</div>}
      {profile && <div className="formStack">
        <section><h3>收货地址</h3><p style={{ whiteSpace: "pre-wrap" }}>{profile.shipping_address || "还没有填写地址"}</p>
          {profile.shipping_address && <button className="secondaryButton" onClick={() => void navigator.clipboard.writeText(profile.shipping_address ?? "")}>复制地址</button>}</section>
        <section><h3>收款码</h3>{profile.payment_qr_url ? <img src={profile.payment_qr_url} alt={`${profile.username}的收款码`} style={{ width: 220, maxWidth: "100%" }} /> : <p>还没有上传收款码</p>}</section>
      </div>}
    </div>
  </div>;
}
