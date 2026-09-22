"use client";

import type { Puzzle } from "@/lib/types";
import { Avatar } from "@/components/Avatar";

function stateLabel(puzzle: Puzzle) {
  if (puzzle.availability === "retired") return { text: "退役", cls: "statusMuted" };
  return { text: "正在漂", cls: "statusGreen" };
}

export function PuzzleCard({ puzzle, onOpen, onOpenUser }: { puzzle: Puzzle; onOpen: (id: string) => void; onOpenUser: (id: string) => void }) {
  const state = stateLabel(puzzle);

  return (
    <button className="puzzleCard" type="button" onClick={() => onOpen(puzzle.id)}>
      <div className="puzzleCoverWrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="puzzleCover" src={puzzle.cover_url} alt={puzzle.name} loading="lazy" />
        <span className={`statusPill ${state.cls}`}>{state.text}</span>
      </div>

      <div className="puzzleCardBody">
        <div className="puzzleCardTitleRow">
          <div>
            <h3>{puzzle.name}</h3>
            <p>{puzzle.brand || "未填写品牌"}</p>
          </div>
          <span className="queueCount">{puzzle.waiting_count > 0 ? `排队 ${puzzle.waiting_count}` : "暂无排队"}</span>
        </div>

        <div className="ownerLine">
          <Avatar name={puzzle.owner_name} url={puzzle.owner_avatar_url} size={28} onOpen={() => onOpenUser(puzzle.owner_id)} />
          <span>图主 {puzzle.owner_name}</span>
        </div>
      </div>
    </button>
  );
}
