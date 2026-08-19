import sharp from "sharp";
import { putListingPhoto } from "./listingPhotoStorage";
import type { DefectPhoto, DefectPhotoKind } from "./defectiveListing";

export type DefectPhotoUpload = {
  base64: string;
  mimeType: string;
  kind: DefectPhotoKind;
};

function decodeBase64(value: string) {
  const comma = value.indexOf(",");
  const raw =
    value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
  return Buffer.from(raw, "base64");
}

export async function convertDefectivePhotoToJpeg(source: Buffer) {
  return sharp(source, { failOn: "none" })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

export function buildDefectivePhotoKey(labelId: string, index: number) {
  return `defective/${labelId.trim().toUpperCase()}/${String(index + 1).padStart(2, "0")}.jpg`;
}

/**
 * 写真を保存してキーを返す。
 *
 * startIndex は「その個体に既に何枚あるか」。既存枚数を渡さないと 01.jpg から
 * 採番し直してしまい、あとから足した1枚が既存の1枚目を上書きする。
 * 2026-08-18にこれが起きて、同じ写真が2枚並んだ状態になった。
 */
export async function uploadDefectivePhotos(
  labelId: string,
  uploads: readonly DefectPhotoUpload[],
  storagePutImpl: typeof putListingPhoto = putListingPhoto,
  startIndex = 0
): Promise<DefectPhoto[]> {
  const normalizedId = labelId.trim().toUpperCase();
  const photos: DefectPhoto[] = [];
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    const source = decodeBase64(upload.base64);
    let body = source;
    let contentType = upload.mimeType || "application/octet-stream";
    try {
      body = await convertDefectivePhotoToJpeg(source);
      contentType = "image/jpeg";
    } catch (error) {
      console.warn(
        "[defective-photo] JPEG conversion failed; storing original bytes",
        {
          labelId: normalizedId,
          index: index + 1,
          mimeType: upload.mimeType,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
    const key = buildDefectivePhotoKey(normalizedId, startIndex + index);
    const url = await storagePutImpl(key, body, contentType);
    photos.push({ url, key, kind: upload.kind });
  }
  return photos;
}
