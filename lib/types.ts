export type User = {
  id: string;
  username: string;
  avatar_url: string | null;
  is_admin: boolean;
};

export type JourneyEntry = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  seq: number;
  status: "waiting" | "current" | "completed" | "cancelled";
  is_owner_start: boolean;
  joined_at: string;
  received_on: string | null;
  shipped_on: string | null;
};

export type Puzzle = {
  id: string;
  name: string;
  brand: string;
  description: string;
  cover_url: string;
  owner_id: string;
  owner_name: string;
  owner_avatar_url: string | null;
  current_holder_id: string;
  current_holder_name: string;
  availability: "active" | "paused" | "retired";
  created_at: string;
  updated_at: string;
  drift_state: "idle" | "drifting" | "retired";
  in_transit: boolean;
  waiting_count: number;
  journey: JourneyEntry[];
};

export type Activity = {
  id: number;
  type: string;
  puzzle_id: string;
  puzzle_name: string;
  actor_id: string | null;
  actor_name: string;
  actor_avatar_url: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type Snapshot = {
  user: User;
  puzzles: Puzzle[];
  activities: Activity[];
};
