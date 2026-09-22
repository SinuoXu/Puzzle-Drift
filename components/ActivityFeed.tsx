"use client";

import type { Activity } from "@/lib/types";
import { Avatar } from "@/components/Avatar";

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function describe(activity: Activity) {
  switch (activity.type) {
    case "puzzle_created":
      return `发布了新拼图《${activity.puzzle_name}》`;
    case "queue_joined":
      return `排队了《${activity.puzzle_name}》`;
    case "received":
      return `为《${activity.puzzle_name}》上传了收货留存`;
    case "shipped":
      return `为《${activity.puzzle_name}》上传了发货留存`;
    case "became_holder":
      return `成为《${activity.puzzle_name}》的当前持有人`;
    case "handoff":
      return `面交了《${activity.puzzle_name}》`;
    case "queue_moved":
      return `调整了《${activity.puzzle_name}》的排队位置`;
    case "availability_changed": {
      const value = String(activity.payload.availability ?? "");
      const label = value === "active" ? "开放漂流" : value === "paused" ? "暂停漂流" : "结束漂流";
      return `将《${activity.puzzle_name}》设为“${label}”`;
    }
    case "admin_forced_end":
      return `强制结束了《${activity.puzzle_name}》的漂流`;
    default:
      return `更新了《${activity.puzzle_name}》`;
  }
}

export function ActivityFeed({ activities, isAdmin, onOpenPuzzle, onOpenUser, onChanged }: { activities: Activity[]; isAdmin: boolean; onOpenPuzzle: (id: string) => void; onOpenUser: (id: string) => void; onChanged: () => Promise<void> }) {
  async function remove(activity: Activity) {
    if (!window.confirm(`删除这条关于《${activity.puzzle_name}》的消息？`)) return;
    const response = await fetch(`/api/admin/activity/${activity.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      window.alert(data.error ?? "删除消息失败。");
      return;
    }
    await onChanged();
  }

  if (activities.length === 0) {
    return <div className="emptyPanel">暂时还没有动态。发布第一张拼图后，这里会自动出现消息。</div>;
  }

  return (
    <div className="activityList">
      {activities.map((activity) => (
        <article className="activityItem" key={activity.id}>
          <button type="button" className="activityOpen" onClick={() => onOpenPuzzle(activity.puzzle_id)}>
            <Avatar name={activity.actor_name} url={activity.actor_avatar_url} size={38} onOpen={activity.actor_id ? () => onOpenUser(activity.actor_id as string) : undefined} />
            <div className="activityCopy">
              <div>
                <strong>{activity.actor_name}</strong> {describe(activity)}
              </div>
              <span>{formatTime(activity.created_at)}</span>
            </div>
          </button>
          {isAdmin && <button type="button" className="textButton activityDelete" onClick={() => void remove(activity)}>删除</button>}
        </article>
      ))}
    </div>
  );
}
