import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createRequire } from "node:module";
import { createLoader } from "./load-ts.mjs";

const { NextRequest } = createRequire(import.meta.url)("next/server");
const token = "test-session-only";
const hash = createHash("sha256").update(token).digest("hex");
const puzzleId = "6ed4c338-668c-4cdc-b42d-ad2f77a5cd25";

function fixture() {
  return {
    schema_version: 1,
    app_users: [{ id: "owner", username: "图主", session_version: 1 }, { id: "me", username: "成员", is_admin: true, session_version: 2, pin_hash: "DO_NOT_EXPOSE_PIN", shipping_address: "DO_NOT_EXPOSE_ADDRESS" }],
    app_sessions: [{ user_id: "me", token_hash: hash, session_version: 2, expires_at: "2099-01-01T00:00:00Z" }],
    puzzles: [{ id: puzzleId, name: "测试拼图", brand: "3djp", description: "", owner_id: "owner", current_holder_id: "me", availability: "active", in_transit: true, created_at: "2026-10-01", updated_at: "2026-11-10" }],
    puzzle_journey: [{ id: "turn", puzzle_id: puzzleId, user_id: "me", status: "current", is_owner_start: false, seq: 1, received_on: null, received_photo_urls: [] }],
    puzzle_tasks: [{ id: "receive", puzzle_id: puzzleId, journey_id: "turn", user_id: "me", kind: "receive", status: "open", created_at: "2026-11-10" }],
    puzzle_activity: [{ id: 1, type: "became_holder", puzzle_id: puzzleId, actor_id: "me", payload: {}, created_at: "2026-11-10" }],
    list_items: [], puzzle_handoffs: [], puzzle_comments: [], puzzle_likes: [{ puzzle_id: puzzleId, user_id: "me" }], shipment_groups: [], counters: { puzzle_activity: 2 }, metadata: {},
  };
}

function harness() {
  let state = fixture();
  let cookie = token;
  let reads = 0;
  let writes = 0;
  const store = {
    readState: async () => { reads++; return structuredClone(state); },
    mutateState: async (fn) => { const draft = structuredClone(state); const result = await fn(draft); state = draft; writes++; return result; },
    uuid: randomUUID, isoNow: () => new Date().toISOString(),
    nextActivityId: (s) => s.counters.puzzle_activity++,
  };
  const load = createLoader({ "@/lib/edgeone-store": store, "next/headers": { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined }) } });
  return { load, store, get state() { return state; }, get reads() { return reads; }, get writes() { return writes; }, setCookie(value) { cookie = value; } };
}

test("snapshot authenticates and builds all tables from exactly one read without exposing secrets", async () => {
  const h = harness();
  const response = await h.load("app/api/snapshot/route.ts").GET(new NextRequest("https://puzzle.test/api/snapshot"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(h.reads, 1);
  assert.equal(h.writes, 0);
  assert.equal(payload.puzzles[0].brand, "3DJP");
  assert.equal(payload.puzzles[0].liked_by_me, true);
  assert.equal(payload.puzzles[0].journey[0].status, "current");
  assert.equal(payload.activities[0].actor_name, "成员");
  assert.equal(JSON.stringify(payload).includes("DO_NOT_EXPOSE"), false);
  assert.equal(JSON.stringify(payload).includes(hash), false);
  assert.match(response.headers.get("server-timing"), /snapshot;dur=/);
});

test("unchanged polling sends 304, but changed data or a revoked session cannot reuse it", async () => {
  const h = harness();
  const route = h.load("app/api/snapshot/route.ts");
  const first = await route.GET(new NextRequest("https://puzzle.test/api/snapshot"));
  const etag = first.headers.get("etag");
  const request = () => new NextRequest("https://puzzle.test/api/snapshot", { headers: { "if-none-match": etag } });
  const same = await route.GET(request());
  assert.equal(same.status, 304);
  assert.equal(await same.text(), "");
  h.state.puzzle_journey[0].received_on = "2026-11-10";
  assert.equal((await route.GET(request())).status, 200);
  h.state.app_users[1].session_version++;
  assert.equal((await route.GET(request())).status, 401);
});

test("tasks use one read and are never served as an HTTP stale task list", async () => {
  const h = harness();
  const response = await h.load("app/api/tasks/route.ts").GET();
  assert.equal(h.reads, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.tasks[0].kind, "receive");
  assert.equal(body.tasks[0].puzzle_name, "测试拼图");
});

for (const route of ["history", "comments", "likes"]) test(`${route} authenticates and reads from one snapshot`, async () => {
  const h = harness();
  const response = await h.load(`app/api/puzzles/[id]/${route}/route.ts`).GET(new NextRequest(`https://puzzle.test/api/puzzles/${puzzleId}/${route}`), { params: Promise.resolve({ id: puzzleId }) });
  assert.equal(response.status, 200);
  assert.equal(h.reads, 1);
  assert.equal(h.writes, 0);
});

test("expired and malformed sessions are rejected without a global write", async () => {
  for (const expiry of ["2020-01-01", "invalid"]) {
    const h = harness();
    h.state.app_sessions[0].expires_at = expiry;
    assert.equal(await h.load("lib/session.ts").getCurrentUser(), null);
    assert.equal(h.reads, 1);
    assert.equal(h.writes, 0);
  }
  const h = harness();
  h.setCookie(null);
  assert.equal(await h.load("lib/session.ts").getCurrentUser(), null);
  assert.equal(h.reads, 0);
});

test("a snapshot-bound query cannot overwrite a concurrent change on write", async () => {
  const h = harness();
  const db = h.load("lib/supabase-admin.ts").getSupabaseAdmin(structuredClone(h.state));
  h.state.list_items.push({ id: "concurrent", title: "preserve" });
  const result = await db.from("list_items").insert({ title: "new" });
  assert.equal(result.error, null);
  assert.equal(h.state.list_items.length, 2);
  assert.equal(h.state.list_items[0].id, "concurrent");
});

test("receiving retries after a lost response create only one record/activity and cannot replace photos", async () => {
  const h = harness();
  const db = h.load("lib/supabase-admin.ts").getSupabaseAdmin();
  const args = { p_puzzle_id: puzzleId, p_user_id: "me", p_date: "2026-11-10", p_urls: ["/api/blob/received/me/photo.jpg"], p_note: "真实备注" };
  assert.equal((await db.rpc("v03_receive", args)).error, null);
  const saved = structuredClone(h.state);
  assert.equal((await db.rpc("v03_receive", args)).error, null);
  assert.deepEqual(h.state, saved);
  assert.ok((await db.rpc("v03_receive", { ...args, p_urls: ["different-photo"] })).error);
  assert.deepEqual(h.state, saved);
});

test("Store instances reuse SDK credentials but never cache application snapshots", async () => {
  let constructions = 0;
  let reads = 0;
  let current = fixture();
  const fake = { get: async () => { reads++; return structuredClone(current); } };
  const load = createLoader({ "@edgeone/pages-blob": { getStore: () => { constructions++; return fake; } } });
  const store = load("lib/edgeone-store.ts");
  const first = await store.readState();
  current.puzzles[0].name = "updated";
  const second = await store.readState();
  assert.equal(first.puzzles[0].name, "测试拼图");
  assert.equal(second.puzzles[0].name, "updated");
  assert.equal(reads, 2);
  assert.equal(constructions, 1);
  store.getImageStore(); store.getImageStore();
  assert.equal(constructions, 2);
});

test("usage scan counts large images through HEAD only, not object downloads", async () => {
  const { scanStoreUsage } = createLoader()("lib/storage-usage.ts");
  let heads = 0;
  const usage = await scanStoreUsage({
    list: async () => ({ blobs: [{ key: "large" }, { key: "deleted" }] }),
    getMetadata: async (key) => { heads++; return key === "deleted" ? null : { headers: { "content-length": "90000000" } }; },
    get: () => { throw new Error("must not download"); },
  });
  assert.equal(usage.bytes, 90_000_000);
  assert.equal(heads, 2);
  await assert.rejects(scanStoreUsage({ list: async () => ({ blobs: [{ key: "large" }] }), getMetadata: async () => ({ headers: {} }) }));
});

test("usage refresh never rewrites or locks state.json", async () => {
  const writes = [];
  const fake = {
    list: async () => ({ blobs: [{ key: "object" }] }),
    getMetadata: async () => ({ headers: { "content-length": "123" } }),
    setJSON: async (...args) => { writes.push(args); },
  };
  const load = createLoader({
    "@/lib/session": { getReadyContext: async () => ({ user: { is_admin: true }, state: fixture() }) },
    "@/lib/edgeone-store": { getDataStore: () => fake, getImageStore: () => fake, mutateState: () => { throw new Error("must not lock app data"); } },
  });
  const response = await load("app/api/admin/storage/route.ts").GET(new NextRequest("https://puzzle.test/api/admin/storage?refresh=1"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total_bytes, 246);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "metadata/storage-usage.json");
});

test("upload recovery is scoped to the authenticated user's own namespace", async () => {
  let path;
  const load = createLoader({
    "@/lib/session": { getCurrentUser: async () => ({ id: "me" }) },
    "@/lib/edgeone-store": {
      getImageStore: () => ({ getMetadata: async (key) => { path = key; return { headers: {} }; } }),
      publicImageUrl: (key) => `/api/blob/${key}`,
    },
    "@/lib/supabase-admin": {},
  });
  const route = load("app/api/upload/route.ts");
  const response = await route.GET(new NextRequest("https://puzzle.test/api/upload?upload_id=123456789abc&kind=received&type=image%2Fjpeg&user_id=someone-else"));
  assert.equal(response.status, 200);
  assert.equal(path, "received/me/123456789abc.jpg");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await route.GET(new NextRequest("https://puzzle.test/api/upload?upload_id=..%2Fsecret&kind=received&type=image%2Fjpeg"))).status, 400);
});
