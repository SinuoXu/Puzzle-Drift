import { getImageStore, isoNow, mutateState, nextActivityId, publicImageUrl, readState, uuid, type EdgeState } from "@/lib/edgeone-store";

type DbError = { message: string; code?: string };
type DbResult<T = any> = { data: T; error: DbError | null };
type TableName = keyof Pick<
  EdgeState,
  | "app_users"
  | "app_sessions"
  | "list_items"
  | "puzzles"
  | "puzzle_journey"
  | "puzzle_activity"
  | "puzzle_tasks"
  | "puzzle_handoffs"
>;

type Filter = { kind: "eq"; column: string; value: any } | { kind: "in"; column: string; values: any[] };

type QueryMode = "select" | "insert" | "update" | "delete";

function err(message: string, code?: string): DbError {
  return { message, ...(code ? { code } : {}) };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function getRows(state: EdgeState, table: TableName): Record<string, any>[] {
  return state[table] as Record<string, any>[];
}

function matches(row: Record<string, any>, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.kind === "eq") return row[filter.column] === filter.value;
    return filter.values.includes(row[filter.column]);
  });
}

function project(row: Record<string, any>, fields: string | null): Record<string, any> {
  if (!fields || fields.trim() === "*") return clone(row);
  const names = fields.split(",").map((part) => part.trim()).filter(Boolean);
  const out: Record<string, any> = {};
  for (const name of names) out[name] = row[name];
  return out;
}

function addActivity(state: EdgeState, type: string, puzzleId: string, actorId: string | null, payload: Record<string, any> = {}) {
  state.puzzle_activity.push({
    id: nextActivityId(state),
    type,
    puzzle_id: puzzleId,
    actor_id: actorId,
    payload,
    created_at: isoNow(),
  });
}

function applyDefaults(table: TableName, input: Record<string, any>, state: EdgeState): Record<string, any> {
  const now = isoNow();
  if (table === "app_users") {
    return {
      id: uuid(),
      username: "",
      username_normalized: "",
      avatar_url: null,
      is_admin: false,
      created_at: now,
      pin_hash: null,
      pin_failed_count: 0,
      pin_locked_until: null,
      session_version: 1,
      shipping_address: null,
      payment_qr_url: null,
      profile_required: false,
      ...clone(input),
    };
  }
  if (table === "app_sessions") {
    return {
      id: uuid(),
      created_at: now,
      session_version: 1,
      ...clone(input),
    };
  }
  if (table === "list_items") {
    return { id: uuid(), created_at: now, ...clone(input) };
  }
  if (table === "puzzles") {
    return {
      id: uuid(),
      brand: "",
      description: "",
      piece_count: null,
      has_box: false,
      has_sheet: false,
      availability: "active",
      in_transit: false,
      created_at: now,
      updated_at: now,
      ...clone(input),
    };
  }
  if (table === "puzzle_journey") {
    return {
      id: uuid(),
      status: "waiting",
      is_owner_start: false,
      joined_at: now,
      received_on: null,
      received_photo_url: null,
      received_photo_urls: [],
      receiving_note: "",
      shipped_on: null,
      shipping_photo_url: null,
      shipping_photo_urls: [],
      shipping_note: "",
      ...clone(input),
    };
  }
  if (table === "puzzle_activity") {
    return { id: nextActivityId(state), payload: {}, created_at: now, ...clone(input) };
  }
  if (table === "puzzle_tasks") {
    return {
      id: uuid(),
      payee_id: null,
      status: "open",
      amount_cents: null,
      tracking_number: null,
      receipt_url: null,
      created_at: now,
      completed_at: null,
      ...clone(input),
    };
  }
  return { id: uuid(), created_at: now, return_home: false, ...clone(input) };
}

function addTaskIfMissing(state: EdgeState, row: Record<string, any>) {
  if (row.kind !== "pay_return") {
    const duplicate = state.puzzle_tasks.some(
      (task) => task.journey_id === row.journey_id && task.kind === row.kind && task.user_id === row.user_id && task.status !== "cancelled",
    );
    if (duplicate) return;
  }
  state.puzzle_tasks.push(applyDefaults("puzzle_tasks", row, state));
}

function sortedWaiting(state: EdgeState, puzzleId: string, afterSeq = -1) {
  return state.puzzle_journey
    .filter((row) => row.puzzle_id === puzzleId && row.status === "waiting" && Number(row.seq) > afterSeq)
    .sort((a, b) => Number(a.seq) - Number(b.seq));
}

function currentTurn(state: EdgeState, puzzleId: string, userId?: string) {
  return state.puzzle_journey.find(
    (row) => row.puzzle_id === puzzleId && row.status === "current" && (!userId || row.user_id === userId),
  );
}

function puzzleById(state: EdgeState, id: string) {
  return state.puzzles.find((row) => row.id === id);
}

function setPuzzleAvailability(state: EdgeState, puzzle: Record<string, any>, value: string, suppressActivity = false) {
  const old = puzzle.availability;
  puzzle.availability = value;
  puzzle.updated_at = isoNow();
  if (!suppressActivity && old !== value) {
    addActivity(state, "availability_changed", puzzle.id, puzzle.owner_id, { availability: value });
  }
}

function markShippedInternal(
  state: EdgeState,
  puzzleId: string,
  userId: string,
  date: string,
  urls: string[],
  note: string,
  returnHome: boolean,
): string {
  const puzzle = puzzleById(state, puzzleId);
  if (!puzzle) throw new Error("Puzzle not found");
  const turn = currentTurn(state, puzzleId, userId);
  if (!turn) throw new Error("You are not the current holder");
  if (turn.shipped_on) throw new Error("Shipping record already exists");
  if (!turn.is_owner_start && !turn.received_on) throw new Error("Please add the receiving record before shipping");
  if (!turn.is_owner_start && (!Array.isArray(urls) || urls.length < 1 || urls.length > 12)) throw new Error("Invalid photos");
  const feeDone = state.puzzle_tasks.some(
    (task) => task.journey_id === turn.id && task.kind === "shipping_fee" && task.status === "done",
  );
  if (!feeDone) throw new Error("Fee first");

  const next = sortedWaiting(state, puzzleId, Number(turn.seq))[0];
  if (returnHome) {
    if (turn.is_owner_start || next) throw new Error("Return unavailable");
  } else if (!next) {
    throw new Error("Nobody is waiting next");
  }

  turn.shipped_on = date;
  turn.shipping_photo_url = urls[0] ?? null;
  turn.shipping_photo_urls = urls;
  turn.shipping_note = (note ?? "").slice(0, 1000);
  turn.status = "completed";
  addActivity(state, "shipped", puzzleId, userId, { shipped_on: date });

  if (returnHome) {
    setPuzzleAvailability(state, puzzle, "retired");
    puzzle.in_transit = true;
    puzzle.current_holder_id = puzzle.owner_id;
  } else {
    next.status = "current";
    puzzle.current_holder_id = next.user_id;
    puzzle.in_transit = true;
    puzzle.updated_at = isoNow();
    addActivity(state, "became_holder", puzzleId, next.user_id, { seq: next.seq });
    addTaskIfMissing(state, { puzzle_id: puzzleId, journey_id: next.id, user_id: next.user_id, kind: "receive" });
  }

  for (const task of state.puzzle_tasks) {
    if (task.journey_id === turn.id && task.kind === "ship" && task.status === "open") {
      task.status = "done";
      task.completed_at = isoNow();
    }
  }

  return returnHome ? puzzle.owner_id : next.user_id;
}

async function runRpc(name: string, args: Record<string, any>): Promise<DbResult> {
  try {
    const data = await mutateState((state) => {
      switch (name) {
        case "create_puzzle_with_owner": {
          const owner = state.app_users.find((row) => row.id === args.p_owner_id);
          if (!owner) throw new Error("Owner not found");
          const puzzle = applyDefaults("puzzles", {
            name: String(args.p_name ?? "").trim(),
            brand: String(args.p_brand ?? "").trim(),
            cover_url: args.p_cover_url,
            description: String(args.p_description ?? "").trim(),
            piece_count: Number(args.p_piece_count) || null,
            has_box: args.p_has_box === true,
            has_sheet: args.p_has_sheet === true,
            owner_id: args.p_owner_id,
            current_holder_id: args.p_owner_id,
          }, state);
          state.puzzles.push(puzzle);
          state.puzzle_journey.push(applyDefaults("puzzle_journey", {
            puzzle_id: puzzle.id,
            user_id: args.p_owner_id,
            seq: 0,
            status: "current",
            is_owner_start: true,
          }, state));
          addActivity(state, "puzzle_created", puzzle.id, args.p_owner_id, { name: puzzle.name, brand: puzzle.brand });
          return puzzle.id;
        }
        case "v03_pin_failed": {
          const user = state.app_users.find((row) => row.id === args.p_user_id);
          if (!user) return null;
          const count = Number(user.pin_failed_count ?? 0) + 1;
          if (count >= 5) {
            user.pin_failed_count = 0;
            user.pin_locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          } else {
            user.pin_failed_count = count;
          }
          return null;
        }
        case "v03_pin_succeeded": {
          const user = state.app_users.find((row) => row.id === args.p_user_id);
          if (user) {
            user.pin_failed_count = 0;
            user.pin_locked_until = null;
          }
          return null;
        }
        case "v03_claim_pin": {
          const user = state.app_users.find((row) => row.id === args.p_user_id && !row.pin_hash);
          if (!user) return false;
          user.pin_hash = args.p_hash;
          user.pin_failed_count = 0;
          user.pin_locked_until = null;
          user.session_version = Number(user.session_version ?? 1) + 1;
          return true;
        }
        case "v03_reset_pin": {
          const user = state.app_users.find((row) => row.id === args.p_user_id);
          if (!user) return false;
          user.pin_hash = args.p_hash;
          user.pin_failed_count = 0;
          user.pin_locked_until = null;
          user.session_version = Number(user.session_version ?? 1) + 1;
          return true;
        }
        case "v03_join_queue": {
          const puzzle = puzzleById(state, args.p_puzzle_id);
          if (!puzzle) throw new Error("Puzzle not found");
          if (puzzle.availability !== "active") throw new Error("This puzzle is not open for queueing");
          if (puzzle.owner_id === args.p_user_id) throw new Error("The owner cannot queue for their own puzzle");
          if (state.puzzle_journey.some((row) => row.puzzle_id === puzzle.id && row.user_id === args.p_user_id && ["waiting", "current"].includes(row.status))) {
            throw new Error("You are already in this queue");
          }
          const seq = Math.max(0, ...state.puzzle_journey.filter((row) => row.puzzle_id === puzzle.id).map((row) => Number(row.seq) || 0)) + 1;
          const journey = applyDefaults("puzzle_journey", {
            puzzle_id: puzzle.id,
            user_id: args.p_user_id,
            seq,
            status: "waiting",
            is_owner_start: false,
          }, state);
          state.puzzle_journey.push(journey);
          addActivity(state, "queue_joined", puzzle.id, args.p_user_id, { seq });
          const holder = currentTurn(state, puzzle.id);
          if (holder && (holder.is_owner_start || holder.received_on)) {
            addTaskIfMissing(state, { puzzle_id: puzzle.id, journey_id: holder.id, user_id: holder.user_id, kind: "shipping_fee" });
            if (!holder.is_owner_start) addTaskIfMissing(state, { puzzle_id: puzzle.id, journey_id: holder.id, user_id: holder.user_id, kind: "ship" });
          }
          return journey.id;
        }
        case "v03_cancel_queue": {
          const turn = state.puzzle_journey.find((row) => row.puzzle_id === args.p_puzzle_id && row.user_id === args.p_user_id && row.status === "waiting");
          if (!turn) return false;
          if (state.puzzle_tasks.some((task) => task.journey_id === turn.id && task.kind === "pay_shipping")) {
            throw new Error("Shipping fee has already been assigned");
          }
          turn.status = "cancelled";
          if (!state.puzzle_journey.some((row) => row.puzzle_id === args.p_puzzle_id && row.status === "waiting")) {
            const ownerTurn = currentTurn(state, args.p_puzzle_id);
            if (ownerTurn?.is_owner_start) {
              for (const task of state.puzzle_tasks) {
                if (task.puzzle_id === args.p_puzzle_id && task.journey_id === ownerTurn.id && ["ship", "shipping_fee"].includes(task.kind) && task.status === "open") {
                  task.status = "cancelled";
                }
              }
            }
          }
          return true;
        }
        case "v03_move_queue": {
          const direction = Number(args.p_direction);
          if (direction !== -1 && direction !== 1) throw new Error("Invalid direction");
          const mine = state.puzzle_journey.find((row) => row.puzzle_id === args.p_puzzle_id && row.user_id === args.p_user_id && row.status === "waiting");
          if (!mine) throw new Error("Not waiting");
          const candidates = state.puzzle_journey.filter((row) => row.puzzle_id === args.p_puzzle_id && row.status === "waiting" && (direction < 0 ? row.seq < mine.seq : row.seq > mine.seq));
          candidates.sort((a, b) => direction < 0 ? b.seq - a.seq : a.seq - b.seq);
          const other = candidates[0];
          if (!other) return false;
          if (state.puzzle_tasks.some((task) => [mine.id, other.id].includes(task.journey_id) && task.kind === "pay_shipping")) {
            throw new Error("A shipment is already assigned");
          }
          const from = mine.seq;
          const to = other.seq;
          mine.seq = to;
          other.seq = from;
          addActivity(state, "queue_moved", args.p_puzzle_id, args.p_user_id, { from, to });
          return true;
        }
        case "v03_receive": {
          const urls = Array.isArray(args.p_urls) ? args.p_urls : [];
          if (urls.length < 1 || urls.length > 12) throw new Error("Invalid photos");
          const turn = currentTurn(state, args.p_puzzle_id, args.p_user_id);
          if (!turn) throw new Error("You are not the current holder");
          if (turn.is_owner_start) throw new Error("The initial owner turn does not need a receiving record");
          if (turn.received_on) throw new Error("Receiving record already exists");
          const puzzle = puzzleById(state, args.p_puzzle_id);
          if (!puzzle) throw new Error("Puzzle not found");
          turn.received_on = args.p_date;
          turn.received_photo_url = urls[0];
          turn.received_photo_urls = urls;
          turn.receiving_note = String(args.p_note ?? "").slice(0, 1000);
          puzzle.in_transit = false;
          puzzle.updated_at = isoNow();
          addActivity(state, "received", puzzle.id, args.p_user_id, { received_on: args.p_date });
          for (const task of state.puzzle_tasks) {
            if (task.journey_id === turn.id && task.kind === "receive" && task.status === "open") {
              task.status = "done";
              task.completed_at = isoNow();
            }
          }
          addTaskIfMissing(state, { puzzle_id: puzzle.id, journey_id: turn.id, user_id: args.p_user_id, kind: "shipping_fee" });
          addTaskIfMissing(state, { puzzle_id: puzzle.id, journey_id: turn.id, user_id: args.p_user_id, kind: "ship" });
          return true;
        }
        case "v03_ship": {
          return markShippedInternal(
            state,
            args.p_puzzle_id,
            args.p_user_id,
            args.p_date,
            Array.isArray(args.p_urls) ? args.p_urls : [],
            String(args.p_note ?? ""),
            args.p_return === true,
          );
        }
        case "v03_fee": {
          const amount = Number(args.p_amount_cents);
          if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10_000_000) throw new Error("Invalid amount");
          const turn = currentTurn(state, args.p_puzzle_id, args.p_user_id);
          if (!turn) throw new Error("Not holder");
          const next = sortedWaiting(state, args.p_puzzle_id, Number(turn.seq))[0];
          const returnHome = args.p_return === true;
          if (returnHome) {
            if (turn.is_owner_start || next) throw new Error("Return unavailable");
          } else if (!next) {
            throw new Error("No next holder");
          }
          const feeTask = state.puzzle_tasks.find((task) => task.journey_id === turn.id && task.kind === "shipping_fee" && task.status === "open");
          if (!feeTask) throw new Error("Fee already submitted");
          feeTask.status = "done";
          feeTask.amount_cents = amount;
          feeTask.tracking_number = String(args.p_tracking ?? "").slice(0, 120);
          feeTask.receipt_url = args.p_receipt ?? null;
          feeTask.completed_at = isoNow();

          if (returnHome) {
            const participantIds = [...new Set(state.puzzle_journey.filter((row) => row.puzzle_id === args.p_puzzle_id && !row.is_owner_start && row.status !== "cancelled").map((row) => row.user_id))].sort();
            if (!participantIds.length) throw new Error("No participants");
            const base = Math.floor(amount / participantIds.length);
            const extra = amount % participantIds.length;
            participantIds.forEach((participantId, index) => {
              if (participantId === args.p_user_id) return;
              state.puzzle_tasks.push(applyDefaults("puzzle_tasks", {
                puzzle_id: args.p_puzzle_id,
                journey_id: turn.id,
                user_id: participantId,
                payee_id: args.p_user_id,
                kind: "pay_return",
                amount_cents: base + (index < extra ? 1 : 0),
              }, state));
            });
          } else {
            addTaskIfMissing(state, {
              puzzle_id: args.p_puzzle_id,
              journey_id: next.id,
              user_id: next.user_id,
              payee_id: args.p_user_id,
              kind: "pay_shipping",
              amount_cents: amount,
            });
            if (turn.is_owner_start) {
              markShippedInternal(state, args.p_puzzle_id, args.p_user_id, new Date().toISOString().slice(0, 10), [], "", false);
            }
          }
          return true;
        }
        case "v03_mark_paid": {
          const task = state.puzzle_tasks.find((row) => row.id === args.p_task_id && row.user_id === args.p_user_id && ["pay_shipping", "pay_return"].includes(row.kind) && row.status === "open");
          if (!task) return false;
          task.status = "done";
          task.completed_at = isoNow();
          return true;
        }
        case "v03_prepare_return": {
          const puzzle = puzzleById(state, args.p_puzzle_id);
          if (!puzzle || puzzle.availability === "retired") throw new Error("Return unavailable");
          const turn = currentTurn(state, args.p_puzzle_id, args.p_user_id);
          if (!turn || turn.is_owner_start || !turn.received_on || sortedWaiting(state, args.p_puzzle_id).length) throw new Error("Return unavailable");
          addTaskIfMissing(state, { puzzle_id: args.p_puzzle_id, journey_id: turn.id, user_id: args.p_user_id, kind: "shipping_fee" });
          addTaskIfMissing(state, { puzzle_id: args.p_puzzle_id, journey_id: turn.id, user_id: args.p_user_id, kind: "ship" });
          return true;
        }
        case "v03_handoff": {
          const puzzle = puzzleById(state, args.p_puzzle_id);
          if (!puzzle || puzzle.availability === "retired") throw new Error("Handoff unavailable");
          const turn = currentTurn(state, args.p_puzzle_id, args.p_user_id);
          if (!turn || turn.shipped_on || (!turn.is_owner_start && !turn.received_on)) throw new Error("Handoff unavailable");
          const next = sortedWaiting(state, args.p_puzzle_id, Number(turn.seq))[0];
          const returnHome = args.p_return === true;
          if (returnHome) {
            if (turn.is_owner_start || next) throw new Error("Return unavailable");
          } else if (!next) {
            throw new Error("No next holder");
          }
          if (state.puzzle_tasks.some((task) => task.journey_id === turn.id && task.kind === "shipping_fee" && task.status === "done") ||
              (next && state.puzzle_tasks.some((task) => task.journey_id === next.id && task.kind === "pay_shipping"))) {
            throw new Error("Shipping fee already assigned");
          }
          const target = returnHome ? puzzle.owner_id : next.user_id;
          turn.shipped_on = new Date().toISOString().slice(0, 10);
          turn.status = "completed";
          if (!returnHome) {
            next.status = "current";
            next.received_on = new Date().toISOString().slice(0, 10);
            addTaskIfMissing(state, { puzzle_id: puzzle.id, journey_id: next.id, user_id: next.user_id, kind: "shipping_fee" });
            addTaskIfMissing(state, { puzzle_id: puzzle.id, journey_id: next.id, user_id: next.user_id, kind: "ship" });
          }
          puzzle.current_holder_id = target;
          puzzle.in_transit = false;
          puzzle.updated_at = isoNow();
          if (returnHome) puzzle.availability = "retired";
          for (const task of state.puzzle_tasks) {
            const currentMatch = task.journey_id === turn.id;
            const nextReceive = next && task.journey_id === next.id && task.kind === "receive";
            if (task.puzzle_id === puzzle.id && task.status === "open" && (currentMatch || nextReceive) && ["receive", "ship", "shipping_fee"].includes(task.kind)) {
              task.status = "cancelled";
            }
          }
          state.puzzle_handoffs.push(applyDefaults("puzzle_handoffs", {
            puzzle_id: puzzle.id,
            from_user_id: args.p_user_id,
            to_user_id: target,
            return_home: returnHome,
          }, state));
          return target;
        }
        case "v03_admin_force_retire": {
          const actor = state.app_users.find((row) => row.id === args.p_admin_id);
          const puzzle = puzzleById(state, args.p_puzzle_id);
          if (!puzzle) throw new Error("Puzzle not found");
          if (!actor || (!actor.is_admin && puzzle.owner_id !== actor.id)) {
            throw new Error("Owner or admin required");
          }
          const previous = puzzle.availability;
          for (const task of state.puzzle_tasks) {
            if (task.puzzle_id === puzzle.id && task.status === "open") {
              task.status = "cancelled";
              task.completed_at = isoNow();
            }
          }
          for (const journey of state.puzzle_journey) {
            if (journey.puzzle_id === puzzle.id && journey.status === "waiting") journey.status = "cancelled";
          }
          setPuzzleAvailability(state, puzzle, "retired");
          puzzle.in_transit = false;
          addActivity(state, "admin_forced_end", puzzle.id, args.p_admin_id, { previous_availability: previous });
          return true;
        }
        case "v03_admin_delete_puzzle": {
          const actor = state.app_users.find((row) => row.id === args.p_admin_id);
          const puzzle = puzzleById(state, args.p_puzzle_id);
          if (!puzzle) throw new Error("Puzzle not found");
          if (!actor || (!actor.is_admin && puzzle.owner_id !== actor.id)) {
            throw new Error("Owner or admin required");
          }
          state.puzzle_tasks = state.puzzle_tasks.filter((row) => row.puzzle_id !== args.p_puzzle_id);
          state.puzzle_handoffs = state.puzzle_handoffs.filter((row) => row.puzzle_id !== args.p_puzzle_id);
          state.puzzle_journey = state.puzzle_journey.filter((row) => row.puzzle_id !== args.p_puzzle_id);
          state.puzzle_activity = state.puzzle_activity.filter((row) => row.puzzle_id !== args.p_puzzle_id);
          state.puzzle_comments = state.puzzle_comments.filter((row) => row.puzzle_id !== args.p_puzzle_id);
          state.puzzle_likes = state.puzzle_likes.filter((row) => row.puzzle_id !== args.p_puzzle_id);
          state.puzzles = state.puzzles.filter((row) => row.id !== args.p_puzzle_id);
          return true;
        }
        case "v03_admin_delete_activity": {
          const admin = state.app_users.find((row) => row.id === args.p_admin_id && row.is_admin);
          if (!admin) throw new Error("Admin required");
          const before = state.puzzle_activity.length;
          state.puzzle_activity = state.puzzle_activity.filter((row) => Number(row.id) !== Number(args.p_activity_id));
          return state.puzzle_activity.length < before;
        }
        default:
          throw new Error(`Unsupported RPC: ${name}`);
      }
    });
    return { data, error: null };
  } catch (error) {
    return { data: null, error: err(error instanceof Error ? error.message : "Database operation failed") };
  }
}

class QueryBuilder implements PromiseLike<DbResult> {
  private mode: QueryMode = "select";
  private filters: Filter[] = [];
  private fields: string | null = null;
  private selectCalled = false;
  private payload: any = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private maxRows: number | null = null;

  constructor(private table: TableName) {}

  select(fields = "*") {
    this.fields = fields;
    this.selectCalled = true;
    return this;
  }
  eq(column: string, value: any) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  in(column: string, values: any[]) {
    this.filters.push({ kind: "in", column, values });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }
  limit(value: number) {
    this.maxRows = value;
    return this;
  }
  insert(payload: any) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: any) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }

  async single(): Promise<DbResult> {
    return this.execute("single");
  }
  async maybeSingle(): Promise<DbResult> {
    return this.execute("maybeSingle");
  }

  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute("many").then(onfulfilled, onrejected);
  }

  private async execute(shape: "many" | "single" | "maybeSingle"): Promise<DbResult> {
    try {
      let rows: Record<string, any>[] = [];
      if (this.mode === "select") {
        const state = await readState();
        rows = getRows(state, this.table).filter((row) => matches(row, this.filters)).map(clone);
      } else {
        rows = await mutateState((state) => {
          const tableRows = getRows(state, this.table);
          if (this.mode === "insert") {
            const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
            const inserted: Record<string, any>[] = [];
            for (const value of incoming) {
              const row = applyDefaults(this.table, value, state);
              if (this.table === "app_users" && tableRows.some((item) => item.username_normalized === row.username_normalized)) {
                throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
              }
              tableRows.push(row);
              inserted.push(clone(row));
            }
            return inserted;
          }
          if (this.mode === "update") {
            const updated: Record<string, any>[] = [];
            for (const row of tableRows) {
              if (!matches(row, this.filters)) continue;
              const beforeAvailability = this.table === "puzzles" ? row.availability : undefined;
              Object.assign(row, clone(this.payload));
              if (this.table === "puzzles") {
                row.updated_at = isoNow();
                if (beforeAvailability !== row.availability) {
                  addActivity(state, "availability_changed", row.id, row.owner_id, { availability: row.availability });
                }
              }
              updated.push(clone(row));
            }
            return updated;
          }
          const deleted = tableRows.filter((row) => matches(row, this.filters));
          (state as any)[this.table] = tableRows.filter((row) => !matches(row, this.filters));
          return deleted.map(clone);
        });
      }

      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        rows.sort((a, b) => {
          const av = a[column];
          const bv = b[column];
          if (av === bv) return 0;
          if (av == null) return ascending ? -1 : 1;
          if (bv == null) return ascending ? 1 : -1;
          return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
        });
      }
      if (this.maxRows != null) rows = rows.slice(0, this.maxRows);
      const projected = rows.map((row) => project(row, this.fields));

      if (shape === "single") {
        if (projected.length !== 1) return { data: null, error: err(`Expected one row, got ${projected.length}`) };
        return { data: projected[0], error: null };
      }
      if (shape === "maybeSingle") {
        if (projected.length > 1) return { data: null, error: err(`Expected zero or one row, got ${projected.length}`) };
        return { data: projected[0] ?? null, error: null };
      }
      if (this.mode !== "select" && !this.selectCalled) return { data: null, error: null };
      return { data: projected, error: null };
    } catch (error: any) {
      return { data: null, error: err(error?.message ?? "Database operation failed", error?.code) };
    }
  }
}

class StorageBucket {
  upload(path: string, value: any, _options?: any): Promise<{ error: DbError | null }> {
    return (async () => {
      try {
        let payload = value;
        if (ArrayBuffer.isView(value)) {
          payload = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        }
        await getImageStore().set(path, payload);
        return { error: null };
      } catch (error) {
        return { error: err(error instanceof Error ? error.message : "Image upload failed") };
      }
    })();
  }

  getPublicUrl(path: string) {
    return { data: { publicUrl: publicImageUrl(path) } };
  }
}

class EdgeOneCompatClient {
  from(table: string) {
    return new QueryBuilder(table as TableName);
  }
  rpc(name: string, args: Record<string, any>) {
    return runRpc(name, args);
  }
  storage = {
    from: (_bucket: string) => new StorageBucket(),
  };
}

const client = new EdgeOneCompatClient();

// Kept under the old function name so the existing API routes do not need to be
// rewritten all at once. This client no longer connects to Supabase.
export function getSupabaseAdmin(): any {
  return client;
}
