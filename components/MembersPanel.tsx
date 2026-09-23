"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import type { Member } from "@/lib/types";

export function MembersPanel({
  members,
  onOpenUser,
}: {
  members: Member[];
  onOpenUser: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="membersPanel">
      <button
        type="button"
        className="membersToggle"
        onClick={() => setOpen((value) => !value)}
      >
        <span>成员</span>
        <strong>{members.length}</strong>
        <span>{open ? "收起 ▲" : "查看全部 ▼"}</span>
      </button>

      {open && (
        <div className="membersList">
          {members.map((member) => (
            <button
              type="button"
              className="memberRow"
              key={member.id}
              onClick={() => onOpenUser(member.id)}
            >
              <Avatar
                name={member.username}
                url={member.avatar_url}
                size={34}
              />

              <span className="memberName">{member.username}</span>

              {member.is_admin && (
                <span className="memberAdmin">管理员</span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
