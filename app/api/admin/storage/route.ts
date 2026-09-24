import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import {
  getDataStore,
  getImageStore,
  mutateState,
  readState,
} from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAPACITY_BYTES = 1_000_000_000;
const CACHE_MS = 30 * 60 * 1000;

type StoreUsage = {
  bytes: number;
  objects: number;
};

type UsageResult = {
  scanned_at: string;
  total_bytes: number;
  capacity_bytes: number;
  image_bytes: number;
  image_objects: number;
  data_bytes: number;
  data_objects: number;
};

function byteLength(value: unknown): number {
  if (value == null) return 0;

  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }

  if (typeof value === "string") {
    return Buffer.byteLength(value);
  }

  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

async function scanStore(store: any): Promise<StoreUsage> {
  const { blobs } = await store.list({
    consistency: "strong",
  });

  let bytes = 0;

  // Read a few at a time so this does not place all uploaded
  // images in memory simultaneously.
  const batchSize = 6;

  for (let i = 0; i < blobs.length; i += batchSize) {
    const batch = blobs.slice(i, i + batchSize);

    const sizes = await Promise.all(
      batch.map(async (blob: { key: string }) => {
        try {
          const value = await store.get(blob.key, {
            type: "arrayBuffer",
            consistency: "strong",
          });

          return byteLength(value);
        } catch {
          // A transient lock file may disappear between list()
          // and get(). It is safe to ignore such a tiny object.
          return 0;
        }
      }),
    );

    bytes += sizes.reduce(
      (sum: number, size: number) => sum + size,
      0,
    );
  }

  return {
    bytes,
    objects: blobs.length,
  };
}

function isFresh(value: any): value is UsageResult {
  if (!value || typeof value !== "object") return false;
  if (typeof value.scanned_at !== "string") return false;

  const age =
    Date.now() -
    new Date(value.scanned_at).getTime();

  return (
    Number.isFinite(age) &&
    age >= 0 &&
    age < CACHE_MS
  );
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getReadyUser();

    if (!admin?.is_admin) {
      return NextResponse.json(
        { error: "只有管理员可以查看存储空间。" },
        { status: 403 },
      );
    }

    const force =
      new URL(request.url).searchParams.get("refresh") === "1";

    const state = await readState();
    const cached =
      state.metadata?.storage_usage;

    if (!force && isFresh(cached)) {
      return NextResponse.json(
        {
          ...cached,
          cached: true,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const [images, data] = await Promise.all([
      scanStore(getImageStore()),
      scanStore(getDataStore()),
    ]);

    const result: UsageResult = {
      scanned_at: new Date().toISOString(),

      total_bytes:
        images.bytes +
        data.bytes,

      capacity_bytes:
        CAPACITY_BYTES,

      image_bytes:
        images.bytes,

      image_objects:
        images.objects,

      data_bytes:
        data.bytes,

      data_objects:
        data.objects,
    };

    // Cache only the result. No application records,
    // users, puzzles or images are modified.
    await mutateState((next) => {
      next.metadata = {
        ...(next.metadata ?? {}),
        storage_usage: result,
      };
    });

    return NextResponse.json(
      {
        ...result,
        cached: false,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "GET /api/admin/storage failed",
      error,
    );

    return NextResponse.json(
      {
        error:
          "统计存储空间失败，请稍后重试。",
      },
      { status: 500 },
    );
  }
}
