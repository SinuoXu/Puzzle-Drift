"use client";

import { useEffect } from "react";
import { createRetryingFetch } from "@/lib/network-fetch";

export function NetworkRetryProvider() {
  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = createRetryingFetch(nativeFetch, window.location.origin);
    return () => { window.fetch = nativeFetch; };
  }, []);
  return null;
}
