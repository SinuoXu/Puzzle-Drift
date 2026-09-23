"use client";

import { useEffect, useState } from "react";

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "+" || event.key === "=") {
        setZoom((value) => Math.min(4, value + 0.25));
      }
      if (event.key === "-") {
        setZoom((value) => Math.max(0.5, value - 0.25));
      }
    };

    window.addEventListener("keydown", key);

    return () => {
      document.body.style.overflow = old;
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div className="imageLightbox" onMouseDown={onClose}>
      <div
        className="imageLightboxToolbar"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
        >
          −
        </button>

        <button type="button" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>

        <button
          type="button"
          onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
        >
          ＋
        </button>

        <a href={src} target="_blank" rel="noreferrer">
          打开原图
        </a>

        <button type="button" onClick={onClose}>
          ×
        </button>
      </div>

      <div
        className="imageLightboxStage"
        onMouseDown={(event) => event.stopPropagation()}
        onWheel={(event) => {
          event.preventDefault();
          setZoom((value) =>
            Math.min(4, Math.max(0.5, value + (event.deltaY < 0 ? 0.15 : -0.15)))
          );
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{ transform: `scale(${zoom})` }}
          onDoubleClick={() => setZoom((value) => value === 1 ? 2 : 1)}
        />
      </div>
    </div>
  );
}
