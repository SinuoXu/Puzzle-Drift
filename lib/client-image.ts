export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件。");
  }

  if (file.size < 1_000_000) return file;

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("无法读取这张图片。"));
      img.src = objectUrl;
    });

    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(image, 0, 0, width, height);

    let blob: Blob | null = null;
    for (const quality of [0.8, 0.65, 0.5, 0.35]) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && blob.size < 1_000_000) break;
    }
    if (!blob || blob.size >= 1_000_000) throw new Error("图片压缩后仍超过 1 MB，请换一张图片。");

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${baseName}.webp`, { type: "image/webp" });
  } catch (error) {
    throw error instanceof Error ? error : new Error("图片压缩失败。");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function uploadImage(file: File, kind: "cover" | "received" | "shipped" | "avatar" | "payment_qr" | "receipt"): Promise<string> {
  const compressed = await compressImage(file);

  if (compressed.size >= 1_000_000) {
    throw new Error("图片压缩后仍超过 1 MB，请换一张更小的图片。");
  }

  const form = new FormData();
  form.append("file", compressed);
  form.append("kind", kind);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "图片上传失败。");
  return data.url as string;
}
