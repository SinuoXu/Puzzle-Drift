const TRANSIENT_STATUS = new Set([408, 425, 429, 502, 503, 504]);

export function requestPolicy(path: string, method: string, body?: BodyInit | null) {
  if (method === "POST" && path === "/api/upload") return { attempts: 3, timeoutMs: 90_000 };
  if (method === "GET" && path === "/api/admin/storage") return { attempts: 2, timeoutMs: 60_000 };
  if (method === "GET" || method === "HEAD") return { attempts: 3, timeoutMs: 15_000 };
  if ((method === "POST" && path === "/api/session") ||
      (method === "PATCH" && ["/api/profile", "/api/admin/registration"].includes(path)) ||
      (method === "PUT" && /^\/api\/puzzles\/[^/]+\/likes$/.test(path)) ||
      (method === "PATCH" && /^\/api\/shipping-groups\/[^/]+$/.test(path))) {
    return { attempts: 10, timeoutMs: 35_000 };
  }
  if (method === "POST" && /^\/api\/puzzles\/[^/]+\/retention$/.test(path) && typeof body === "string") {
    try {
      // Only receiving with the identical date/photos/note is safely repeatable.
      if (JSON.parse(body).action === "received") return { attempts: 3, timeoutMs: 45_000 };
    } catch { /* An invalid body is left for the API to reject. */ }
  }
  if (method === "DELETE" && path === "/api/session") return { attempts: 3, timeoutMs: 35_000 };
  // Wait longer than the backend's 25-second lock queue, without blindly
  // repeating non-idempotent puzzle creation, queue changes, shipping or fees.
  return { attempts: 1, timeoutMs: 45_000 };
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function makeUploadId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createRetryingFetch(nativeFetch: typeof fetch, origin: string, pause = wait): typeof fetch {
  return async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/blob/")) {
      return nativeFetch(input, init);
    }
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const policy = requestPolicy(url.pathname, method, init?.body);
    const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const baseInit = { ...init };
    const upload = method === "POST" && url.pathname === "/api/upload";
    let recoveryUrl: string | undefined;
    if (upload) {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      if (!headers.has("X-PD-Upload-ID")) headers.set("X-PD-Upload-ID", makeUploadId());
      baseInit.headers = headers;
      if (init?.body instanceof FormData) {
        const file = init.body.get("file");
        const kind = init.body.get("kind");
        if (file instanceof Blob && typeof kind === "string") {
          const recovery = new URL("/api/upload", origin);
          recovery.search = new URLSearchParams({ upload_id: headers.get("X-PD-Upload-ID")!, kind, type: file.type }).toString();
          recoveryUrl = recovery.href;
        }
      }
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= policy.attempts; attempt++) {
      originalSignal?.throwIfAborted();
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(originalSignal?.reason);
      originalSignal?.addEventListener("abort", forwardAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
      try {
        if (attempt > 1 && recoveryUrl) {
          const recovered = await nativeFetch(recoveryUrl, { cache: "no-store", credentials: baseInit.credentials, signal: controller.signal });
          if (recovered.ok || recovered.status === 401) {
            await recovered.clone().arrayBuffer();
            return recovered;
          }
          await recovered.body?.cancel().catch(() => undefined);
        }
        const response = await nativeFetch(input instanceof Request ? input.clone() : input, { ...baseInit, signal: controller.signal });
        if (attempt < policy.attempts && (TRANSIENT_STATUS.has(response.status) || (upload && response.status === 500))) {
          await response.body?.cancel().catch(() => undefined);
        } else {
          // Headers arriving is not completion: cover the JSON body too, while
          // leaving the returned response readable by the original caller.
          if (response.headers.get("content-type")?.includes("json")) await response.clone().arrayBuffer();
          return response;
        }
      } catch (error) {
        if (originalSignal?.aborted) throw originalSignal.reason ?? error;
        lastError = error;
        if (attempt === policy.attempts) break;
      } finally {
        clearTimeout(timer);
        originalSignal?.removeEventListener("abort", forwardAbort);
      }
      await pause(Math.min(500 * attempt, 2_000), originalSignal);
    }
    const message = policy.attempts === 1
      ? "网络中断或等待超时，操作结果尚未确认。请刷新页面核对状态后再操作。"
      : `${upload ? "图片上传超时或连接中断" : "网络连接不稳定"}，已尝试 ${policy.attempts} 次，请稍后重试。`;
    throw new Error(message, { cause: lastError });
  };
}
