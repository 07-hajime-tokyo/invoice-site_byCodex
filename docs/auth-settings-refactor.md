# 認証・設定・共通基盤 リファクタリング棚卸し（staff/yousunafu/refactor-auth-settings）

基準コミット: `d103b48`。UI・機能・API契約・保存値・保存順は完全維持。新機能・修正なし。

## 対象（整理前）

### server/inventory/routers.ts の8ブロック（整理前 888行）
- `auth`（513–545）: me / logout / checkAuthorized / authorize（access_code 検証＋authorized_users 登録）
- `purchaseExtra`（565–576）: upsert / upsertBulk（savePurchaseTracking(Bulk) への委譲）
- `invoiceManualItem`（615–670）: list / listByInvoiceNos / create / update / delete
- `domesticProduct`（675–715）: list / create / update / delete
- `monthlyDomesticItem`（720–776）: list / create / update / togglePaid / delete
- `customer`（783–821）: list / create / update / delete
- `accessCode`（826–866）: verify / isSet / set（ADMIN_EMAILS チェック＋TRPCError FORBIDDEN）
- `admin`（874–881）: isAdmin
- 前半のワンタイム修復ヘルパー（repair系 112–503・setTimeout 起動）は動かさない（下記参照）

### server/routers.ts（整理前 233行）
- `quoteProxyProcedure`（29–41）: x-invoice-site-proxy-key 検証＋ローカルバイパス
- `isLocalAuthBypass` + `authGateRouter`（48–97）: checkVerified / loginWithEmail（許可リストメール・sdk.createSessionToken・cookie 設定）
- インライン `auth`（103–110）: me / logout
- インライン `quoteProxy`（112–208）: invoiceClientsList / invoicesGetNextNumber / invoicesCreate
- appRouter 合成と `export type AppRouter` は残す

### client/src/inventory/pages/Settings.tsx（整理前 934行）
- 型: `CustomerRow`(34)・`DomesticProductRow`(45)
- 本体 `Settings()`(56–934): 最上位の純粋関数は存在しない。全ハンドラ（handleAddCustomer / handleCsvFileChange / handleCsvImport / handleTest / handleToggleZaico / handleImport ほか）と全JSXセクションが state・tRPC mutation に密結合のため画面に残す（PartnerPortal P-A3 と同じ判断）

### server/_core/（23ファイル・棚卸しのみ・変更禁止）
- apiApp.ts(204): API用Expressアプリ組み立て / app.ts(25): HTTPサーバー起動
- chat.ts(123): Chat APIハンドラ / dataApi.ts(64): Forge Data API呼び出し
- context.ts(64): tRPCコンテキスト生成。**LOCAL_AUTH_BYPASS 時の擬似ユーザー（id:0, openId:"local-dev", role:"admin", email=ADMIN_EMAILS[0]）の正本**
- cookies.ts(48): セッションcookieオプションの正本（getSessionCookieOptions）
- cron.ts(187): cronエンドポイント / gasWebhook.ts(837): GAS Webhook受口 / receiptAckIngest.ts(87): 受取連絡取込
- database.ts(109): **DB接続（drizzle/mysql2）設定の正本** / env.ts(10): ENV正本
- emailAuth.ts(32): 許可リストメール認証の正本（normalizeLoginEmail / isAllowedLoginEmail / createEmailOpenId）
- sdk.ts(316): Forge SDK（セッショントークン発行・検証の正本） / oauth.ts(53): OAuthコールバック
- trpc.ts(57): router / publicProcedure / **protectedProcedure（認可の正本）** / systemRouter.ts(29): health等
- notification.ts(114)・imageGeneration.ts(92)・map.ts(319)・voiceTranscription.ts(284)・patchedFetch.ts(91): Forge系ヘルパー
- index.ts(42)・vite.ts(81): エントリ・開発サーバー

### client/src/components/AuthGate.tsx（114行・棚卸しのみ）
- trpc.authGate.checkVerified / loginWithEmail を使用する小規模コンポーネント。分割不要と判断（変更なし）

## 既存の注意点（修正せず記録のみ）
- `const publicProcedure = protectedProcedure;`: 「public」と命名された手続きも実効は protectedProcedure。抽出先の authRouter / purchaseExtraRouter / invoiceManualItemRouter / domesticProductRouter / monthlyDomesticItemRouter（publicProcedure 使用ファイルすべて）で別名を逐語再現し実効認可を維持
- inventory/routers.ts 前半のワンタイム修復コード（ebay_7696_2 系・MAXIM 404 系・setTimeout 起動、NODE_ENV!=="production" で実行）は移動せず routers.ts に残置
- `invoiceManualItem.update` は unitPrice 未指定時に null で上書き（ルーターが `input.unitPrice ?? null` を渡す）→ 回帰テストで固定
- `domesticProduct.update` も unitPrice 未指定で null 上書き（db層 `data.unitPrice != null ? String(...) : null`）→ 回帰テストで固定
- `monthlyDomesticItem.update` は対照的に patch 方式（未指定項目を保持）
- `accessCode.set("")` は system_settings に `value`="" の行が残る（未設定扱いで解除）→ 回帰テストで固定
- `inventory.auth.authorize` は access_code 未設定時に常に valid:true で authorized_users へ登録
- `customer.create` は insertId を返さない（{success:true} のみ。domesticProduct 等とは非対称）
- quoteProxy のキー無しローカルバイパスは `NODE_ENV==="development" && LOCAL_AUTH_BYPASS!=="false"` 限定（NODE_ENV=test では UNAUTHORIZED）
- `server/gemini.test.ts` は GEMINI_API_KEY 未設定環境で失敗する既存の環境依存テスト（本変更とは無関係。`pnpm vitest run` で唯一の失敗）

## 進捗
- [x] 調査・棚卸し（本ドキュメント）
- [x] C-A0: 整理前基準 tests/regression/authSettings.test.ts（コミット b26886f）
- [x] C-A1: inventory 8ブロック抽出（コミット e1b96d0）
- [x] C-A2: server/routers.ts 分割（コミット d4378d0）
- [x] C-A3: Settings.tsx 型抽出（コミット fdb8dbf）

## 変更ファイル / 検証結果

### C-A0（コミット b26886f）
- 新設 `tests/regression/authSettings.test.ts`（442行・18テスト）: authGate（checkVerified バイパス・loginWithEmail バイパス時 users 未書込）、auth.me/logout、inventory.auth（me / logout / 未設定 authorize→valid:true＋登録 / 設定時不一致→valid:false）、accessCode（未設定 verify true→set トリム保存→isSet/verify→空保存で解除）、admin.isAdmin、customer CRUD（sortOrder, displayName 順）、domesticProduct（update の unitPrice null 上書き固定）、monthlyDomesticItem（文字列 unitPrice 変換・isPaid 1/0・togglePaid）、invoiceManualItem（デフォルト値・listByInvoiceNos 空→[]・null 上書き）、purchaseExtra（upsert / upsertBulk の戻り値契約）、quoteProxy（NODE_ENV=test で UNAUTHORIZED、テスト内で NODE_ENV を一時 "development" に切替えて list / 採番 `INV-YYYYMMDD-001` / invoicesCreate＋DB検証＋重複 CONFLICT、finally で復元）
- 旧コードで全236テスト（既存218＋新規18）成功を確認してからコミット

### C-A1（コミット e1b96d0）
- `server/inventory/routers.ts` 888 → 592行。8ブロックを1行参照へ置換、ブロック専用 import（db関数19個・z・COOKIE_NAME/ADMIN_EMAILS・TRPCError・getSessionCookieOptions・purchaseTracking系4個）を削除
- 新設: authRouter.ts(45)・purchaseExtraRouter.ts(18)・invoiceManualItemRouter.ts(68)・domesticProductRouter.ts(52)・monthlyDomesticItemRouter.ts(68)・customerRouter.ts(48)・accessCodeRouter.ts(50)・adminRouter.ts(11)
- 逐語比較（行マルチセット・import行除外）: MISSING / EXTRA はラッパー行・参照行・別名・空行のみ（ブロック本体 0 / 0）。`pnpm check` クリーン。回帰 236/236 成功

### C-A2（コミット d4378d0）
- `server/routers.ts` 233 → 47行。appRouter 合成と型 export のみ残す
- 新設: `server/authGateRouter.ts`（66行・isLocalAuthBypass 同梱）・`server/quoteProxyRouter.ts`（120行・quoteProxyProcedure 同梱）・`server/authRouter.ts`（12行）
- 逐語比較: ブロック本体 MISSING=0 / EXTRA=0。`pnpm check` クリーン。回帰 236/236 成功

### C-A3（コミット fdb8dbf）
- `Settings.tsx` 934 → 912行。新設 `settings/types.ts`（22行・CustomerRow / DomesticProductRow）
- 純粋関数が存在しないため単体テストの新設なし（抽出対象は型のみ）。逐語比較: `export ` 接頭辞と空行1のみの差。`pnpm check` クリーン

### 最終確認
- `pnpm check` / `pnpm check:regression`: エラーなし
- 回帰テスト `node scripts/test-local-regression.mjs test`: 236/236 成功
- `pnpm vitest run`: 836成功 / 1失敗（既存の環境依存 `server/gemini.test.ts` のみ）
- 終了時に `node scripts/test-local-regression.mjs seed` で専用DBを架空7件に復元

## 未検証範囲
- 実ブラウザでの画面表示（Settings / AuthGate）は目視未確認（型チェック・回帰テスト・逐語比較で担保）
- `accessCode.isSet / set` の FORBIDDEN 経路（非管理者）: LOCAL_AUTH_BYPASS 環境では非管理者ユーザーを作れないため回帰テストでは未検証
- 本番認証経路（Forge セッショントークン検証・OAuth・メールログインの cookie 発行）および Zaico / GAS / Forge 通知など外部接続経路（テスト環境では無効のまま契約を固定）
