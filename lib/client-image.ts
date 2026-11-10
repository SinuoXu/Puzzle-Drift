const TARGET_BYTES = 2_900_000;
const MAX_UPLOAD_BYTES = 3_000_000;

async function canvasToWebp(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      resolve,
      "image/webp",
      quality,
    );
  });
}

export async function compressImage(
  file: File,
): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件。");
  }

  /*
   * Preserve the original file completely when it is already
   * within the upload limit.
   */
  if (file.size < MAX_UPLOAD_BYTES) {
    return file;
  }

  const objectUrl =
    URL.createObjectURL(file);

  try {
    const image =
      await new Promise<HTMLImageElement>(
        (resolve, reject) => {
          const img = new Image();

          img.onload = () =>
            resolve(img);

          img.onerror = () =>
            reject(
              new Error(
                "无法读取这张图片。",
              ),
            );

          img.src = objectUrl;
        },
      );

    const originalWidth =
      image.naturalWidth;

    const originalHeight =
      image.naturalHeight;

    /*
     * Start large and high-quality.
     * Only reduce dimensions when compression alone
     * cannot keep the image below ~3 MB.
     */
    const maxSides = [
      3000,
      2700,
      2400,
      2100,
      1800,
    ];

    const qualities = [
      0.92,
      0.88,
      0.84,
      0.80,
      0.76,
      0.72,
      0.68,
    ];

    let bestBlob: Blob | null = null;

    for (const maxSide of maxSides) {
      const scale = Math.min(
        1,
        maxSide /
          Math.max(
            originalWidth,
            originalHeight,
          ),
      );

      const width = Math.max(
        1,
        Math.round(
          originalWidth * scale,
        ),
      );

      const height = Math.max(
        1,
        Math.round(
          originalHeight * scale,
        ),
      );

      const canvas =
        document.createElement(
          "canvas",
        );

      canvas.width = width;
      canvas.height = height;

      const ctx =
        canvas.getContext("2d");

      if (!ctx) {
        throw new Error(
          "图片压缩初始化失败。",
        );
      }

      /*
       * High-quality browser resampling.
       */
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      ctx.drawImage(
        image,
        0,
        0,
        width,
        height,
      );

      for (
        const quality of qualities
      ) {
        const blob =
          await canvasToWebp(
            canvas,
            quality,
          );

        if (!blob) continue;

        /*
         * Remember the best attempt in case all attempts
         * remain slightly oversized.
         */
        if (
          !bestBlob ||
          blob.size < bestBlob.size
        ) {
          bestBlob = blob;
        }

        if (
          blob.size <= TARGET_BYTES
        ) {
          const baseName =
            file.name.replace(
              /\.[^.]+$/,
              "",
            ) || "image";

          return new File(
            [blob],
            `${baseName}.webp`,
            {
              type: "image/webp",
            },
          );
        }
      }
    }

    if (
      bestBlob &&
      bestBlob.size <
        MAX_UPLOAD_BYTES
    ) {
      const baseName =
        file.name.replace(
          /\.[^.]+$/,
          "",
        ) || "image";

      return new File(
        [bestBlob],
        `${baseName}.webp`,
        {
          type: "image/webp",
        },
      );
    }

    throw new Error(
      "图片压缩后仍超过 3 MB，请换一张分辨率稍低的图片。",
    );
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error(
          "图片压缩失败。",
        );
  } finally {
    URL.revokeObjectURL(
      objectUrl,
    );
  }
}

export type ImageKind = "cover" | "received" | "shipped" | "avatar" | "payment_qr" | "receipt";

// Cache only File objects from the current page, never application records.
export function createImageUploader(send: (file: File, kind: ImageKind, id: string) => Promise<string>, concurrency = 2) {
  const uploads = new WeakMap<File, Map<ImageKind, { id: string; promise?: Promise<string> }>>();
  let active = 0;
  const queue: (() => void)[] = [];
  async function run<T>(job: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try { return await job(); }
    finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  }
  return (file: File, kind: ImageKind): Promise<string> => {
    let kinds = uploads.get(file);
    if (!kinds) { kinds = new Map(); uploads.set(file, kinds); }
    let upload = kinds.get(kind);
    if (!upload) {
      const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      upload = { id };
      kinds.set(kind, upload);
    }
    if (upload.promise) return upload.promise;
    const entry = upload;
    entry.promise = run(() => send(file, kind, entry.id)).catch((error) => {
      entry.promise = undefined;
      throw error;
    });
    return entry.promise;
  };
}

async function sendImage(
  file: File,
  kind: ImageKind,
  uploadId: string,
): Promise<string> {
  const compressed =
    await compressImage(file);

  if (
    compressed.size >=
    MAX_UPLOAD_BYTES
  ) {
    throw new Error(
      "图片压缩后仍超过 3 MB，请换一张稍小的图片。",
    );
  }

  const form = new FormData();

  form.append(
    "file",
    compressed,
  );

  form.append(
    "kind",
    kind,
  );

  const response = await fetch(
    "/api/upload",
    {
      method: "POST",
      headers: { "X-PD-Upload-ID": uploadId },
      body: form,
    },
  );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error ??
        "图片上传失败。",
    );
  }

  if (typeof data.url !== "string" || !data.url.startsWith("/api/blob/")) {
    throw new Error("上传结果未确认，请重试，已上传的图片不会重复创建。");
  }
  return data.url;
}

export const uploadImage = createImageUploader(sendImage);
