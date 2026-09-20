# Puzzle Drift

A minimal shared list for a small private group, built with Next.js + Supabase.

## Features

- Username-only entry (no password/auth verification)
- Persistent HttpOnly session cookie on the same browser/device
- Shared list for all users
- Add/delete items
- Shows the username that created each item
- 4-second polling for simple multi-user sync

> Important: username-only entry is **not real identity authentication**. Anyone who knows another username can enter as that user from another device.

## 1. Create the database

Open your Supabase project → SQL Editor → New query. Paste and run `supabase/schema.sql`.

## 2. Environment variables

Create `.env.local` for local development:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
```

Never commit the real secret key. Do not prefix it with `NEXT_PUBLIC_`.

## 3. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## 4. Deploy to Vercel

Import the GitHub repository into Vercel and add these environment variables:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Then deploy.
