export type PdfLogoImage = {
  dataUrl: string;
  format: "PNG" | "JPEG";
};

export function detectPdfLogoFormat(mimeType: string, url: string): PdfLogoImage["format"] | null {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "image/png") return "PNG";
  if (mime === "image/jpeg" || mime === "image/jpg") return "JPEG";

  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".png")) return "PNG";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "JPEG";
  return null;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Logo image could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Logo image could not be read."));
    reader.readAsDataURL(blob);
  });
}

export async function loadPdfLogoImage(logoUrl?: string | null): Promise<PdfLogoImage | null> {
  if (!logoUrl?.trim()) return null;
  try {
    const resp = await fetch(logoUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const format = detectPdfLogoFormat(blob.type || "", logoUrl);
    if (!format) {
      console.warn("Skipping unsupported invoice logo format", { mimeType: blob.type, logoUrl });
      return null;
    }
    return { dataUrl: await blobToDataUrl(blob), format };
  } catch (error) {
    console.warn("Skipping invoice logo because it could not be loaded", error);
    return null;
  }
}

