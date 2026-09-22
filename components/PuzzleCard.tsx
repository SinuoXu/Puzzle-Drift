"use client";

import type { Puzzle } from "@/lib/types";
import { Avatar } from "@/components/Avatar";

function stateLabel(puzzle: Puzzle) {
  if (puzzle.availability === "paused") return { text: "暂停漂流", cls: "statusMuted" };
  if (puzzle.availability === "retired") return { text: "结束漂流", cls: "statusMuted" };
  if (puzzle.drift_state === "drifting") return { text: `在 ${puzzle.current_holder_name} 手里`, cls: "statusGreen" };
  if (puzzle.drift_state === "waiting_to_ship") return { text: "待图主发出", cls: "statusAmber" };
  return { text: "目前没在漂", cls: "statusMuted" };
}

export function PuzzleCard({ puzzle, onOpen }: { puzzle: Puzzle; onOpen: (id: string) => void }) {
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
          <Avatar name={puzzle.owner_name} size={28} />
          <span>图主 {puzzle.owner_name}</span>
        </div>
      </div>
    </button>
  );
}
