import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readState, type EdgeState } from "@/lib/edgeone-store";

const COOKIE_NAME = "pd_session";
const SESSION_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export type AppUser = {
  id: string;
  username: string;
  avatar_url: string | null;
  is_admin: boolean;
  profile_required: boolean;
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

// A read-only request authenticates and renders from the same strong-consistent
// snapshot. Do not retain this state across requests or use it for writes.
export async function getSessionContext(): Promise<{ user: AppUser | null; state: EdgeState | null }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return { user: null, state: null };

  const state = await readState();
  const tokenHash = hashToken(token);
  const sessions = state.app_sessions.filter((row) => row.token_hash === tokenHash);
  const session = sessions.length === 1 ? sessions[0] : null;
  const expiresAt = new Date(session?.expires_at ?? "").getTime();
  // Reject expiry immediately, without making a GET queue for a global write.
  if (!session || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { user: null, state: null };
  const users = state.app_users.filter((row) => row.id === session.user_id);
  const user = users.length === 1 ? users[0] : null;
  if (!user || session.session_version !== user.session_version) return { user: null, state: null };

  return {
    state,
    user: {
      id: user.id,
      username: user.username,
      avatar_url: user.avatar_url ?? null,
      is_admin: Boolean(user.is_admin),
      profile_required: Boolean(user.profile_required),
    },
  };
}

export async function getCurrentUser(): Promise<AppUser | null> {
  return (await getSessionContext()).user;
}

export async function getReadyContext() {
  const context = await getSessionContext();
  return context.user?.profile_required ? { user: null, state: null } : context;
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

export async function getReadyUser(): Promise<AppUser | null> {
  const user = await getCurrentUser();
  return user && !user.profile_required ? user : null;
}
