import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isUploadedImageUrl } from "@/lib/image-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, max: number, required = false): string | null {
  if (typeof value !== "string") return required ? null : "";
  const text = value.normalize("NFKC").trim();
  const length = Array.from(text).length;
  if (required && length < 1) return null;
  if (length > max) return null;
  return text;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getReadyUser();
    if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const name = cleanText(input.name, 80, true);
    const brandInput = cleanText(input.brand, 80);
    const descriptionInput = cleanText(input.description, 1000);
    const coverUrl = cleanText(input.cover_url, 2000, true);

    if (!name) return NextResponse.json({ error: "请填写 1–80 字的拼图名称。" }, { status: 400 });
    if (brandInput === null) return NextResponse.json({ error: "品牌最多 80 字。" }, { status: 400 });
    if (descriptionInput === null) return NextResponse.json({ error: "介绍最多 1000 字。" }, { status: 400 });
    const brand = brandInput ?? "";
    const description = descriptionInput ?? "";
    if (!coverUrl || !isUploadedImageUrl(coverUrl, "cover", user.id)) {
      return NextResponse.json({ error: "请先上传封面图。" }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const { data, error } = await db.rpc("create_puzzle_with_owner", {
      p_name: name,
      p_brand: brand,
      p_cover_url: coverUrl,
      p_description: description,
      p_owner_id: user.id,
    });

    if (error) throw new Error(error.message);
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    console.error("POST /api/puzzles failed", error);
    return NextResponse.json({ error: "发布拼图失败。" }, { status: 500 });
  }
}
