import { randomUUID } from "node:crypto";
import { getStore } from "@edgeone/pages-blob";

export type EdgeState = {
  schema_version: number;
  app_users: Record<string, any>[];
  app_sessions: Record<string, any>[];
  list_items: Record<string, any>[];
  puzzles: Record<string, any>[];
  puzzle_journey: Record<string, any>[];
  puzzle_activity: Record<string, any>[];
  puzzle_tasks: Record<string, any>[];
  puzzle_handoffs: Record<string, any>[];
  puzzle_comments: Record<string, any>[];
  puzzle_likes: Record<string, any>[];
  counters: { puzzle_activity: number };
  metadata?: Record<string, any>;
};

const STATE_KEY = "data/state.json";
const LOCK_PREFIX = "locks/global/";
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 25_000;

function openDataStore() {
  return getStore("puzzle-drift-data");
}

function openImageStore() {
  return getStore("puzzle-drift-images");
}

function emptyState(): EdgeState {
  return {
    schema_version: 1,
    app_users: [],
    app_sessions: [],
    list_items: [],
    puzzles: [],
    puzzle_journey: [],
    puzzle_activity: [],
    puzzle_tasks: [],
    puzzle_handoffs: [],
    puzzle_comments: [],
    puzzle_likes: [],
    counters: { puzzle_activity: 1 },
    metadata: { registration_open: true },
  };
}

function normalizeState(input: any): EdgeState {
  const state = { ...emptyState(), ...(input ?? {}) } as EdgeState;
  for (const key of [
    "app_users",
    "app_sessions",
    "list_items",
    "puzzles",
    "puzzle_journey",
    "puzzle_activity",
    "puzzle_tasks",
    "puzzle_handoffs",
    "puzzle_comments",
    "puzzle_likes",
  ] as const) {
    if (!Array.isArray(state[key])) state[key] = [] as never;
  }
  if (!state.metadata || typeof state.metadata !== "object") {
    state.metadata = {};
  }
  if (typeof state.metadata.registration_open !== "boolean") {
    state.metadata.registration_open = true;
  }

  const maxActivity = state.puzzle_activity.reduce((max, row) => {
    const value = Number(row.id);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  if (!state.counters || !Number.isFinite(Number(state.counters.puzzle_activity))) {
    state.counters = { puzzle_activity: maxActivity + 1 };
  } else {
    state.counters.puzzle_activity = Math.max(Number(state.counters.puzzle_activity), maxActivity + 1);
  }
  return state;
}

async function ensureState(): Promise<EdgeState> {
  const existing = await openDataStore().get(STATE_KEY, { type: "json", consistency: "strong" });
  if (existing) return normalizeState(existing);

  const initial = emptyState();
  try {
    await openDataStore().setJSON(STATE_KEY, initial, { onlyIfNew: true });
  } catch {
    // Another request may have initialized the state concurrently.
  }
  const created = await openDataStore().get(STATE_KEY, { type: "json", consistency: "strong" });
  return normalizeState(created ?? initial);
}

function lockTimestamp(key: string): number {
  const raw = key.slice(LOCK_PREFIX.length).split("-")[0];
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireGlobalLock(): Promise<string> {
  const started = Date.now();
  const key = `${LOCK_PREFIX}${String(started).padStart(13, "0")}-${randomUUID()}`;
  await openDataStore().set(key, "1", { onlyIfNew: true });

  while (Date.now() - started < LOCK_WAIT_MS) {
    let { blobs } = await openDataStore().list({ prefix: LOCK_PREFIX, consistency: "strong" });
    const now = Date.now();
    const stale = blobs.filter((item: { key: string }) => now - lockTimestamp(item.key) > LOCK_STALE_MS);
    if (stale.length) {
      await Promise.all(stale.map((item: { key: string }) => openDataStore().delete(item.key).catch(() => undefined)));
      ({ blobs } = await openDataStore().list({ prefix: LOCK_PREFIX, consistency: "strong" }));
    }

    const ordered = blobs.map((item: { key: string }) => item.key).sort();
    if (ordered[0] === key) return key;
    await sleep(75);
  }

  await openDataStore().delete(key).catch(() => undefined);
  throw new Error("EdgeOne data lock timed out. Please retry.");
}

export async function readState(): Promise<EdgeState> {
  return ensureState();
}

export async function mutateState<T>(fn: (state: EdgeState) => T | Promise<T>): Promise<T> {
  const lockKey = await acquireGlobalLock();
  try {
    const state = await ensureState();
    const result = await fn(state);
    state.schema_version = 1;
    await openDataStore().setJSON(STATE_KEY, state);
    return result;
  } finally {
    await openDataStore().delete(lockKey).catch(() => undefined);
  }
}

export async function createStateBackup(label: string): Promise<string> {
  const state = await readState();

  const safeLabel = label
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .slice(0, 80);

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const key = `backups/${stamp}-${safeLabel || "backup"}.json`;

  await openDataStore().setJSON(key, state);

  return key;
}

export async function isRegistrationOpen(): Promise<boolean> {
  const state = await readState();
  return state.metadata?.registration_open !== false;
}

export async function setRegistrationOpen(open: boolean): Promise<void> {
  await mutateState((state) => {
    state.metadata = {
      ...(state.metadata ?? {}),
      registration_open: open,
    };
  });
}

export async function replaceState(next: EdgeState): Promise<void> {
  await mutateState(async (state) => {
    const normalized = normalizeState(next);
    for (const key of Object.keys(state)) delete (state as any)[key];
    Object.assign(state, normalized);
  });
}

export function getImageStore() {
  return openImageStore();
}

export function publicImageUrl(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `/api/blob/${encoded}`;
}

export function imageKeyFromPublicUrl(value: string): string | null {
  try {
    const parsed = new URL(value, "https://puzzle-drift.invalid");
    const prefix = "/api/blob/";
    if (!parsed.pathname.startsWith(prefix) || parsed.search || parsed.hash) return null;
    return parsed.pathname
      .slice(prefix.length)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  } catch {
    return null;
  }
}

export function nextActivityId(state: EdgeState): number {
  const value = Math.max(1, Number(state.counters.puzzle_activity) || 1);
  state.counters.puzzle_activity = value + 1;
  return value;
}

export function uuid(): string {
  return randomUUID();
}

export function isoNow(): string {
  return new Date().toISOString();
}
