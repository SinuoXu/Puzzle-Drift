"use client";

import { useEffect, useMemo, useState } from "react";

type Usage = {
  scanned_at: string;
  total_bytes: number;
  capacity_bytes: number;
  image_bytes: number;
  image_objects: number;
  data_bytes: number;
  data_objects: number;
  cached: boolean;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }

  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  }

  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }

  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`;
  }

  return `${bytes} B`;
}

export function StorageUsage() {
  const [usage, setUsage] =
    useState<Usage | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  async function load(force = false) {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/storage${force ? "?refresh=1" : ""}`,
        {
          cache: "no-store",
        },
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ??
            "读取存储空间失败。",
        );
      }

      setUsage(data as Usage);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "读取存储空间失败。",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, []);

  const percent = useMemo(() => {
    if (!usage) return 0;

    return Math.min(
      100,
      Math.max(
        0,
        usage.total_bytes /
          usage.capacity_bytes *
          100,
      ),
    );
  }, [usage]);

  const level =
    percent >= 85
      ? "danger"
      : percent >= 70
        ? "warning"
        : "normal";

  const remaining = usage
    ? Math.max(
        0,
        usage.capacity_bytes -
          usage.total_bytes,
      )
    : 0;

  return (
    <section className={`storageUsage storage-${level}`}>
      <div className="storageHeader">
        <div>
          <span>存储空间</span>

          {usage && (
            <small>
              {usage.cached
                ? "最近统计"
                : "刚刚统计"}
            </small>
          )}
        </div>

        {usage && (
          <strong>
            {percent.toFixed(1)}%
          </strong>
        )}
      </div>

      {loading && !usage && (
        <p className="storageMuted">
          正在统计 Blob 存储…
        </p>
      )}

      {usage && (
        <>
          <div className="storageMainNumber">
            <strong>
              {formatBytes(
                usage.total_bytes,
              )}
            </strong>

            <span>
              / {formatBytes(
                usage.capacity_bytes,
              )}
            </span>
          </div>

          <div className="storageBar">
            <span
              style={{
                width: `${percent}%`,
              }}
            />
          </div>

          <div className="storageRows">
            <div>
              <span>图片</span>
              <strong>
                {formatBytes(
                  usage.image_bytes,
                )}
              </strong>
              <small>
                {usage.image_objects} 个对象
              </small>
            </div>

            <div>
              <span>数据</span>
              <strong>
                {formatBytes(
                  usage.data_bytes,
                )}
              </strong>
              <small>
                {usage.data_objects} 个对象
              </small>
            </div>

            <div>
              <span>剩余</span>
              <strong>
                {formatBytes(remaining)}
              </strong>
            </div>
          </div>

          {percent >= 85 && (
            <p className="storageWarningText">
              存储空间已超过 85%，建议尽快清理图片或增加容量。
            </p>
          )}

          {percent >= 70 &&
            percent < 85 && (
              <p className="storageWarningText">
                存储空间已超过 70%，建议开始关注后续图片增长。
              </p>
            )}

          <p className="storageTimestamp">
            统计时间：
            {new Date(
              usage.scanned_at,
            ).toLocaleString("zh-CN")}
          </p>
        </>
      )}

      {error && (
        <p className="storageError">
          {error}
        </p>
      )}

      <button
        type="button"
        className="secondaryButton"
        disabled={loading}
        onClick={() => void load(true)}
      >
        {loading
          ? "正在统计…"
          : "重新统计"}
      </button>

      <p className="storageFootnote">
        这里只统计 Puzzle Drift 当前项目的
        data 和 images 两个 Blob 空间。
      </p>
    </section>
  );
}
