import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const COOKIE_NAME = "pd_session";
const SESSION_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export type AppUser = {
  id: string;
  username: string;
  avatar_url: string | null;
  is_admin: boolean;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const db = getSupabaseAdmin();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const { data: user, error: userError } = await db.from("app_users").select("session_version").eq("id", userId).single();
  if (userError) throw new Error(`Failed to read user session version: ${userError.message}`);

  const { error } = await db.from("app_sessions").insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    session_version: user.session_version,
  });

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const db = getSupabaseAdmin();
  const tokenHash = hashToken(token);

  const { data: session, error: sessionError } = await db
    .from("app_sessions")
    .select("user_id, expires_at, session_version")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (sessionError) throw new Error(`Failed to read session: ${sessionError.message}`);
  if (!session) return null;

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await db.from("app_sessions").delete().eq("token_hash", tokenHash);
    return null;
  }

  const { data: user, error: userError } = await db
    .from("app_users")
    .select("id, username, avatar_url, is_admin, session_version")
    .eq("id", session.user_id)
    .maybeSingle();

  if (userError) throw new Error(`Failed to read user: ${userError.message}`);
  if (!user) return null;
  if (session.session_version !== user.session_version) return null;

  return {
    id: user.id,
    username: user.username,
    avatar_url: user.avatar_url ?? null,
    is_admin: Boolean(user.is_admin),
  };
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    const db = getSupabaseAdmin();
    await db.from("app_sessions").delete().eq("token_hash", hashToken(token));
  }

  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}
