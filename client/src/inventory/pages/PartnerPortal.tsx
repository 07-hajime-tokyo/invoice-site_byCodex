import { useState, useMemo, useEffect } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Globe, Lock, CheckCircle2, MessageSquare, Send, LogOut, Package, Trash2, Reply, ChevronDown, ChevronUp, Eye, EyeOff, Search } from "lucide-react";
import { toast } from "sonner";
import { toEnglishProductName, normalizeProductName, matchesCsvProductName, toShipmentProductKey } from "@/inventory/lib/productNameUtils";

type ShipmentItem = {
  productNameJa: string;
  productNameEn: string;
  quantity: number;
};

type FedexShipment = {
  id: number;
  deliveryNo: string;
  sheetName: string;
  shippingDate: string;
  trackingNumber: string;
  itemsJson: string;
  spreadsheetStatus: string;
  operatorName: string | null;
  createdAt: Date;
};

type CsvInvoiceData = {
  partner: string;
  paymentDate: string;
  products: Array<{ name: string; qty: number }>;
  isComplete?: boolean;
};

export default function PartnerPortal() {
  const params = useParams<{ code: string }>();
  const partnerCode = params.code ?? "";

  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [showMessageHistory, setShowMessageHistory] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [initializedKey, setInitializedKey] = useState<string | null>(null);
  const [showPendingOrders, setShowPendingOrders] = useState(true);
  // メッセージ検索
  const [messageSearch, setMessageSearch] = useState("");
  // メッセージ内容表示/非表示（メッセージIDのセット）
  const [collapsedMessages, setCollapsedMessages] = useState<Set<number>>(new Set());
  // スレッド返信入力状態（メッセージID → 入力テキスト）
  const [threadReplyTexts, setThreadReplyTexts] = useState<Record<number, string>>({});
  // 返信フォーム表示中のメッセージID
  const [replyingToId, setReplyingToId] = useState<number | null>(null);

  // セッション確認（Cookieベース）
  const { data: sessionData, isLoading: sessionLoading, refetch: refetchSession } = trpc.inventory.partner.checkSession.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const isAuthenticated = sessionData?.authenticated && sessionData.partnerCode === partnerCode;

  const loginMutation = trpc.inventory.partner.login.useMutation({
    onSuccess: () => {
      setLoginLoading(false);
      refetchSession();
    },
    onError: (e) => {
      toast.error(e.message || "Invalid password");
      setLoginLoading(false);
    },
  });

  const logoutMutation = trpc.inventory.partner.logout.useMutation({
    onSuccess: () => refetchSession(),
  });

  // 発送データ取得（認証済みの場合のみ）
  const { data: portalData, isLoading: dataLoading, refetch } = trpc.inventory.partner.getShipments.useQuery(undefined, {
    enabled: !!isAuthenticated,
    retry: false,
  });

  const toggleCheckMutation = trpc.inventory.partner.updateCheck.useMutation({
    onSuccess: () => refetch(),
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const sendMessageMutation = trpc.inventory.partner.sendMessage.useMutation({
    onSuccess: () => {
      toast.success("Message sent successfully");
      setMessageText("");
      setShowMessageForm(false);
      refetchMessages();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  // メッセージ履歴
  const { data: myMessages, refetch: refetchMessages } = trpc.inventory.partner.getMyMessages.useQuery(undefined, {
    enabled: !!isAuthenticated,
    retry: false,
  });

  const markMessagesReadMutation = trpc.inventory.partner.markMessagesRead.useMutation({
    onSuccess: () => refetchMessages(),
  });

  // スレッド取得
  const messageIds = useMemo(() => (myMessages ?? []).map(m => m.id), [myMessages]);
  const { data: threads, refetch: refetchThreads } = trpc.inventory.partner.getThreads.useQuery(
    { parentMessageIds: messageIds },
    { enabled: messageIds.length > 0, retry: false }
  );
  // スレッド返信mutation
  const addThreadReplyMutation = trpc.inventory.partner.addThreadReply.useMutation({
    onSuccess: () => {
      toast.success("Reply sent");
      setReplyingToId(null);
      setThreadReplyTexts({});
      refetchMessages();
      refetchThreads();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const deleteMyMessageMutation = trpc.inventory.partner.deleteMyMessage.useMutation({
    onSuccess: () => {
      toast.success("Message deleted");
      refetchMessages();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const handleLogin = () => {
    setLoginLoading(true);
    loginMutation.mutate({ partnerCode, password });
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const handleSendMessage = () => {
    if (!messageText.trim()) return;
    setMessageSending(true);
    sendMessageMutation.mutate(
      { message: messageText },
      { onSettled: () => setMessageSending(false) }
    );
  };

  // 発送データの整理
  const shipments = (portalData?.shipments ?? []) as FedexShipment[];
  const csvData = (portalData?.csvData ?? {}) as Record<string, CsvInvoiceData>;
  const checks = (portalData?.checks ?? {}) as Record<string, boolean>;
  const partnerName = sessionData?.partnerName ?? partnerCode;

  // グループ化（追跡番号 × 発送日）
  // 返品商品は正規化して通常商品として扱う
  const shipmentGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      trackingNumber: string;
      shippingDate: string;
      rows: Array<{ shipment: FedexShipment; item: ShipmentItem; itemIndex: number; invoiceNo: string }>;
      isComplete: boolean;
    }> = [];
    const groupMap = new Map<string, typeof groups[0]>();

    for (const s of shipments) {
      let items: ShipmentItem[] = [];
      try { items = JSON.parse(s.itemsJson); } catch { items = []; }

      const invoiceNo = s.deliveryNo.match(/^(\d+)/)?.[1] ?? s.deliveryNo;
      const groupKey = `${s.trackingNumber}_${s.shippingDate}`;

      if (!groupMap.has(groupKey)) {
        const g = {
          key: groupKey,
          trackingNumber: s.trackingNumber,
          shippingDate: s.shippingDate,
          rows: [] as typeof groups[0]["rows"],
          isComplete: false,
        };
        groupMap.set(groupKey, g);
        groups.push(g);
      }
      const group = groupMap.get(groupKey)!;
      items.forEach((item, idx) => {
        // 返品商品は「返品」を除去して通常商品として扱う
        const baseJa = normalizeProductName(item.productNameJa ?? "");
        const baseEn = normalizeProductName(item.productNameEn ?? "");
        const normalizedItem: ShipmentItem = {
          ...item,
          productNameJa: baseJa,
          productNameEn: baseEn,
        };

        // 英語表示名で結合判定（日本語・英語混在やスペース有無を統一）
        const itemKey = toShipmentProductKey(baseJa, baseEn);
        const existingRow = group.rows.find(r => {
          if (r.invoiceNo !== invoiceNo) return false;
          return toShipmentProductKey(r.item.productNameJa, r.item.productNameEn) === itemKey;
        });
        if (existingRow) {
          existingRow.item = { ...existingRow.item, quantity: existingRow.item.quantity + normalizedItem.quantity };
        } else {
          group.rows.push({ shipment: s, item: normalizedItem, itemIndex: idx, invoiceNo });
        }
        if (csvData[invoiceNo]?.isComplete) group.isComplete = true;
      });
    }

    // 発送日の新しい順（M/D形式とYYYY-MM-DD形式の混在に対応）
    const parseDateStr = (s: string): number => {
      // YYYY-MM-DD形式
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s).getTime();
      // M/D または MM/DD 形式（2026年固定）
      const parts = s.split("/");
      if (parts.length === 2) {
        const m = parseInt(parts[0], 10);
        const d = parseInt(parts[1], 10);
        if (!isNaN(m) && !isNaN(d)) return new Date(2026, m - 1, d).getTime();
      }
      return 0;
    };
    return groups.sort((a, b) => parseDateStr(b.shippingDate) - parseDateStr(a.shippingDate));
  }, [shipments, csvData]);

  // 発送日が最も新しいグループを決定して展開（データ更新時に再評価）
  useEffect(() => {
    if (shipmentGroups.length > 0) {
      // shipmentGroupsは発送日順でソート済みなので先頭が最新
      const latestKey = shipmentGroups[0].key;
      // 最新グループが変わった場合のみ展開状態を更新
      if (latestKey !== initializedKey) {
        setExpandedGroups(new Set([latestKey]));
        setInitializedKey(latestKey);
      }
    }
  }, [shipmentGroups, initializedKey]);

  // インボイスごとの発注数・発送数サマリーを計算（残数表示用）
  const invoiceSummary = useMemo(() => {
    const summary: Record<string, { orderedQty: number; shippedQty: number }> = {};
    // 発注数をCSVから取得
    for (const [invoiceNo, data] of Object.entries(csvData)) {
      const orderedQty = data.products.reduce((sum, p) => sum + p.qty, 0);
      summary[invoiceNo] = { orderedQty, shippedQty: 0 };
    }
    // 発送数を集計
    for (const s of shipments) {
      const invoiceNo = s.deliveryNo.match(/^(\d+)/)?.[1] ?? s.deliveryNo;
      let items: ShipmentItem[] = [];
      try { items = JSON.parse(s.itemsJson); } catch { items = []; }
      const shipped = items.reduce((sum, item) => sum + item.quantity, 0);
      if (!summary[invoiceNo]) summary[invoiceNo] = { orderedQty: 0, shippedQty: 0 };
      summary[invoiceNo].shippedQty += shipped;
    }
    return summary;
  }, [shipments, csvData]);

  // セッション確認中
  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50 flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // ログイン画面（未認証 or 別の取引先のセッション）
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-sm shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-3">
              <div className="h-12 w-12 rounded-full bg-sky-100 flex items-center justify-center">
                <Globe className="h-6 w-6 text-sky-600" />
              </div>
            </div>
            <CardTitle className="text-xl">Partner Portal</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Shipment tracking & confirmation</p>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="password" className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                autoFocus
              />
            </div>
            <Button
              className="w-full"
              onClick={handleLogin}
              disabled={!password || loginLoading}
            >
              {loginLoading ? "Signing in..." : "Sign In"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // データ読み込み中
  if (dataLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50 flex items-center justify-center">
        <div className="text-muted-foreground">Loading shipments...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50">
      {/* ヘッダー */}
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-sky-600" />
            <span className="font-semibold text-sm">Partner Portal</span>
            <Badge variant="secondary" className="text-xs">{partnerName}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5 text-xs"
              onClick={() => {
                setShowMessageHistory(v => {
                  if (!v) {
                    // パネルを開くときに返信未読を既読にする
                    markMessagesReadMutation.mutate();
                  }
                  return !v;
                });
              }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Messages
              {(() => {
                const unreadCount = myMessages?.filter(m => m.replyText && !m.isReadByPartner).length ?? 0;
                return unreadCount > 0 ? (
                  <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] bg-sky-500">{unreadCount}</Badge>
                ) : null;
              })()}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5 text-xs"
              onClick={() => setShowMessageForm(v => !v)}
            >
              <Send className="h-3.5 w-3.5" />
              Report Issue
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              onClick={handleLogout}
              disabled={logoutMutation.isPending}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* メッセージ送信フォーム */}
        {showMessageForm && (
          <Card className="border-sky-200 bg-sky-50/50">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-sky-600" />
                Report a shortage or issue
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="Describe the shortage or issue (e.g., Invoice No.370 - Vita2000: received 4 out of 5, 1 unit missing)"
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                rows={4}
                className="bg-white"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowMessageForm(false)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={!messageText.trim() || messageSending}
                  onClick={handleSendMessage}
                  className="flex items-center gap-1.5"
                >
                  <Send className="h-3.5 w-3.5" />
                  {messageSending ? "Sending..." : "Send Message"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* メッセージ履歴 */}
        {showMessageHistory && (
          <Card className="border-slate-200">
            <CardHeader className="pb-2 pt-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-sky-600" />
                <span className="text-sm font-semibold">Message History</span>
                <div className="ml-auto relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search messages..."
                    value={messageSearch}
                    onChange={e => setMessageSearch(e.target.value)}
                    className="pl-7 h-7 text-xs w-44"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {!myMessages || myMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No messages sent yet.</p>
              ) : (
                <div className="space-y-3">
                  {myMessages
                    .filter(msg => {
                      if (!messageSearch.trim()) return true;
                      const q = messageSearch.toLowerCase();
                      return (
                        msg.message.toLowerCase().includes(q) ||
                        (msg.replyText ?? "").toLowerCase().includes(q)
                      );
                    })
                    .map((msg) => {
                      const isCollapsed = collapsedMessages.has(msg.id);
                      const msgThreads = (threads ?? []).filter(t => t.parentMessageId === msg.id);
                      const isReplying = replyingToId === msg.id;
                      return (
                        <div key={msg.id} className="rounded-lg border bg-white p-3 space-y-2">
                          {/* ヘッダー行 */}
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs text-muted-foreground">{new Date(msg.createdAt).toLocaleString()}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground"
                                title={isCollapsed ? "Show content" : "Hide content"}
                                onClick={() => setCollapsedMessages(prev => {
                                  const next = new Set(prev);
                                  if (next.has(msg.id)) next.delete(msg.id);
                                  else next.add(msg.id);
                                  return next;
                                })}
                              >
                                {isCollapsed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteMyMessageMutation.mutate({ id: msg.id })}
                                disabled={deleteMyMessageMutation.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          {/* メッセージ本文（非表示時は件名のみ） */}
                          {isCollapsed ? (
                            <p className="text-xs text-muted-foreground italic">[Content hidden — click eye icon to show]</p>
                          ) : (
                            <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                          )}
                          {/* 管理者の最初の返信（replyText） */}
                          {!isCollapsed && msg.replyText && (
                            <div className="mt-2 rounded bg-sky-50 border border-sky-200 p-2.5">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Reply className="h-3.5 w-3.5 text-sky-600" />
                                <span className="text-xs font-medium text-sky-700">Reply from seller</span>
                                <Badge className="ml-auto text-xs bg-sky-100 text-sky-700 border-sky-200">Replied</Badge>
                              </div>
                              <p className="text-sm whitespace-pre-wrap">{msg.replyText}</p>
                              {msg.repliedAt && (
                                <p className="text-xs text-muted-foreground mt-1">{new Date(msg.repliedAt).toLocaleString()}</p>
                              )}
                            </div>
                          )}
                          {/* スレッド返信一覧 */}
                          {!isCollapsed && msgThreads.length > 0 && (
                            <div className="space-y-2 mt-1">
                              {msgThreads.map(t => (
                                <div key={t.id} className={`rounded p-2.5 border ${
                                  t.senderType === "admin"
                                    ? "bg-sky-50 border-sky-200"
                                    : "bg-slate-50 border-slate-200"
                                }`}>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Reply className="h-3.5 w-3.5 text-sky-600" />
                                    <span className="text-xs font-medium text-sky-700">
                                      {t.senderType === "admin" ? `Reply from seller (${t.senderName})` : `You (${t.senderName})`}
                                    </span>
                                    <span className="ml-auto text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</span>
                                  </div>
                                  <p className="text-sm whitespace-pre-wrap">{t.content}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* 返信ボタン・フォーム */}
                          {!isCollapsed && (
                            <div className="mt-1">
                              {isReplying ? (
                                <div className="space-y-2">
                                  <Textarea
                                    placeholder="Type your reply..."
                                    value={threadReplyTexts[msg.id] ?? ""}
                                    onChange={e => setThreadReplyTexts(prev => ({ ...prev, [msg.id]: e.target.value }))}
                                    rows={3}
                                    className="text-sm"
                                  />
                                  <div className="flex justify-end gap-2">
                                    <Button variant="ghost" size="sm" onClick={() => setReplyingToId(null)}>Cancel</Button>
                                    <Button
                                      size="sm"
                                      disabled={!(threadReplyTexts[msg.id] ?? "").trim() || addThreadReplyMutation.isPending}
                                      onClick={() => addThreadReplyMutation.mutate({
                                        parentMessageId: msg.id,
                                        content: threadReplyTexts[msg.id] ?? "",
                                      })}
                                      className="flex items-center gap-1.5"
                                    >
                                      <Send className="h-3.5 w-3.5" />
                                      {addThreadReplyMutation.isPending ? "Sending..." : "Send Reply"}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                (msg.replyText || msgThreads.length > 0) && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs text-sky-600 hover:text-sky-700 px-2"
                                    onClick={() => setReplyingToId(msg.id)}
                                  >
                                    <Reply className="h-3.5 w-3.5 mr-1" />
                                    Reply
                                  </Button>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 未完了インボイス一覧（発送残数あり） */}
        {(() => {
          const pendingInvoices = Object.entries(csvData)
            .map(([invoiceNo, data]) => {
              const summary = invoiceSummary[invoiceNo];
              const remaining = summary ? Math.max(0, summary.orderedQty - summary.shippedQty) : data.products.reduce((s, p) => s + p.qty, 0);
              return { invoiceNo, data, remaining };
            })
            // インボイス370以降・未完了・残数ありのみ表示
            .filter(({ remaining, data, invoiceNo }) => remaining > 0 && !data.isComplete && parseInt(invoiceNo) >= 370)
            .sort((a, b) => parseInt(a.invoiceNo) - parseInt(b.invoiceNo));

          if (pendingInvoices.length === 0) return null;
          return (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-100">
                  <span className="text-amber-600 text-xs font-bold">{pendingInvoices.length}</span>
                </span>
                <h2 className="font-semibold">Pending Orders</h2>
                <span className="text-xs text-muted-foreground">(items still awaiting shipment)</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-xs h-7 px-2 text-muted-foreground"
                  onClick={() => setShowPendingOrders(v => !v)}
                >
                  {showPendingOrders ? "Hide" : "Show"}
                </Button>
              </div>
              {showPendingOrders && (
                <Card className="border-amber-200 bg-amber-50/40">
                  <CardContent className="p-0">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-amber-200/60">
                          <th className="text-left py-2 px-4 text-xs font-medium text-muted-foreground">Invoice</th>
                          <th className="text-left py-2 px-4 text-xs font-medium text-muted-foreground">Product</th>
                          <th className="text-right py-2 px-4 text-xs font-medium text-muted-foreground">Ordered</th>
                          <th className="text-right py-2 px-4 text-xs font-medium text-muted-foreground">Shipped</th>
                          <th className="text-right py-2 px-4 text-xs font-medium text-muted-foreground">Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingInvoices.map(({ invoiceNo, data, remaining }) => {
                          const summary = invoiceSummary[invoiceNo];
                          return data.products.map((p, pi) => {
                            const productEn = toEnglishProductName(p.name);
                            const displayName = (productEn && productEn !== p.name) ? productEn : p.name;
                            return (
                              <tr key={`${invoiceNo}-${pi}`} className="border-b border-amber-100/60 last:border-0">
                                <td className="py-2 px-4 text-muted-foreground text-xs">No.{invoiceNo}</td>
                                <td className="py-2 px-4 font-medium">{displayName}</td>
                                <td className="py-2 px-4 text-right text-muted-foreground">{p.qty}</td>
                                <td className="py-2 px-4 text-right font-semibold">{summary?.shippedQty ?? 0}</td>
                                <td className="py-2 px-4 text-right font-bold text-amber-600">{remaining}</td>
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })()}

        {/* 発送一覧 */}
        <div className="flex items-center gap-2 mb-2">
          <Package className="h-5 w-5 text-sky-600" />
          <h2 className="font-semibold">Shipment Records</h2>
          <span className="text-sm text-muted-foreground">({shipmentGroups.length} shipments)</span>
        </div>

        {shipmentGroups.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No shipment records found.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {shipmentGroups.map((group, groupIdx) => {
              const isExpanded = expandedGroups.has(group.key);
              const toggleGroup = () => {
                setExpandedGroups(prev => {
                  const next = new Set(prev);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                });
              };
              return (
              <Card key={group.key} className={group.isComplete ? "opacity-70" : ""}>
                {/* トグルヘッダー */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg"
                  onClick={toggleGroup}
                >
                  <div className="text-muted-foreground flex-shrink-0">
                    {isExpanded
                      ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                      : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                    }
                  </div>
                  <span className="text-sm font-medium text-muted-foreground flex-shrink-0">Tracking:</span>
                  <span className="font-mono font-semibold text-sm">{group.trackingNumber}</span>
                  <span className="text-sm text-muted-foreground">·</span>
                  <span className="text-sm text-muted-foreground flex-shrink-0">{group.shippingDate}</span>
                  {groupIdx === 0 && (
                    <Badge className="bg-sky-500/10 text-sky-600 border-sky-200 text-xs flex-shrink-0">Latest</Badge>
                  )}
                  {group.isComplete && (
                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200 text-xs flex-shrink-0">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Complete
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">{group.rows.length} item{group.rows.length !== 1 ? "s" : ""}</span>
                </div>
                {/* 展開時の内容 */}
                {isExpanded && (
                <CardContent className="px-4 pb-4 border-t">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground text-xs border-b">
                        <th className="text-left py-1.5 font-medium">Invoice</th>
                        <th className="text-left py-1.5 font-medium">Product</th>
                        <th className="text-right py-1.5 font-medium">Ordered</th>
                        <th className="text-right py-1.5 font-medium">Shipped</th>
                        <th className="text-right py-1.5 font-medium">Remaining</th>
                        <th className="text-center py-1.5 font-medium w-16">Received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row, i) => {
                        const inv = csvData[row.invoiceNo];
                        // 商品名マッチング（英語変換後の名前でも照合）
                        const rowProductEn = toEnglishProductName(row.item.productNameJa || row.item.productNameEn || "");
                        const matchedProduct = inv?.products.find(p => {
                          const pLower = p.name.toLowerCase();
                          const jaLower = (row.item.productNameJa ?? "").toLowerCase();
                          const enLower = (row.item.productNameEn ?? "").toLowerCase();
                          const rowEnLower = rowProductEn.toLowerCase();
                          // matchesCsvProductNameで照合（Random Colorは全色対応）
                          if (matchesCsvProductName(row.item.productNameJa || row.item.productNameEn || "", p.name)) return true;
                          return (
                            pLower.includes(jaLower) ||
                            jaLower.includes(pLower) ||
                            pLower.includes(enLower) ||
                            enLower.includes(pLower) ||
                            pLower.includes(rowEnLower) ||
                            rowEnLower.includes(pLower)
                          );
                        });
                        const checkKey = `${row.shipment.id}_${row.itemIndex}`;
                        const isChecked = checks[checkKey] ?? false;

                        // 残数計算
                        const summary = invoiceSummary[row.invoiceNo];
                        const orderedQty = matchedProduct?.qty ?? summary?.orderedQty ?? 0;
                        const shippedQty = row.item.quantity;
                        // インボイス全体の残数
                        const invoiceRemaining = summary
                          ? Math.max(0, summary.orderedQty - summary.shippedQty)
                          : null;

                        // 英語変換名を優先（CSV名が日本語の場合も英語表示）
                        const csvName = matchedProduct?.name ?? "";
                        const csvNameEn = toEnglishProductName(csvName);
                        // CSV名が英語変換できた場合はそれを使用、できない場傈は直接英語変換を使用
                        const displayName = (csvNameEn && csvNameEn !== csvName) ? csvNameEn
                          : rowProductEn || row.item.productNameEn || csvName || row.item.productNameJa;

                        return (
                          <tr key={i} className={`border-b border-border/50 last:border-0 transition-colors ${isChecked ? "bg-emerald-50/50" : ""}`}>
                            <td className="py-2 text-muted-foreground text-xs">
                              <div>No.{row.invoiceNo}</div>
                            </td>
                            <td className="py-2">
                              <div className="font-medium">{displayName}</div>
                            </td>
                            <td className="py-2 text-right text-muted-foreground">
                              {orderedQty > 0 ? orderedQty : "-"}
                            </td>
                            <td className="py-2 text-right font-semibold">{shippedQty}</td>
                            <td className="py-2 text-right">
                              {invoiceRemaining !== null && invoiceRemaining > 0 ? (
                                <span className="text-amber-600 font-medium">{invoiceRemaining}</span>
                              ) : invoiceRemaining === 0 ? (
                                <span className="text-emerald-600 font-medium">0</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="py-2 text-center">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  toggleCheckMutation.mutate({
                                    fedexShipmentId: row.shipment.id,
                                    itemIndex: row.itemIndex,
                                    isChecked: !!checked,
                                  });
                                }}
                                className="data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
                )}
              </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
