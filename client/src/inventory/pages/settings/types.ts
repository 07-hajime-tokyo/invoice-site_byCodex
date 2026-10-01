// 取引先行の型
export type CustomerRow = {
  id: number;
  displayName: string;
  code: string;
  keywords: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

// 国内卸商品マスタ行の型
export type DomesticProductRow = {
  id: number;
  title: string;
  unitPrice: string | null;
  supplierName: string | null;
  note: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};
