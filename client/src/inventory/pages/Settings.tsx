import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Settings as SettingsIcon,
  Key,
  ExternalLink,
  Info,
  Download,
  Upload,
  FileText,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Database,
  Package,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Users,
  ShieldCheck,
  Eye,
  EyeOff,
} from "lucide-react";

// 取引先行の型
type CustomerRow = {
  id: number;
  displayName: string;
  code: string;
  keywords: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

// 国内卸商品マスタ行の型
type DomesticProductRow = {
  id: number;
  title: string;
  unitPrice: string | null;
  supplierName: string | null;
  note: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export default function Settings() {
  // 管理者チェック
  const { data: adminData, isLoading: isAdminLoading } = trpc.inventory.admin.isAdmin.useQuery();
  const isAdmin = adminData?.isAdmin ?? false;

  // 招待コード管理
  const { data: accessCodeIsSet, refetch: refetchAccessCodeIsSet } = trpc.inventory.accessCode.isSet.useQuery(
    undefined,
    { enabled: isAdmin },
  );
  const setAccessCodeMutation = trpc.inventory.accessCode.set.useMutation({
    onSuccess: () => {
      toast.success(newAccessCode.trim() === "" ? "招待コードを削除しました（アクセス制限なし）" : "招待コードを更新しました");
      void refetchAccessCodeIsSet();
      setNewAccessCode("");
      setShowAccessCode(false);
    },
    onError: (e) => toast.error(`更新失敗: ${e.message}`),
  });
  const [newAccessCode, setNewAccessCode] = useState("");
  const [showAccessCode, setShowAccessCode] = useState(false);

  const [testToken, setTestToken] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const testMutation = trpc.inventory.zaico.testConnection.useMutation();

  // 国内卸商品マスタ
  const { data: domesticProducts, refetch: refetchDomesticProducts } = trpc.inventory.domesticProduct.list.useQuery();
  const createDomesticMutation = trpc.inventory.domesticProduct.create.useMutation({
    onSuccess: () => { toast.success("商品を追加しました"); void refetchDomesticProducts(); setNewDomestic({ title: "", unitPrice: "", supplierName: "", note: "" }); },
    onError: (e) => toast.error(`追加失敗: ${e.message}`),
  });
  const updateDomesticMutation = trpc.inventory.domesticProduct.update.useMutation({
    onSuccess: () => { toast.success("更新しました"); void refetchDomesticProducts(); setEditingDomesticId(null); },
    onError: (e) => toast.error(`更新失敗: ${e.message}`),
  });
  const deleteDomesticMutation = trpc.inventory.domesticProduct.delete.useMutation({
    onSuccess: () => { toast.success("削除しました"); void refetchDomesticProducts(); },
    onError: (e) => toast.error(`削除失敗: ${e.message}`),
  });
  const [newDomestic, setNewDomestic] = useState({ title: "", unitPrice: "", supplierName: "", note: "" });
  const [editingDomesticId, setEditingDomesticId] = useState<number | null>(null);
  const [editDomestic, setEditDomestic] = useState({ title: "", unitPrice: "", supplierName: "", note: "" });

  // 取引先マスタ
  const { data: customers, refetch: refetchCustomers } = trpc.inventory.customer.list.useQuery();
  const createCustomerMutation = trpc.inventory.customer.create.useMutation({
    onSuccess: () => { toast.success("取引先を追加しました"); void refetchCustomers(); setNewCustomer({ displayName: "", code: "", keywords: "" }); },
    onError: (e) => toast.error(`追加失敗: ${e.message}`),
  });
  const updateCustomerMutation = trpc.inventory.customer.update.useMutation({
    onSuccess: () => { toast.success("更新しました"); void refetchCustomers(); setEditingCustomerId(null); },
    onError: (e) => toast.error(`更新失敗: ${e.message}`),
  });
  const deleteCustomerMutation = trpc.inventory.customer.delete.useMutation({
    onSuccess: () => { toast.success("削除しました"); void refetchCustomers(); },
    onError: (e) => toast.error(`削除失敗: ${e.message}`),
  });
  const [newCustomer, setNewCustomer] = useState({ displayName: "", code: "", keywords: "" });
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [editCustomer, setEditCustomer] = useState({ displayName: "", code: "", keywords: "" });

  const handleAddCustomer = () => {
    if (!newCustomer.displayName.trim()) { toast.error("表示名を入力してください"); return; }
    if (!newCustomer.code.trim()) { toast.error("出庫Noコードを入力してください"); return; }
    const keywords = newCustomer.keywords.trim() || newCustomer.displayName.trim();
    createCustomerMutation.mutate({
      displayName: newCustomer.displayName.trim(),
      code: newCustomer.code.trim(),
      keywords,
      sortOrder: 0,
    });
  };
  const startEditCustomer = (c: CustomerRow) => {
    setEditingCustomerId(c.id);
    setEditCustomer({ displayName: c.displayName, code: c.code, keywords: c.keywords });
  };
  const handleUpdateCustomer = (id: number) => {
    if (!editCustomer.displayName.trim()) { toast.error("表示名を入力してください"); return; }
    if (!editCustomer.code.trim()) { toast.error("出庫Noコードを入力してください"); return; }
    updateCustomerMutation.mutate({
      id,
      displayName: editCustomer.displayName.trim(),
      code: editCustomer.code.trim(),
      keywords: editCustomer.keywords.trim() || editCustomer.displayName.trim(),
    });
  };

  const handleAddDomestic = () => {
    if (!newDomestic.title.trim()) { toast.error("商品名を入力してください"); return; }
    createDomesticMutation.mutate({
      title: newDomestic.title.trim(),
      unitPrice: newDomestic.unitPrice ? parseFloat(newDomestic.unitPrice) : null,
      supplierName: newDomestic.supplierName.trim() || null,
      note: newDomestic.note.trim() || null,
    });
  };
  const startEditDomestic = (p: DomesticProductRow) => {
    setEditingDomesticId(p.id);
    setEditDomestic({ title: p.title, unitPrice: p.unitPrice ?? "", supplierName: p.supplierName ?? "", note: p.note ?? "" });
  };
  const handleUpdateDomestic = (id: number) => {
    if (!editDomestic.title.trim()) { toast.error("商品名を入力してください"); return; }
    updateDomesticMutation.mutate({
      id,
      title: editDomestic.title.trim(),
      unitPrice: editDomestic.unitPrice ? parseFloat(editDomestic.unitPrice) : null,
      supplierName: editDomestic.supplierName.trim() || null,
      note: editDomestic.note.trim() || null,
    });
  };

  // 外部API連携ON/OFF
  const { data: zaicoEnabledData, refetch: refetchEnabled } = trpc.inventory.migration.getZaicoEnabled.useQuery();
  const setZaicoEnabledMutation = trpc.inventory.migration.setZaicoEnabled.useMutation();

  // インポート統計
  const { data: importStats, refetch: refetchStats } = trpc.inventory.migration.getImportStats.useQuery();

  // インポート実行
  const importMutation = trpc.inventory.migration.importFromZaico.useMutation();
  const [importResult, setImportResult] = useState<{ inventories: number; purchases: number; errors: string[] } | null>(null);

  const zaicoEnabled = zaicoEnabledData?.enabled ?? false;

  // CSV インポート
  const csvImportMutation = trpc.inventory.migration.importZaicoCsv.useMutation();
  const [csvImportResult, setCsvImportResult] = useState<{ total: number; inserted: number; updated: number; errors: string[] } | null>(null);
  const [csvFileName, setCsvFileName] = useState<string>("");
  const [csvFileReady, setCsvFileReady] = useState(false);
  const [csvText, setCsvText] = useState<string>("");

  async function handleCsvFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setCsvFileReady(false);
    setCsvImportResult(null);
    // Shift-JIS / CP932 として読み込み
    try {
      const buffer = await file.arrayBuffer();
      const decoder = new TextDecoder("shift-jis");
      const text = decoder.decode(buffer);
      setCsvText(text);
      setCsvFileReady(true);
    } catch {
      // UTF-8 フォールバック
      const text = await file.text();
      setCsvText(text);
      setCsvFileReady(true);
    }
  }

  async function handleCsvImport() {
    if (!csvText) { toast.error("CSVファイルを選択してください"); return; }
    setCsvImportResult(null);
    try {
      toast.info("CSVをインポート中です...");
      const result = await csvImportMutation.mutateAsync({ csvText });
      setCsvImportResult(result);
      await refetchStats();
      if (result.errors.length === 0) {
        toast.success(`CSVインポート完了: ${result.total}件処理（新規${result.inserted}件、更新${result.updated}件）`);
      } else {
        toast.warning(`CSVインポート完了（一部エラーあり）: ${result.total}件処理`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "CSVインポートに失敗しました";
      toast.error(msg);
    }
  }

  async function handleTest() {
    setTestResult(null);
    try {
      const result = await testMutation.mutateAsync({ token: testToken.trim() || "__use_env__" });
      setTestResult(result);
      if (result.success) {
        toast.success("外部APIへの接続に成功しました");
      } else {
        toast.error(result.message);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "接続テストに失敗しました";
      setTestResult({ success: false, message: msg });
      toast.error(msg);
    }
  }

  async function handleToggleZaico() {
    const newValue = !zaicoEnabled;
    try {
      await setZaicoEnabledMutation.mutateAsync({ enabled: newValue });
      await refetchEnabled();
      toast.success(newValue ? "外部API連携をONにしました" : "外部API連携をOFFにしました");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "設定の変更に失敗しました";
      toast.error(msg);
    }
  }

  async function handleImport() {
    setImportResult(null);
    try {
      toast.info("外部APIからデータをインポート中です。しばらくお待ちください...");
      const result = await importMutation.mutateAsync();
      setImportResult(result);
      await refetchStats();
      if (result.errors.length === 0) {
        toast.success(`インポート完了: 在庫 ${result.inventories}件、発注 ${result.purchases}件`);
      } else {
        toast.warning(`インポート完了（一部エラーあり）: 在庫 ${result.inventories}件、発注 ${result.purchases}件`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "インポートに失敗しました";
      toast.error(msg);
    }
  }

  // 管理者チェック中はローディング表示
  if (isAdminLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        読み込み中...
      </div>
    );
  }

  // 非管理者にはアクセス制限画面を表示
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="rounded-full bg-destructive/10 p-4 mb-4">
          <ShieldCheck className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-1">アクセス権限がありません</h2>
        <p className="text-sm text-muted-foreground">設定画面は管理者のみ利用できます。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* ヘッダー */}
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <SettingsIcon className="h-5 w-5" />
          設定
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          サイト内DB運用・データ管理
        </p>
      </div>

      {/* 外部API連携 ON/OFF */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20">
          <h2 className="font-semibold flex items-center gap-2">
            {zaicoEnabled ? (
              <ToggleRight className="h-4 w-4 text-green-600" />
            ) : (
              <ToggleLeft className="h-4 w-4 text-muted-foreground" />
            )}
            外部API連携
          </h2>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                現在の状態：
                <span className={zaicoEnabled ? "text-green-600 ml-1" : "text-muted-foreground ml-1"}>
                  {zaicoEnabled ? "ON（外部APIと連携中）" : "OFF（サイト単独運用）"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {zaicoEnabled
                  ? "在庫・発注データを外部APIから取得し、操作内容も外部APIへ反映しています。"
                  : "外部APIは使用せず、サイト内DBのみで運用しています。"}
              </p>
            </div>
            <Button
              variant={zaicoEnabled ? "outline" : "default"}
              size="sm"
              onClick={handleToggleZaico}
              disabled={!zaicoEnabled || setZaicoEnabledMutation.isPending}
              className="ml-4 shrink-0"
            >
              {setZaicoEnabledMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              {zaicoEnabled ? "OFFにする" : "サイト単独運用"}
            </Button>
          </div>

          {/* OFFにする前の注意 */}
          {zaicoEnabled && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
              <div>
                <p className="font-medium">OFFにする前に必ずデータインポートを実行してください</p>
                <p className="text-xs mt-0.5">
                  外部API連携をOFFにすると、外部APIへのアクセスが停止します。
                  下記の「外部APIデータインポート」でデータをサイトDBに取り込んでからOFFにしてください。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 外部APIデータインポート */}
      {zaicoEnabled && (
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20">
          <h2 className="font-semibold flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            外部APIデータインポート
          </h2>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* 現在のインポート状況 */}
          <div className="rounded-md bg-muted/30 p-3 text-sm space-y-2">
            <p className="font-medium flex items-center gap-1.5">
              <Database className="h-4 w-4 text-primary" />
              サイトDB内のデータ件数
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-background rounded p-2 border text-center">
                <p className="text-2xl font-bold text-primary">{importStats?.inventories ?? 0}</p>
                <p className="text-muted-foreground">在庫商品</p>
              </div>
              <div className="bg-background rounded p-2 border text-center">
                <p className="text-2xl font-bold text-primary">{importStats?.purchases ?? 0}</p>
                <p className="text-muted-foreground">発注データ</p>
              </div>
            </div>
          </div>

          <div className="text-sm text-muted-foreground space-y-1">
            <p>外部APIから在庫商品・発注データ（ordered/not_ordered）を全件取得してサイトDBに保存します。</p>
            <p className="text-xs">既存データは上書き更新されます。何度実行しても安全です。</p>
          </div>

          <Button
            onClick={handleImport}
            disabled={importMutation.isPending}
            className="w-full"
          >
            {importMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                インポート中...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1.5" />
                外部APIからデータをインポート
              </>
            )}
          </Button>

          {/* インポート結果 */}
          {importResult && (
            <div className={`rounded-md p-3 text-sm space-y-1 ${
              importResult.errors.length === 0
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-amber-50 border border-amber-200 text-amber-800"
            }`}>
              <p className="font-medium flex items-center gap-1.5">
                {importResult.errors.length === 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
                インポート完了
              </p>
              <p>在庫商品: {importResult.inventories}件</p>
              <p>発注データ: {importResult.purchases}件</p>
              {importResult.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="font-medium">エラー:</p>
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-xs">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      )}

      {/* 在庫CSVインポート */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20">
          <h2 className="font-semibold flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            在庫CSVインポート
          </h2>
          <p className="text-xs text-muted-foreground mt-1">在庫CSVファイルをアップロードして在庫データをインポートします。</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="text-sm text-muted-foreground space-y-1">
            <p>在庫データのCSVファイルを選択してインポートします。</p>
            <p className="text-xs">在庫IDをキーに既存データを上書き更新、なければ新規登録します。Shift-JIS・ UTF-8 の両方に対応しています。</p>
          </div>

          {/* ファイル選択 */}
          <div className="space-y-2">
            <label className="text-sm font-medium block">
              CSVファイルを選択
            </label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-muted-foreground/40 cursor-pointer hover:border-primary hover:bg-muted/30 transition-colors text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                {csvFileName ? csvFileName : "ファイルを選択..."}
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleCsvFileChange}
                />
              </label>
              {csvFileReady && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  読み込み完了
                </span>
              )}
            </div>
          </div>

          <Button
            onClick={handleCsvImport}
            disabled={!csvFileReady || csvImportMutation.isPending}
            className="w-full"
          >
            {csvImportMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                インポート中...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-1.5" />
                CSVをインポート
              </>
            )}
          </Button>

          {/* CSVインポート結果 */}
          {csvImportResult && (
            <div className={`rounded-md p-3 text-sm space-y-1 ${
              csvImportResult.errors.length === 0
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-amber-50 border border-amber-200 text-amber-800"
            }`}>
              <p className="font-medium flex items-center gap-1.5">
                {csvImportResult.errors.length === 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
                CSVインポート完了
              </p>
              <p>処理件数: {csvImportResult.total}件</p>
              <p>新規登録: {csvImportResult.inserted}件</p>
              <p>更新: {csvImportResult.updated}件</p>
              {csvImportResult.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="font-medium">エラー:</p>
                  {csvImportResult.errors.map((e, i) => (
                    <p key={i} className="text-xs">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {zaicoEnabled && (
        <>
      {/* API設定カード */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20">
          <h2 className="font-semibold flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            外部API設定
          </h2>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="rounded-md bg-muted/30 p-3 text-sm space-y-1">
            <p className="font-medium text-foreground">現在の設定</p>
            <p className="text-muted-foreground">
              APIトークンは環境変数で管理されています。
            </p>
            <p className="text-muted-foreground">
              トークンの変更はサーバーの環境変数を更新して反映してください。
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1.5">
                接続テスト用トークン入力
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                別のAPIトークンで接続テストを行う場合に入力してください。
                現在設定中のトークンをテストする場合は空欄のままテストボタンを押してください。
              </p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="外部APIトークン（任意）"
                  value={testToken}
                  onChange={(e) => setTestToken(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={handleTest}
                  disabled={testMutation.isPending}
                  variant="outline"
                >
                  {testMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : null}
                  接続テスト
                </Button>
              </div>
            </div>

            {testResult && (
              <div
                className={`rounded-md p-3 flex items-start gap-2 text-sm ${
                  testResult.success
                    ? "bg-green-50 border border-green-200 text-green-800"
                    : "bg-red-50 border border-red-200 text-red-800"
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-600" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 外部APIについて */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20">
          <h2 className="font-semibold flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            外部APIについて
          </h2>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm text-muted-foreground">
          <p>
            このシステムは現在、外部APIを使用せずサイト内DBで入出庫管理を行います。
            旧API連携は停止しています。
          </p>
          <a
            href="https://zaicodev.github.io/zaico_api_doc/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            外部APIドキュメント
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

        </>
      )}

      {/* 国内卸商品マスタ */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20">
          <h2 className="font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            国内卸商品マスタ
          </h2>
          <p className="text-xs text-muted-foreground mt-1">月次棚卸しレポートで選択できる国内卸（toynet等）の発注商品を登録します。</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* 商品一覧 */}
          {domesticProducts && domesticProducts.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 text-xs text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">商品名</th>
                    <th className="text-right px-3 py-2 font-medium w-28">仕入単価</th>
                    <th className="text-left px-3 py-2 font-medium w-32">仕入先</th>
                    <th className="text-left px-3 py-2 font-medium">メモ</th>
                    <th className="px-3 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {(domesticProducts as DomesticProductRow[]).map((p) => (
                    <tr key={p.id} className="border-t hover:bg-muted/10">
                      {editingDomesticId === p.id ? (
                        <>
                          <td className="px-2 py-1.5">
                            <Input value={editDomestic.title} onChange={(e) => setEditDomestic((v) => ({ ...v, title: e.target.value }))} className="h-7 text-sm" />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input type="number" value={editDomestic.unitPrice} onChange={(e) => setEditDomestic((v) => ({ ...v, unitPrice: e.target.value }))} className="h-7 text-sm text-right" placeholder="例: 3500" />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input value={editDomestic.supplierName} onChange={(e) => setEditDomestic((v) => ({ ...v, supplierName: e.target.value }))} className="h-7 text-sm" placeholder="例: toynet" />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input value={editDomestic.note} onChange={(e) => setEditDomestic((v) => ({ ...v, note: e.target.value }))} className="h-7 text-sm" />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex gap-1 justify-end">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => handleUpdateDomestic(p.id)} disabled={updateDomesticMutation.isPending}>
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingDomesticId(null)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 font-medium">{p.title}</td>
                          <td className="px-3 py-2 text-right">{p.unitPrice != null ? `¥${parseFloat(p.unitPrice).toLocaleString("ja-JP")}` : <span className="text-muted-foreground text-xs">未設定</span>}</td>
                          <td className="px-3 py-2 text-muted-foreground text-xs">{p.supplierName ?? "-"}</td>
                          <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-xs">{p.note ?? ""}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1 justify-end">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEditDomestic(p)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteDomesticMutation.mutate({ id: p.id })} disabled={deleteDomesticMutation.isPending}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">まだ商品が登録されていません。</p>
          )}

          {/* 新規追加フォーム */}
          <div className="border rounded-lg p-3 bg-muted/10 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">新規追加</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">商品名 <span className="text-destructive">*</span></label>
                <Input value={newDomestic.title} onChange={(e) => setNewDomestic((v) => ({ ...v, title: e.target.value }))} placeholder="例: New3DSLL 本体" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">仕入単価（円）</label>
                <Input type="number" value={newDomestic.unitPrice} onChange={(e) => setNewDomestic((v) => ({ ...v, unitPrice: e.target.value }))} placeholder="例: 3500" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">仕入先名</label>
                <Input value={newDomestic.supplierName} onChange={(e) => setNewDomestic((v) => ({ ...v, supplierName: e.target.value }))} placeholder="例: toynet" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">メモ</label>
                <Input value={newDomestic.note} onChange={(e) => setNewDomestic((v) => ({ ...v, note: e.target.value }))} placeholder="任意のメモ" className="h-8 text-sm" />
              </div>
            </div>
            <Button size="sm" onClick={handleAddDomestic} disabled={createDomesticMutation.isPending} className="mt-1">
              <Plus className="h-4 w-4 mr-1" />
              追加
            </Button>
          </div>
        </div>
      </div>

      {/* 取引先管理 */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20">
          <h2 className="font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            取引先管理
          </h2>
          <p className="text-xs text-muted-foreground mt-1">出庫Noの自動生成に使う取引先を管理します。管理番号（例: 371_ルカ_...）からキーワードで自動判別します。</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* 取引先一覧 */}
          {customers && customers.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 text-xs text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">表示名</th>
                    <th className="text-left px-3 py-2 font-medium w-28">出庫Noコード</th>
                    <th className="text-left px-3 py-2 font-medium">判別キーワード（カンマ区切り）</th>
                    <th className="px-3 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {(customers as CustomerRow[]).map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/10">
                      {editingCustomerId === c.id ? (
                        <>
                          <td className="px-2 py-1.5">
                            <Input value={editCustomer.displayName} onChange={(e) => setEditCustomer((v) => ({ ...v, displayName: e.target.value }))} className="h-7 text-sm" placeholder="例: ルカ" />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input value={editCustomer.code} onChange={(e) => setEditCustomer((v) => ({ ...v, code: e.target.value }))} className="h-7 text-sm" placeholder="例: luca" />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input value={editCustomer.keywords} onChange={(e) => setEditCustomer((v) => ({ ...v, keywords: e.target.value }))} className="h-7 text-sm" placeholder="例: ルカ,luca,Luca" />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex gap-1 justify-end">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => handleUpdateCustomer(c.id)} disabled={updateCustomerMutation.isPending}>
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingCustomerId(null)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 font-medium">{c.displayName}</td>
                          <td className="px-3 py-2">
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{c.code}</code>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-xs">{c.keywords}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1 justify-end">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEditCustomer(c)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteCustomerMutation.mutate({ id: c.id })} disabled={deleteCustomerMutation.isPending}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">まだ取引先が登録されていません。</p>
          )}

          {/* 新規追加フォーム */}
          <div className="border rounded-lg p-3 bg-muted/10 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">新規追加</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">表示名 <span className="text-destructive">*</span></label>
                <Input value={newCustomer.displayName} onChange={(e) => setNewCustomer((v) => ({ ...v, displayName: e.target.value }))} placeholder="例: ルカ" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">出庫Noコード <span className="text-destructive">*</span></label>
                <Input value={newCustomer.code} onChange={(e) => setNewCustomer((v) => ({ ...v, code: e.target.value }))} placeholder="例: luca" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">判別キーワード（省略可）</label>
                <Input value={newCustomer.keywords} onChange={(e) => setNewCustomer((v) => ({ ...v, keywords: e.target.value }))} placeholder="例: ルカ,luca,Luca" className="h-8 text-sm" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">判別キーワードを省略した場合、表示名がそのままキーワードとして使われます。</p>
            <Button size="sm" onClick={handleAddCustomer} disabled={createCustomerMutation.isPending} className="mt-1">
              <Plus className="h-4 w-4 mr-1" />
              追加
            </Button>
          </div>
        </div>
      </div>

      {/* 招待コード管理 */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20">
          <h2 className="font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            アクセス制限（招待コード）
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            設定すると、ログイン後に招待コードの入力画面が表示されます。正しいコードを知らない人はアクセスできません。
          </p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full ${accessCodeIsSet?.isSet ? "bg-green-500" : "bg-muted-foreground/40"}`} />
            <span className="text-sm">
              {accessCodeIsSet?.isSet ? (
                <span>招待コードが設定されています。<span className="text-muted-foreground text-xs ml-1">（セキュリティ上、現在のコードは表示できません）</span></span>
              ) : (
                <span className="text-muted-foreground">招待コード未設定（アクセス制限なし）</span>
              )}
            </span>
          </div>

          {/* 新規設定 / 変更フォーム */}
          <div className="border rounded-lg p-3 bg-muted/10 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {accessCodeIsSet?.isSet ? "招待コードを変更" : "招待コードを設定"}
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showAccessCode ? "text" : "password"}
                  value={newAccessCode}
                  onChange={(e) => setNewAccessCode(e.target.value)}
                  placeholder={accessCodeIsSet?.isSet ? "新しい招待コードを入力" : "招待コードを入力"}
                  className="w-full h-8 text-sm rounded-md border border-input bg-background px-3 pr-9 focus:outline-none focus:ring-2 focus:ring-ring"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowAccessCode((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showAccessCode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                size="sm"
                onClick={() => setAccessCodeMutation.mutate({ code: newAccessCode })}
                disabled={setAccessCodeMutation.isPending}
              >
                {setAccessCodeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span className="ml-1">保存</span>
              </Button>
            </div>
            {accessCodeIsSet?.isSet && (
              <p className="text-xs text-muted-foreground">
                招待コードを削除する場合は、入力欄を空にして「保存」を押してください。
              </p>
            )}
          </div>
        </div>
      </div>

      {/* システム情報 */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20">
          <h2 className="font-semibold">システム情報</h2>
        </div>
        <div className="px-5 py-4 text-sm space-y-2">
          <div className="flex justify-between py-1 border-b">
            <span className="text-muted-foreground">システム名</span>
            <span className="font-medium">入出庫管理システム</span>
          </div>
          <div className="flex justify-between py-1 border-b">
            <span className="text-muted-foreground">データベース</span>
            <span className="font-medium">MySQL（在庫・発注・出庫履歴）</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">外部API</span>
            <span className={`font-medium ${zaicoEnabled ? "text-green-600" : "text-muted-foreground"}`}>
              {zaicoEnabled ? "v1（連携中）" : "無効"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
