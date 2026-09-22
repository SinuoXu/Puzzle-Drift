"use client";

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";

  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.38)) }}
      aria-label={name}
      title={name}
    >
      {initial}
    </div>
  );
}
