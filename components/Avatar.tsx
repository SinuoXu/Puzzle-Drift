"use client";

export function Avatar({ name, size = 36, url, onOpen }: { name: string; size?: number; url?: string | null; onOpen?: () => void }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";

  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.38)) }}
      title={name}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? (event) => { event.stopPropagation(); onOpen(); } : undefined}
      onKeyDown={onOpen ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onOpen(); } } : undefined}
      aria-label={onOpen ? `查看${name}的主页` : name}
    >
      {url ? <img src={url} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} /> : initial}
    </div>
  );
}
