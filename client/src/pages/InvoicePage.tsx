/**
 * InvoicePage — 請求書発行・管理ページ
 * Features:
 *   - WhatsAppチャット貼り付け → 自動解析 → 請求書生成
 *   - 請求書の編集・保存・削除
 *   - 宛先（クライアント）管理
 *   - freeinvoicebuilder風プレビュー
 *   - PDF出力（印刷ダイアログ）
 *   - 通貨/合計の表示/非表示切替
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  Trash2,
  Pencil,
  Eye,
  Printer,
  MessageSquare,
  Users,
  FileText,
  ChevronLeft,
  X,
  GripVertical,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Save,
  Settings,
  Upload,
  Download,
  Send,
  Copy,
  Sparkles,
  CheckCheck,
  FileDown,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface InvoiceItem {
  description: string;
  subText?: string; // 商品名の下に表示するサブテキスト（種類・カラー等）
  quantity: number;
  unitPrice: number;
  currency?: string;
  sortOrder?: number;
  tax?: number; // tax rate 0-100
}

interface InvoiceFormData {
  invoiceNumber: string;
  clientId: number | null;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  showAmounts: boolean;
  notes: string;
  rawChat: string;
  status: "draft" | "sent" | "paid";
  accentColor: string;
  items: InvoiceItem[];
}

// ─── Sender Settings Dialog ──────────────────────────────────────────────────
function SenderSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: settings } = trpc.invoiceSettings.get.useQuery();
  const [form, setForm] = useState({
    senderName: "",
    senderCompany: "",
    senderEmail: "",
    senderPhone: "",
    senderAddress: "",
    senderCity: "",
    senderCountry: "",
    senderExtraInfo: "",
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<{ base64: string; mimeType: string; fileName: string } | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const uploadLogoMutation = trpc.invoiceSettings.uploadLogo.useMutation();

  const saveMutation = trpc.invoiceSettings.save.useMutation({
    onSuccess: () => {
      utils.invoiceSettings.get.invalidate();
      toast.success("差出人情報を保存しました");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  // Initialize form from settings when dialog opens
  const [initialized, setInitialized] = useState(false);
  if (open && settings && !initialized) {
    setInitialized(true);
    setForm({
      senderName: settings.senderName ?? "",
      senderCompany: settings.senderCompany ?? "",
      senderEmail: settings.senderEmail ?? "",
      senderPhone: settings.senderPhone ?? "",
      senderAddress: settings.senderAddress ?? "",
      senderCity: settings.senderCity ?? "",
      senderCountry: settings.senderCountry ?? "",
      senderExtraInfo: (settings as { senderExtraInfo?: string | null }).senderExtraInfo ?? "",
    });
    if (settings.logoUrl) setLogoPreview(settings.logoUrl);
  }
  if (!open && initialized) { setInitialized(false); setLogoFile(null); }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("画像サイズは2MB以下にしてください"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setLogoPreview(dataUrl);
      const base64 = dataUrl.split(",")[1];
      setLogoFile({ base64, mimeType: file.type, fileName: file.name });
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setIsUploadingLogo(true);
    try {
      let logoUrl: string | undefined;
      let logoKey: string | undefined;
      if (logoFile) {
        const result = await uploadLogoMutation.mutateAsync(logoFile);
        logoUrl = result.url;
        logoKey = result.key;
      }
      saveMutation.mutate({ ...form, ...(logoUrl ? { logoUrl, logoKey } : {}) });
    } catch {
      toast.error("ロゴのアップロードに失敗しました");
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const isSaving = saveMutation.isPending || isUploadingLogo;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings size={16} /> 差出人情報の設定</DialogTitle>
          <DialogDescription>請求書に表示される差出人（From）のデフォルト情報を設定します。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {/* Logo upload */}
          <div>
            <Label className="text-xs">会社ロゴ（インボイスに表示）</Label>
            <div className="mt-1 flex items-center gap-3">
              <div
                className="w-16 h-16 border-2 border-dashed border-border rounded-lg flex items-center justify-center bg-muted/30 overflow-hidden cursor-pointer hover:border-primary/50 transition-colors flex-shrink-0"
                onClick={() => logoInputRef.current?.click()}
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo preview" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-muted-foreground text-xs text-center px-1">ロゴ</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => logoInputRef.current?.click()}
                >
                  <Upload size={11} /> 画像を選択
                </Button>
                {logoPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => { setLogoPreview(null); setLogoFile(null); }}
                  >
                    削除
                  </Button>
                )}
                <p className="text-[10px] text-muted-foreground">PNG/JPG, 2MB以下</p>
              </div>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={handleLogoChange}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">名前</Label>
              <Input value={form.senderName} onChange={e => setForm(f => ({ ...f, senderName: e.target.value }))} placeholder="例: 村上 肥" className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">会社名</Label>
              <Input value={form.senderCompany} onChange={e => setForm(f => ({ ...f, senderCompany: e.target.value }))} placeholder="例: Murakami Trading" className="h-8 text-sm mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">メール</Label>
              <Input value={form.senderEmail} onChange={e => setForm(f => ({ ...f, senderEmail: e.target.value }))} placeholder="example@email.com" className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">電話</Label>
              <Input value={form.senderPhone} onChange={e => setForm(f => ({ ...f, senderPhone: e.target.value }))} placeholder="+81 ..." className="h-8 text-sm mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">住所</Label>
            <Input value={form.senderAddress} onChange={e => setForm(f => ({ ...f, senderAddress: e.target.value }))} placeholder="Street, Number" className="h-8 text-sm mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">都市</Label>
              <Input value={form.senderCity} onChange={e => setForm(f => ({ ...f, senderCity: e.target.value }))} placeholder="Tokyo" className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">国</Label>
              <Input value={form.senderCountry} onChange={e => setForm(f => ({ ...f, senderCountry: e.target.value }))} placeholder="Japan" className="h-8 text-sm mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">追加情報 <span className="text-muted-foreground font-normal">(税関番号・登録番号など)</span></Label>
            <textarea
              value={form.senderExtraInfo}
              onChange={e => setForm(f => ({ ...f, senderExtraInfo: e.target.value }))}
              placeholder="例: 税関登録番号: EORI-12345&#10;消費税登録番号: JP-67890"
              className="w-full mt-1 text-sm border border-border rounded-md px-3 py-2 bg-background resize-y min-h-[72px]"
            />
            <p className="text-[10px] text-muted-foreground mt-1">請求書の差出人欄（JAPANの下）に表示されます</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>キャンセル</Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <RefreshCw size={12} className="animate-spin mr-1" /> : null}
            保存する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 発行日から1ヶ月後（同日-1日）の日付を計算する
function calcDueDate(issueDateStr: string): string {
  if (!issueDateStr) return "";
  const d = new Date(issueDateStr);
  // 翌月の同日から1日引く（例: 3/25 → 4/24）
  d.setMonth(d.getMonth() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

const EMPTY_FORM: InvoiceFormData = {
  invoiceNumber: "",
  clientId: null,
  invoiceDate: TODAY,
  dueDate: calcDueDate(TODAY),
  currency: "EUR",
  showAmounts: true,
  notes: "",
  rawChat: "",
  status: "draft",
  accentColor: "#db8b1a",
  items: [],
};

type InvoiceClientOption = {
  id: number;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
};

function getDefaultCurrencyForClient(client: { name?: string | null; company?: string | null } | null | undefined) {
  const text = `${client?.name ?? ""} ${client?.company ?? ""}`.normalize("NFKC").toLowerCase();
  return text.includes("luca") || text.includes("ルカ") ? "EUR" : "USD";
}

function normalizeClientLookupText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^~\s*/, "")
    .replace(/[^\p{L}\p{N}@+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phoneDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function findClientByDetectedSender(clients: InvoiceClientOption[], detectedSender: string | null | undefined) {
  const sender = normalizeClientLookupText(detectedSender);
  if (!sender) return null;
  const senderDigits = phoneDigits(sender);

  return clients.find((client) => {
    const candidates = [client.name, client.company, client.email]
      .map(normalizeClientLookupText)
      .filter(Boolean);
    const textMatch = candidates.some((candidate) =>
      candidate.length >= 2 && (sender.includes(candidate) || candidate.includes(sender))
    );
    if (textMatch) return true;

    const clientDigits = phoneDigits(client.phone);
    return Boolean(
      senderDigits.length >= 7 &&
      clientDigits.length >= 7 &&
      (senderDigits.includes(clientDigits) || clientDigits.includes(senderDigits))
    );
  }) ?? null;
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "下書き", className: "bg-gray-100 text-gray-600 border-gray-200" },
    sent: { label: "送付済み", className: "bg-blue-50 text-blue-600 border-blue-200" },
    paid: { label: "支払済み", className: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  };
  const s = map[status] ?? map.draft;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.className}`}>
      {s.label}
    </span>
  );
}

// ─── Client Manager Dialog ────────────────────────────────────────────────────
function ClientManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: clients = [], isLoading } = trpc.invoiceClients.list.useQuery();
  const [editingClient, setEditingClient] = useState<typeof clients[0] | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", address: "", city: "", country: "", notes: "", extraInfo: "" });

  const createMutation = trpc.invoiceClients.create.useMutation({
    onSuccess: () => {
      utils.invoiceClients.list.invalidate();
      setIsCreating(false);
      setForm({ name: "", company: "", email: "", phone: "", address: "", city: "", country: "", notes: "", extraInfo: "" });
      toast.success("宛先を登録しました");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.invoiceClients.update.useMutation({
    onSuccess: () => {
      utils.invoiceClients.list.invalidate();
      setEditingClient(null);
      toast.success("宛先を更新しました");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.invoiceClients.delete.useMutation({
    onSuccess: () => {
      utils.invoiceClients.list.invalidate();
      toast.success("宛先を削除しました");
    },
    onError: (e) => toast.error(e.message),
  });

  const startEdit = (c: typeof clients[0]) => {
    setEditingClient(c);
    setForm({
      name: c.name,
      company: c.company ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      city: c.city ?? "",
      country: c.country ?? "",
      notes: c.notes ?? "",
      extraInfo: (c as { extraInfo?: string | null }).extraInfo ?? "",
    });
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("名前は必須です"); return; }
    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const ClientForm = () => (
    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">名前 *</Label>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例: Luca" className="h-8 text-sm mt-1" />
        </div>
        <div>
          <Label className="text-xs">会社名</Label>
          <Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="例: ABC GmbH" className="h-8 text-sm mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">メール</Label>
          <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="example@email.com" className="h-8 text-sm mt-1" />
        </div>
        <div>
          <Label className="text-xs">電話</Label>
          <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+49 177 ..." className="h-8 text-sm mt-1" />
        </div>
      </div>
      <div>
        <Label className="text-xs">住所</Label>
        <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Street, Number" className="h-8 text-sm mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">都市</Label>
          <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Berlin" className="h-8 text-sm mt-1" />
        </div>
        <div>
          <Label className="text-xs">国</Label>
          <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="Germany" className="h-8 text-sm mt-1" />
        </div>
      </div>
      <div>
        <Label className="text-xs">追加情報 <span className="text-muted-foreground font-normal">(税関番号・登録番号など)</span></Label>
        <textarea
          value={form.extraInfo}
          onChange={e => setForm(f => ({ ...f, extraInfo: e.target.value }))}
          placeholder="例: EORI: DE123456789&#10;税関登録番号: ..."
          className="w-full mt-1 text-sm border border-border rounded-md px-3 py-2 bg-background resize-y min-h-[60px]"
        />
        <p className="text-[10px] text-muted-foreground mt-1">請求書の宛先欄（国名の下）に表示されます</p>
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="h-8">
          {(createMutation.isPending || updateMutation.isPending) ? <RefreshCw size={12} className="animate-spin mr-1" /> : <Save size={12} className="mr-1" />}
          保存
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setIsCreating(false); setEditingClient(null); }} className="h-8">キャンセル</Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users size={16} />
            宛先管理
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            請求書の送付先（クライアント）を登録・管理します。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {(isCreating && !editingClient) && <ClientForm />}

          {!isCreating && !editingClient && (
            <Button size="sm" onClick={() => { setIsCreating(true); setForm({ name: "", company: "", email: "", phone: "", address: "", city: "", country: "", notes: "", extraInfo: "" }); }} className="h-8">
              <Plus size={12} className="mr-1" /> 新規宛先を追加
            </Button>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={16} className="animate-spin text-muted-foreground" />
            </div>
          ) : clients.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">宛先が登録されていません</p>
          ) : (
            <div className="space-y-2">
              {clients.map(c => (
                <div key={c.id}>
                  {editingClient?.id === c.id ? (
                    <ClientForm />
                  ) : (
                    <div className="flex items-start justify-between p-3 bg-background border border-border rounded-lg hover:bg-muted/30 transition-colors">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{c.name}</p>
                        {c.company && <p className="text-xs text-muted-foreground">{c.company}</p>}
                        {(c.address || c.city || c.country) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {[c.address, c.city, c.country].filter(Boolean).join(", ")}
                          </p>
                        )}
                        {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                        {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                      </div>
                      <div className="flex gap-1 ml-2 flex-shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(c)}>
                          <Pencil size={12} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => {
                          if (confirm(`「${c.name}」を削除しますか？`)) deleteMutation.mutate({ id: c.id });
                        }}>
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invoice Preview (print-ready) ───────────────────────────────────────────
function InvoicePreview({
  form,
  clientData,
  senderSettings,
}: {
  form: InvoiceFormData;
  clientData: { name: string; company?: string | null; email?: string | null; phone?: string | null; address?: string | null; city?: string | null; country?: string | null; notes?: string | null; extraInfo?: string | null } | null;
  senderSettings: {
    senderName?: string | null;
    senderCompany?: string | null;
    senderEmail?: string | null;
    senderPhone?: string | null;
    senderAddress?: string | null;
    senderCity?: string | null;
    senderCountry?: string | null;
    logoUrl?: string | null;
    taxRate?: string | null;
    senderExtraInfo?: string | null;
  } | null;
}) {
  const accent = form.accentColor || "#db8b1a";
  const currencySymbol = form.currency === "USD" ? "$" : form.currency === "EUR" ? "€" : form.currency === "GBP" ? "£" : form.currency === "JPY" ? "¥" : form.currency;
  const fmt = (n: number) => {
    if (form.currency === "JPY") return n.toLocaleString();
    return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  const subtotal = form.items.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
  const taxTotal = form.items.reduce((s, item) => {
    const rate = (item.tax ?? 0) / 100;
    return s + item.quantity * item.unitPrice * rate;
  }, 0);
  const total = subtotal + taxTotal;

  return (
    <div
      className="invoice-preview"
      style={{
        fontFamily: "'Lato', 'Helvetica Neue', Arial, sans-serif",
        minHeight: "297mm",
        fontSize: "13px",
        lineHeight: "1.6",
        overflow: "hidden",
        // Explicit colors to avoid oklch() which html2canvas cannot parse
        backgroundColor: "#ffffff",
        color: "#111827",
      }}
    >
      {/* ── Top color bar ── */}
      <div style={{ height: "8px", background: `linear-gradient(90deg, ${accent} 0%, ${accent}99 100%)` }} />

      <div style={{ padding: "40px 56px 48px" }}>
      {/* ── Header: Logo + Company | Invoice title ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "40px" }}>
        {/* Left: logo + company */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          {senderSettings?.logoUrl ? (
            <img
              src={senderSettings.logoUrl}
              alt="Logo"
              style={{ width: "72px", height: "72px", objectFit: "contain", borderRadius: "8px", flexShrink: 0 }}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {senderSettings?.senderCompany && (
              <p style={{ fontSize: "20px", fontWeight: 700, color: "#111", margin: 0, lineHeight: 1.2 }}>{senderSettings.senderCompany}</p>
            )}
            {senderSettings?.senderName && !senderSettings?.senderCompany && (
              <p style={{ fontSize: "20px", fontWeight: 700, color: "#111", margin: 0, lineHeight: 1.2 }}>{senderSettings.senderName}</p>
            )}
          </div>
        </div>
        {/* Right: Invoice number + dates */}
        <div style={{ textAlign: "right" }}>
          <h1 style={{ fontSize: "44px", fontWeight: 800, color: accent, margin: "0 0 6px 0", letterSpacing: "-1.5px" }}>
            Invoice: {form.invoiceNumber.replace(/^INV-\d{8}-/, "") || form.invoiceNumber}
          </h1>
          {form.invoiceDate && (
            <p style={{ fontSize: "12px", color: "#666", margin: "2px 0" }}>Issued on: {form.invoiceDate}</p>
          )}
          {form.dueDate && (
            <p style={{ fontSize: "12px", color: "#666", margin: "2px 0" }}>Due by: {form.dueDate}</p>
          )}
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ height: "2px", background: `linear-gradient(90deg, ${accent} 0%, #e5e7eb 100%)`, marginBottom: "32px" }} />

      {/* ── From / To ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px", marginBottom: "40px" }}>
        {/* From */}
        <div>
          <p style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: accent, marginBottom: "10px", borderBottom: `2px solid ${accent}`, paddingBottom: "4px", display: "inline-block" }}>From</p>
          {senderSettings?.senderCompany && <p style={{ margin: "2px 0" }}>{senderSettings.senderCompany}</p>}
          {senderSettings?.senderName && <p style={{ margin: "2px 0" }}>{senderSettings.senderName}</p>}
          {senderSettings?.senderAddress && <p style={{ margin: "2px 0" }}>{senderSettings.senderAddress}</p>}
          {(senderSettings?.senderCity || senderSettings?.senderCountry) && (
            <p style={{ margin: "2px 0" }}>
              {[senderSettings?.senderCity, senderSettings?.senderCountry].filter(Boolean).join(" ")}
            </p>
          )}
          {senderSettings?.senderEmail && <p style={{ margin: "2px 0" }}>{senderSettings.senderEmail}</p>}
          {senderSettings?.senderPhone && <p style={{ margin: "2px 0" }}>{senderSettings.senderPhone}</p>}
          {senderSettings?.senderExtraInfo && senderSettings.senderExtraInfo.split("\n").map((line, i) => (
            <p key={i} style={{ margin: "2px 0" }}>{line}</p>
          ))}
          {!senderSettings?.senderName && !senderSettings?.senderCompany && (
            <p style={{ color: "#aaa", fontStyle: "italic" }}>差出人未設定</p>
          )}
        </div>
        {/* To */}
        <div>
          <p style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: accent, marginBottom: "10px", borderBottom: `2px solid ${accent}`, paddingBottom: "4px", display: "inline-block" }}>To</p>
          {clientData ? (
            <>
              {clientData.company && <p style={{ margin: "2px 0" }}>{clientData.company}</p>}
              {clientData.name && <p style={{ margin: "2px 0" }}>{clientData.name}</p>}
              {clientData.address && <p style={{ margin: "2px 0" }}>{clientData.address}</p>}
              {(clientData.city || clientData.country) && (
                <p style={{ margin: "2px 0" }}>
                  {[clientData.city, clientData.country].filter(Boolean).join(" ")}
                </p>
              )}
              {clientData.email && <p style={{ margin: "2px 0" }}>{clientData.email}</p>}
              {clientData.phone && <p style={{ margin: "2px 0" }}>{clientData.phone}</p>}
              {clientData.notes && <p style={{ margin: "2px 0" }}>{clientData.notes}</p>}
              {clientData.extraInfo && clientData.extraInfo.split("\n").map((line, i) => (
                <p key={i} style={{ margin: "2px 0" }}>{line}</p>
              ))}
            </>
          ) : (
            <p style={{ color: "#aaa", fontStyle: "italic" }}>宛先未選択</p>
          )}
        </div>
      </div>

      {/* ── Items table ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "32px" }}>
        <thead>
          <tr style={{ backgroundColor: "#f0f0f0" }}>
            <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, fontSize: "13px", color: "#333" }}>Product</th>
            <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 600, fontSize: "13px", color: "#333", width: "80px" }}>Quantity</th>
            {form.showAmounts && (
              <>
                <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, fontSize: "13px", color: "#333", width: "110px" }}>Unit Price</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, fontSize: "13px", color: "#333", width: "80px" }}>Tax</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, fontSize: "13px", color: "#333", width: "110px" }}>Total</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {form.items.length === 0 ? (
            <tr>
              <td colSpan={form.showAmounts ? 5 : 2} style={{ padding: "24px", textAlign: "center", color: "#aaa", fontStyle: "italic" }}>
                明細がありません
              </td>
            </tr>
          ) : (
            form.items.map((item, i) => {
              const lineTotal = item.quantity * item.unitPrice;
              const taxRate = item.tax ?? 0;
              return (
                <tr key={i} style={{ borderBottom: "1px solid #e5e5e5" }}>
                  <td style={{ padding: "14px 12px" }}>
                    <p style={{ fontWeight: 700, margin: 0 }}>{item.description}</p>
                    {item.subText && (
                      <p style={{ margin: 0, fontSize: "11px", color: "#888", marginTop: "2px" }}>{item.subText}</p>
                    )}
                  </td>
                  <td style={{ padding: "14px 12px", textAlign: "center" }}>{item.quantity}</td>
                  {form.showAmounts && (
                    <>
                      <td style={{ padding: "14px 12px", textAlign: "right" }}>{currencySymbol} {fmt(item.unitPrice)}</td>
                      <td style={{ padding: "14px 12px", textAlign: "right" }}>{taxRate > 0 ? `${taxRate}%` : "—"}</td>
                      <td style={{ padding: "14px 12px", textAlign: "right", fontWeight: 600 }}>{currencySymbol} {fmt(lineTotal)}</td>
                    </>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* ── Invoice Summary (right-aligned) ── */}
      {form.showAmounts && form.items.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "32px" }}>
          <div style={{ minWidth: "240px" }}>
            {/* Summary header */}
            <div style={{
              backgroundColor: "#f0f0f0",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              borderRadius: "4px 4px 0 0",
            }}>
              {/* Bar chart icon */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="12" width="4" height="9" rx="1" fill="#555"/>
                <rect x="10" y="7" width="4" height="14" rx="1" fill="#555"/>
                <rect x="17" y="3" width="4" height="18" rx="1" fill="#555"/>
              </svg>
              <span style={{ fontWeight: 700, fontSize: "14px", color: "#222" }}>Invoice Summary</span>
            </div>
            {/* Summary rows */}
            <div style={{ border: "1px solid #e5e5e5", borderTop: "none", borderRadius: "0 0 4px 4px", overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ color: "#555" }}>Subtotal</span>
                <span>{currencySymbol} {fmt(subtotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ color: "#555" }}>Tax</span>
                <span>{currencySymbol} {fmt(taxTotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", fontWeight: 700 }}>
                <span>Total</span>
                <span>{currencySymbol} {fmt(total)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {form.notes && (
        <div style={{ borderTop: "1px solid #e5e5e5", paddingTop: "20px", marginBottom: "20px" }}>
          <p style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: "6px" }}>備考</p>
          <p style={{ color: "#555", whiteSpace: "pre-wrap", margin: 0 }}>{form.notes}</p>
        </div>
      )}

      {/* Page number footer removed */}
      </div>{/* end inner padding div */}
    </div>
  );
}

// ─── PDF Generation Utility ──────────────────────────────────────────────────
type SenderSettingsData = {
  logoUrl?: string | null;
  senderCompany?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  senderCity?: string | null;
  senderCountry?: string | null;
  senderEmail?: string | null;
  senderPhone?: string | null;
  senderExtraInfo?: string | null;
} | null;

async function generateInvoicePdf(
  form: InvoiceFormData,
  selectedClient: { company?: string | null; name: string; address?: string | null; city?: string | null; country?: string | null; email?: string | null; phone?: string | null; notes?: string | null; extraInfo?: string | null } | null,
  senderSettings: SenderSettingsData
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const currencySymbol = form.currency === "USD" ? "$" : form.currency === "EUR" ? "€" : form.currency === "GBP" ? "£" : form.currency === "JPY" ? "¥" : form.currency;
  const fmt = (n: number) => {
    if (form.currency === "JPY") return n.toLocaleString();
    return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  const subtotal = form.items.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
  const taxTotal = form.items.reduce((s, item) => {
    const rate = (item.tax ?? 0) / 100;
    return s + item.quantity * item.unitPrice * rate;
  }, 0);
  const total = subtotal + taxTotal;

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  const hexToRgb = (hex: string): [number, number, number] => {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return [isNaN(r) ? 26 : r, isNaN(g) ? 86 : g, isNaN(b) ? 219 : b];
  };
  const accentRgb = hexToRgb(form.accentColor || "#db8b1a");

  let logoBase64: string | null = null;
  let logoMime = "image/png";
  if (senderSettings?.logoUrl) {
    try {
      const resp = await fetch(senderSettings.logoUrl);
      const blob = await resp.blob();
      logoMime = blob.type || "image/png";
      const ab = await blob.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let binary = "";
      bytes.forEach(b => { binary += String.fromCharCode(b); });
      logoBase64 = btoa(binary);
    } catch {
      logoBase64 = null;
    }
  }

  pdf.setFillColor(...accentRgb);
  pdf.rect(0, 0, pageW, 6, "F");
  y = 16;

  const logoSize = 18;
  const logoX = margin;
  const logoTopY = y - 2;
  if (logoBase64) {
    pdf.addImage(logoBase64, logoMime, logoX, logoTopY, logoSize, logoSize);
  }
  const companyX = logoBase64 ? logoX + logoSize + 4 : margin;
  const companyName = senderSettings?.senderCompany || senderSettings?.senderName || "";
  if (companyName) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(30, 30, 30);
    const fontHeightMm = 13 * 0.352778 * 0.7;
    const companyCenterY = logoTopY + logoSize / 2 + fontHeightMm / 2;
    pdf.text(companyName, companyX, companyCenterY);
  }

  const invoiceNumDisplay = form.invoiceNumber.replace(/^INV-\d{8}-/, "") || form.invoiceNumber;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(26);
  pdf.setTextColor(...accentRgb);
  pdf.text(`Invoice: ${invoiceNumDisplay}`, pageW - margin, y + 6, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(100, 100, 100);
  if (form.invoiceDate) pdf.text(`Issued on: ${form.invoiceDate}`, pageW - margin, y + 13, { align: "right" });
  if (form.dueDate) pdf.text(`Due by: ${form.dueDate}`, pageW - margin, y + 18, { align: "right" });

  y += Math.max(logoSize + 4, 22);

  pdf.setDrawColor(...accentRgb);
  pdf.setLineWidth(0.5);
  pdf.line(margin, y, pageW - margin, y);
  y += 8;

  const colW = (pageW - margin * 2 - 10) / 2;
  const fromX = margin;
  const toX = margin + colW + 10;
  const fromToY = y;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(...accentRgb);
  pdf.text("FROM", fromX, fromToY);
  pdf.setDrawColor(...accentRgb);
  pdf.setLineWidth(0.4);
  pdf.line(fromX, fromToY + 1, fromX + 14, fromToY + 1);
  pdf.text("TO", toX, fromToY);
  pdf.line(toX, fromToY + 1, toX + 8, fromToY + 1);

  let fromY = fromToY + 6;
  let toY = fromToY + 6;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(40, 40, 40);
  const fromLines: string[] = [];
  if (senderSettings?.senderCompany) fromLines.push(senderSettings.senderCompany);
  if (senderSettings?.senderName) fromLines.push(senderSettings.senderName);
  if (senderSettings?.senderAddress) fromLines.push(senderSettings.senderAddress);
  if (senderSettings?.senderCity) fromLines.push(senderSettings.senderCity);
  if (senderSettings?.senderCountry) fromLines.push(senderSettings.senderCountry);
  if (senderSettings?.senderEmail) fromLines.push(senderSettings.senderEmail);
  if (senderSettings?.senderPhone) fromLines.push(senderSettings.senderPhone);
  if (senderSettings?.senderExtraInfo) {
    senderSettings.senderExtraInfo.split("\n").forEach(l => { if (l.trim()) fromLines.push(l); });
  }
  fromLines.forEach((line, i) => {
    pdf.text(line, fromX, fromY + i * 5, { maxWidth: colW });
  });
  fromY += fromLines.length * 5;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(40, 40, 40);
  if (selectedClient) {
    const toLines: string[] = [];
    if (selectedClient.company) toLines.push(selectedClient.company);
    if (selectedClient.name) toLines.push(selectedClient.name);
    if (selectedClient.address) toLines.push(selectedClient.address);
    if (selectedClient.city) toLines.push(selectedClient.city);
    if (selectedClient.country) toLines.push(selectedClient.country);
    if (selectedClient.email) toLines.push(selectedClient.email);
    if (selectedClient.phone) toLines.push(selectedClient.phone);
    if (selectedClient.notes) {
      selectedClient.notes.split("\n").forEach(l => { if (l.trim()) toLines.push(l); });
    }
    if (selectedClient.extraInfo) {
      selectedClient.extraInfo.split("\n").forEach(l => { if (l.trim()) toLines.push(l); });
    }
    toLines.forEach((line, i) => {
      pdf.text(line, toX, toY + i * 5, { maxWidth: colW });
    });
    toY += toLines.length * 5;
  }

  y = Math.max(fromY, toY) + 10;

  const tableHead = form.showAmounts
    ? [["Product", "Quantity", "Unit Price", "Tax", "Total"]]
    : [["Product", "Quantity"]];
  const tableBody = form.items.map(item => {
    const lineTotal = item.quantity * item.unitPrice;
    const taxRate = item.tax ?? 0;
    const desc = (item as InvoiceItem & { subText?: string }).subText ? `${item.description}\n${(item as InvoiceItem & { subText?: string }).subText}` : item.description;
    if (form.showAmounts) {
      return [desc, String(item.quantity), `${currencySymbol} ${fmt(item.unitPrice)}`, taxRate > 0 ? `${taxRate}%` : "—", `${currencySymbol} ${fmt(lineTotal)}`];
    }
    return [desc, String(item.quantity)];
  });

  autoTable(pdf, {
    startY: y,
    head: tableHead,
    body: tableBody,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 3.5, textColor: [40, 40, 40], lineColor: [220, 220, 220], lineWidth: 0.2 },
    headStyles: { fillColor: [240, 240, 240], textColor: [50, 50, 50], fontStyle: "bold", fontSize: 9 },
    bodyStyles: { fillColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles: form.showAmounts
      ? { 0: { cellWidth: "auto" }, 1: { cellWidth: 22, halign: "center" }, 2: { cellWidth: 28, halign: "right" }, 3: { cellWidth: 16, halign: "center" }, 4: { cellWidth: 28, halign: "right" } }
      : { 0: { cellWidth: "auto" }, 1: { cellWidth: 25, halign: "center" } },
    didDrawCell: (data) => {
      if (data.section === "body" && data.row.index === tableBody.length - 1 && data.column.index === 0) {
        const finalRowY = data.cell.y + data.cell.height;
        pdf.setDrawColor(220, 220, 220);
        pdf.setLineWidth(0.2);
        pdf.line(margin, finalRowY, pageW - margin, finalRowY);
      }
    },
  });

  const tableEndY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  if (form.showAmounts) {
    const boxW = 62;
    const boxX = pageW - margin - boxW;
    const boxPad = 4;
    const lineH = 6;
    const boxH = 6 + lineH * 2 + 2 + lineH + boxPad * 2 + 2;
    const boxY = tableEndY;

    pdf.setFillColor(247, 248, 250);
    pdf.setDrawColor(210, 215, 220);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(boxX, boxY, boxW, boxH, 2, 2, "FD");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(30, 30, 30);
    const iconX = boxX + boxPad;
    const iconY = boxY + boxPad + 0.5;
    pdf.setFillColor(80, 80, 80);
    pdf.rect(iconX,     iconY + 2.5, 1.5, 1.5, "F");
    pdf.rect(iconX + 2, iconY + 1,   1.5, 3,   "F");
    pdf.rect(iconX + 4, iconY,       1.5, 4,   "F");
    pdf.text("Invoice Summary", boxX + boxPad + 7, boxY + boxPad + 3.5);

    pdf.setDrawColor(210, 215, 220);
    pdf.line(boxX, boxY + boxPad + 5.5, boxX + boxW, boxY + boxPad + 5.5);

    const row1Y = boxY + boxPad + 5.5 + lineH;
    const row2Y = row1Y + lineH;
    const row3Y = row2Y + lineH + 2;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(60, 60, 60);
    pdf.text("Subtotal", boxX + boxPad, row1Y);
    pdf.text(`${currencySymbol} ${fmt(subtotal)}`, boxX + boxW - boxPad, row1Y, { align: "right" });
    pdf.text("Tax", boxX + boxPad, row2Y);
    pdf.text(`${currencySymbol} ${fmt(taxTotal)}`, boxX + boxW - boxPad, row2Y, { align: "right" });

    pdf.setDrawColor(210, 215, 220);
    pdf.line(boxX + boxPad, row3Y - 4, boxX + boxW - boxPad, row3Y - 4);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Total", boxX + boxPad, row3Y);
    pdf.text(`${currencySymbol} ${fmt(total)}`, boxX + boxW - boxPad, row3Y, { align: "right" });
  }

  if (form.notes) {
    const notesY = tableEndY + (form.showAmounts ? 46 : 6);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text("Notes", margin, notesY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(60, 60, 60);
    pdf.text(form.notes, margin, notesY + 5, { maxWidth: pageW - margin * 2 });
  }

  const numMatch = form.invoiceNumber.match(/(\d+)$/);
  const numStr = numMatch ? numMatch[1].padStart(4, "0") : form.invoiceNumber;

  pdf.setProperties({
    title: `Invoice-${numStr}`,
    subject: "Invoice",
    creator: "Tokyo Media Koueki",
  });

  const { PDFDocument, PDFName, PDFNumber, PDFNull, PDFArray } = await import("pdf-lib");
  const jsPdfBytes = pdf.output("arraybuffer");
  const pdfDoc = await PDFDocument.load(jsPdfBytes);
  const pages = pdfDoc.getPages();
  if (pages.length > 0) {
    const xyzArray = PDFArray.withContext(pdfDoc.context);
    xyzArray.push(pages[0].ref);
    xyzArray.push(PDFName.of("XYZ"));
    xyzArray.push(PDFNull);
    xyzArray.push(PDFNull);
    xyzArray.push(PDFNumber.of(1.0));
    pdfDoc.catalog.set(PDFName.of("OpenAction"), xyzArray);
  }
  const modifiedBytes = await pdfDoc.save();
  const modifiedBlob = new Blob([modifiedBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(modifiedBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Invoice-${numStr}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast.success("PDFをダウンロードしました");
}

// ─── Invoice Editor ───────────────────────────────────────────────────────────
function InvoiceEditor({
  initialData,
  invoiceId,
  onSaved,
  onCancel,
}: {
  initialData: InvoiceFormData;
  invoiceId: number | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<InvoiceFormData>(initialData);
  const initialDataRef = useRef(initialData);
  const [showPreview, setShowPreview] = useState(false);
  const [chatText, setChatText] = useState(initialData.rawChat ?? "");
  const [showChatInput, setShowChatInput] = useState(!invoiceId && !initialData.items.length);
  const [chatImagePreview, setChatImagePreview] = useState<string | null>(null);
  const [chatImageBase64, setChatImageBase64] = useState<string | null>(null);
  const [chatImageMime, setChatImageMime] = useState<string>("image/png");
  const previewRef = useRef<HTMLDivElement>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  // ─── 100万円超過確認ダイアログ
  const [showOverLimitConfirm, setShowOverLimitConfirm] = useState(false);
  const [overLimitJpy, setOverLimitJpy] = useState<number>(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pendingSavePayload, setPendingSavePayload] = useState<null | any>(null);

  const { data: clients = [] } = trpc.invoiceClients.list.useQuery();
  const { data: senderSettings } = trpc.invoiceSettings.get.useQuery();
  const { data: imageAnalysisStatus } = trpc.invoices.imageAnalysisStatus.useQuery(undefined, {
    staleTime: 10 * 60_000,
  });
  const imageAnalysisEnabled = imageAnalysisStatus?.enabled ?? false;

  // Screenshot analysis mutation for the chat input area
  const chatScreenshotMutation = trpc.invoices.analyzeScreenshot.useMutation({
    onSuccess: (data) => {
      if (data.items.length === 0) {
        toast.error("明細を読み取れませんでした。文字が見える範囲にトリミングして、もう一度試してください。");
        return;
      }
      const matchedClient = findClientByDetectedSender(clients, data.detectedSender);
      const autoClientId = matchedClient?.id ?? null;
      const resultWithExtra = data as typeof data & { totalAmount?: number | null; currency?: string | null };
      setForm(f => ({
        ...f,
        items: data.items.map((item, idx) => ({ ...item, sortOrder: idx })),
        ...(data.invoiceNumbers[0] ? { invoiceNumber: String(data.invoiceNumbers[0]).padStart(4, "0") } : {}),
        ...(resultWithExtra.currency ? { currency: resultWithExtra.currency } : {}),
        ...(autoClientId !== null ? { clientId: autoClientId } : {}),
      }));
      setChatImagePreview(null);
      setChatImageBase64(null);
      setShowChatInput(false);
      const msgs: string[] = [`${data.items.length}件の明細を解析しました`];
      if (matchedClient) msgs.push(`宛先: ${matchedClient.name}`);
      else if (data.detectedSender) msgs.push(`宛先候補: ${data.detectedSender}`);
      if (resultWithExtra.totalAmount) msgs.push(`合計: ${resultWithExtra.currency ?? "EUR"} ${resultWithExtra.totalAmount}`);
      toast.success(msgs.join(" / "));
    },
    onError: (e) => toast.error(e.message || "画像解析に失敗しました"),
  });

  const parseMutation = trpc.invoices.parseWhatsApp.useMutation({
    onSuccess: (data) => {
      const matchedClient = findClientByDetectedSender(clients, data.detectedSender);
      const autoClientId = matchedClient?.id ?? null;
      setForm(f => ({
        ...f,
        invoiceNumber: f.invoiceNumber || data.invoiceNumber,
        rawChat: chatText,
        items: data.items.map((item, idx) => ({ ...item, sortOrder: idx })),
        ...(autoClientId !== null ? { clientId: autoClientId } : {}),
      }));
      setShowChatInput(false);
      const senderMsg = matchedClient
        ? ` (宛先: ${matchedClient.name})`
        : data.detectedSender ? ` (宛先候補: ${data.detectedSender})` : "";
      toast.success(`${data.items.length}件の明細を解析しました${senderMsg}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── 分割インボイス関連の状態
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [splitPreview, setSplitPreview] = useState<Array<{ invoiceNumber: string; items: InvoiceItem[]; totalJpy: number }>>([]);
  const [exchangeRateInfo, setExchangeRateInfo] = useState<{ rate: number; date: string } | null>(null);
  const [isFetchingRate, setIsFetchingRate] = useState(false);

  const getExchangeRateQuery = trpc.invoices.getExchangeRate.useQuery(
    { currency: form.currency },
    { enabled: false }
  );

  const createSplitMutation = trpc.invoices.createSplit.useMutation({
    onSuccess: (data) => {
      utils.invoices.list.invalidate();
      toast.success(`${data.count}枚のインボイスを作成しました`);
      setShowSplitDialog(false);
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  // 分割ロジック: 1回100万円以下になるようアイテムを分割する
  const computeSplits = (items: InvoiceItem[], rate: number, limitJpy = 1_000_000) => {
    const groups: Array<{ invoiceNumber: string; items: InvoiceItem[]; totalJpy: number }> = [];
    let currentItems: InvoiceItem[] = [];
    let currentTotal = 0;
    const baseNum = parseInt(form.invoiceNumber.replace(/\D/g, ""), 10) || 0;

    for (const item of items) {
      const itemJpy = item.quantity * item.unitPrice * rate;
      // 単体で上限超える場合はそのまま単独グループに
      if (currentItems.length > 0 && currentTotal + itemJpy > limitJpy) {
        const groupNum = baseNum + groups.length;
        groups.push({ invoiceNumber: String(groupNum), items: currentItems, totalJpy: currentTotal });
        currentItems = [];
        currentTotal = 0;
      }
      currentItems.push(item);
      currentTotal += itemJpy;
    }
    if (currentItems.length > 0) {
      const groupNum = baseNum + groups.length;
      groups.push({ invoiceNumber: String(groupNum), items: currentItems, totalJpy: currentTotal });
    }
    return groups;
  };

  const handleOpenSplitDialog = async () => {
    if (!form.invoiceNumber.trim()) { toast.error("インボイス番号は必須です"); return; }
    if (form.items.length === 0) { toast.error("明細を1件以上追加してください"); return; }
    setIsFetchingRate(true);
    try {
      const result = await getExchangeRateQuery.refetch();
      if (!result.data) throw new Error("為替レートの取得に失敗しました");
      const { rate, date } = result.data;
      setExchangeRateInfo({ rate, date });
      const splits = computeSplits(form.items, rate);
      setSplitPreview(splits);
      setShowSplitDialog(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "為替レートの取得に失敗しました");
    } finally {
      setIsFetchingRate(false);
    }
  };

  const handleConfirmSplit = () => {
    if (!exchangeRateInfo || splitPreview.length === 0) return;
    const selectedClient = clients.find(c => c.id === form.clientId);
    const clientSnapshot = selectedClient ?? null;
    createSplitMutation.mutate({
      baseInvoiceNumber: form.invoiceNumber,
      clientId: form.clientId,
      clientSnapshot,
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate,
      currency: form.currency,
      showAmounts: form.showAmounts,
      notes: form.notes,
      rawChat: form.rawChat,
      status: form.status as "draft" | "sent" | "paid",
      accentColor: form.accentColor,
      exchangeRate: exchangeRateInfo.rate,
      splits: splitPreview.map(g => ({
        invoiceNumber: g.invoiceNumber,
        items: g.items.map(item => ({
          ...item,
          variant: item.subText ?? undefined,
        })),
      })),
    });
  };

  const createMutation = trpc.invoices.create.useMutation({
    onSuccess: () => {
      utils.invoices.list.invalidate();
      toast.success("請求書を保存しました");
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.invoices.update.useMutation({
    onSuccess: async (_, variables) => {
      await Promise.all([
        utils.invoices.list.invalidate(),
        utils.invoices.get.invalidate({ id: variables.id }),
      ]);
      toast.success("請求書を更新しました");
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = async (skipOverLimitCheck = false) => {
    if (!form.invoiceNumber.trim()) { toast.error("インボイス番号は必須です"); return; }
    if (form.items.length === 0) { toast.error("明細を1件以上追加してください"); return; }

    const selectedClient = clients.find(c => c.id === form.clientId);
    const clientSnapshot = selectedClient ?? null;

    const payload = {
      ...form,
      clientSnapshot,
      items: form.items.map(item => ({
        ...item,
        variant: item.subText ?? undefined,
      })),
    };

    // ─── 100万円超過チェック（新規作成時のみ・skipフラグなし時）
    if (!skipOverLimitCheck && !invoiceId) {
      try {
        let totalJpy = 0;
        if (form.currency === "JPY") {
          totalJpy = form.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
        } else {
          const result = await getExchangeRateQuery.refetch();
          if (result.data) {
            totalJpy = form.items.reduce((sum, item) => sum + item.quantity * item.unitPrice * result.data.rate, 0);
          }
        }
        if (totalJpy > 1_000_000) {
          setOverLimitJpy(Math.round(totalJpy));
          setPendingSavePayload(payload);
          setShowOverLimitConfirm(true);
          return;
        }
      } catch {
        // 為替取得失敗時はそのまま保存を続行
      }
    }

    if (invoiceId) {
      updateMutation.mutate({ id: invoiceId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const addItem = () => {
    setForm(f => ({
      ...f,
      items: [...f.items, { description: "", quantity: 1, unitPrice: 0, currency: f.currency, sortOrder: f.items.length }],
    }));
  };

  // Track dirty state whenever form changes
  useEffect(() => {
    const orig = JSON.stringify(initialDataRef.current);
    const curr = JSON.stringify(form);
    setIsDirty(orig !== curr);
  }, [form]);

  const updateItem = (idx: number, field: keyof InvoiceItem, value: string | number) => {
    setForm(f => ({
      ...f,
      items: f.items.map((item, i) => i === idx ? { ...item, [field]: value } : item),
    }));
  };

  const removeItem = (idx: number) => {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  };

  const handleClientChange = useCallback((value: string) => {
    const clientId = value === "__none__" ? null : Number(value);
    const client = clientId ? clients.find(c => c.id === clientId) : null;
    setForm(f => {
      if (!client) return { ...f, clientId };
      const nextCurrency = getDefaultCurrencyForClient(client);
      return {
        ...f,
        clientId,
        currency: nextCurrency,
        items: f.items.map(item => (
          !item.currency || item.currency === f.currency
            ? { ...item, currency: nextCurrency }
            : item
        )),
      };
    });
  }, [clients]);

  const handlePrint = () => {
    // Set document title to control PDF filename: "Invoice - 0373.pdf"
    const numMatch = form.invoiceNumber.match(/(\d+)$/);
    const numStr = numMatch ? numMatch[1].padStart(4, "0") : form.invoiceNumber;
    const prevTitle = document.title;
    document.title = `Invoice - ${numStr}`;

    // Clone the invoice preview and attach directly to body for printing
    // This bypasses ScaledPreview's transform/overflow constraints
    const previewEl = previewRef.current?.querySelector(".invoice-preview");
    let printRoot: HTMLDivElement | null = null;
    if (previewEl) {
      printRoot = document.createElement("div");
      printRoot.className = "invoice-print-root";
      const cloned = previewEl.cloneNode(true) as HTMLElement;
      // Ensure the cloned element fills the page properly
      cloned.style.transform = "none";
      cloned.style.width = "100%";
      cloned.style.height = "auto";
      cloned.style.overflow = "visible";
      printRoot.appendChild(cloned);
      document.body.appendChild(printRoot);
    }

    const cleanup = () => {
      document.title = prevTitle;
      if (printRoot && document.body.contains(printRoot)) {
        document.body.removeChild(printRoot);
      }
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup);
    // Fallback cleanup in case afterprint doesn't fire
    setTimeout(cleanup, 5000);

    window.print();
  };

  const selectedClient = clients.find(c => c.id === form.clientId) ?? null;

  // oklch()などhtml2canvasが解析できないカラー関数をRGBに変換するヘルパー
  const inlineComputedStyles = (el: HTMLElement) => {
    const allEls = [el, ...Array.from(el.querySelectorAll("*"))] as HTMLElement[];
    const colorProps = [
      "color", "backgroundColor", "borderColor",
      "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
      "outlineColor", "boxShadow", "textDecorationColor",
    ];
    for (const node of allEls) {
      if (!(node instanceof HTMLElement)) continue;
      const cs = window.getComputedStyle(node);
      for (const prop of colorProps) {
        const val = cs.getPropertyValue(prop);
        if (val && (val.includes("oklch") || val.includes("oklab") || val.includes("color("))) {
          // computedStyleはブラウザがRGBに変換済みのはずだが、念のためセット
          (node.style as unknown as Record<string, string>)[prop] = val;
        }
      }
    }
  };

  const handleSavePdf = async () => {
    setIsPdfLoading(true);
    try {
      const selectedClient = clients.find(c => c.id === form.clientId) ?? null;
      await generateInvoicePdf(form, selectedClient, senderSettings ?? null);
    } catch (err) {
      console.error("PDF error:", err);
      toast.error(`PDF生成エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsPdfLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => {
          if (isDirty) {
            setShowBackConfirm(true);
          } else {
            onCancel();
          }
        }} className="h-8 gap-1">
          <ChevronLeft size={14} /> 一覧に戻る
        </Button>

        {/* 保存確認ダイアログ */}
        <Dialog open={showBackConfirm} onOpenChange={setShowBackConfirm}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>変更を保存しますか？</DialogTitle>
              <DialogDescription>
                未保存の変更があります。一覧に戻る前に保存しますか？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 sm:gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowBackConfirm(false); onCancel(); }}>
                保存せず戻る
              </Button>
              <Button size="sm" onClick={() => {
                setShowBackConfirm(false);
                handleSave();
              }} disabled={createMutation.isPending || updateMutation.isPending}>
                {(createMutation.isPending || updateMutation.isPending) ? <RefreshCw size={12} className="animate-spin mr-1" /> : <Save size={12} className="mr-1" />}
                保存して戻る
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)} className="h-8 gap-1">
            <Eye size={13} /> {showPreview ? "編集に戻る" : "プレビュー"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSavePdf}
            disabled={isPdfLoading}
            className="h-8 gap-1"
          >
            {isPdfLoading ? (
              <><RefreshCw size={12} className="animate-spin" /> 生成中...</>
            ) : (
              <><Download size={13} /> PDFで保存</>
            )}
          </Button>
          {/* 分割して保存ボタン */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenSplitDialog}
            disabled={isFetchingRate}
            className="h-8 gap-1 border-orange-400 text-orange-600 hover:bg-orange-50"
          >
            {isFetchingRate ? (
              <><RefreshCw size={12} className="animate-spin" /> 為替取得中...</>
            ) : (
              <><Sparkles size={12} /> 分割して保存</>
            )}
          </Button>
          <Button size="sm" onClick={() => handleSave()} disabled={createMutation.isPending || updateMutation.isPending} className="h-8 gap-1">
            {(createMutation.isPending || updateMutation.isPending) ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
            保存
          </Button>
        </div>
      </div>

      {/* 100万円超過確認ダイアログ */}
      <Dialog open={showOverLimitConfirm} onOpenChange={setShowOverLimitConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle size={18} className="text-orange-500" />
              金額が100万円を超えています
            </DialogTitle>
            <DialogDescription>
              このインボイスの円換算合計は「¥{overLimitJpy.toLocaleString()}」で、100万円を超えています。分割しますか？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowOverLimitConfirm(false);
                if (pendingSavePayload) {
                  createMutation.mutate(pendingSavePayload);
                  setPendingSavePayload(null);
                }
              }}
            >
              <Save size={12} className="mr-1" />
              そのまま保存
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setShowOverLimitConfirm(false);
                setPendingSavePayload(null);
                handleOpenSplitDialog();
              }}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              <Sparkles size={12} className="mr-1" />
              分割する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 分割インボイスプレビューダイアログ */}
      <Dialog open={showSplitDialog} onOpenChange={setShowSplitDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={16} className="text-orange-500" />
              インボイス自動分割プレビュー
            </DialogTitle>
            <DialogDescription>
              {exchangeRateInfo && (
                <span className="text-xs">
                  為替レート: 1 {form.currency} = {exchangeRateInfo.rate.toLocaleString()} 円（{exchangeRateInfo.date}）　上限: 100万円/回
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {splitPreview.length === 1 ? (
            <div className="py-4">
              <div className="flex items-center gap-2 text-green-600 bg-green-50 border border-green-200 rounded-lg p-3">
                <CheckCircle2 size={16} />
                <div>
                  <p className="text-sm font-semibold">分割不要です</p>
                  <p className="text-xs text-muted-foreground">
                    合計 {splitPreview[0]?.totalJpy.toLocaleString()} 円で100万円以下です。通常の「保存」で登録できます。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-orange-600 bg-orange-50 border border-orange-200 rounded-lg p-3">
                <AlertCircle size={16} />
                <p className="text-sm">
                  合計金額が100万円を超えるため、<strong>{splitPreview.length}枚</strong>に分割します。
                </p>
              </div>
              {splitPreview.map((group, idx) => (
                <div key={idx} className="border border-border rounded-lg overflow-hidden">
                  <div className="bg-muted/50 px-3 py-2 flex items-center justify-between">
                    <span className="text-sm font-semibold">
                      インボイス #{group.invoiceNumber}
                      {idx === 0 ? " (元番号)" : " (連番)"}
                    </span>
                    <span className="text-xs font-mono text-orange-600">
                      約 {Math.round(group.totalJpy).toLocaleString()} 円
                    </span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        <th className="text-left px-3 py-1.5 font-medium">商品</th>
                        <th className="text-right px-3 py-1.5 font-medium">数量</th>
                        <th className="text-right px-3 py-1.5 font-medium">単価</th>
                        <th className="text-right px-3 py-1.5 font-medium">小計(円)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item, iIdx) => (
                        <tr key={iIdx} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-1.5">
                            {item.description}
                            {item.subText && <span className="text-muted-foreground ml-1">({item.subText})</span>}
                          </td>
                          <td className="text-right px-3 py-1.5">{item.quantity}</td>
                          <td className="text-right px-3 py-1.5">{form.currency} {item.unitPrice.toLocaleString()}</td>
                          <td className="text-right px-3 py-1.5">
                            {Math.round(item.quantity * item.unitPrice * (exchangeRateInfo?.rate ?? 1)).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowSplitDialog(false)}>
              キャンセル
            </Button>
            {splitPreview.length === 1 ? (
              <Button size="sm" onClick={() => { setShowSplitDialog(false); handleSave(); }} disabled={createMutation.isPending}>
                {createMutation.isPending ? <RefreshCw size={12} className="animate-spin mr-1" /> : <Save size={12} className="mr-1" />}
                そのまま保存
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleConfirmSplit}
                disabled={createSplitMutation.isPending}
                className="bg-orange-500 hover:bg-orange-600 text-white"
              >
                {createSplitMutation.isPending ? (
                  <><RefreshCw size={12} className="animate-spin mr-1" /> 作成中...</>
                ) : (
                  <><Sparkles size={12} className="mr-1" /> {splitPreview.length}枚に分割して保存</>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 常時レンダリング（PDF生成用）：編集モードでは非表示だが DOMに存在 */}      <div
        ref={previewRef}
        className="rounded-lg overflow-hidden shadow-sm"
        style={showPreview ? { display: "inline-block", width: "100%" } : { position: "absolute", left: "-9999px", top: 0, width: "794px", pointerEvents: "none", zIndex: -1 }}
      >
        <ScaledPreview>
          <InvoicePreview form={form} clientData={selectedClient} senderSettings={senderSettings ?? null} />
        </ScaledPreview>
      </div>
      {!showPreview ? (
        /* ── Edit mode ── */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: form */}
          <div className="space-y-4">
            {/* WhatsApp chat input */}
            {showChatInput ? (
              <div
                className="bg-[#075E54]/5 border border-[#075E54]/20 rounded-lg p-4 space-y-3"
                onPaste={e => {
                  const items = Array.from(e.clipboardData?.items ?? []);
                  const imgItem = items.find(it => it.type.startsWith("image/"));
                  if (imgItem) {
                    e.preventDefault();
                    const file = imgItem.getAsFile();
                    if (!file) return;
                    const mime = file.type || "image/png";
                    const reader = new FileReader();
                    reader.onload = ev => {
                      const dataUrl = ev.target?.result as string;
                      const base64 = dataUrl.split(",")[1];
                      setChatImagePreview(dataUrl);
                      setChatImageBase64(base64);
                      setChatImageMime(mime);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-[#075E54]">
                  <MessageSquare size={14} />
                  WhatsAppチャット貼り付け
                </div>

                {/* Image mode */}
                {chatImagePreview ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <img src={chatImagePreview} alt="preview" className="w-full max-h-48 object-contain rounded border border-border" />
                      <button
                        className="absolute top-1 right-1 bg-background/80 rounded-full p-0.5 text-destructive hover:bg-destructive/10"
                        onClick={() => { setChatImagePreview(null); setChatImageBase64(null); }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {!imageAnalysisEnabled && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        画像解析APIが未設定です。無料枠で使う場合は Vercel に GEMINI_API_KEY を設定してください。
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-8 gap-1 bg-[#075E54] hover:bg-[#075E54]/90"
                        disabled={chatScreenshotMutation.isPending || !imageAnalysisEnabled}
                        onClick={() => {
                          if (!chatImageBase64) return;
                          chatScreenshotMutation.mutate({ base64: chatImageBase64, mimeType: chatImageMime });
                        }}
                      >
                        {chatScreenshotMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
                        {imageAnalysisEnabled ? "画像を解析して明細を生成" : "画像解析API未設定"}
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => { setChatImagePreview(null); setChatImageBase64(null); }}>
                        テキストに切替
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Drop zone for image paste hint */}
                    <div
                      className="border-2 border-dashed border-[#075E54]/30 rounded-lg p-2 text-center cursor-pointer hover:bg-[#075E54]/5 transition-colors"
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.onchange = () => {
                          const file = input.files?.[0];
                          if (!file) return;
                          const mime = file.type || "image/png";
                          const reader = new FileReader();
                          reader.onload = ev => {
                            const dataUrl = ev.target?.result as string;
                            const base64 = dataUrl.split(",")[1];
                            setChatImagePreview(dataUrl);
                            setChatImageBase64(base64);
                            setChatImageMime(mime);
                          };
                          reader.readAsDataURL(file);
                        };
                        input.click();
                      }}
                    >
                      <p className="text-[10px] text-muted-foreground">📷 スクショを <strong>Ctrl+V</strong> で貼り付け、またはクリックして画像を選択</p>
                    </div>
                    <Textarea
                      value={chatText}
                      onChange={e => setChatText(e.target.value)}
                      placeholder={"[10:52, 2026/3/23] 村上さん: ...\n[21:45, 2026/3/23] +49 177...: Hey, please invoice me\n20 PSVita 2 random color\n10 3DS XL White base\n..."}
                      className="min-h-[140px] text-xs font-mono resize-y"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => parseMutation.mutate({ chatText })} disabled={!chatText.trim() || parseMutation.isPending} className="h-8 gap-1 bg-[#075E54] hover:bg-[#075E54]/90">
                        {parseMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : <MessageSquare size={12} />}
                        テキストを解析
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setShowChatInput(false)} className="h-8">スキップ</Button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowChatInput(true)} className="h-8 gap-1 text-[#075E54] border-[#075E54]/30 hover:bg-[#075E54]/5">
                <MessageSquare size={12} /> WhatsAppから再解析
              </Button>
            )}

            {/* Invoice metadata */}
            <div className="bg-background border border-border rounded-lg p-4 space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">基本情報</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">インボイス番号 *</Label>
                  <Input value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} placeholder="INV-20260324-001" className="h-8 text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">ステータス</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as InvoiceFormData["status"] }))}>
                    <SelectTrigger className="h-8 text-sm mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">下書き</SelectItem>
                      <SelectItem value="sent">送付済み</SelectItem>
                      <SelectItem value="paid">支払済み</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">発行日</Label>
                  <Input
                    type="date"
                    value={form.invoiceDate}
                    onChange={e => {
                      const newDate = e.target.value;
                      setForm(f => ({
                        ...f,
                        invoiceDate: newDate,
                        // 支払期限が未設定 or まだ自動計算値のままなら自動更新
                        dueDate: calcDueDate(newDate),
                      }));
                    }}
                    className="h-8 text-sm mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">支払期限 <span className="text-muted-foreground font-normal">(発行日+1ヶ月-1日)</span></Label>
                  <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className="h-8 text-sm mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">通貨</Label>
                  <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger className="h-8 text-sm mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EUR">EUR (€)</SelectItem>
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="JPY">JPY (¥)</SelectItem>
                      <SelectItem value="GBP">GBP (£)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2 pb-0.5">
                  <Switch
                    checked={form.showAmounts}
                    onCheckedChange={v => setForm(f => ({ ...f, showAmounts: v }))}
                    id="show-amounts"
                  />
                  <Label htmlFor="show-amounts" className="text-xs cursor-pointer">金額を表示</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">アクセントカラー</Label>
                  <input
                    type="color"
                    value={form.accentColor || "#db8b1a"}
                    onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                    className="w-8 h-8 rounded cursor-pointer border border-border p-0.5 bg-transparent"
                    title="インボイスのアクセントカラーを変更"
                  />
                  <span className="text-xs text-muted-foreground font-mono">{form.accentColor || "#db8b1a"}</span>
                </div>
              </div>
            </div>

            {/* Client selection */}
            <div className="bg-background border border-border rounded-lg p-4 space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">宛先</h3>
              <Select
                value={form.clientId ? String(form.clientId) : "__none__"}
                onValueChange={handleClientChange}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="宛先を選択..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">選択しない</SelectItem>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}{c.company ? ` (${c.company})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedClient && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {selectedClient.address && <p>{selectedClient.address}</p>}
                  {selectedClient.city && <p>{selectedClient.city}{selectedClient.country ? `, ${selectedClient.country}` : ""}</p>}
                  {selectedClient.email && <p>{selectedClient.email}</p>}
                  {selectedClient.phone && <p>{selectedClient.phone}</p>}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="bg-background border border-border rounded-lg p-4 space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">備考</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="支払い方法、振込先など..." className="text-sm min-h-[80px] resize-y mt-1" />
            </div>
          </div>

          {/* Right: items */}
          <div className="space-y-3">
            <div className="bg-background border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">明細</h3>
                <Button size="sm" variant="outline" onClick={addItem} className="h-7 text-xs gap-1">
                  <Plus size={11} /> 行を追加
                </Button>
              </div>

              {form.items.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4 italic">
                  WhatsAppから解析するか、手動で行を追加してください
                </p>
              ) : (
                <div className="space-y-2">
                  {/* Header */}
                  <div className={`grid gap-2 text-[10px] font-bold text-muted-foreground uppercase px-1 ${form.showAmounts ? "grid-cols-[1fr_60px_80px_24px]" : "grid-cols-[1fr_60px_24px]"}`}>
                    <span>商品名</span>
                    <span className="text-right">数量</span>
                    {form.showAmounts && <span className="text-right">単価</span>}
                    <span></span>
                  </div>
                  {form.items.map((item, idx) => (
                    <div key={idx} className={`grid gap-2 items-start ${form.showAmounts ? "grid-cols-[1fr_60px_80px_24px]" : "grid-cols-[1fr_60px_24px]"}`}>
                      <div className="flex flex-col gap-1">
                        <Input
                          value={item.description}
                          onChange={e => updateItem(idx, "description", e.target.value)}
                          placeholder="商品名・説明"
                          className="h-8 text-xs"
                        />
                        <Input
                          value={item.subText ?? ""}
                          onChange={e => updateItem(idx, "subText", e.target.value)}
                          placeholder="種類・カラー等（任意）"
                          className="h-7 text-xs text-muted-foreground"
                        />
                      </div>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={e => updateItem(idx, "quantity", Number(e.target.value))}
                        className="h-8 text-xs text-right"
                        min={0}
                      />
                      {form.showAmounts && (
                        <Input
                          type="number"
                          value={item.unitPrice}
                          onChange={e => updateItem(idx, "unitPrice", Number(e.target.value))}
                          className="h-8 text-xs text-right"
                          min={0}
                        />
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(idx)}
                      >
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Totals */}
              {form.showAmounts && form.items.length > 0 && (
                <div className="border-t border-border pt-3 space-y-1">
                  {(() => {
                    const subtotal = form.items.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
                    const sym = form.currency === "USD" ? "$" : form.currency === "EUR" ? "€" : form.currency;
                    return (
                      <div className="flex justify-between text-sm font-bold">
                        <span>合計</span>
                        <span>{sym}{subtotal.toLocaleString()}</span>
                      </div>
                    );
                  })()}
                </div>
              )}
        </div>
        </div>
        </div>
      ) : null}

      {/* Print styles */}
      <style>{`
        @page {
          size: A4 portrait;
          margin: 0;
        }
        @media print {
          html, body {
            zoom: 100% !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body > * { display: none !important; }
          body > .invoice-print-root { display: block !important; }
          .invoice-print-root {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            z-index: 9999 !important;
            background: white !important;
          }
          .invoice-print-root .invoice-preview {
            box-shadow: none !important;
            border: none !important;
            transform: none !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
          }
          .invoice-print-root .scaled-preview-container {
            height: auto !important;
            overflow: visible !important;
          }
          .invoice-print-root .scaled-preview-inner {
            transform: none !important;
            width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
}


// ─── Knowledge Base Dialog (知識ベース・AIチャット) ──────────────────────────────────────────────────────
const getTodayStr = () => new Date().toISOString().slice(0, 10);

function KnowledgeBaseDialog({
  open,
  onClose,
  onNewWithNumber,
}: {
  open: boolean;
  onClose: () => void;
  onNewWithNumber: (num: string, items?: InvoiceItem[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; base64: string; mimeType: string; sizeKB: number; screenshotDate?: string }>>([]);
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  const [editingNameValue, setEditingNameValue] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "chat">("upload");
  const [chatInput, setChatInput] = useState("");
  // Conversation session management
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [latestNumberResult, setLatestNumberResult] = useState<{ invoiceNumber: number | null; nextNumber: number | null; message: string } | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const { data: knowledgeList = [], refetch: refetchList } = trpc.knowledgeBase.list.useQuery();

  // Conversations list
  const { data: conversations = [], refetch: refetchConversations } = trpc.knowledgeBase.listConversations.useQuery();

  // Load chat history for active conversation
  const { data: persistedHistory } = trpc.knowledgeBase.getChatHistory.useQuery(
    activeConversationId ? { conversationId: activeConversationId } : undefined,
    { enabled: activeConversationId !== null }
  );

  // Sync DB history to local state when conversation changes
  useEffect(() => {
    if (activeConversationId === null) {
      setChatHistory([]);
      return;
    }
    if (persistedHistory !== undefined) {
      setChatHistory(persistedHistory.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })));
    }
  }, [persistedHistory, activeConversationId]);

  const createConversationMutation = trpc.knowledgeBase.createConversation.useMutation({
    onSuccess: (data) => {
      setActiveConversationId(data.id);
      setChatHistory([]);
      refetchConversations();
      setActiveTab("chat");
    },
    onError: (e) => toast.error(`作成エラー: ${e.message}`),
  });

  const deleteConversationMutation = trpc.knowledgeBase.deleteConversation.useMutation({
    onSuccess: (_, variables) => {
      if (activeConversationId === variables.id) {
        setActiveConversationId(null);
        setChatHistory([]);
      }
      refetchConversations();
      toast.success("会話を削除しました");
    },
    onError: (e) => toast.error(`削除エラー: ${e.message}`),
  });

  const uploadMutation = trpc.knowledgeBase.upload.useMutation({
    onSuccess: (data) => {
      const ok = data.results.filter((r: any) => r.status === "ok").length;
      const err = data.results.filter((r: any) => r.status === "error").length;
      if (ok > 0) toast.success(`${ok}件のファイルを知識ベースに追加しました`);
      if (err > 0) toast.error(`${err}件のファイルでエラーが発生しました`);
      setPendingFiles([]);
      refetchList();
    },
    onError: (e) => toast.error(`アップロードエラー: ${e.message}`),
  });

  const deleteMutation = trpc.knowledgeBase.delete.useMutation({
    onSuccess: () => { toast.success("削除しました"); refetchList(); },
    onError: (e) => toast.error(`削除エラー: ${e.message}`),
  });

  const chatMutation = trpc.knowledgeBase.chat.useMutation({
    onSuccess: (data) => {
      setChatHistory(prev => [...prev, { role: "assistant", content: data.reply }]);
      refetchConversations();
    },
    onError: (e) => {
      toast.error(`AIエラー: ${e.message}`);
      setChatHistory(prev => [...prev, { role: "assistant", content: `エラーが発生しました: ${e.message}` }]);
    },
  });

  const getLatestNumberMutation = trpc.knowledgeBase.getLatestInvoiceNumber.useMutation({
    onSuccess: (data) => {
      setLatestNumberResult(data);
      if (data.nextNumber) {
        toast.success(`最新番号: ${data.invoiceNumber} → 次の番号: ${data.nextNumber}`);
      } else {
        toast.info(data.message);
      }
    },
    onError: (e) => toast.error(`抽出エラー: ${e.message}`),
  });

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const readFile = useCallback((file: File): Promise<{ name: string; base64: string; mimeType: string; sizeKB: number }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = (e.target?.result as string).split(",")[1];
        resolve({ name: file.name, base64, mimeType: file.type || "application/octet-stream", sizeKB: Math.round(file.size / 1024) });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items: Array<{ name: string; base64: string; mimeType: string; sizeKB: number; screenshotDate?: string }> = [];
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} は10MBを超えています`); continue; }
      try {
        const data = await readFile(file);
        // 画像ファイルは今日の日付をデフォルトセット
        const screenshotDate = file.type.startsWith("image/") ? getTodayStr() : undefined;
        items.push({ ...data, screenshotDate });
      } catch (err) { toast.error(`${file.name} の読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`); }
    }
    setPendingFiles(prev => [...prev, ...items]);
  }, [readFile]);

  // Handle Ctrl/Cmd+V paste for screenshots
  useEffect(() => {
    if (!open) return;
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems = Array.from(items).filter(item => item.type.startsWith("image/"));
      if (imageItems.length === 0) return;
      e.preventDefault();
      const newFiles: Array<{ name: string; base64: string; mimeType: string; sizeKB: number; screenshotDate?: string }> = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        try {
          const data = await readFile(file);
          const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          newFiles.push({ ...data, name: `screenshot-${ts}.png`, screenshotDate: getTodayStr() });
        } catch {
          toast.error("画像の読み込みに失敗しました");
        }
      }
      if (newFiles.length > 0) {
        setPendingFiles(prev => [...prev, ...newFiles]);
        setActiveTab("upload");
        toast.success(`スクリーンショット ${newFiles.length}枚を追加しました`);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [open, readFile]);

  const handleSendChat = () => {
    const msg = chatInput.trim();
    if (!msg || chatMutation.isPending) return;
    if (!activeConversationId) {
      toast.error("会話を選択するか「新規チャット」を作成してください");
      return;
    }
    setChatHistory(prev => [...prev, { role: "user", content: msg }]);
    setChatInput("");
    chatMutation.mutate({ message: msg, conversationId: activeConversationId, history: chatHistory.slice(-10) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl w-[98vw] max-h-[95vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-6 h-6 bg-[#075E54] rounded-md flex items-center justify-center">
              <MessageSquare size={13} className="text-white" />
            </div>
            知識ベース
            <span className="ml-auto text-xs font-normal text-muted-foreground">{knowledgeList.length}件学習済み</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            WhatsApp履歴・スクリーンショット・インボイスPDFをアップロードしてAIに学習させます
          </DialogDescription>
        </DialogHeader>

        {/* Tab navigation */}
        <div className="flex border-b border-border flex-shrink-0">
          {(["upload", "chat"] as const).map((tab) => {
            const labels = { upload: "アップロード・管理", chat: "AIチャット" };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
                  activeTab === tab
                    ? "border-[#075E54] text-[#075E54]"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Upload & Management Tab ── */}
          {activeTab === "upload" && (
            <div className="p-4 space-y-4">
              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
                  isDragging ? "border-[#075E54] bg-[#075E54]/5" : "border-border hover:border-[#075E54]/50 hover:bg-muted/30"
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileSelect(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={22} className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">ファイルをドロップ または クリックして選択</p>
                <p className="text-xs text-muted-foreground mt-1">.txt（チャット履歴）/ 画像（スクショ）/ .pdf（インボイス）· 最大10MB</p>
                <p className="text-xs text-muted-foreground mt-0.5">💡 スクリーンショットは <kbd className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-mono">Ctrl</kbd> / <kbd className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-mono">⌘</kbd> + <kbd className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-mono">V</kbd> で貼り付け可能</p>
                <input ref={fileInputRef} type="file" multiple accept=".txt,.pdf,image/*" className="hidden" onChange={(e) => handleFileSelect(e.target.files)} />
              </div>

              {/* Pending files */}
              {pendingFiles.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">アップロード待ち ({pendingFiles.length}件)</p>
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="bg-muted/40 rounded px-2 py-1.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <FileText size={13} className="text-muted-foreground flex-shrink-0" />
                        {/* ファイル名インライン編集 */}
                        {editingNameIdx === i ? (
                          <input
                            type="text"
                            autoFocus
                            className="text-xs flex-1 border border-[#075E54] rounded px-1.5 py-0.5 bg-background text-foreground"
                            value={editingNameValue}
                            onChange={(e) => setEditingNameValue(e.target.value)}
                            onBlur={() => {
                              const trimmed = editingNameValue.trim();
                              if (trimmed) setPendingFiles(prev => prev.map((pf, j) => j === i ? { ...pf, name: trimmed } : pf));
                              setEditingNameIdx(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const trimmed = editingNameValue.trim();
                                if (trimmed) setPendingFiles(prev => prev.map((pf, j) => j === i ? { ...pf, name: trimmed } : pf));
                                setEditingNameIdx(null);
                              } else if (e.key === "Escape") {
                                setEditingNameIdx(null);
                              }
                            }}
                          />
                        ) : (
                          <span
                            className="text-xs flex-1 truncate cursor-pointer hover:text-[#075E54] group flex items-center gap-1"
                            title="クリックして名前を変更"
                            onClick={() => { setEditingNameIdx(i); setEditingNameValue(f.name); }}
                          >
                            {f.name}
                            <Pencil size={10} className="text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0" />
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{f.sizeKB}KB</span>
                        <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}>
                          <X size={12} className="text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                      {/* Date input for screenshots */}
                      {f.mimeType.startsWith("image/") && (
                        <div className="flex items-center gap-1.5 pl-5">
                          <label className="text-[10px] text-muted-foreground whitespace-nowrap">撮影日:</label>
                          <input
                            type="date"
                            className="text-[10px] border border-border rounded px-1.5 py-0.5 bg-background text-foreground flex-1"
                            value={f.screenshotDate ?? ""}
                            onChange={(e) => setPendingFiles(prev => prev.map((pf, j) => j === i ? { ...pf, screenshotDate: e.target.value } : pf))}
                          />
                          <span className="text-[9px] text-muted-foreground">日付を入力するとAIが時刻を正確に解釈</span>
                        </div>
                      )}
                    </div>
                  ))}
                  <Button
                    className="w-full bg-[#075E54] hover:bg-[#075E54]/90 text-white"
                    size="sm"
                    onClick={() => uploadMutation.mutate({ files: pendingFiles.map(f => ({ name: f.name, base64: f.base64, mimeType: f.mimeType, screenshotDate: f.screenshotDate })) })}
                    disabled={uploadMutation.isPending}
                  >
                    {uploadMutation.isPending ? <><RefreshCw size={13} className="animate-spin mr-1.5" />AI解析中...</> : <><Upload size={13} className="mr-1.5" />知識ベースに追加 ({pendingFiles.length}件)</>}
                  </Button>
                </div>
              )}

              {/* Latest invoice number extraction */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold">最新インボイス番号を抽出</p>
                <p className="text-xs text-muted-foreground">知識ベースの学習データからAIが最新のインボイス番号を抽出し、次の番号でインボイスを作成できます。</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => getLatestNumberMutation.mutate()}
                  disabled={getLatestNumberMutation.isPending || knowledgeList.length === 0}
                >
                  {getLatestNumberMutation.isPending ? (
                    <><RefreshCw size={13} className="animate-spin" />AI解析中...</>
                  ) : (
                    <><Download size={13} />最新インボイス番号を抽出</>
                  )}
                </Button>
                {latestNumberResult && (
                  <div className="bg-background border border-border rounded p-2.5 space-y-1.5">
                    <p className="text-xs text-muted-foreground">{latestNumberResult.message}</p>
                    {latestNumberResult.nextNumber && (
                      <Button
                        size="sm"
                        className="w-full bg-[#075E54] hover:bg-[#075E54]/90 text-white gap-1.5"
                        onClick={() => {
                          onNewWithNumber(String(latestNumberResult.nextNumber));
                          onClose();
                        }}
                      >
                        <Plus size={13} />
                        No.{latestNumberResult.nextNumber} でインボイスを作成
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Knowledge list */}
              <div>
                <p className="text-xs font-semibold mb-2">学習済みデータ ({knowledgeList.length}件)</p>
                {knowledgeList.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-xs">まだデータがありません。上からファイルをアップロードしてください。</p>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {knowledgeList.map((item: any) => (
                      <div key={item.id} className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          item.sourceType === "chat_text" ? "bg-green-100 text-green-700" :
                          item.sourceType === "screenshot" ? "bg-blue-100 text-blue-700" :
                          "bg-red-100 text-red-700"
                        }`}>
                          {item.sourceType === "chat_text" ? "テキスト" : item.sourceType === "screenshot" ? "スクショ" : "PDF"}
                        </span>
                        <span className="text-xs flex-1 truncate">{item.sourceLabel ?? "不明"}</span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {new Date(item.createdAt).toLocaleDateString("ja-JP")}
                        </span>
                        <button onClick={() => { if (confirm(`「${item.sourceLabel}」を削除しますか？`)) deleteMutation.mutate({ id: item.id }); }}>
                          <Trash2 size={12} className="text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── AI Chat Tab ── */}
          {activeTab === "chat" && (
            <div className="flex" style={{ height: "480px" }}>
              {/* Left sidebar: conversation list */}
              <div className="w-52 flex-shrink-0 border-r border-border flex flex-col bg-muted/20">
                <div className="p-2 border-b border-border">
                  <Button
                    size="sm"
                    className="w-full bg-[#075E54] hover:bg-[#075E54]/90 text-white gap-1.5 text-xs h-8"
                    onClick={() => createConversationMutation.mutate({})}
                    disabled={createConversationMutation.isPending}
                  >
                    <Plus size={13} />
                    新規チャット
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
                  {conversations.length === 0 && (
                    <p className="text-[10px] text-muted-foreground text-center py-4">会話がありません</p>
                  )}
                  {conversations.map((conv: any) => (
                    <div
                      key={conv.id}
                      className={`group flex items-center gap-1 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                        activeConversationId === conv.id
                          ? "bg-[#075E54]/10 border border-[#075E54]/20"
                          : "hover:bg-muted/60"
                      }`}
                      onClick={() => {
                        setActiveConversationId(conv.id);
                        setChatHistory([]);
                      }}
                    >
                      <MessageSquare size={11} className="flex-shrink-0 text-muted-foreground" />
                      <span className="text-[11px] flex-1 truncate leading-tight">{conv.title}</span>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`「${conv.title}」を削除しますか？`)) {
                            deleteConversationMutation.mutate({ id: conv.id });
                          }
                        }}
                      >
                        <Trash2 size={10} className="text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: chat area */}
              <div className="flex-1 flex flex-col min-w-0">
                {activeConversationId === null ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6">
                    <MessageSquare size={36} className="mb-3 opacity-20" />
                    <p className="text-sm font-medium">会話を選択してください</p>
                    <p className="text-xs mt-1">左のリストから選択、または「新規チャット」で新しい会話を開始</p>
                    {knowledgeList.length === 0 && (
                      <p className="text-xs mt-3 text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                        ⚠️ まだ知識ベースが空です。「アップロード・管理」タブからファイルをアップロードしてください。
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {chatHistory.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          <p className="text-sm font-medium">AIに質問してみましょう</p>
                          <div className="mt-3 space-y-2">
                            {[
                              "Vita2000の価格について最近ルカさんとどんな会話をしましたか？",
                              "未払いのインボイスはありますか？",
                              "最近の注文内容を教えてください",
                            ].map((s, i) => (
                              <button key={i} className="block w-full text-left text-xs bg-muted/40 hover:bg-muted/70 rounded-lg px-3 py-2 transition-colors" onClick={() => setChatInput(s)}>
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {chatHistory.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs ${
                            msg.role === "user" ? "bg-[#075E54] text-white rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"
                          }`}>
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          </div>
                        </div>
                      ))}
                      {chatMutation.isPending && (
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2">
                            <div className="flex gap-1 items-center">
                              <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]" />
                              <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
                              <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
                            </div>
                          </div>
                        </div>
                      )}
                      <div ref={chatBottomRef} />
                    </div>
                    {/* Input */}
                    <div className="border-t border-border p-3 flex-shrink-0">
                      <div className="flex gap-2">
                        <Textarea
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                          placeholder="質問を入力... (Enter で送信、Shift+Enter で改行)"
                          className="resize-none text-sm min-h-[52px] max-h-[100px]"
                          rows={2}
                        />
                        <Button
                          className="bg-[#075E54] hover:bg-[#075E54]/90 text-white px-3 self-end"
                          size="sm"
                          onClick={handleSendChat}
                          disabled={!chatInput.trim() || chatMutation.isPending}
                        >
                          <Send size={14} />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


// ─// ─── Scaled Preview Wrapper ──────────────────────────────────────────────────────────────────────────────────
// Scales A4 (794px wide) to fit the available container width
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const A4_W = 794;
  const A4_H = 1123;

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      // Use the parent's width to determine scale
      const available = el.parentElement?.clientWidth ?? el.clientWidth;
      const s = Math.min(1, available / A4_W);
      setScale(s);
    };
    update();
    const ro = new ResizeObserver(update);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);

  // The outer wrapper is exactly the scaled size — no extra white space on the right or bottom
  const scaledW = Math.round(A4_W * scale);
  const scaledH = Math.round(A4_H * scale);

  return (
    <div
      ref={wrapperRef}
      className="scaled-preview-container"
      style={{
        // Exact scaled dimensions — wrapper hugs the content
        width: `${scaledW}px`,
        height: `${scaledH}px`,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        className="scaled-preview-inner"
        style={{
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          width: `${A4_W}px`,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// 幅・高さ両方を考慮してモーダル内に収めるプレビューコンポーネント
function ScaledPreviewFit({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const A4_W = 794;
  const A4_H = 1123;

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      const parent = el.parentElement;
      if (!parent) return;
      const availW = parent.clientWidth - 0; // padding already applied by parent
      const availH = parent.clientHeight - 0;
      const scaleW = availW / A4_W;
      const scaleH = availH / A4_H;
      const s = Math.min(1, scaleW, scaleH);
      setScale(s);
    };
    update();
    const ro = new ResizeObserver(update);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);

  const scaledW = Math.round(A4_W * scale);
  const scaledH = Math.round(A4_H * scale);

  return (
    <div
      ref={wrapperRef}
      style={{
        width: `${scaledW}px`,
        height: `${scaledH}px`,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
      }}
    >
      <div
        style={{
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          width: `${A4_W}px`,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Invoice List ──────────────────────────────────────────────────────────────────────────────────────
function InvoiceList({  onNew,
  onNewWithNumber,
  onEdit,
}: {
  onNew: () => void;
  onNewWithNumber: (num: string, items?: InvoiceItem[]) => void;
  onEdit: (id: number) => void;
}) {
  const utils = trpc.useUtils();
  const { data: invoiceList = [], isLoading } = trpc.invoices.list.useQuery();
  const { data: clients = [] } = trpc.invoiceClients.list.useQuery();
  const [showClientManager, setShowClientManager] = useState(false);
  const [showSenderSettings, setShowSenderSettings] = useState(false);
  const [showWhatsAppUpload, setShowWhatsAppUpload] = useState(false);
  const [showDetectDialog, setShowDetectDialog] = useState(false);
  const [detectResult, setDetectResult] = useState<{
    sent: Array<{ invoiceNumber: number; confidence: string; evidence: string }>;
    paid: Array<{ invoiceNumber: number; confidence: string; evidence: string }>;
    message: string;
  } | null>(null);
  const [applyingIds, setApplyingIds] = useState<Set<number>>(new Set());
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);
  const [showDeletedList, setShowDeletedList] = useState(false);
  const { data: deletedList = [] } = trpc.invoices.listDeleted.useQuery(
    undefined,
    { enabled: showDeletedList }
  );
  const restoreMutation = trpc.invoices.restore.useMutation({
    onSuccess: () => {
      toast.success("インボイスを復元しました");
      utils.invoices.list.invalidate();
      utils.invoices.listDeleted.invalidate();
    },
    onError: () => toast.error("復元に失敗しました"),
  });
  const permanentDeleteMutation = trpc.invoices.permanentDelete.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.invoiceNumber} を完全削除しました（番号は再利用可能になりました）`);
      utils.invoices.list.invalidate();
      utils.invoices.listDeleted.invalidate();
    },
    onError: (e) => toast.error(`完全削除に失敗しました: ${e.message}`),
  });
  const [confirmPermanentDeleteId, setConfirmPermanentDeleteId] = useState<number | null>(null);
  const [previewInvId, setPreviewInvId] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    form: InvoiceFormData;
    client: { name: string; company?: string | null; email?: string | null; phone?: string | null; address?: string | null; city?: string | null; country?: string | null; notes?: string | null; extraInfo?: string | null } | null;
  } | null>(null);
  const { data: senderSettings } = trpc.invoiceSettings.get.useQuery();

  // 為替レート取得（インボイス一覧に使用する通貨を収集して一括取得）
  const currencies = useMemo(() => {
    const set = new Set(invoiceList.map(inv => inv.currency).filter(c => c !== "JPY"));
    return Array.from(set);
  }, [invoiceList]);

  // 通貨ごとに為替レートを取得（EUR, USD, GBP等）
  const { data: eurRate } = trpc.invoices.getExchangeRate.useQuery(
    { currency: "EUR" },
    { enabled: currencies.includes("EUR"), staleTime: 5 * 60 * 1000 }
  );
  const { data: usdRate } = trpc.invoices.getExchangeRate.useQuery(
    { currency: "USD" },
    { enabled: currencies.includes("USD"), staleTime: 5 * 60 * 1000 }
  );
  const { data: gbpRate } = trpc.invoices.getExchangeRate.useQuery(
    { currency: "GBP" },
    { enabled: currencies.includes("GBP"), staleTime: 5 * 60 * 1000 }
  );
  const { data: chfRate } = trpc.invoices.getExchangeRate.useQuery(
    { currency: "CHF" },
    { enabled: currencies.includes("CHF"), staleTime: 5 * 60 * 1000 }
  );

  // 通貨→レートのマップ
  const rateMap = useMemo(() => {
    const map: Record<string, number> = { JPY: 1 };
    if (eurRate) map["EUR"] = eurRate.rate;
    if (usdRate) map["USD"] = usdRate.rate;
    if (gbpRate) map["GBP"] = gbpRate.rate;
    if (chfRate) map["CHF"] = chfRate.rate;
    return map;
  }, [eurRate, usdRate, gbpRate, chfRate]);

  // 円換算金額を計算するヘルパー
  const calcJpy = useCallback((totalAmount: number, currency: string): number | null => {
    const rate = rateMap[currency];
    if (rate == null) return null;
    return Math.round(totalAmount * rate);
  }, [rateMap]);

  const handlePreviewOpen = async (invId: number) => {
    setPreviewInvId(invId);
    setPreviewLoading(true);
    try {
      const inv = await utils.invoices.get.fetch({ id: invId });
      if (!inv) { toast.error("請求書データが取得できませんでした"); return; }
      const form: InvoiceFormData = {
        invoiceNumber: inv.invoiceNumber,
        clientId: inv.clientId ?? null,
        invoiceDate: inv.invoiceDate ?? "",
        dueDate: inv.dueDate ?? "",
        currency: inv.currency,
        showAmounts: inv.showAmounts,
        notes: inv.notes ?? "",
        rawChat: inv.rawChat ?? "",
        status: inv.status,
        accentColor: (inv as unknown as { accentColor?: string | null }).accentColor ?? "#db8b1a",
        items: (inv.items ?? []).map((item: { description: string; variant?: string | null; quantity: string | number; unitPrice: string | number; currency?: string | null; sortOrder?: number | null; tax?: string | number | null }) => ({
          description: item.description,
          subText: item.variant ?? undefined,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          currency: item.currency ?? undefined,
          sortOrder: item.sortOrder ?? undefined,
          tax: item.tax != null ? Number(item.tax) : undefined,
        })),
      };
      const selectedClient = inv.clientId
        ? clients.find(c => c.id === inv.clientId) ?? null
        : null;
      setPreviewData({ form, client: selectedClient });
    } catch (e) {
      toast.error("プレビューの読み込みに失敗しました");
      console.error(e);
      setPreviewInvId(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleListPdf = async (invId: number, invNumber: string) => {
    setPdfLoadingId(invId);
    try {
      // 請求書の詳細データを取得
      const inv = await utils.invoices.get.fetch({ id: invId });
      if (!inv) { toast.error("請求書データが取得できませんでした"); return; }

      const form: InvoiceFormData = {
        invoiceNumber: inv.invoiceNumber,
        clientId: inv.clientId ?? null,
        invoiceDate: inv.invoiceDate ?? "",
        dueDate: inv.dueDate ?? "",
        currency: inv.currency,
        showAmounts: inv.showAmounts,
        notes: inv.notes ?? "",
        rawChat: inv.rawChat ?? "",
        status: inv.status,
        accentColor: (inv as unknown as { accentColor?: string | null }).accentColor ?? "#db8b1a",
        items: (inv.items ?? []).map((item: { description: string; variant?: string | null; quantity: string | number; unitPrice: string | number; currency?: string | null; sortOrder?: number | null; tax?: string | number | null }) => ({
          description: item.description,
          subText: item.variant ?? undefined,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          currency: item.currency ?? undefined,
          sortOrder: item.sortOrder ?? undefined,
          tax: item.tax != null ? Number(item.tax) : undefined,
        })),
      };

      const selectedClient = inv.clientId
        ? clients.find(c => c.id === inv.clientId) ?? null
        : null;

      await generateInvoicePdf(form, selectedClient, senderSettings ?? null);
    } catch (e) {
      toast.error("PDF生成に失敗しました");
      console.error(e);
    } finally {
      setPdfLoadingId(null);
    }
  };

  const deleteMutation = trpc.invoices.delete.useMutation({
    onSuccess: () => {
      utils.invoices.list.invalidate();
      toast.success("請求書を削除しました");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateStatusMutation = trpc.invoices.updateStatus.useMutation({
    onSuccess: () => utils.invoices.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const cloneMutation = trpc.invoices.clone.useMutation({
    onSuccess: (data) => {
      utils.invoices.list.invalidate();
      toast.success(`クローンしました: ${data.invoiceNumber}`);
    },
    onError: (e) => toast.error(`クローンエラー: ${e.message}`),
  });

  const detectMutation = trpc.knowledgeBase.detectStatusFromKnowledge.useMutation({
    onSuccess: (data) => {
      setDetectResult(data);
      setShowDetectDialog(true);
    },
    onError: (e) => toast.error(`検知エラー: ${e.message}`),
  });

  const applyStatusMutation = trpc.invoices.updateStatus.useMutation({
    onSuccess: () => utils.invoices.list.invalidate(),
    onError: (e) => toast.error(`ステータス更新エラー: ${e.message}`),
  });

  const handleApplyDetected = async (invoiceNumber: number, status: "sent" | "paid") => {
    // Find matching invoice by number suffix
    const matched = invoiceList.filter(inv => {
      const m = inv.invoiceNumber.match(/(\d+)$/);
      return m && parseInt(m[1], 10) === invoiceNumber;
    });
    if (matched.length === 0) {
      toast.error(`インボイス ${invoiceNumber} が見つかりません`);
      return;
    }
    setApplyingIds(prev => new Set([...prev, invoiceNumber]));
    for (const inv of matched) {
      await applyStatusMutation.mutateAsync({ id: inv.id, status });
    }
    setApplyingIds(prev => { const s = new Set(prev); s.delete(invoiceNumber); return s; });
    toast.success(`${invoiceNumber} を「${status === "sent" ? "送信済み" : "支払済み"}」に変更しました`);
  };

  const clientMap = new Map(clients.map(c => [c.id, c]));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onNew} className="h-8 gap-1">
            <Plus size={13} /> 新規請求書
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowClientManager(true)} className="h-8 gap-1">
            <Users size={13} /> 宛先管理
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowSenderSettings(true)} className="h-8 gap-1">
            <Settings size={13} /> 差出人設定
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowWhatsAppUpload(true)} className="h-8 gap-1">
            <MessageSquare size={13} /> 履歴アップロード
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => detectMutation.mutate()}
            disabled={detectMutation.isPending}
            className="h-8 gap-1 text-primary border-primary/30 hover:bg-primary/5"
            title="知識ベースの学習データから送信済み・支払済みを自動検知"
          >
            {detectMutation.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            ステータス自動検知
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">{invoiceList.length}件</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowDeletedList(true)}
            className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive"
            title="削除済みインボイス一覧"
          >
            <Trash2 size={12} />
            削除済み
          </Button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : invoiceList.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <FileText size={40} className="mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">請求書がまだありません</p>
          <Button size="sm" onClick={onNew} className="h-8 gap-1">
            <Plus size={12} /> 最初の請求書を作成
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {invoiceList.map((inv) => {
            const client = inv.clientId ? clientMap.get(inv.clientId) : null;
            const invWithExtras = inv as typeof inv & { itemCount?: number; totalAmount?: number };
            const totalAmount = invWithExtras.totalAmount ?? 0;
            const itemCount = invWithExtras.itemCount ?? 0;
            const jpyAmount = calcJpy(totalAmount, inv.currency);
            const isOver1M = jpyAmount != null && jpyAmount >= 1_000_000;
            return (
              <div
                key={inv.id}
                className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted/20 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground truncate">{inv.invoiceNumber}</span>
                    <StatusBadge status={inv.status} />
                    {jpyAmount != null && (
                      <span className={`flex items-center gap-1 text-xs font-medium ${
                        isOver1M ? "text-orange-500" : "text-muted-foreground"
                      }`}>
                        {isOver1M && <AlertCircle size={12} className="text-orange-500" />}
                        ¥{jpyAmount.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {client && <span>{client.name}</span>}
                    {inv.invoiceDate && <span>{inv.invoiceDate}</span>}
                    <span>{itemCount}件の明細</span>
                    <span>{inv.currency}</span>
                    {totalAmount > 0 && (
                      <span className="font-medium text-foreground/70">{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} {inv.currency}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                  <Select
                    value={inv.status}
                    onValueChange={v => updateStatusMutation.mutate({ id: inv.id, status: v as "draft" | "sent" | "paid" })}
                  >
                    <SelectTrigger className="h-7 text-xs w-24 border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">下書き</SelectItem>
                      <SelectItem value="sent">送付済み</SelectItem>
                      <SelectItem value="paid">支払済み</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    title="プレビュー"
                    onClick={() => handlePreviewOpen(inv.id)}
                    disabled={previewLoading && previewInvId === inv.id}
                  >
                    {previewLoading && previewInvId === inv.id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Eye size={13} />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(inv.id)} title="編集">
                    <Pencil size={13} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    title="PDF保存"
                    onClick={() => handleListPdf(inv.id, inv.invoiceNumber)}
                    disabled={pdfLoadingId === inv.id}
                  >
                    {pdfLoadingId === inv.id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <FileDown size={13} />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    title="クローン（最新番号+1で複製）"
                    onClick={() => cloneMutation.mutate({ id: inv.id })}
                    disabled={cloneMutation.isPending}
                  >
                    <Copy size={13} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="削除"
                    onClick={() => {
                      if (confirm(`「${inv.invoiceNumber}」を削除しますか？`)) {
                        deleteMutation.mutate({ id: inv.id });
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ClientManagerDialog open={showClientManager} onClose={() => setShowClientManager(false)} />
      <SenderSettingsDialog open={showSenderSettings} onClose={() => setShowSenderSettings(false)} />
      <KnowledgeBaseDialog open={showWhatsAppUpload} onClose={() => setShowWhatsAppUpload(false)} onNewWithNumber={onNewWithNumber} />

      {/* ステータス自動検知ダイアログ */}
      <Dialog open={showDetectDialog} onOpenChange={setShowDetectDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={16} className="text-primary" />
              ステータス自動検知結果
            </DialogTitle>
            <DialogDescription>{detectResult?.message}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* 送信済み */}
            {detectResult && detectResult.sent.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1">
                  <Send size={13} className="text-blue-500" /> 送信済みと検知されたインボイス
                </h4>
                <div className="space-y-2">
                  {detectResult.sent.map((item) => (
                    <div key={item.invoiceNumber} className="flex items-start justify-between gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">#{item.invoiceNumber}</span>
                          <Badge variant="outline" className={`text-[10px] h-4 ${
                            item.confidence === "high" ? "border-green-500 text-green-600" :
                            item.confidence === "medium" ? "border-yellow-500 text-yellow-600" :
                            "border-gray-400 text-gray-500"
                          }`}>{item.confidence}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.evidence}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs flex-shrink-0 border-blue-400 text-blue-600 hover:bg-blue-50"
                        disabled={applyingIds.has(item.invoiceNumber)}
                        onClick={() => handleApplyDetected(item.invoiceNumber, "sent")}
                      >
                        {applyingIds.has(item.invoiceNumber) ? <RefreshCw size={11} className="animate-spin" /> : <CheckCheck size={11} />}
                        適用
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* 支払済み */}
            {detectResult && detectResult.paid.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1">
                  <CheckCircle2 size={13} className="text-green-500" /> 支払済みと検知されたインボイス
                </h4>
                <div className="space-y-2">
                  {detectResult.paid.map((item) => (
                    <div key={item.invoiceNumber} className="flex items-start justify-between gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">#{item.invoiceNumber}</span>
                          <Badge variant="outline" className={`text-[10px] h-4 ${
                            item.confidence === "high" ? "border-green-500 text-green-600" :
                            item.confidence === "medium" ? "border-yellow-500 text-yellow-600" :
                            "border-gray-400 text-gray-500"
                          }`}>{item.confidence}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.evidence}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs flex-shrink-0 border-green-400 text-green-600 hover:bg-green-50"
                        disabled={applyingIds.has(item.invoiceNumber)}
                        onClick={() => handleApplyDetected(item.invoiceNumber, "paid")}
                      >
                        {applyingIds.has(item.invoiceNumber) ? <RefreshCw size={11} className="animate-spin" /> : <CheckCheck size={11} />}
                        適用
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detectResult && detectResult.sent.length === 0 && detectResult.paid.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">送信済み・支払済みのインボイスが検知されませんでした</p>
                <p className="text-xs mt-1">履歴アップロードから知識ベースを充実させてください</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDetectDialog(false)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* インボイスプレビューモーダル */}
      <Dialog open={previewInvId !== null} onOpenChange={(o) => { if (!o) { setPreviewInvId(null); setPreviewData(null); } }}>
        <DialogContent className="max-w-3xl w-[95vw] flex flex-col p-0" style={{ height: "92vh", maxHeight: "92vh" }}>
          <DialogHeader className="px-4 pt-4 pb-2 flex-shrink-0 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Eye size={15} />
              インボイスプレビュー
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden flex items-center justify-center p-4 bg-muted/30">
            {previewLoading ? (
              <div className="flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">読み込み中...</span>
              </div>
            ) : previewData ? (
              <ScaledPreviewFit>
                <InvoicePreview
                  form={previewData.form}
                  clientData={previewData.client}
                  senderSettings={senderSettings ?? null}
                />
              </ScaledPreviewFit>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* 削除済みインボイス一覧モーダル */}
      <Dialog open={showDeletedList} onOpenChange={setShowDeletedList}>
        <DialogContent className="max-w-2xl w-[95vw] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Trash2 size={15} />
              削除済みインボイス
            </DialogTitle>
          </DialogHeader>
          {deletedList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Trash2 size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">削除済みのインボイスはありません</p>
            </div>
          ) : (
            <div className="space-y-2">
              {deletedList.map((inv) => {
                const invWithExtras = inv as typeof inv & { itemCount?: number; totalAmount?: number };
                const deletedAt = inv.deletedAt ? new Date(inv.deletedAt).toLocaleDateString("ja-JP") : "";
                return (
                  <div key={inv.id} className="flex items-center justify-between p-3 bg-muted/30 border border-border rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">{inv.invoiceNumber}</span>
                        <span className="text-xs text-muted-foreground">{inv.currency}</span>
                        {invWithExtras.totalAmount != null && invWithExtras.totalAmount > 0 && (
                          <span className="text-xs text-muted-foreground">{invWithExtras.totalAmount.toLocaleString()} {inv.currency}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{inv.invoiceDate}</span>
                        {deletedAt && <span className="text-xs text-destructive/70">削除日: {deletedAt}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => restoreMutation.mutate({ id: inv.id })}
                        disabled={restoreMutation.isPending || permanentDeleteMutation.isPending}
                      >
                        <RotateCcw size={12} />
                        復元
                      </Button>
                      {confirmPermanentDeleteId === inv.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-destructive">本当に？</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 gap-1 text-xs"
                            onClick={() => {
                              permanentDeleteMutation.mutate({ id: inv.id });
                              setConfirmPermanentDeleteId(null);
                            }}
                            disabled={permanentDeleteMutation.isPending}
                          >
                            完全削除
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setConfirmPermanentDeleteId(null)}
                          >
                            キャンセル
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-xs text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setConfirmPermanentDeleteId(inv.id)}
                          disabled={permanentDeleteMutation.isPending}
                          title="完全削除（番号が再利用可能になります）"
                        >
                          <Trash2 size={12} />
                          完全削除
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDeletedList(false)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// // ─── Main InvoicePage ─────────────────────────────────────────────────
type View = "list" | "new" | { editId: number } | { newWithNumber: string; items?: InvoiceItem[] };

export default function InvoicePage({ initialEditId }: { initialEditId?: number | null }) {
  const [view, setView] = useState<View>(() => {
    if (initialEditId) return { editId: initialEditId };
    return "list";
  });
  const utils = trpc.useUtils();

  // Load invoice for editing
  const editId = typeof view === "object" && "editId" in view ? view.editId : null;
  const { data: editInvoice, isLoading: editLoading } = trpc.invoices.get.useQuery(
    { id: editId! },
    { enabled: editId !== null }
  );

  // Fetch next invoice number (used when creating new invoice)
  const isNewView = view === "new";
  const { data: nextNumberData, isLoading: nextNumberLoading } = trpc.whatsappHistory.getNextNumber.useQuery(
    undefined,
    { enabled: isNewView, staleTime: 0 }
  );

  const handleEdit = useCallback((id: number) => setView({ editId: id }), []);
  const handleNew = useCallback(() => setView("new"), []);
  const handleNewWithNumber = useCallback((num: string, items?: InvoiceItem[]) => setView({ newWithNumber: num, items }), []);
  const handleBack = useCallback(() => {
    setView("list");
    utils.invoices.list.invalidate();
    utils.whatsappHistory.getNextNumber.invalidate();
  }, [utils]);

  if (view === "list") {
    return <InvoiceList onNew={handleNew} onNewWithNumber={handleNewWithNumber} onEdit={handleEdit} />;
  }

  if (view === "new") {
    // Wait for next number to load before rendering the editor
    if (nextNumberLoading) {
      return (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={18} className="animate-spin text-muted-foreground" />
        </div>
      );
    }
    const autoNumber = nextNumberData?.nextFormatted ?? "";
    const newForm: InvoiceFormData = { ...EMPTY_FORM, invoiceNumber: autoNumber };
    return (
      <InvoiceEditor
        initialData={newForm}
        invoiceId={null}
        onSaved={handleBack}
        onCancel={handleBack}
      />
    );
  }

  if (typeof view === "object" && "newWithNumber" in view) {
    const newForm: InvoiceFormData = {
      ...EMPTY_FORM,
      invoiceNumber: view.newWithNumber,
      ...(view.items && view.items.length > 0
        ? { items: view.items.map((item, idx) => ({ ...item, sortOrder: idx })) }
        : {}),
    };
    return (
      <InvoiceEditor
        initialData={newForm}
        invoiceId={null}
        onSaved={handleBack}
        onCancel={handleBack}
      />
    );
  }

  // Edit mode
  if (editLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!editInvoice) {
    return (
      <div className="text-center py-16 space-y-3">
        <AlertCircle size={32} className="mx-auto text-destructive" />
        <p className="text-sm text-muted-foreground">請求書が見つかりませんでした</p>
        <Button size="sm" onClick={handleBack}>一覧に戻る</Button>
      </div>
    );
  }

  const editForm: InvoiceFormData = {
    invoiceNumber: editInvoice.invoiceNumber,
    clientId: editInvoice.clientId ?? null,
    invoiceDate: editInvoice.invoiceDate ?? "",
    dueDate: editInvoice.dueDate ?? "",
    currency: editInvoice.currency,
    showAmounts: editInvoice.showAmounts,
    notes: editInvoice.notes ?? "",
    rawChat: editInvoice.rawChat ?? "",
    status: editInvoice.status,
    accentColor: (editInvoice as unknown as { accentColor?: string | null }).accentColor ?? "#db8b1a",
    items: (editInvoice.items ?? []).map(item => ({
      description: item.description,
      subText: (item as unknown as { variant?: string | null }).variant ?? undefined,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      currency: item.currency ?? undefined,
      sortOrder: item.sortOrder,
    })),
  };

  return (
    <InvoiceEditor
      initialData={editForm}
      invoiceId={editInvoice.id}
      onSaved={handleBack}
      onCancel={handleBack}
    />
  );
}
