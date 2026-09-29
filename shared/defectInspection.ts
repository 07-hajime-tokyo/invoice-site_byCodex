/** 不良検品の選択肢と写真形式。画面入力・API検証・端末保存で共用する。 */
export const DEFECT_TAGS = [
  "通電せず",
  "起動しない",
  "画面不良",
  "バッテリー不良",
  "充電不可",
  "ボタン・スティック不良",
  "外装破損",
  "付属品欠品",
  "その他",
] as const;

export const DEFECT_PHOTO_KINDS = ["whole", "defect", "accessory"] as const;

export type DefectTag = (typeof DEFECT_TAGS)[number];
export type DefectPhotoKind = (typeof DEFECT_PHOTO_KINDS)[number];
export type DefectPhoto = { url: string; key: string; kind: DefectPhotoKind };
