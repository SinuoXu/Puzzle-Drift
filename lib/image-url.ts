import { imageKeyFromPublicUrl } from "@/lib/edgeone-store";

export function isUploadedImageUrl(value: unknown, kind: string, userId: string): value is string {
  if (typeof value !== "string") return false;
  const key = imageKeyFromPublicUrl(value);
  if (!key) return false;
  return key.startsWith(`${kind}/${userId}/`);
}
