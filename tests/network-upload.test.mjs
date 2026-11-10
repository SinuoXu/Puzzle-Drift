import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as immediate } from "node:timers/promises";
import { createRetryingFetch, requestPolicy } from "../lib/network-fetch.ts";
import { createImageUploader } from "../lib/client-image.ts";

const origin = "https://puzzle.test";
const noWait = async () => {};

test("upload retries preserve the same object ID and leave the response JSON readable", async () => {
  const ids = [];
  const wrapped = createRetryingFetch(async (_input, init) => {
    ids.push(new Headers(init.headers).get("X-PD-Upload-ID"));
    if (ids.length === 1) throw new Error("lost response");
    return Response.json({ url: "/api/blob/received/me/same.jpg" });
  }, origin, noWait);
  const response = await wrapped("/api/upload", { method: "POST", body: new FormData() });
  assert.equal((await response.json()).url, "/api/blob/received/me/same.jpg");
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test("upload waits past the old 12-second cutoff and stops after three actual attempts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let aborts = 0;
  const wrapped = createRetryingFetch(async (_input, init) => new Promise((_resolve, reject) => {
    calls++;
    init.signal.addEventListener("abort", () => { aborts++; reject(new Error("timeout")); }, { once: true });
  }), origin, noWait);
  const pending = wrapped("/api/upload", { method: "POST" });
  const rejected = assert.rejects(pending, /已尝试 3 次/);
  t.mock.timers.tick(12_001);
  await immediate();
  assert.equal(aborts, 0);
  t.mock.timers.tick(77_999);
  await immediate();
  assert.equal(aborts, 1);
  t.mock.timers.tick(90_000); await immediate();
  t.mock.timers.tick(90_000); await rejected;
  assert.equal(calls, 3);
});

test("a lost successful upload is recovered with a small GET instead of resending the photo", async () => {
  const calls = [];
  const form = new FormData();
  form.set("kind", "received");
  form.set("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));
  const wrapped = createRetryingFetch(async (input, init) => {
    calls.push({ input, init });
    if (init.method === "POST") throw new Error("response lost after server saved the image");
    assert.equal(new URL(input).searchParams.get("kind"), "received");
    assert.equal(new URL(input).searchParams.get("upload_id"), new Headers(calls[0].init.headers).get("X-PD-Upload-ID"));
    return Response.json({ url: "/api/blob/received/me/photo.jpg" });
  }, origin, noWait);
  assert.equal((await (await wrapped("/api/upload", { method: "POST", body: form })).json()).url, "/api/blob/received/me/photo.jpg");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.body, undefined);
});

test("a truncated JSON body is retried rather than reporting successful upload", async () => {
  let calls = 0;
  const wrapped = createRetryingFetch(async () => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream({ start(c) { c.error(new Error("body connection lost")); } }), { headers: { "content-type": "application/json" } });
    return Response.json({ ok: true });
  }, origin, noWait);
  assert.deepEqual(await (await wrapped("/api/upload", { method: "POST" })).json(), { ok: true });
  assert.equal(calls, 2);
});

test("caller cancellation is not retried and its abort listener is removed", async () => {
  const controller = new AbortController();
  let calls = 0;
  let adds = 0;
  let removes = 0;
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => { adds++; return add(...args); };
  signal.removeEventListener = (...args) => { removes++; return remove(...args); };
  const wrapped = createRetryingFetch(async (_input, init) => new Promise((_resolve, reject) => {
    calls++;
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }), origin, noWait);
  const request = wrapped("/api/snapshot", { signal });
  controller.abort(new Error("user cancelled"));
  await assert.rejects(request, /user cancelled/);
  assert.equal(calls, 1);
  assert.equal(adds, removes);
});

test("the timeout remains active when headers arrive but the JSON body stalls", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const wrapped = createRetryingFetch(async (_input, init) => {
    calls++;
    if (calls > 1) return Response.json({ recovered: true });
    return new Response(new ReadableStream({ start(controller) {
      init.signal.addEventListener("abort", () => controller.error(new Error("stalled body timed out")), { once: true });
    } }), { headers: { "content-type": "application/json" } });
  }, origin, noWait);
  const pending = wrapped("/api/snapshot");
  await immediate();
  t.mock.timers.tick(15_000);
  const response = await pending;
  assert.deepEqual(await response.json(), { recovered: true });
  assert.equal(calls, 2);
});

test("non-idempotent writes are not repeated and do not falsely claim three retries", async () => {
  let calls = 0;
  const wrapped = createRetryingFetch(async () => { calls++; throw new Error("lost response"); }, origin, noWait);
  await assert.rejects(wrapped("/api/puzzles", { method: "POST", body: "{}" }), /结果尚未确认/);
  assert.equal(calls, 1);
  assert.equal(requestPolicy("/api/puzzles/id/retention", "POST", '{"action":"shipped"}').attempts, 1);
  assert.equal(requestPolicy("/api/puzzles/id/retention", "POST", '{"action":"received"}').attempts, 3);
});

test("other origins and media fetches remain untouched", async () => {
  const init = { method: "POST" };
  const wrapped = createRetryingFetch(async (_input, receivedInit) => { assert.equal(receivedInit, init); return new Response("ok"); }, origin, noWait);
  await wrapped("https://another.test/api/upload", init);
  await wrapped("/api/blob/photo.jpg", init);
});

test("multi-photo uploads are limited to two, reused after form failure, and keep IDs on manual retry", async () => {
  let active = 0;
  let peak = 0;
  const sends = [];
  let fail = true;
  const send = createImageUploader(async (file, kind, id) => {
    active++; peak = Math.max(peak, active);
    sends.push({ file, kind, id });
    await immediate();
    active--;
    if (file.name === "retry.jpg" && fail) { fail = false; throw new Error("lost response"); }
    return `/api/blob/${kind}/${id}.jpg`;
  });
  const files = Array.from({ length: 8 }, (_, index) => new File(["photo"], `${index}.jpg`));
  const urls = await Promise.all(files.map((file) => send(file, "received")));
  assert.equal(peak, 2);
  assert.equal(await send(files[0], "received"), urls[0]);
  assert.equal(sends.length, 8);
  const file = new File(["photo"], "retry.jpg");
  await assert.rejects(send(file, "received"));
  await send(file, "received");
  assert.equal(sends[8].id, sends[9].id);
  await send(file, "shipped");
  assert.notEqual(sends[9].id, sends[10].id);
});
