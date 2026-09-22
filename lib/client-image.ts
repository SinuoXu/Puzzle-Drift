export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件。");
  }

  // Already small enough: keep it as-is.
  if (file.size <= 900_000) return file;

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("无法读取这张图片。"));
      img.src = objectUrl;
    });

    const maxSide = 1920;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.82);
    });

    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${baseName}.webp`, { type: "image/webp" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function uploadImage(file: File, kind: "cover" | "received" | "shipped"): Promise<string> {
  const compressed = await compressImage(file);

  if (compressed.size > 6 * 1024 * 1024) {
    throw new Error("图片压缩后仍超过 6 MB，请换一张更小的图片。");
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
