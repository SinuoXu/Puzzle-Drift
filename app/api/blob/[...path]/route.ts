import { NextResponse } from "next/server";
import { getImageStore } from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const key = path.join("/");
  if (!key || path.some((part) => part === "." || part === "..")) {
    return NextResponse.json({ error: "无效图片地址。" }, { status: 400 });
  }

  try {
    const data = await getImageStore().get(key, { type: "arrayBuffer" });
    if (!data) return NextResponse.json({ error: "图片不存在。" }, { status: 404 });
    return new Response(data as ArrayBuffer, {
      headers: {
        "Content-Type": contentTypeFor(key),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("GET /api/blob failed", error);
    return NextResponse.json({ error: "读取图片失败。" }, { status: 500 });
  }
}
