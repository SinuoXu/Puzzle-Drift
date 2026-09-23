import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 1_000_000;
const ALLOWED_KINDS = new Set(["cover", "received", "shipped", "avatar", "payment_qr", "receipt"]);

function extensionForMime(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
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
      return NextResponse.json({ error: "图片必须小于 1 MB。" }, { status: 400 });
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
