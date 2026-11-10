import assert from "node:assert/strict";
import test from "node:test";
import { applyChurchRepair, CHURCH_REPAIR as C, inspectChurchRepair } from "../lib/repair-church-receive.ts";

function fixture() {
  return {
    schema_version: 1,
    app_users: [{ id: C.ownerId, username: "唐女士" }, { id: C.recipientId, username: "nono", is_admin: true }],
    app_sessions: [{ id: "session-to-preserve" }], list_items: [],
    puzzles: [{ id: C.puzzleId, name: C.puzzleName, owner_id: C.ownerId, current_holder_id: C.ownerId, availability: "active", in_transit: false }, { id: "other", name: "other" }],
    puzzle_journey: [
      { id: "owner-turn", puzzle_id: C.puzzleId, user_id: C.ownerId, status: "current", seq: 0, is_owner_start: true, shipped_on: null, shipping_photo_urls: [] },
      { id: "receiver-turn", puzzle_id: C.puzzleId, user_id: C.recipientId, status: "waiting", seq: 1, is_owner_start: false, received_on: null, received_photo_urls: [], shipped_on: null },
      { id: "next-turn", puzzle_id: C.puzzleId, user_id: "another", status: "waiting", seq: 3 },
    ],
    puzzle_tasks: [
      { id: "old-ship", puzzle_id: C.puzzleId, journey_id: "owner-turn", user_id: C.ownerId, kind: "ship", status: "open" },
      { id: "fee", puzzle_id: C.puzzleId, journey_id: "owner-turn", user_id: C.ownerId, kind: "shipping_fee", status: "open" },
      { id: "payment", puzzle_id: C.puzzleId, journey_id: "receiver-turn", user_id: C.recipientId, kind: "pay_shipping", status: "done", amount_cents: 1200 },
    ],
    puzzle_activity: [{ id: 1 }], puzzle_handoffs: [], puzzle_comments: [{ content: "keep" }], puzzle_likes: [{ user_id: C.recipientId }], shipment_groups: [], counters: { puzzle_activity: 2 }, metadata: { registration_open: false },
  };
}

test("repair restores receive entry without fabricating evidence or changing other records", () => {
  const state = fixture();
  const before = structuredClone(state);
  const plan = inspectChurchRepair(state);
  applyChurchRepair(state, plan.fingerprint, "backups/verified.json", "2026-11-10T15:00:00Z", "new-receive");
  assert.equal(state.puzzles[0].current_holder_id, C.recipientId);
  assert.equal(state.puzzle_journey[0].status, "completed");
  assert.equal(state.puzzle_journey[0].shipped_on, null);
  assert.deepEqual(state.puzzle_journey[0].shipping_photo_urls, []);
  assert.equal(state.puzzle_journey[1].status, "current");
  assert.equal(state.puzzle_journey[1].received_on, null);
  assert.deepEqual(state.puzzle_journey[1].received_photo_urls, []);
  assert.equal(state.puzzle_tasks.at(-1).kind, "receive");
  assert.equal(state.puzzle_tasks.at(-1).status, "open");
  assert.deepEqual(state.puzzle_tasks.slice(1, 3), before.puzzle_tasks.slice(1, 3));
  assert.deepEqual(state.puzzles[1], before.puzzles[1]);
  assert.deepEqual(state.puzzle_journey[2], before.puzzle_journey[2]);
  for (const key of ["app_users", "app_sessions", "list_items", "puzzle_activity", "puzzle_handoffs", "puzzle_comments", "puzzle_likes", "shipment_groups", "counters"]) assert.deepEqual(state[key], before[key]);
  assert.equal(state.metadata.registration_open, false);
});

test("retries cannot duplicate tasks or roll back a subsequently submitted retention", () => {
  const state = fixture();
  const { fingerprint } = inspectChurchRepair(state);
  applyChurchRepair(state, fingerprint, "backups/verified.json", "now", "receive");
  state.puzzle_journey[1].received_on = "2026-11-10";
  state.puzzle_journey[1].received_photo_urls = ["real-photo"];
  const before = structuredClone(state);
  applyChurchRepair(state, fingerprint, "another-backup", "later", "duplicate");
  assert.deepEqual(state, before);
});

test("existing open receive task is reused", () => {
  const state = fixture();
  state.puzzle_tasks.push({ id: "receive-existing", puzzle_id: C.puzzleId, journey_id: "receiver-turn", user_id: C.recipientId, kind: "receive", status: "open" });
  const { fingerprint } = inspectChurchRepair(state);
  const audit = applyChurchRepair(state, fingerprint, "backup", "now", "unused");
  assert.equal(audit.receive_task_id, "receive-existing");
  assert.equal(state.puzzle_tasks.filter((row) => row.kind === "receive").length, 1);
});

for (const [label, change] of [
  ["another current holder", (s) => { s.puzzles[0].current_holder_id = "another"; }],
  ["not first in queue", (s) => { s.puzzle_journey[2].seq = 0.5; }],
  ["existing retention date", (s) => { s.puzzle_journey[1].received_on = "2026-11-08"; }],
  ["existing retention photo", (s) => { s.puzzle_journey[1].received_photo_urls = ["real-photo"]; }],
  ["active merged shipment", (s) => { s.shipment_groups.push({ puzzle_ids: [C.puzzleId], shipping_done: true, fee_done: false }); }],
  ["existing handoff", (s) => { s.puzzle_handoffs.push({ puzzle_id: C.puzzleId }); }],
  ["ambiguous current turns", (s) => { s.puzzle_journey[2].status = "current"; }],
  ["retired puzzle", (s) => { s.puzzles[0].availability = "retired"; }],
  ["completed receive task", (s) => { s.puzzle_tasks.push({ puzzle_id: C.puzzleId, journey_id: "receiver-turn", user_id: C.recipientId, kind: "receive", status: "done" }); }],
]) test(`refuse ${label} without changing data`, () => {
  const state = fixture();
  change(state);
  const before = structuredClone(state);
  assert.throws(() => inspectChurchRepair(state));
  assert.deepEqual(state, before);
});

test("stale preview cannot overwrite a later write", () => {
  const state = fixture();
  const { fingerprint } = inspectChurchRepair(state);
  state.puzzle_tasks[1].status = "done";
  const before = structuredClone(state);
  assert.throws(() => applyChurchRepair(state, fingerprint, "backup", "now", "unused"));
  assert.deepEqual(state, before);
});
