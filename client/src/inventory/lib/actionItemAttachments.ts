export const ACTION_ITEM_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_RESIZE_MAX_EDGE = 1600;
const IMAGE_JPEG_QUALITY = 0.82;

export type ActionItemAttachmentPayload = {
  fileName: string;
  contentType: string;
  dataBase64: string;
};

export type ActionItemAttachmentDraft = ActionItemAttachmentPayload & {
  id: string;
  previewUrl: string;
  size: number;
};

export function getImageFilesFromClipboard(clipboardData: DataTransfer | null) {
  const files: File[] = [];
  for (const item of Array.from(clipboardData?.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

function newDraftId(file: File) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2)}`;
}

function readBlobAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("画像の読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を表示用に読み込めませんでした"));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("画像の圧縮に失敗しました"));
      }
    }, type, quality);
  });
}

async function normalizeImageDataUrl(file: File, originalDataUrl: string) {
  if (file.size <= ACTION_ITEM_ATTACHMENT_MAX_BYTES) {
    return {
      dataUrl: originalDataUrl,
      contentType: file.type || "image/jpeg",
      size: file.size,
    };
  }

  const image = await loadImage(originalDataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    throw new Error(`${file.name} の画像サイズを読み取れませんでした`);
  }
  const scale = Math.min(1, IMAGE_RESIZE_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の圧縮に失敗しました");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const compressedBlob = await canvasToBlob(canvas, "image/jpeg", IMAGE_JPEG_QUALITY);
  return {
    dataUrl: await readBlobAsDataUrl(compressedBlob),
    contentType: "image/jpeg",
    size: compressedBlob.size,
  };
}

export async function fileToActionItemAttachment(file: File): Promise<ActionItemAttachmentDraft> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} は画像ファイルではありません`);
  }

  const originalDataUrl = await readBlobAsDataUrl(file);
  const normalized = await normalizeImageDataUrl(file, originalDataUrl);
  if (normalized.size > ACTION_ITEM_ATTACHMENT_MAX_BYTES) {
    throw new Error(`${file.name} は8MBを超えています`);
  }

  const previewUrl = normalized.dataUrl;
  const dataBase64 = previewUrl.split(",")[1] ?? "";
  if (!dataBase64) {
    throw new Error(`${file.name} の画像データを読み込めませんでした`);
  }

  return {
    id: newDraftId(file),
    fileName: file.name || "screenshot",
    contentType: normalized.contentType,
    dataBase64,
    previewUrl,
    size: normalized.size,
  };
}

export function toActionItemAttachmentPayloads(
  drafts: ActionItemAttachmentDraft[],
): ActionItemAttachmentPayload[] {
  return drafts.map(({ fileName, contentType, dataBase64 }) => ({ fileName, contentType, dataBase64 }));
}
