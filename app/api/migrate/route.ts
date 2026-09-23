import { NextRequest, NextResponse } from "next/server";
import { getImageStore, publicImageUrl, replaceState, type EdgeState } from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLES = [
  "app_users",
  "app_sessions",
  "list_items",
  "puzzles",
  "puzzle_journey",
  "puzzle_activity",
  "puzzle_tasks",
  "puzzle_handoffs",
] as const;

function migrationConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  const secret = process.env.MIGRATION_SECRET;
  return { url, key, secret };
}

async function fetchTable(baseUrl: string, apiKey: string, table: string): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const response = await fetch(`${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*`, {
      headers: {
        apikey: apiKey,
        Range: `${start}-${start + pageSize - 1}`,
        "Range-Unit": "items",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`读取 Supabase 表 ${table} 失败：${response.status} ${detail.slice(0, 300)}`);
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error(`Supabase 表 ${table} 返回格式异常。`);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

function extractSupabaseImagePath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = new URL(value);
    const marker = "/storage/v1/object/public/puzzle-images/";
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return null;
    return parsed.pathname
      .slice(index + marker.length)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  } catch {
    return null;
  }
}

function collectImageUrls(state: EdgeState): string[] {
  const urls = new Set<string>();
  const add = (value: unknown) => { if (typeof value === "string" && extractSupabaseImagePath(value)) urls.add(value); };

  for (const user of state.app_users) {
    add(user.avatar_url);
    add(user.payment_qr_url);
  }
  for (const puzzle of state.puzzles) add(puzzle.cover_url);
  for (const journey of state.puzzle_journey) {
    add(journey.received_photo_url);
    add(journey.shipping_photo_url);
    for (const value of Array.isArray(journey.received_photo_urls) ? journey.received_photo_urls : []) add(value);
    for (const value of Array.isArray(journey.shipping_photo_urls) ? journey.shipping_photo_urls : []) add(value);
  }
  for (const task of state.puzzle_tasks) add(task.receipt_url);
  return [...urls];
}

function rewriteImages(state: EdgeState, mapping: Map<string, string>): EdgeState {
  const copy: EdgeState = JSON.parse(JSON.stringify(state));
  const rewrite = (value: any) => typeof value === "string" && mapping.has(value) ? mapping.get(value)! : value;

  for (const user of copy.app_users) {
    user.avatar_url = rewrite(user.avatar_url);
    user.payment_qr_url = rewrite(user.payment_qr_url);
  }
  for (const puzzle of copy.puzzles) puzzle.cover_url = rewrite(puzzle.cover_url);
  for (const journey of copy.puzzle_journey) {
    journey.received_photo_url = rewrite(journey.received_photo_url);
    journey.shipping_photo_url = rewrite(journey.shipping_photo_url);
    if (Array.isArray(journey.received_photo_urls)) journey.received_photo_urls = journey.received_photo_urls.map(rewrite);
    if (Array.isArray(journey.shipping_photo_urls)) journey.shipping_photo_urls = journey.shipping_photo_urls.map(rewrite);
  }
  for (const task of copy.puzzle_tasks) task.receipt_url = rewrite(task.receipt_url);
  return copy;
}

export async function GET() {
  const { url, key, secret } = migrationConfig();
  return NextResponse.json({
    ready: Boolean(url && key && secret),
    has_supabase_url: Boolean(url),
    has_supabase_secret: Boolean(key),
    has_migration_secret: Boolean(secret),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    const { url, key, secret } = migrationConfig();
    if (!url || !key || !secret) {
      return NextResponse.json({ error: "迁移环境变量未配置完整。" }, { status: 503 });
    }

    const input = await request.json().catch(() => null);
    if (!input || input.secret !== secret) {
      return NextResponse.json({ error: "迁移口令不正确。" }, { status: 403 });
    }

    const tableEntries = await Promise.all(TABLES.map(async (table) => [table, await fetchTable(url, key, table)] as const));
    const tableMap = Object.fromEntries(tableEntries) as Record<(typeof TABLES)[number], any[]>;
    const maxActivity = tableMap.puzzle_activity.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);

    let state: EdgeState = {
      schema_version: 1,
      app_users: tableMap.app_users,
      app_sessions: tableMap.app_sessions,
      list_items: tableMap.list_items,
      puzzles: tableMap.puzzles,
      puzzle_journey: tableMap.puzzle_journey,
      puzzle_activity: tableMap.puzzle_activity,
      puzzle_tasks: tableMap.puzzle_tasks,
      puzzle_handoffs: tableMap.puzzle_handoffs,
      counters: { puzzle_activity: maxActivity + 1 },
      metadata: { migrated_from_supabase_at: new Date().toISOString() },
    };

    const imageUrls = collectImageUrls(state);
    const mapping = new Map<string, string>();
    const imageStore = getImageStore();
    const failed: string[] = [];

    for (const oldUrl of imageUrls) {
      const path = extractSupabaseImagePath(oldUrl);
      if (!path) continue;
      try {
        const response = await fetch(oldUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        await imageStore.set(path, data);
        mapping.set(oldUrl, publicImageUrl(path));
      } catch (error) {
        console.error("Image migration failed", oldUrl, error);
        failed.push(oldUrl);
      }
    }

    if (failed.length) {
      return NextResponse.json({
        error: `有 ${failed.length} 张图片迁移失败，数据尚未切换。请重试。`,
        failed_images: failed.slice(0, 20),
      }, { status: 502 });
    }

    state = rewriteImages(state, mapping);
    await replaceState(state);

    return NextResponse.json({
      ok: true,
      counts: Object.fromEntries(TABLES.map((table) => [table, tableMap[table].length])),
      images_migrated: mapping.size,
      message: "Supabase 数据和图片已迁移到 EdgeOne Blob。",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("POST /api/migrate failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "迁移失败。",
    }, { status: 500 });
  }
}
