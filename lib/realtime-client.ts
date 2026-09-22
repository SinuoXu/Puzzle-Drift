import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let realtimeClient: SupabaseClient | null | undefined;

export function getRealtimeClient(): SupabaseClient | null {
  if (realtimeClient !== undefined) return realtimeClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    realtimeClient = null;
    return null;
  }

  realtimeClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return realtimeClient;
}
