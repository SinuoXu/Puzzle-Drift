"use client";

import { useEffect } from "react";

const TRANSIENT_STATUS = new Set([408, 425, 429, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function requestPath(input: RequestInfo | URL): string {
  try {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return "";
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function retryCount(path: string, method: string): number {
  // Ordinary reads: three total attempts.
  if (method === "GET" || method === "HEAD") return 3;

  // Critical requests that are safe/idempotent enough to retry.
  if (method === "POST" && path === "/api/session") return 10;
  if (method === "PATCH" && path === "/api/profile") return 10;
  if (method === "POST" && path === "/api/upload") return 10;
  if (method === "PATCH" && path === "/api/admin/registration") return 10;

  // Like/unlike is idempotent because the client sends the desired final state.
  if (
    method === "PUT" &&
    /^\/api\/puzzles\/[^/]+\/likes$/.test(path)
  ) return 10;

  // Logging out is idempotent.
  if (method === "DELETE" && path === "/api/session") return 3;

  // Do NOT blindly retry queue / shipping / payment / puzzle creation mutations.
  return 1;
}

function uploadId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function NetworkRetryProvider() {
  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const path = requestPath(input);
      const method = requestMethod(input, init);
      const attempts = retryCount(path, method);

      let baseInit: RequestInit = { ...(init ?? {}) };

      // Make upload retries idempotent: every retry of the same upload uses
      // exactly the same object key on the server.
      if (method === "POST" && path === "/api/upload") {
        const headers = new Headers(
          typeof Request !== "undefined" && input instanceof Request
            ? input.headers
            : undefined,
        );
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));

        if (!headers.has("X-PD-Upload-ID")) {
          headers.set("X-PD-Upload-ID", uploadId());
        }
        baseInit = { ...baseInit, headers };
      }

      let lastNetworkError: unknown = null;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timeoutMs = attempts >= 10 ? 12_000 : 10_000;
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

        const originalSignal = baseInit.signal;
        if (originalSignal) {
          if (originalSignal.aborted) {
            controller.abort();
          } else {
            originalSignal.addEventListener(
              "abort",
              () => controller.abort(),
              { once: true },
            );
          }
        }

        try {
          const attemptInput =
            typeof Request !== "undefined" && input instanceof Request
              ? input.clone()
              : input;

          const response = await nativeFetch(attemptInput, {
            ...baseInit,
            signal: controller.signal,
          });

          window.clearTimeout(timeout);

          if (
            attempt < attempts &&
            TRANSIENT_STATUS.has(response.status)
          ) {
            try {
              await response.body?.cancel();
            } catch {
              // Nothing to do.
            }

            await sleep(Math.min(300 * attempt, 1_500));
            continue;
          }

          return response;
        } catch (error) {
          window.clearTimeout(timeout);
          lastNetworkError = error;

          if (attempt >= attempts) break;

          await sleep(Math.min(300 * attempt, 1_500));
        }
      }

      const suffix =
        attempts >= 10
          ? "已自动重试 10 次，请切换 Wi-Fi / 移动网络后再试。"
          : "已自动重试 3 次，请稍后再试。";

      throw new Error(`网络连接不稳定，${suffix}`, {
        cause: lastNetworkError,
      });
    };

    window.fetch = wrappedFetch;

    return () => {
      window.fetch = nativeFetch;
    };
  }, []);

  return null;
}
