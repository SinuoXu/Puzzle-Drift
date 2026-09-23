# Puzzle Drift — EdgeOne-native backend patch

This patch keeps the existing Next.js UI/API routes but replaces the server-side Supabase data client with EdgeOne Makers Blob.

## Runtime architecture

- Next.js stays unchanged for the UI and route handlers.
- `puzzle-drift-data` Blob store contains `data/state.json` (users, sessions, puzzles, journeys, tasks, activities, handoffs, legacy list items).
- `puzzle-drift-images` Blob store contains uploaded images.
- Writes to the JSON state are serialized by a Blob-backed global lock using strong-consistency reads.
- Existing `/api/*` route code continues to call `getSupabaseAdmin()`, but that function is now a compatibility client backed by EdgeOne; it no longer connects to Supabase.
- Supabase Realtime can remain installed in the bundle, but when `NEXT_PUBLIC_SUPABASE_*` variables are not configured it is inactive. Existing 10-second polling remains the cross-device refresh fallback.

## One-time migration

Temporarily configure these three environment variables in EdgeOne:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `MIGRATION_SECRET` (choose your own long random string)

Deploy, open `/migrate`, enter `MIGRATION_SECRET`, and click the migration button. The migration copies all database tables used by Puzzle Drift and copies referenced public images from the old `puzzle-images` bucket into EdgeOne Blob, rewriting stored URLs.

After migration succeeds, test the site. Then delete all three migration environment variables and redeploy. Normal runtime no longer requires Supabase.

## Important safety notes

1. Do not delete the Supabase project until you have verified login, puzzle creation, queueing, retention photos, shipping fees, handoff, admin controls, and old images on EdgeOne.
2. Keep the Supabase project untouched for at least several days as a rollback backup.
3. EdgeOne Blob does not provide PostgreSQL transactions. This patch serializes all state writes through a strong-read distributed lock so the current small-group workflow preserves atomic state transitions. It is intended for the current small Puzzle Drift group, not high-throughput public traffic.
4. The migration endpoint becomes unusable once the three migration environment variables are removed.
