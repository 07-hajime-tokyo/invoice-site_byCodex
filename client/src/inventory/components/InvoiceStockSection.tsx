/**
 * InvoiceStockSection
 * 未完了インボイストグル内に表示する在庫一覧セクション。
 * Deliveries.tsx と同じ複数選択・販売価格サマリー・まとめて出庫UIを提供する。
 * 仕入れ情報（仕入れ金額・仕入れ先URL・追跡番号）も表示する。
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Boxes,
  Minus,
  Plus,
  PackageMinus,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buildSupplierDisplay } from "@/inventory/lib/supplier";

// ============================================================
// 型定義
// ============================================================
interface MatchedInventory {
  id: number;
  title: string;
  quantity: string;
  etc: string | null;
  unit_price: number | null;
  purchase_unit_price?: number | null;
  supplierUrl?: string | null;
  supplierName?: string | null;
  trackingNumber?: string | null;
  matchedCsvProduct: string;
}

interface CsvProduct {
  productName: string;
  orderQty: number;
  sellingPrice: number | null;
  currency: string;
}

interface DeliveryItem {
  inventoryId: number;
  title: string;
  quantity: number;
  unit: string;
  checked: boolean;
  etc?: string;
  sellingPrice: number | null;
  currency: string;
}

interface Props {
  invoiceNo: string;
  partner: string;
  csvProducts: CsvProduct[];
  matchedInventories: MatchedInventory[];
  csvRows: Array<{ invoiceNo: string; productName: string; sellingPrice: number | null; currency: string }>;
  onDeliverySuccess: () => void;
}

// ============================================================
// ヘルパー
// ============================================================
function getManagementNo(etc: string | null | undefined): string {
  if (!etc) return "";
  const firstPart = etc.split(",")[0].trim();
  const raw = firstPart.split(" ")[0].trim();
  if (/^\d/.test(raw) || /^在庫/.test(raw) || /^ebay/i.test(raw)) return raw;
  return "";
}

function extractPrefixFromManagementNo(etc: string | null | undefined): string | undefined {
  const managementNo = getManagementNo(etc);
  if (!managementNo) return undefined;
  const match = managementNo.match(/^(\d+)/);
  return match ? match[1] : undefined;
}

function generateDeliveryNo(customerCode: string, invoiceNo: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${invoiceNo}_${customerCode}${y}${m}${d}`;
}

function lookupSellingPrice(
  inv: MatchedInventory,
  invoiceNo: string,
  csvRows: Props["csvRows"]
): { sellingPrice: number | null; currency: string } {
  if (!csvRows || csvRows.length === 0) return { sellingPrice: null, currency: "EUR" };
  const prefix = extractPrefixFromManagementNo(inv.etc);
  const targetInvoiceNo = prefix ?? invoiceNo;
  const invoiceRowsForInv = csvRows.filter((r) => r.invoiceNo === targetInvoiceNo);
  if (invoiceRowsForInv.length === 0) return { sellingPrice: null, currency: "EUR" };
  const titleLower = inv.title.toLowerCase();
  const matched = invoiceRowsForInv.find((r) => {
    if (!r.productName) return false;
    const csvNameLower = r.productName.toLowerCase();
    return titleLower.includes(csvNameLower) || csvNameLower.includes(titleLower);
  });
  if (matched && matched.sellingPrice != null) {
    return { sellingPrice: matched.sellingPrice, currency: matched.currency || "EUR" };
  }
  const first = invoiceRowsForInv.find((r) => r.sellingPrice != null);
  if (first) return { sellingPrice: first.sellingPrice, currency: first.currency || "EUR" };
  return { sellingPrice: null, currency: "EUR" };
}

function formatPrice(price: number | undefined | null): string {
  if (price == null) return "-";
  return `¥${price.toLocaleString()}`;
}

// ============================================================
// コンポーネント
// ============================================================
export function InvoiceStockSection({
  invoiceNo,
  partner,
  csvProducts,
  matchedInventories,
  csvRows,
  onDeliverySuccess,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [deliveryItems, setDeliveryItems] = useState<Map<number, DeliveryItem>>(new Map());
  const [deliveryNo, setDeliveryNo] = useState("");
  const [customerCode, setCustomerCode] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // customers一覧を取得
  const { data: customers } = trpc.inventory.customer.list.useQuery();

  const createDeliveryMutation = trpc.inventory.zaico.createDelivery.useMutation();
  const utils = trpc.useUtils();

  // パートナー名からデフォルトcustomerCodeを判別
  const defaultCustomerCode = useMemo(() => {
    if (!customers) return "";
    const partnerLower = partner.toLowerCase();
    for (const c of customers) {
      const keywords = c.keywords.split(",").map((k: string) => k.trim().toLowerCase());
      if (keywords.some((kw: string) => partnerLower.includes(kw))) return c.code;
    }
    return "";
  }, [partner, customers]);

  // 管理番号から取引先コードを自動判別
  function detectCustomerCodeFromManagementNo(etc: string | null | undefined): string | null {
    if (!etc || !customers) return null;
    const managementNo = getManagementNo(etc);
    if (!managementNo) return null;
    const parts = managementNo.split("_");
    const partToMatch = parts.length >= 2 ? parts[1] : parts[0];
    for (const customer of customers) {
      const keywords = customer.keywords.split(",").map((k: string) => k.trim().toLowerCase());
      if (keywords.some((kw: string) => kw === partToMatch.toLowerCase())) return customer.code;
    }
    return null;
  }

  // チェック済み商品
  const checkedItems = useMemo(
    () => Array.from(deliveryItems.values()).filter((item) => item.checked),
    [deliveryItems]
  );

  // 初期customerCodeをpartnerから設定
  useEffect(() => {
    if (defaultCustomerCode && !customerCode) {
      setCustomerCode(defaultCustomerCode);
      setDeliveryNo(generateDeliveryNo(defaultCustomerCode, invoiceNo));
    }
  }, [defaultCustomerCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // チェック商品が変わったら取引先を自動判別（手動設定済みなら上書きしない）
  useEffect(() => {
    if (!customers || checkedItems.length === 0) return;
    if (customerCode) return;
    const detectedCodes = checkedItems
      .map((item) => detectCustomerCodeFromManagementNo(item.etc))
      .filter(Boolean);
    const uniqueCodes = Array.from(new Set(detectedCodes));
    if (uniqueCodes.length === 1 && uniqueCodes[0]) {
      setCustomerCode(uniqueCodes[0]);
      setDeliveryNo(generateDeliveryNo(uniqueCodes[0], invoiceNo));
    } else if (defaultCustomerCode) {
      setCustomerCode(defaultCustomerCode);
      setDeliveryNo(generateDeliveryNo(defaultCustomerCode, invoiceNo));
    }
  }, [checkedItems, customers]); // eslint-disable-line react-hooks/exhaustive-deps

  // 販売価格サマリー
  const sellingPriceSummary = useMemo(() => {
    const groups: Map<string, { sellingPrice: number; currency: string; totalQty: number }> = new Map();
    for (const item of checkedItems) {
      if (item.sellingPrice == null) continue;
      const key = item.title;
      const existing = groups.get(key);
      if (existing) {
        existing.totalQty += item.quantity;
      } else {
        groups.set(key, { sellingPrice: item.sellingPrice, currency: item.currency, totalQty: item.quantity });
      }
    }
    return Array.from(groups.entries()).map(([title, v]) => ({ title, ...v }));
  }, [checkedItems]);

  const totalQty = checkedItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = sellingPriceSummary.reduce((sum, s) => sum + s.sellingPrice * s.totalQty, 0);

  // 選択中のcustomerの情報
  const selectedCustomer = customers?.find((c) => c.code === customerCode);
  const isSamee = selectedCustomer
    ? selectedCustomer.code.toLowerCase().includes("samee") || selectedCustomer.displayName.includes("サミー")
    : partner.toLowerCase().includes("samee") || partner.includes("サミー");
  const currencySymbol = isSamee ? "$" : "€";
  const sheetName = isSamee ? "サミー発送管理" as const : "独発送管理" as const;

  // 出庫No自動生成（表示用プレースホルダー）
  const autoDeliveryNo = useMemo(() => {
    const code = customerCode || (isSamee ? "samee" : "luca");
    return generateDeliveryNo(code, invoiceNo);
  }, [customerCode, invoiceNo, isSamee]);

  // 全選択/全解除
  const allChecked = matchedInventories.length > 0 &&
    matchedInventories.every((inv) => {
      const stockQty = parseFloat(inv.quantity ?? "0");
      if (stockQty <= 0) return true; // 在庫0は無視
      return deliveryItems.get(inv.id)?.checked ?? false;
    });

  const toggleAll = useCallback(() => {
    const availableInvs = matchedInventories.filter((inv) => parseFloat(inv.quantity ?? "0") > 0);
    if (availableInvs.length === 0) return;
    setDeliveryItems((prev) => {
      const next = new Map(prev);
      if (allChecked) {
        // 全解除
        for (const inv of availableInvs) {
          const existing = next.get(inv.id);
          if (existing) next.set(inv.id, { ...existing, checked: false });
        }
      } else {
        // 全選択
        for (const inv of availableInvs) {
          const { sellingPrice, currency } = lookupSellingPrice(inv, invoiceNo, csvRows);
          const existing = next.get(inv.id);
          if (existing) {
            next.set(inv.id, { ...existing, checked: true });
          } else {
            next.set(inv.id, {
              inventoryId: inv.id,
              title: inv.title,
              quantity: 1,
              unit: "台",
              checked: true,
              etc: inv.etc ?? undefined,
              sellingPrice,
              currency: currency || (isSamee ? "USD" : "EUR"),
            });
          }
        }
      }
      return next;
    });
  }, [matchedInventories, allChecked, invoiceNo, csvRows, isSamee]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCheck = useCallback((inv: MatchedInventory) => {
    const stockQty = parseFloat(inv.quantity ?? "0");
    if (stockQty <= 0) return;
    const { sellingPrice, currency } = lookupSellingPrice(inv, invoiceNo, csvRows);
    setDeliveryItems((prev) => {
      const next = new Map(prev);
      const existing = next.get(inv.id);
      if (existing) {
        next.set(inv.id, { ...existing, checked: !existing.checked });
      } else {
        next.set(inv.id, {
          inventoryId: inv.id,
          title: inv.title,
          quantity: 1,
          unit: "台",
          checked: true,
          etc: inv.etc ?? undefined,
          sellingPrice,
          currency: currency || (isSamee ? "USD" : "EUR"),
        });
      }
      return next;
    });
  }, [invoiceNo, csvRows, isSamee]);

  const setQuantity = useCallback((invId: number, qty: number, inv: MatchedInventory) => {
    setDeliveryItems((prev) => {
      const next = new Map(prev);
      const existing = next.get(invId);
      if (existing) {
        next.set(invId, { ...existing, quantity: qty });
      } else {
        const { sellingPrice, currency } = lookupSellingPrice(inv, invoiceNo, csvRows);
        next.set(invId, {
          inventoryId: invId,
          title: inv.title,
          quantity: qty,
          unit: "台",
          etc: inv.etc ?? undefined,
          checked: false,
          sellingPrice,
          currency: currency || (isSamee ? "USD" : "EUR"),
        });
      }
      return next;
    });
  }, [invoiceNo, csvRows, isSamee]);

  function openConfirm() {
    if (checkedItems.length === 0) {
      toast.error("出庫する商品を選択してください");
      return;
    }
    const no = deliveryNo.trim() || autoDeliveryNo;
    setDeliveryNo(no);
    setShowConfirm(true);
  }

  async function handleBulkDelivery() {
    if (isSubmitting) return;
    setShowConfirm(false);
    setIsSubmitting(true);
    try {
      await createDeliveryMutation.mutateAsync({
        deliveryNo: deliveryNo.trim() || autoDeliveryNo,
        deliveryDate: new Date().toISOString().slice(0, 10),
        items: checkedItems.map((item) => ({
          inventoryId: item.inventoryId,
          title: item.title,
          quantity: item.quantity,
        })),
        sheetName,
        invoiceNo,
      });
      toast.success(`出庫No「${deliveryNo || autoDeliveryNo}」の出庫処理が完了しました（${checkedItems.length}件）`);
      setDeliveryItems(new Map());
      setDeliveryNo(autoDeliveryNo);
      utils.inventory.zaico.getInventories.invalidate();
      utils.inventory.orderManagement.getIncompleteInvoices.invalidate();
      onDeliverySuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "出庫処理に失敗しました";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="border-t border-border/40">
      {/* 在庫一覧トグルボタン */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
        onClick={() => setIsOpen((v) => !v)}
      >
        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Boxes className="h-3.5 w-3.5" />
        在庫一覧
        <Badge variant="secondary" className="text-xs ml-1">
          {matchedInventories.length}件
        </Badge>
        {checkedItems.length > 0 && (
          <Badge className="text-xs ml-1 bg-orange-500/10 text-orange-600 border-orange-200">
            {checkedItems.length}件選択中
          </Badge>
        )}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3">
          {/* 取引データ発注商品の参照 */}
          {csvProducts.length > 0 && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2 space-y-0.5">
              <div className="font-medium mb-1">発注商品（参照）</div>
              {csvProducts.map((p, i) => (
                <div key={i} className="flex justify-between">
                  <span>{p.productName}</span>
                  <span className="font-medium">
                    {p.orderQty}台
                    {p.sellingPrice != null && (
                      <span className="ml-2 text-amber-600">{p.sellingPrice}{currencySymbol}/台</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 在庫カード一覧ヘッダー（全選択ボタン） */}
          {matchedInventories.filter((inv) => parseFloat(inv.quantity ?? "0") > 0).length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleAll}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border/50 hover:bg-muted/40"
              >
                <Checkbox
                  checked={allChecked}
                  className="h-3.5 w-3.5 pointer-events-none"
                  aria-hidden
                />
                {allChecked ? "全解除" : "全選択"}
              </button>
              <span className="text-xs text-muted-foreground">
                {matchedInventories.filter((inv) => parseFloat(inv.quantity ?? "0") > 0).length}件
              </span>
            </div>
          )}
          {/* 在庫カード一覧 */}
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {matchedInventories.map((inv) => {
              const item = deliveryItems.get(inv.id);
              const isChecked = item?.checked ?? false;
              const qty = item?.quantity ?? 1;
              const stockQty = parseFloat(inv.quantity ?? "0");
              const isZeroStock = stockQty <= 0;
              const managementNo = getManagementNo(inv.etc);
              const { sellingPrice } = lookupSellingPrice(inv, invoiceNo, csvRows);
              const unitPrice = inv.purchase_unit_price ?? inv.unit_price;
              const hasSupplier = !!(inv.supplierUrl || inv.supplierName);

              return (
                <div
                  key={inv.id}
                  className={`rounded-lg border bg-card shadow-sm overflow-hidden ${isZeroStock ? "opacity-50" : ""}`}
                >
                  <div
                    className={`flex items-center gap-3 px-3 py-2.5 ${
                      isChecked ? "bg-primary/10" : "bg-muted/30"
                    }`}
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleCheck(inv)}
                      disabled={isZeroStock}
                      className="flex-shrink-0"
                    />
                    {/* チェック済み時の数量選択 */}
                    {isChecked && (
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setQuantity(inv.id, Math.max(1, qty - 1), inv)}
                          className="w-6 h-6 rounded border border-orange-300 flex items-center justify-center text-orange-600 hover:bg-orange-50 transition-colors"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={Math.floor(stockQty)}
                          value={qty}
                          onChange={(e) => {
                            const v = Math.min(Math.floor(stockQty), Math.max(1, Number(e.target.value)));
                            setQuantity(inv.id, v, inv);
                          }}
                          className="w-12 text-center text-sm font-semibold border border-orange-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white text-orange-700"
                        />
                        <button
                          type="button"
                          onClick={() => setQuantity(inv.id, Math.min(Math.floor(stockQty), qty + 1), inv)}
                          className="w-6 h-6 rounded border border-orange-300 flex items-center justify-center text-orange-600 hover:bg-orange-50 transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">/{Math.floor(stockQty)}台</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {managementNo && (
                          <span className="font-bold text-xs">管理番号: {managementNo}</span>
                        )}
                        <span className="text-sm font-medium truncate">{inv.title}</span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          在庫 {Math.floor(stockQty)}台
                        </Badge>
                        {sellingPrice != null && (
                          <span className="text-xs font-medium text-amber-600">
                            {sellingPrice}{currencySymbol}/台
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground opacity-60">
                          ({inv.matchedCsvProduct})
                        </span>
                      </div>
                      {/* 仕入れ情報 */}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {unitPrice != null && (
                          <span className="text-xs text-muted-foreground">
                            仕入: <span className="font-medium text-foreground">{formatPrice(unitPrice)}</span>
                          </span>
                        )}
                        {hasSupplier && (
                          <span className="text-xs">
                            {inv.supplierUrl ? (
                              <a
                                href={inv.supplierUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-700 hover:underline inline-flex items-center gap-0.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-2.5 w-2.5" />
                                {buildSupplierDisplay(inv.supplierUrl, inv.supplierName)}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">{buildSupplierDisplay(inv.supplierUrl, inv.supplierName)}</span>
                            )}
                          </span>
                        )}
                        {inv.trackingNumber && (
                          <span className="text-xs text-muted-foreground">
                            追跡: <span className="font-mono text-foreground">{inv.trackingNumber}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 取引相手プルダウン + 出庫No + まとめて出庫ボタン */}
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={customerCode}
              onValueChange={(v) => {
                setCustomerCode(v);
                setDeliveryNo(generateDeliveryNo(v, invoiceNo));
              }}
            >
              <SelectTrigger className="h-9 text-sm w-32 flex-shrink-0">
                <SelectValue placeholder="取引相手" />
              </SelectTrigger>
              <SelectContent>
                {customers?.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder={`出庫No（例: ${autoDeliveryNo}）`}
              value={deliveryNo}
              onChange={(e) => setDeliveryNo(e.target.value)}
              className="h-9 text-sm flex-1 min-w-0"
              disabled={isSubmitting}
            />
            <Button
              onClick={openConfirm}
              disabled={isSubmitting || checkedItems.length === 0}
              className="flex-shrink-0 bg-orange-600 hover:bg-orange-700 text-white h-9"
              size="sm"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <PackageMinus className="h-4 w-4 mr-1.5" />
              )}
              まとめて出庫
              {checkedItems.length > 0 && (
                <Badge className="ml-1.5 bg-white/20 text-white text-xs">
                  {checkedItems.length}
                </Badge>
              )}
            </Button>
          </div>

          {/* 販売価格サマリー */}
          {checkedItems.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 p-3 space-y-1.5">
              <div className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">出庫内容</div>
              {sellingPriceSummary.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-amber-700 dark:text-amber-400 truncate max-w-[60%]">{s.title}</span>
                  <span className="font-medium text-amber-800 dark:text-amber-300 whitespace-nowrap ml-2">
                    {s.totalQty}台 = {(s.sellingPrice * s.totalQty).toFixed(0)}{currencySymbol}（{s.sellingPrice}{currencySymbol}/台）
                  </span>
                </div>
              ))}
              <div className="border-t border-amber-200 dark:border-amber-700 pt-1.5 flex justify-between items-center">
                <span className="font-bold text-sm text-amber-800 dark:text-amber-300">
                  合計 {totalQty}台
                </span>
                {totalPrice > 0 && (
                  <span className="font-bold text-sm text-amber-800 dark:text-amber-300">
                    {totalPrice.toFixed(0)}{currencySymbol}
                  </span>
                )}
              </div>
            </div>
          )}

          {checkedItems.length === 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              出庫する商品をチェックしてください
            </p>
          )}
        </div>
      )}

      {/* 出庫確認ダイアログ */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>出庫確認</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              出庫No: <span className="font-mono font-bold">{deliveryNo || autoDeliveryNo}</span>
            </p>
            <p>
              インボイス: No.{invoiceNo} / {partner}
              {selectedCustomer && (
                <span className="ml-2 text-muted-foreground">→ {selectedCustomer.displayName}</span>
              )}
            </p>
            <div className="border rounded p-2 space-y-1">
              {checkedItems.map((item) => (
                <div key={item.inventoryId} className="flex justify-between text-xs">
                  <span className="truncate max-w-[60%]">{item.title}</span>
                  <span className="font-medium">
                    {item.quantity}台
                    {item.sellingPrice != null ? ` = ${(item.sellingPrice * item.quantity).toFixed(0)}${currencySymbol}` : ""}
                  </span>
                </div>
              ))}
            </div>
            <p className="font-bold">
              合計 {totalQty}台
              {totalPrice > 0 ? ` / ${totalPrice.toFixed(0)}${currencySymbol}` : ""}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowConfirm(false)}>キャンセル</Button>
            <Button
              size="sm"
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={handleBulkDelivery}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              出庫登録
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
