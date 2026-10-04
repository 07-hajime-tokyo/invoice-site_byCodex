import { fileAsBase64 } from "@/inventory/components/DefectiveInspectionDialog";

export function yen(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value).toLocaleString("ja-JP")}円`;
}

export function photoKindFor(index: number) {
  return index === 0 ? "whole" : index === 1 ? "defect" : "accessory";
}

export async function filesToPayload(files: File[]) {
  return Promise.all(
    files.map(async (file, index) => ({
      base64: await fileAsBase64(file),
      mimeType: file.type || "image/jpeg",
      kind: photoKindFor(index) as "whole" | "defect" | "accessory",
    }))
  );
}

