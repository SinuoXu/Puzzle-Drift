"use client";

import { useState } from "react";

type BrandChange = {
  puzzle_name: string;
  before: string;
  after: string;
};

export function BrandMaintenance() {
  const [busy, setBusy] = useState(false);

  async function normalize() {
    setBusy(true);

    try {
      const previewResponse = await fetch(
        "/api/admin/normalize-brands",
        { cache: "no-store" },
      );

      const preview = await previewResponse
        .json()
        .catch(() => ({}));

      if (!previewResponse.ok) {
        throw new Error(
          preview.error ?? "读取品牌失败。",
        );
      }

      const changes =
        (preview.changes ?? []) as BrandChange[];

      if (changes.length === 0) {
        window.alert(
          "目前品牌名称已经全部规范，无需修改。",
        );
        return;
      }

      const summary = changes
        .slice(0, 20)
        .map(
          (row) =>
            `${row.puzzle_name}: ${row.before} → ${row.after}`,
        )
        .join("\n");

      const confirmed = window.confirm(
        `将规范化 ${changes.length} 张拼图的品牌名称：\n\n` +
        summary +
        (changes.length > 20
          ? `\n\n另外还有 ${changes.length - 20} 项。`
          : "") +
        "\n\n执行前会先完整备份数据库状态，而且只修改品牌字段。确定继续吗？",
      );

      if (!confirmed) return;

      const response = await fetch(
        "/api/admin/normalize-brands",
        { method: "POST" },
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ?? "品牌整理失败。",
        );
      }

      window.alert(
        `完成：修改了 ${data.changed} 张拼图。\n\n` +
        `修改前完整备份已保存：\n${data.backup_key}`,
      );

      window.location.reload();
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "品牌整理失败。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="secondaryButton"
      disabled={busy}
      onClick={() => void normalize()}
    >
      {busy
        ? "正在检查品牌…"
        : "规范化现有品牌名称"}
    </button>
  );
}
