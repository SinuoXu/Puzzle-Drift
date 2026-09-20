import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createSession, destroyCurrentSession, getCurrentUser, setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeUsername(input: unknown): { username: string; normalized: string } | null {
  if (typeof input !== "string") return null;

  const username = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  const length = Array.from(username).length;

  if (length < 1 || length > 24) return null;
  if (/[\u0000-\u001F\u007F]/.test(username)) return null;

  return {
    username,
    normalized: username.toLocaleLowerCase("zh-CN"),
  };
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { user: null },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { user },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("GET /api/session failed", error);
    return NextResponse.json({ error: "读取登录状态失败。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
    }

    const parsed = normalizeUsername((body as { username?: unknown })?.username);
    if (!parsed) {
      return NextResponse.json({ error: "用户名需要是 1–24 个字符。" }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    let { data: user, error: findError } = await db
      .from("app_users")
      .select("id, username")
      .eq("username_normalized", parsed.normalized)
      .maybeSingle();

    if (findError) throw new Error(findError.message);

    if (!user) {
      const { data: newUser, error: createError } = await db
        .from("app_users")
        .insert({
          username: parsed.username,
          username_normalized: parsed.normalized,
        })
        .select("id, username")
        .single();

      if (createError && createError.code === "23505") {
        const { data: existingUser, error: retryError } = await db
          .from("app_users")
          .select("id, username")
          .eq("username_normalized", parsed.normalized)
          .single();

        if (retryError) throw new Error(retryError.message);
        user = existingUser;
      } else if (createError) {
        throw new Error(createError.message);
      } else {
        user = newUser;
      }
    }

    if (!user) throw new Error("User could not be created.");

    const { token, expiresAt } = await createSession(user.id);
    await setSessionCookie(token, expiresAt);

    return NextResponse.json({
      user: { id: user.id, username: user.username },
    });
  } catch (error) {
    console.error("POST /api/session failed", error);
    return NextResponse.json({ error: "登录失败，请稍后重试。" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await destroyCurrentSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/session failed", error);
    return NextResponse.json({ error: "退出失败。" }, { status: 500 });
  }
}
