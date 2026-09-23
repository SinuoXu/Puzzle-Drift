"use client";

import { KeyboardEvent, useState } from "react";
import type { Puzzle } from "@/lib/types";
import { Avatar } from "@/components/Avatar";
import { ImageLightbox } from "@/components/ImageLightbox";

function stateLabel(puzzle: Puzzle) {
  if (puzzle.availability === "retired") {
    return { text: "退役", cls: "statusMuted" };
  }
  return { text: "正在漂", cls: "statusGreen" };
}

export function PuzzleCard({
  puzzle,
  onOpen,
  onOpenUser,
}: {
  puzzle: Puzzle;
  onOpen: (id: string) => void;
  onOpenUser: (id: string) => void;
}) {
  const state = stateLabel(puzzle);
  const [preview, setPreview] = useState(false);

  function keyboardOpen(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(puzzle.id);
    }
  }

  return (
    <>
      <article className="puzzleCard">
        <button
          className="puzzleCoverButton"
          type="button"
          onClick={() => setPreview(true)}
          aria-label={`预览 ${puzzle.name} 原图`}
        >
          <div className="puzzleCoverWrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="puzzleCover"
              src={puzzle.cover_url}
              alt={puzzle.name}
              loading="lazy"
            />
            <span className={`statusPill ${state.cls}`}>{state.text}</span>
          </div>
        </button>

        <div
          className="puzzleCardBody puzzleCardInteractiveBody"
          role="button"
          tabIndex={0}
          onClick={() => onOpen(puzzle.id)}
          onKeyDown={keyboardOpen}
        >
          <div className="puzzleCardTitleRow">
            <div>
              <h3>{puzzle.name}</h3>
              <p>{puzzle.brand || "未填写品牌"}</p>
            </div>

            <span className="queueCount">
              {puzzle.waiting_count > 0
                ? `排队 ${puzzle.waiting_count}`
                : "暂无排队"}
            </span>
          </div>

          <div className="puzzleMeta">
            <span>
              {puzzle.piece_count
                ? `${puzzle.piece_count} 片`
                : "片数未填"}
            </span>
            <span>{puzzle.has_box ? "有盒" : "无盒"}</span>
            <span>{puzzle.has_sheet ? "有图纸" : "无图纸"}</span>
          </div>

          <div
            className="ownerLine"
            onClick={(event) => event.stopPropagation()}
          >
            <Avatar
              name={puzzle.owner_name}
              url={puzzle.owner_avatar_url}
              size={28}
              onOpen={() => onOpenUser(puzzle.owner_id)}
            />
            <span>图主 {puzzle.owner_name}</span>
          </div>
        </div>
      </article>

      {preview && (
        <ImageLightbox
          src={puzzle.cover_url}
          alt={puzzle.name}
          onClose={() => setPreview(false)}
        />
      )}
    </>
  );
}
