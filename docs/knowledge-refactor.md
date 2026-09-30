# 会話履歴・ナレッジ・AI領域の整理（knowledge）

- 基準コミット: `2da96a7`。担当ブランチ: `staff/yousunafu/refactor-knowledge`。
- 所有範囲: `server/routers.ts` の whatsappHistory / whatsappChats / knowledgeBase の3ブロック、
  新設ルーターファイル、`server/whatsappConversations.ts`、
  `client/src/inventory/pages/WhatsappHistory.tsx`、`client/src/pages/KnowledgeBasePage.tsx`、
  `client/src/inventory/pages/AiInvestigation.tsx` と各サブフォルダー、
  `server/inventory/aiInvestigation.ts`（棚卸しのみ）、この文書。
- UI・機能・API契約・保存値・保存順を維持するローカルのみの整理。新機能・バグ修正・依存追加・スキーマ変更なし。

## 1. 棚卸し（整理前の構造）

### 1-1. server/routers.ts `whatsappHistory` ブロック（2108〜2425行、約318行）

| 手続き | 種別 | DB | 外部サービス |
| --- | --- | --- | --- |
| extractNumbers | mutation | invoice_number_history へ insert / select | 画像ファイルのみ Forge API vision（env未設定なら黙ってスキップ、try/catchで握る）。PDF名・txt本文の正規表現抽出はDBのみ |
| getNextNumber | query | invoice_number_history・invoices を select | なし（DB完結） |
| saveHistory | mutation | whatsapp_chat_history へ insert | type=screenshot のときだけ `storagePut`（S3）。type=chat_text はDB完結 |
| listHistory | query | whatsapp_chat_history select | なし（DB完結） |
| deleteHistory | mutation | whatsapp_chat_history delete | なし（DB完結） |
| analyzeHistoryItem | mutation | whatsapp_chat_history select | Forge API 必須（env未設定なら「Forge API not configured」で即エラー）。screenshot は S3 fetch + vision、chat_text は `detectPaymentsFromChat` + 正規表現（ただしenvチェックが分岐より先） |

依存: `protectedProcedure`/`router`（_core/trpc）、`z`、`getDb`、`invoiceNumberHistory`・`invoices`・`whatsappChatHistory`（drizzle/schema）、`desc`・`eq`・`isNull`（drizzle-orm）、`detectPaymentsFromChat`（invoices/chatParsing）、動的import `./storage`。

### 1-2. server/routers.ts `whatsappChats` ブロック（2428〜2696行、約269行）

| 手続き | 種別 | DB | 外部サービス |
| --- | --- | --- | --- |
| listConversations | query | whatsapp_conversations + whatsapp_messages 集計 | なし（DB完結） |
| getMessages | query | whatsapp_messages（キーワード検索 / 期間窓 + 最低件数フォールバック） | なし（DB完結） |
| importChat | mutation | 会話upsert、dedupeKeyで重複排除して100件ずつinsert、境界日時をupdate | なし（DB完結。解析は `parseWhatsAppExport` 等の純関数） |
| translate | mutation | 未翻訳を select → bodyJa を update | Gemini（`translateMessages`）。GEMINI_API_KEY 未設定なら pending>0 でエラー、pending=0 ならDBのみで完結 |
| deleteConversation | mutation | messages → conversation の順に delete | なし（DB完結） |

ブロック専用の定数 `WHATSAPP_RECENT_DAYS` / `WHATSAPP_EXPAND_MONTHS` / `WHATSAPP_MIN_MESSAGES`（routers.ts 29〜34行）はこのブロックだけが使う（クライアント側 WhatsappHistory.tsx は表示文言用に同値 14 / 3 を別定義 — 既存の重複、値の共有はしない方針のまま記録のみ）。

依存: `router`/`protectedProcedure`、`z`、`getDb`、`whatsappConversations`・`whatsappMessages`（schema）、`eq`・`desc`・`asc`・`and`・`or`・`like`・`gte`・`sql`・`isNull`（drizzle-orm）、`parseWhatsAppExport`・`isOwnerSender`・`looksJapanese`・`makeDedupeKey`・`translateMessages`（server/whatsappConversations.ts）。

### 1-3. server/routers.ts `knowledgeBase` ブロック（2699〜3320行、約622行）

| 手続き | 種別 | DB | 外部サービス |
| --- | --- | --- | --- |
| upload | mutation | chat_knowledge insert | Forge API 必須（env未設定で即エラー）。画像/PDFは `storagePut`（S3）。AI要約は失敗時フォールバックあり |
| list | query | chat_knowledge select（content除く列指定） | なし（DB完結） |
| delete | mutation | chat_knowledge delete | なし（DB完結） |
| createConversation | mutation | chat_conversations insert（$returningId） | なし（DB完結） |
| listConversations | query | chat_conversations select | なし（DB完結） |
| deleteConversation | mutation | ai_chat_messages → chat_conversations delete | なし（DB完結） |
| chat | mutation | chat_knowledge 全件を文脈化、ai_chat_messages へ user/assistant を保存、初回はタイトル自動更新 | Forge API 必須（env未設定で即エラー） |
| getChatHistory | query | ai_chat_messages select（conversationId 任意、limit 200） | なし（DB完結） |
| clearChatHistory | mutation | ai_chat_messages delete（全件 or conversationId） | なし（DB完結） |
| extractFromKnowledge | mutation | chat_knowledge select | Forge API 必須 |
| detectStatusFromKnowledge | mutation | chat_knowledge select。**空なら env チェック前に「知識ベースが空です…」を返す（DB完結の分岐）** | Forge API 必須（非空時） |
| getLatestInvoiceNumber | mutation | 同上（空チェックが先） | Forge API 必須（非空時） |

依存: `router`/`protectedProcedure`、`z`、`getDb`、`chatKnowledge`・`chatConversations`・`aiChatMessages`（schema）、`eq`・`desc`・`asc`（drizzle-orm）、動的import `./storage`。

### 1-4. server/whatsappConversations.ts（228行、既存SSOT）

- 解析純関数: `parseWhatsAppExport`、`isOwnerSender`、`makeDedupeKey`、`looksJapanese`（export済み）、内部に `buildDate`/`parseDatePart`/`parseTimePart`/`matchHeader`/`isSystemLine`。
- 翻訳: `translateMessages`（Gemini呼び出し、チャンク分割、失敗チャンクは黙って飛ばす）。
- ルーター3ブロック内にこのファイルとの重複定義は無し（SSOT化の追加作業は不要と確認）。

### 1-5. クライアント3画面

- `WhatsappHistory.tsx`（516行）: 型 `ViewMode`、定数 `VIEW_MODES`/`SELECTED_KEY`/`RECENT_DAYS`/`EXPAND_MONTHS`/`WALL_CLOCK_TZ`、純関数 `formatDateTime`/`formatDay`/`formatTime`/`tidy`、残りは画面本体（state・query・イベント・JSX）。
- `KnowledgeBasePage.tsx`（550行）: 型 `FileItem`/`ChatMessage`、純表示ヘルパー `getFileIcon`（JSX返し）/`getSourceTypeLabel`、残りは画面本体。
- `AiInvestigation.tsx`（981行）: 型 `EvidenceRow`/`EvidenceSection`/`InvestigationResult`/`InvestigationHistoryItem`/`InvestigationChatMessage`、定数 `DEFAULT_EXAMPLES`/`EXAMPLES_STORAGE_KEY`/`HISTORY_STORAGE_KEY`、localStorage入出力 `loadExamples`/`loadHistory`、純関数 `formatHistoryDate`/`formatCellValue`/`toNumber`/`invoiceNoFromDeliveryNo`/`displayDate`/`buildDeliveryHistoryUrl`/`buildSearchUrl`/`firstSearchTerm`/`formatEbayStatus`/`getEbayStatusCode`/`formatEbayOrderSummary`/`splitInvestigationAnswer`/`summarizeProducts`、独立表示部品 `InvestigationAnswer`/`DeliveryEvidenceGroups`/`EvidenceTable`、画面本体 `AiInvestigation`（調査実行・履歴・チャット配線）。

### 1-6. server/inventory/aiInvestigation.ts（1,572行、今回コード変更なし）

第5節（K-A3）に棚卸しを記載。

## 2. 作業計画と結果

| ID | 単位 | 結果 |
| --- | --- | --- |
| 基準 | tests/regression/knowledge.test.ts（DB完結手続きの整理前基準） | 完了（db378ba、13テスト） |
| K-A1 | 3ブロックを whatsappHistoryRouter.ts / whatsappChatsRouter.ts / knowledgeBaseRouter.ts へ逐語移動 | 完了（66e5d9d、byte単位で基準と一致を確認） |
| K-A2 | 3画面の型・純関数・表示部品をサブフォルダーへ抽出（単体テスト先行） | 完了（969d9dc、単体テスト49件を先行作成。移動はコメント1行の参照先更新を除き逐語） |
| K-A3 | aiInvestigation.ts の棚卸し記録（第5節、コード変更なし） | 完了（本コミット） |

## 2-1. 検証結果（最終）

- `pnpm check`: エラーなし（K-A1後・K-A2後の両方で確認）。
- `pnpm vitest run`: 614テスト中613成功。失敗1件は `server/gemini.test.ts` のAPIキー未設定による既知の失敗（整理前から同じ）。新規の単体テスト49件（whatsapp-history/view 8件、knowledge-base/presentation 6件、ai-investigation/format 28件・storage 7件）を含む。
- `node scripts/test-local-regression.mjs`: 13ファイル96テスト全成功（knowledge.test.ts の13件を含む）。
- 逐語性: 新設ルーター3ファイルと画面から抽出した全宣言を `git show 2da96a7:<path>` と機械照合し、コード行は完全一致。意図した差分はコメント1行のみ（whatsapp-history/view.ts の窓定数コメントの参照先を routers.ts → whatsappChatsRouter.ts へ更新）。
- 作業終了時に `node scripts/test-local-regression.mjs seed` を実行し、テストDBへ架空の発注7件を再投入済み。

## 3. 気付いた既存の注意点（修正しない・記録のみ）

- `whatsappHistory.analyzeHistoryItem` は chat_text の解析（正規表現のみでAI不要）でも Forge API の env が無いと即エラーになる。envチェックが分岐の前にあるため。
- `knowledgeBase.getLatestInvoiceNumber` は `db!` と非nullアサーションで getDb() の失敗を握りつぶす（他の手続きは null チェックあり）。
- `whatsappChats` の窓定数（14日/3ヶ月/20件）はサーバー定義だが、クライアント `WhatsappHistory.tsx` が表示文言用に 14 / 3 を別定義しており、片側だけ変えるとズレる。
- `knowledgeBase.upload` の PDF 解析は `image_url` に `data:application/pdf` を渡しており、ビジョンAPIがPDFを受けない場合はフォールバック文言のまま保存される。
- `deletedItemsRouter.restore`（他領域）に `return { success: true };` 直後の到達不能コードが存在する（参考にした抽出例。方針どおり触らない）。

## 5. server/inventory/aiInvestigation.ts の棚卸し（K-A3・コード変更なし）

1,572行・エクスポートは `aiInvestigationRouter`（investigate mutation 1本）のみ。他はすべてファイル内プライベート。

### 5-1. 内部構造（行番号は基準コミット時点＝現在も同一）

| 区画 | 行 | 内容 |
| --- | --- | --- |
| 型定義 | 17〜53 | `EvidenceRow` / `EvidenceSection` / `InvestigationDateRange` / `InvestigationConversationTurn` / `EbayOrderSummary` |
| 汎用ユーティリティ | 55〜97 | `uniq` / `compactText` / `parseJsonArray` / `parseJsonList` / `parseNumber` / `pad2` / `toIsoDate` |
| 日付解釈 | 100〜179 | `currentJstYear` / `normalizeDateValue` / `dateFromDeliveryNo` / `getDeliveryHistoryDate` / `extractDateRange` / `isDateInRange` |
| 質問からの識別子抽出 | 181〜331 | `normalizeManagementTerm` / `extractIdentifiers` / `invoiceNoFromDeliveryNo` / `deliveryInvoiceNos` / `hasAnyInvoice` / 明細アクセサ `getItem*` / FedEx対象判定 `isFedexExcludedManagementNo`・`isDirectTradeFedexTarget` / `matchesNeedle` / `buildMatchers` |
| 商品名検索 | 333〜520 | `PRODUCT_STOP_WORDS` / `normalizeProductSearchText` / `productTokenVariants` / `stripProductTokenNoise` / `cleanupProductCandidateText` / `extractProductCandidateText` / `buildProductQuery` |
| 会話文脈 | 522〜551 | `hasExplicitInvestigationTarget` / `isLikelyFollowUpQuestion` / `buildContextualQuestion` |
| eBay API | 553〜680 | `extractEbayOrderId` / `getEbayEndpointBase` / `getEbayAccessToken`（静的トークン→リフレッシュトークンの順。未設定なら error 文字列を返しthrowしない） / `fetchEbayOrders`（最大8件） |
| eBay表示整形 | 682〜847 | `rowsTotal` / `formatEbayOrderStatus` / `getEbayStatusCode` / `isEbayRefunded` / `isEbayCanceled` / `describeEbayOrder(±Conclusion)` / `formatEbayOrderDetail` / `formatEbayOrderNotes` / `isEbayOrderOnlyQuestion` / `makeEbayOrderReport` |
| FedEx照合・定型レポート | 849〜1122 | `summarizeFedexRegistration` / `makeFallbackReport` / 発注状態判定 `isInventoryStatusQuestion`・`getPurchaseStatusIntent`・`isPurchaseActionDateQuestion`・`purchaseStatusMatches`・`purchaseDateMatches` / `makePurchaseListReport` / `makeProductStatusReport` / `isFedexLeakQuestion` |
| 生成AIレポート | 1124〜1223 | `shouldUseGenerativeReport`（env 2つで強制ON/OFF可） / `generateAiReport`（FedEx漏れ質問は必ず定型 → Forge API → Gemini → 定型フォールバックの順。API失敗時も定型文＋エラー付記で返し、throwしない） |
| 文脈収集本体 | 1225〜1557 | `collectInvestigationContext`: DBから tradeRecords / localPurchases / localInventories / deliveryHistories / fedexShipments を全件読み、質問種別で evidence を組み、回答は eBay専用→発注一覧→商品状態→生成AI→定型 の優先順で1つ選ぶ |
| ルーター | 1559〜1572 | `aiInvestigationRouter.investigate`（protectedProcedure mutation、`collectInvestigationContext` を呼ぶだけ） |

### 5-2. 依存と外部サービス

- DB: `getDb`（./db）+ drizzle `desc`。書き込みは一切なし（SELECTのみ）。
- 共有: `@shared/invoiceKey` の `invoiceNoFromDeliveryNo`（`invoiceNoFromDeliveryNoStrict` 名で取り込み）と `invoiceNoFromManagementNo`。
- 外部: eBay OAuth/Fulfillment API（資格情報env未設定時はエラー文字列で完結）、Forge API、Gemini（どちらも未設定時は定型レポートへフォールバックし、DB完結で応答が返る）。

### 5-3. 記録のみの気付き（修正しない）

- クライアント `ai-investigation/format.ts` と同名・同旨の関数が重複: `invoiceNoFromDeliveryNo` / `toNumber`（サーバ側は `parseNumber`） / `getEbayStatusCode` / `formatEbayStatus`（サーバ側は `formatEbayOrderStatus`、ラベル表は同一） / `formatEbayOrderSummary`（サーバ側は `describeEbayOrder`）。判定条件が似て非なるものもあるため、共有化は仕様確認込みの別作業とする。
- `collectInvestigationContext` は5テーブルを毎回全件SELECTしてからメモリ上で絞り込む。データ量が増えると重くなるが、絞り込み順序が回答内容に直結するため今回の整理では触らない。
