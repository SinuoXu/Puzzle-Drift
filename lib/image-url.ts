export function isUploadedImageUrl(value: unknown, kind: string, userId: string): value is string {
  if (typeof value !== "string") return false;
  const base = process.env.SUPABASE_URL;
  if (!base) return false;
  try {
    const actual = new URL(value);
    const expected = new URL(base);
    return actual.origin === expected.origin &&
      actual.pathname.startsWith(`${expected.pathname.replace(/\/$/, "")}/storage/v1/object/public/puzzle-images/${kind}/${userId}/`) &&
      !actual.search && !actual.hash;
  } catch { return false; }
}
