import { NextRequest, NextResponse } from "next/server";
import { getReadyUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isUploadedImageUrl } from "@/lib/image-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanNote(value: unknown): string | null {
  if (typeof value !== "string") return "";
  const text = value.normalize("NFKC").trim();
  if (Array.from(text).length > 1000) return null;
  return text;
}

function friendlyRpcError(message: string): string {
  if (message.includes("not the current holder")) return "只有当前持有人可以提交这条留存。";
  if (message.includes("Receiving record already exists")) return "收货留存已经提交过了。";
  if (message.includes("initial owner turn")) return "图主初始持有不需要收货留存。";
  if (message.includes("before shipping")) return "请先提交收货留存，再提交发货留存。";
  if (message.includes("Nobody is waiting next")) return "目前没有下一棒，暂时不能发货。";
  if (message.includes("Shipping record already exists")) return "发货留存已经提交过了。";
  if (message.includes("Fee first")) return "请先填写发货邮费，再提交发货留存。";
  if (message.includes("Receive first")) return "请先提交收货留存。";
  return "提交留存失败。";
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "无效的拼图 ID。" }, { status: 400 });

    const user = await getReadyUser();
    if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const action = input.action;
    const date = input.date;
    const photoUrls = input.photo_urls;
    const note = cleanNote(input.note);

    if (action !== "received" && action !== "shipped") {
      return NextResponse.json({ error: "留存类型不正确。" }, { status: 400 });
    }
    if (typeof date !== "string" || !DATE_RE.test(date)) {
      return NextResponse.json({ error: "请选择日期。" }, { status: 400 });
    }
    if (!Array.isArray(photoUrls) || photoUrls.length < 1 || photoUrls.length > 12 ||
      !photoUrls.every((url) => isUploadedImageUrl(url, action, user.id))) {
      return NextResponse.json({ error: "请先上传留存图片。" }, { status: 400 });
    }
    if (note === null) {
      return NextResponse.json({ error: "备注最多 1000 字。" }, { status: 400 });
    }

    const db = getSupabaseAdmin();

    if (action === "received") {
      const { error } = await db.rpc("v03_receive", {
        p_puzzle_id: id,
        p_user_id: user.id,
        p_date: date,
        p_urls: photoUrls,
        p_note: note,
      });

      if (error) return NextResponse.json({ error: friendlyRpcError(error.message) }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    const { data, error } = await db.rpc("v03_ship", {
      p_puzzle_id: id,
      p_user_id: user.id,
      p_date: date,
      p_urls: photoUrls,
      p_note: note,
      p_return: input.return_home === true,
    });

    if (error) return NextResponse.json({ error: friendlyRpcError(error.message) }, { status: 400 });
    return NextResponse.json({ ok: true, next_holder_id: data });
  } catch (error) {
    console.error("POST retention failed", error);
    return NextResponse.json({ error: "提交留存失败。" }, { status: 500 });
  }
}
