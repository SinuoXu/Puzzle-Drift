import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanContent(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const content = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  const length = Array.from(content).length;

  if (length < 1 || length > 200) return null;
  return content;
}

export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "未登录。" }, { status: 401 });
    }

    const db = getSupabaseAdmin();
    const { data: items, error: itemError } = await db
      .from("list_items")
      .select("id, content, created_by, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (itemError) throw new Error(itemError.message);

    const creatorIds = Array.from(new Set((items ?? []).map((item) => item.created_by)));
    const usernameMap = new Map<string, string>();

    if (creatorIds.length > 0) {
      const { data: users, error: userError } = await db
        .from("app_users")
        .select("id, username")
        .in("id", creatorIds);

      if (userError) throw new Error(userError.message);
      for (const user of users ?? []) usernameMap.set(user.id, user.username);
    }

    const responseItems = (items ?? []).map((item) => ({
      id: item.id,
      content: item.content,
      created_by: item.created_by,
      created_at: item.created_at,
      creator_username: usernameMap.get(item.created_by) ?? "未知用户",
    }));

    return NextResponse.json(
      { items: responseItems },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("GET /api/items failed", error);
    return NextResponse.json({ error: "读取 List 失败。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "未登录。" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
    }

    const content = cleanContent((body as { content?: unknown })?.content);
    if (!content) {
      return NextResponse.json({ error: "内容需要是 1–200 个字符。" }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const { data: item, error } = await db
      .from("list_items")
      .insert({ content, created_by: currentUser.id })
      .select("id, content, created_by, created_at")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json(
      { item: { ...item, creator_username: currentUser.username } },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/items failed", error);
    return NextResponse.json({ error: "添加失败。" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "未登录。" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
    }

    const id = (body as { id?: unknown })?.id;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: "无效的项目 ID。" }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const { error } = await db.from("list_items").delete().eq("id", id);
    if (error) throw new Error(error.message);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("DELETE /api/items failed", error);
    return NextResponse.json({ error: "删除失败。" }, { status: 500 });
  }
}
