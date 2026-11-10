import type { Store } from "@edgeone/pages-blob";

export async function scanStoreUsage(store: Pick<Store, "list" | "getMetadata">) {
  const { blobs } = await store.list({ consistency: "strong" });
  let bytes = 0;
  for (let index = 0; index < blobs.length; index += 6) {
    const sizes = await Promise.all(blobs.slice(index, index + 6).map(async ({ key }) => {
      try {
        // HEAD returns the length without downloading hundreds of MB of images.
        const metadata = await store.getMetadata(key, { consistency: "strong" });
        if (!metadata) return 0; // Deleted after list(), usually a lock object.
        const raw = metadata.headers?.["content-length"];
        if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("Object size unavailable");
        return Number(raw);
      } catch (error) {
        if (key.startsWith("locks/")) return 0;
        // Never publish a misleading low usage total on a failed HEAD request.
        throw error;
      }
    }));
    bytes += sizes.reduce((sum, value) => sum + value, 0);
  }
  return { bytes, objects: blobs.length };
}
