import { NextRequest, NextResponse } from "next/server";
import { hash, compare } from "bcryptjs";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isRegistrationOpen } from "@/lib/edgeone-store";
import {
  createSession,
  destroyCurrentSession,
  getCurrentUser,
  setSessionCookie,
} from "@/lib/session";

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
    normalized: username.toLowerCase(),
  };
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ user: null }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
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
    const pin = (body as { pin?: unknown })?.pin;
    if (!parsed) {
      return NextResponse.json({ error: "用户名需要是 1–24 个字符。" }, { status: 400 });
    }
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: "请输入 6 位数字 PIN。" }, { status: 400 });
    }

    const db = getSupabaseAdmin();

    let { data: user, error: findError } = await db
      .from("app_users")
      .select("id, username, avatar_url, is_admin, pin_hash, pin_failed_count, pin_locked_until, profile_required")
      .eq("username_normalized", parsed.normalized)
      .maybeSingle();

    if (findError) throw new Error(findError.message);

    if (!user) {
      let adminBootstrap = false;

      if (parsed.normalized === "nono") {
        const { data: existingAdmins, error: adminError } = await db
          .from("app_users")
          .select("id")
          .eq("is_admin", true)
          .limit(1);

        if (adminError) throw new Error(adminError.message);

        if ((existingAdmins ?? []).length > 0) {
          return NextResponse.json(
            { error: "管理员账号需由已有管理员恢复。" },
            { status: 403 }
          );
        }

        adminBootstrap = true;
      }

      if (!adminBootstrap && !(await isRegistrationOpen())) {
        return NextResponse.json(
          { error: "当前已关闭新成员注册，请联系管理员。" },
          { status: 403 }
        );
      }

      const { data: newUser, error: createError } = await db
        .from("app_users")
        .insert({
          username: parsed.username,
          username_normalized: parsed.normalized,
          is_admin: parsed.normalized === "nono",
          pin_hash: await hash(pin, 12),
          profile_required: true,
        })
        .select("id, username, avatar_url, is_admin, pin_hash, pin_failed_count, pin_locked_until, profile_required")
        .single();

      if (createError && createError.code === "23505") {
        const { data: existingUser, error: retryError } = await db
          .from("app_users")
          .select("id, username, avatar_url, is_admin, pin_hash, pin_failed_count, pin_locked_until, profile_required")
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

    if (user.pin_hash) {
      if (user.pin_locked_until && new Date(user.pin_locked_until).getTime() > Date.now()) {
        return NextResponse.json({ error: "PIN 尝试过多，请 15 分钟后再试。" }, { status: 429 });
      }
      if (!(await compare(pin, user.pin_hash))) {
        const { error: failedError } = await db.rpc("v03_pin_failed", { p_user_id: user.id });
        if (failedError) throw new Error(failedError.message);
        return NextResponse.json({ error: "用户名或 PIN 不正确。" }, { status: 401 });
      }
      const { error: successError } = await db.rpc("v03_pin_succeeded", { p_user_id: user.id });
      if (successError) throw new Error(successError.message);
    } else {
      // v0.2 accounts had no authentication. Claiming requires an existing session;
      // this prevents username-only takeovers during the migration.
      const existingSession = await getCurrentUser();
      if (existingSession?.id !== user.id) {
        return NextResponse.json({ error: "旧账号请先在原设备打开网站设置 PIN；若已换设备，请联系管理员恢复。" }, { status: 403 });
      }
      const { data: claimed, error: claimError } = await db.rpc("v03_claim_pin", {
        p_user_id: user.id, p_hash: await hash(pin, 12),
      });
      if (claimError) throw new Error(claimError.message);
      if (!claimed) return NextResponse.json({ error: "PIN 已在其他设备设置，请重新登录。" }, { status: 409 });
    }

    // Ensure the reserved username "nono" is always marked as admin.
    if (parsed.normalized === "nono" && !user.is_admin) {
      const { data: promoted, error: promoteError } = await db
        .from("app_users")
        .update({ is_admin: true })
        .eq("id", user.id)
        .select("id, username, avatar_url, is_admin, pin_hash, pin_failed_count, pin_locked_until, profile_required")
        .single();

      if (promoteError) throw new Error(promoteError.message);
      user = promoted;
    }

    const { token, expiresAt } = await createSession(user.id);
    await setSessionCookie(token, expiresAt);

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url ?? null,
        is_admin: Boolean(user.is_admin),
        profile_required: Boolean(user.profile_required),
      },
    });
  } catch (error) {
    console.error("POST /api/session failed", error);
    return NextResponse.json({ error: "进入失败，请稍后重试。" }, { status: 500 });
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

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.pin !== "string" || !/^\d{6}$/.test(body.pin)) {
    return NextResponse.json({ error: "请输入 6 位数字 PIN。" }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  const { data: existing, error: readError } = await db.from("app_users").select("pin_hash").eq("id", user.id).single();
  if (readError) return NextResponse.json({ error: "读取账号失败。" }, { status: 500 });
  if (existing.pin_hash) return NextResponse.json({ error: "PIN 已设置。如需重置，请联系管理员。" }, { status: 409 });
  const { data, error } = await db.rpc("v03_claim_pin", { p_user_id: user.id, p_hash: await hash(body.pin, 12) });
  if (error || !data) return NextResponse.json({ error: "设置 PIN 失败。" }, { status: 409 });
  const { token, expiresAt } = await createSession(user.id);
  await setSessionCookie(token, expiresAt);
  return NextResponse.json({ ok: true });
}
