import { NextRequest, NextResponse } from "next/server";
import { getReadyContext } from "@/lib/session";
import { getDataStore, getImageStore } from "@/lib/edgeone-store";
import { scanStoreUsage } from "@/lib/storage-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAPACITY_BYTES = 1_000_000_000;
const CACHE_MS = 30 * 60 * 1000;
const USAGE_KEY = "metadata/storage-usage.json";

type UsageResult = {
  scanned_at: string;
  total_bytes: number;
  capacity_bytes: number;
  image_bytes: number;
  image_objects: number;
  data_bytes: number;
  data_objects: number;
};

function isFresh(value: any): value is UsageResult {
  if (!value || typeof value !== "object" || typeof value.scanned_at !== "string") return false;
  const age = Date.now() - new Date(value.scanned_at).getTime();
  return Number.isFinite(age) && age >= 0 && age < CACHE_MS;
}

// This coalesces only an in-progress statistics scan; no session or app-state
// snapshot is cached across requests. Every caller is authenticated separately.
let pendingScan: Promise<UsageResult> | undefined;

async function scanUsage(): Promise<UsageResult> {
  const [images, data] = await Promise.all([scanStoreUsage(getImageStore()), scanStoreUsage(getDataStore())]);
  const result: UsageResult = {
    scanned_at: new Date().toISOString(),
    total_bytes: images.bytes + data.bytes, capacity_bytes: CAPACITY_BYTES,
    image_bytes: images.bytes, image_objects: images.objects,
    data_bytes: data.bytes, data_objects: data.objects,
  };
  // Statistics do not need to rewrite/lock the application's state.json.
  await getDataStore().setJSON(USAGE_KEY, result);
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const { user, state } = await getReadyContext();
    if (!user?.is_admin || !state) return NextResponse.json({ error: "只有管理员可以查看存储空间。" }, { status: 403 });
    const force = request.nextUrl.searchParams.get("refresh") === "1";
    const store = getDataStore();
    if (!force) {
      const cached = await store.get(USAGE_KEY, { type: "json", consistency: "strong" });
      // Keep the previous deployment's cached statistic usable during rollout.
      const value = isFresh(cached) ? cached : state.metadata?.storage_usage;
      if (isFresh(value)) return NextResponse.json({ ...value, cached: true }, { headers: { "Cache-Control": "no-store" } });
    }
    pendingScan ??= scanUsage().finally(() => { pendingScan = undefined; });
    const result = await pendingScan;
    return NextResponse.json({ ...result, cached: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/admin/storage failed", error);
    return NextResponse.json({ error: "统计存储空间失败，请稍后重试。" }, { status: 503 });
  }
}
