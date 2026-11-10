import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getImageStore, publicImageUrl } from "@/lib/edgeone-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 3_000_000;
const ALLOWED_KINDS = new Set(["cover", "received", "shipped", "avatar", "payment_qr", "receipt"]);

function extensionForMime(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

// A small, authenticated check recovers a successful upload whose response was
// lost, without sending the image bytes again. Never accept another user's path.
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
    const id = request.nextUrl.searchParams.get("upload_id") ?? "";
    const kind = request.nextUrl.searchParams.get("kind") ?? "";
    const type = request.nextUrl.searchParams.get("type") ?? "";
    if (!/^[A-Za-z0-9_-]{12,100}$/.test(id) || !ALLOWED_KINDS.has(kind) || !ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ error: "无效的上传查询。" }, { status: 400 });
    }
    const path = `${kind}/${user.id}/${id}.${extensionForMime(type)}`;
    const metadata = await getImageStore().getMetadata(path, { consistency: "strong" });
    if (!metadata) return NextResponse.json({ error: "上传尚未完成。" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ url: publicImageUrl(path), path }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/upload failed", error);
    return NextResponse.json({ error: "暂时无法确认上传结果。" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });

    const form = await request.formData();
    const file = form.get("file");
    const kind = form.get("kind");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "没有收到图片文件。" }, { status: 400 });
    }

    if (typeof kind !== "string" || !ALLOWED_KINDS.has(kind)) {
      return NextResponse.json({ error: "图片类型不正确。" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "只支持 JPG、PNG、WebP。" }, { status: 400 });
    }

    if (file.size <= 0 || file.size >= MAX_BYTES) {
      return NextResponse.json({ error: "图片必须小于 3 MB。" }, { status: 400 });
    }

    const ext = extensionForMime(file.type);

    const requestedUploadId = request.headers.get("x-pd-upload-id");
    const safeUploadId =
      requestedUploadId && /^[A-Za-z0-9_-]{12,100}$/.test(requestedUploadId)
        ? requestedUploadId
        : randomUUID();

    const path = `${kind}/${user.id}/${safeUploadId}.${ext}`;
    const db = getSupabaseAdmin();
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error } = await db.storage.from("puzzle-images").upload(path, buffer, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });

    if (error) throw new Error(error.message);

    const { data } = db.storage.from("puzzle-images").getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path });
  } catch (error) {
    console.error("POST /api/upload failed", error);
    return NextResponse.json({ error: "图片上传失败。" }, { status: 500 });
  }
}
