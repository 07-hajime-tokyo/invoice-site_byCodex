# CODEX_HANDOFF.md — ゲーム機取引データ 検索・管理サイト

> **目的:** このドキュメントは、Manus環境で開発されたアプリを **OpenAI Codex / Vercel / 任意のNode.jsホスト** へ完全移行するための引き継ぎ資料です。

> **進行中の運用引き継ぎ:** 2026年6月末棚卸しの調査結果・確定値・未反映修正・別PCでの再開手順は [`INVENTORY_RECONCILIATION_2026-06_HANDOFF.md`](./INVENTORY_RECONCILIATION_2026-06_HANDOFF.md) を参照してください。

---

## 1. 技術スタック

| レイヤー | 技術 | バージョン |
|---|---|---|
| フロントエンド | React 19 + TypeScript | 19.2.1 |
| スタイリング | Tailwind CSS 4 + shadcn/ui | 4.1.14 |
| ルーティング | wouter | 3.7.1 |
| UIコンポーネント | Radix UI + lucide-react | 各最新 |
| チャート | Recharts | 2.15.2 |
| API通信 | tRPC 11 + TanStack Query 5 | 11.6.0 / 5.90.2 |
| バックエンド | Express 4 + tsx (Node.js) | 4.21.2 |
| データシリアライズ | superjson | 1.13.3 |
| ORM | Drizzle ORM | 0.44.5 |
| DB | MySQL / TiDB (本番: Manus管理TiDB) | — |
| 認証 | Manus OAuth (JWT cookie) | — |
| PDF生成 | pdfkit + jsPDF + pdf-lib | 各最新 |
| 画像生成 | dom-to-image-more / html2canvas | — |
| AI | Manus Forge API (OpenAI互換) + Gemini | — |
| ファイルストレージ | AWS S3 (Manus管理バケット) | — |
| 外部スプレッドシート | Google Sheets API v4 | — |
| 在庫管理連携 | サイト内統合（ローカルDB + tRPC） | — |
| ビルドツール | Vite 7 + esbuild | 7.1.7 |
| パッケージマネージャ | pnpm 10 | 10.4.1 |
| テスト | Vitest 2 | 2.1.4 |

---

## 2. 起動手順

### 前提条件
- Node.js 20以上
- pnpm 10以上 (`npm install -g pnpm`)
- MySQL 8.0以上 または TiDB互換DB
- 必要な環境変数（`.env`ファイル）が設定済みであること

### ローカル開発起動

```bash
# 1. 依存インストール
pnpm install

# 2. .envファイルを作成（.env.exampleをコピーして値を設定）
cp .env.example .env
# .envを編集して実際の値を入力

# 3. DBマイグレーション実行
pnpm db:push

# 4. 開発サーバー起動（フロント + バックエンド同時起動）
pnpm dev
# → http://localhost:3000 で起動
```

### 本番ビルド

```bash
pnpm build
# → dist/public/ にフロントエンド成果物
# → dist/index.js にバックエンドバンドル

pnpm start
# → NODE_ENV=production node dist/index.js
```

---

## 3. ビルド手順詳細

```bash
# フロントエンドビルド（Vite）
vite build
# → client/ をビルドして dist/public/ に出力

# バックエンドビルド（esbuild）
esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
# → dist/index.js に出力

# 型チェック
pnpm check   # tsc --noEmit
```

**注意:** `vite-plugin-manus-runtime` がビルドに含まれています。Manus環境外では後述の「差し替えポイント」を参照してください。

---

## 4. テスト手順

```bash
pnpm test
# → vitest run で全テストを実行

# テストファイル
# server/auth.logout.test.ts  — ログアウトエンドポイントのテスト
# server/gemini.test.ts       — Gemini API連携テスト
```

---

## 5. 主要画面と機能一覧

| 画面 | パス | 主な機能 |
|---|---|---|
| 取引データダッシュボード | `/` (Home.tsx) | KPIカード・フィルター・テーブル・チャート・取引追加/編集/削除 |
| 入出庫管理 | `/inventory/*` (Homeタブ切替) | サイト内統合された入出庫管理 |
| インボイス管理 | `/` (Homeタブ切替) | 請求書一覧・作成・編集・PDF出力・WhatsApp解析・自動採番 |
| ナレッジベース | `/knowledge` (KnowledgeBasePage.tsx) | ファイルアップロード・AI会話・インボイス番号抽出 |
| コンポーネント一覧 | `/showcase` (ComponentShowcase.tsx) | UIコンポーネントのデモ |

### 取引データ機能詳細

- **全文検索:** 商品名・取引相手・状況をスペース無視で横断検索
- **フィルター:** 年・月範囲（四半期ショートカット付き）・取引相手・通貨・状況・未完了のみ
- **KPIカード:** 還付金合計・還付込み利益合計・売上合計・注文数・取引先数・送料合計・関税合計
- **チャート:** 月別売上/利益推移・取引相手別売上・通貨別構成
- **取引編集:** 商品名・価格・数量・通貨・状況・仕入れ・発送日・送料・還付・関税（USD取引のみ自動計算）
- **発送管理:** 分割発送対応・送料自動按分・発送記録一覧・編集・削除
- **Google Sheets同期:** 取引追加/更新時にスプレッドシートへ自動反映

### インボイス機能詳細

- **宛先管理:** 顧客情報（名前・会社・住所・メール）のCRUD
- **WhatsApp解析:** チャットテキスト貼り付け→AI自動解析→インボイス自動生成
- **自動採番:** 過去インボイスから最大番号+1を自動設定
- **100万円超過自動分割:** 保存時に円換算合計が100万円を超えると分割確認ダイアログ表示
- **PDF出力:** ブラウザ印刷ダイアログ経由でPDF保存
- **差出人設定:** ロゴ画像アップロード・会社情報・税率の永続保存
- **ゴミ箱機能:** ソフトデリート・復元・完全削除

---

## 6. tRPC / API 一覧

全エンドポイントは `/api/trpc` 以下のtRPCバッチリンクで提供されます。

### 認証系

| プロシージャ | 種別 | 説明 |
|---|---|---|
| `auth.me` | query | 現在のログインユーザー情報を返す |
| `auth.logout` | mutation | セッションCookieを削除してログアウト |
| `checkVerified` | query | アクセスコード認証済みかチェック |
| `verifyCode` | mutation | アクセスコードを検証して認証済みフラグを保存 |

### 取引データ系

| プロシージャ | 種別 | 説明 |
|---|---|---|
| `trade.listFromDb` | query | DBから取引データを検索・フィルタリングして返す |
| `trade.updateInDb` | mutation | DBの取引データを更新（シンプル版） |
| `trade.deleteFromDb` | mutation | DBの取引データを削除 |
| `trade.getFilterOptions` | query | フィルター用ユニーク値（年・取引先・通貨・状況）を返す |
| `trade.getExchangeRates` | query | Frankfurter APIから現在の為替レート（EUR/USD→JPY）を取得 |
| `trade.getRateByDate` | query | 指定日の為替レートを取得 |
| `trade.findRowByInvoiceNo` | query | インボイスNo.でスプレッドシートの行を検索 |
| `trade.updateRecord` | mutation | スプレッドシート + DB を同時更新（利益自動計算付き） |
| `trade.addRecord` | mutation | スプレッドシート + DB に新規取引を追加 |

### Zaico在庫管理系

| プロシージャ | 種別 | 説明 |
|---|---|---|

### インボイス系

| プロシージャ | 種別 | 説明 |
|---|---|---|
| `invoiceClients.list` | query | 宛先一覧を取得 |
| `invoiceClients.get` | query | 宛先詳細を取得 |
| `invoiceClients.create` | mutation | 宛先を作成 |
| `invoiceClients.update` | mutation | 宛先を更新 |
| `invoiceClients.delete` | mutation | 宛先を削除 |
| `invoices.list` | query | インボイス一覧を取得（削除済み除く） |
| `invoices.get` | query | インボイス詳細を取得 |
| `invoices.parseWhatsApp` | mutation | WhatsAppテキストをAIで解析してインボイスデータを生成 |
| `invoices.detectPayments` | mutation | テキストから入金情報を検出 |
| `invoices.analyzeScreenshot` | mutation | スクリーンショットをAIで解析 |
| `invoices.getNextNumber` | query | 次のインボイス番号を返す |
| `invoices.create` | mutation | インボイスを作成 |
| `invoices.update` | mutation | インボイスを更新 |
| `invoices.delete` | mutation | インボイスをソフトデリート |
| `invoices.restore` | mutation | ソフトデリートされたインボイスを復元 |
| `invoices.permanentDelete` | mutation | インボイスを完全削除 |
| `invoices.listDeleted` | query | ゴミ箱内インボイス一覧 |
| `invoices.updateStatus` | mutation | インボイスのステータスを更新 |
| `invoices.getLatest` | query | 最新インボイスを取得 |
| `invoices.getExchangeRate` | query | Frankfurter APIで為替レートを取得 |
| `invoices.createSplit` | mutation | インボイスを分割して複数作成 |
| `invoices.clone` | mutation | インボイスを複製 |
| `invoiceSettings.get` | query | 差出人設定を取得 |
| `invoiceSettings.save` | mutation | 差出人設定を保存 |
| `invoiceSettings.uploadLogo` | mutation | ロゴ画像をS3にアップロード |

### WhatsApp履歴・番号抽出系

| プロシージャ | 種別 | 説明 |
|---|---|---|
| `whatsappHistory.extractNumbers` | mutation | WhatsAppチャット/PDF/画像からインボイス番号を抽出 |
| `whatsappHistory.getNextNumber` | query | 次のインボイス番号を返す（履歴ベース） |
| `whatsappHistory.saveHistory` | mutation | 解析履歴をDB/S3に保存 |
| `whatsappHistory.listHistory` | query | 解析履歴一覧を取得 |
| `whatsappHistory.deleteHistory` | mutation | 解析履歴を削除 |
| `whatsappHistory.analyzeHistoryItem` | mutation | 保存済み履歴アイテムを再解析 |

### ナレッジベース系

| プロシージャ | 種別 | 説明 |
|---|---|---|
| `knowledgeBase.upload` | mutation | ファイルをS3にアップロードしてDBに登録 |
| `knowledgeBase.list` | query | ナレッジファイル一覧を取得 |
| `knowledgeBase.delete` | mutation | ナレッジファイルを削除 |
| `knowledgeBase.createConversation` | mutation | AI会話セッションを作成 |
| `knowledgeBase.listConversations` | query | 会話セッション一覧を取得 |
| `knowledgeBase.deleteConversation` | mutation | 会話セッションを削除 |
| `knowledgeBase.chat` | mutation | ナレッジベースを参照してAI回答を生成 |
| `knowledgeBase.getChatHistory` | query | 会話履歴を取得 |
| `knowledgeBase.clearChatHistory` | mutation | 会話履歴を削除 |
| `knowledgeBase.extractFromKnowledge` | mutation | ナレッジからインボイス番号を抽出 |
| `knowledgeBase.detectStatusFromKnowledge` | mutation | ナレッジから取引ステータスを検出 |
| `knowledgeBase.getLatestInvoiceNumber` | query | 最新インボイス番号を取得 |

### 発送管理系

| プロシージャ | 種別 | 説明 |
|---|---|---|
| `shipment.list` | query (protected) | 発送記録一覧を取得 |
| `shipment.invoiceSummary` | query (protected) | インボイスNo.別発送サマリーを取得 |
| `shipment.byInvoice` | query (protected) | 特定インボイスの発送記録を取得 |
| `shipment.create` | mutation (protected) | 発送記録を作成 |
| `shipment.update` | mutation (protected) | 発送記録を更新 |
| `shipment.delete` | mutation (protected) | 発送記録を削除 |

### システム系

| プロシージャ | 種別 | 説明 |
|---|---|---|
| `system.notifyOwner` | mutation (protected) | オーナーに通知を送信 |

---

## 7. DB テーブルと用途

| テーブル名 | 用途 |
|---|---|
| `users` | Manus OAuthで認証されたユーザー情報（openId・name・email・role） |
| `verified_users` | アクセスコード認証済みユーザー（openId単位で管理） |
| `trade_records` | ゲーム機取引データ（No.・商品名・数量・価格・通貨・状況・利益計算済み値） |
| `shipments` | 発送記録（発送日・追跡番号・実際の送料・メモ） |
| `shipment_items` | 発送明細（発送ID・インボイスNo.・発送台数） |
| `invoice_clients` | インボイス宛先（顧客情報） |
| `invoices` | インボイス本体（番号・宛先・日付・通貨・ステータス・ソフトデリート） |
| `invoice_items` | インボイス明細行（商品名・数量・単価・税） |
| `invoice_settings` | 差出人設定（会社名・住所・ロゴURL・税率） |
| `invoice_number_history` | 抽出済みインボイス番号の履歴 |
| `whatsapp_chat_history` | WhatsApp解析履歴（テキスト・画像・PDF） |
| `chat_knowledge` | ナレッジベースファイル（S3キー・ファイル名・MIME） |
| `chat_conversations` | AI会話セッション |
| `ai_chat_messages` | AI会話メッセージ履歴 |

### trade_records の主要カラム

| カラム | 型 | 説明 |
|---|---|---|
| `no` | INT | スプレッドシートのNo.（取引番号） |
| `month` | VARCHAR | 月（"1"〜"12"） |
| `partner` | VARCHAR | 取引相手名 |
| `paymentDate` | VARCHAR | 支払い日（ISO文字列） |
| `productName` | TEXT | 商品名 |
| `quantity` | DECIMAL(10,2) | 注文数 |
| `unitPrice` | DECIMAL(12,4) | 商品価格（元通貨） |
| `currency` | VARCHAR | 通貨（"ユーロ" / "ドル"） |
| `unitPriceJPY` | DECIMAL(14,4) | 商品価格（円換算） |
| `totalSales` | DECIMAL(16,4) | 売上合計（円） |
| `procurementTotal` | DECIMAL(16,4) | 仕入れ合計（円） |
| `refund` | DECIMAL(14,4) | 還付金（円） |
| `shippingCost` | DECIMAL(14,4) | 送料（円） |
| `customsDuty` | DECIMAL(14,4) | 関税（円、USD取引のみ: 商品価格円換算×数量×10%） |
| `profitWithRefund` | DECIMAL(16,4) | 還付込み利益（円） |
| `cumulativeProfit` | DECIMAL(16,4) | 累積利益（円） |

---

## 8. 外部サービス連携

| サービス | 用途 | 設定箇所 |
|---|---|---|
| **Google Sheets API v4** | 取引データの読み書き（スプレッドシートID: `1yOBlT5PbKGQOILcd0LUqo0_Ql_27g6MbQLb-g5cHVyw`） | `GOOGLE_SERVICE_ACCOUNT_JSON` |
| **Frankfurter API** | EUR/USD→JPY為替レート取得（無料・APIキー不要） | `https://api.frankfurter.app` |
| **入出庫管理** | サイト内DBで在庫・発注・出庫を管理 | 外部Zaico/Manus URLは使用しない |
| **Manus Forge API** | LLM（OpenAI互換）・画像生成・音声認識 | `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` |
| **Gemini API** | WhatsApp解析・インボイス番号抽出・ナレッジベースAI | `GEMINI_API_KEY` |
| **AWS S3** | ロゴ画像・WhatsApp解析ファイル・ナレッジベースファイルの保存 | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `AWS_S3_BUCKET` |
| **Manus OAuth** | ユーザー認証（Manus固有のOAuth2フロー） | `VITE_APP_ID` / `OAUTH_SERVER_URL` / `VITE_OAUTH_PORTAL_URL` |

---

## 9. Manus環境依存の箇所

以下の箇所はManus固有の機能に依存しており、Codex/Vercel等への移行時に差し替えが必要です。

### 9-1. `vite-plugin-manus-runtime`（最重要）

```ts
// vite.config.ts
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
plugins = [..., vitePluginManusRuntime(), ...]
```

このプラグインはManus環境でのみ動作します。**Codex/Vercel移行時は削除してください。**

```ts
// 差し替え後（vite.config.ts）
const plugins = [react(), tailwindcss(), jsxLocPlugin()];
// vitePluginManusRuntime() と vitePluginManusDebugCollector() を削除
```

### 9-2. Manus OAuth認証

`server/_core/oauth.ts` がManus OAuth (`OAUTH_SERVER_URL`) に依存しています。

**差し替え方法:**
- NextAuth.js / Auth.js / Clerk / Supabase Auth などに置き換える
- `server/_core/context.ts` の `ctx.user` 取得ロジックを変更する
- フロントエンドの `client/src/_core/hooks/useAuth.ts` を対応する認証ライブラリのhookに置き換える
- `client/src/const.ts` の `getLoginUrl()` を変更する

### 9-3. Manus Forge API（LLM・画像生成・音声認識）

`BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` はManus内部APIです。

**差し替え方法:**
- OpenAI API: `OPENAI_API_KEY` を設定し、`server/_core/sdk.ts` のbaseURLを `https://api.openai.com/v1` に変更
- `server/_core/imageGeneration.ts` / `server/_core/voiceTranscription.ts` も同様に変更

### 9-4. Zaico連携URL

```ts
// server/routers.ts:47
// 外部Zaico/ManusアプリURLは使用しません。inventory router を同一アプリ内に統合します。
```

この URL はManus上の別アプリです。**環境変数化を推奨します。**

```ts
// 外部在庫管理URLは不要です。
```

### 9-5. allowedHosts（Vite開発サーバー）

```ts
// vite.config.ts
allowedHosts: [".manuspre.computer", ".manus.computer", ...]
```

Codex/ローカル開発では `"localhost"` のみで十分です。

### 9-6. Manus通知API

`server/_core/notification.ts` の `notifyOwner()` はManus内部通知APIを使用しています。Codex移行時はSlack/メール等に差し替えてください。

### 9-7. ManusDialog コンポーネント

`client/src/components/ManusDialog.tsx` はManus固有のダイアログUIです。削除またはカスタムダイアログに置き換えてください。

### 9-8. `client/public/__manus__/` ディレクトリ

デバッグ用のManus固有ファイルです。本番デプロイ時は不要です。

---

## 10. Codex / Vercel等への移行時の差し替えポイント

### 最小限の移行手順

1. **`vite-plugin-manus-runtime` を削除**（`package.json` と `vite.config.ts`）
2. **認証を置き換え**（Manus OAuth → NextAuth.js等）
3. **LLM APIを置き換え**（Forge API → OpenAI API）
4. **環境変数を設定**（`.env.example` 参照）
5. **DBを用意**（MySQL 8.0以上 または PlanetScale/TiDB Cloud）
6. **S3バケットを用意**（AWS S3またはCloudflare R2）
7. **Google Sheets APIの認証情報を設定**
8. **Zaico URLを環境変数化**

### Vercel固有の注意点

- `pnpm build` でビルド後、`dist/public/` を静的ホスティング、`dist/index.js` をServerless Functionとして設定
- Vercel Edge Runtimeは非対応（Node.js Runtimeを使用）
- 環境変数はVercelダッシュボードで設定

### Docker化する場合

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

---

## 11. DB初期化手順

### 新規セットアップ

```bash
# 1. MySQLデータベースを作成
mysql -u root -p -e "CREATE DATABASE invoice_site CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. .envにDATABASE_URLを設定
# DATABASE_URL=mysql://user:password@localhost:3306/invoice_site
# TiDB Cloud: DATABASE_URL=mysql://user:password@<tidb-host>:4000/invoice_site_by_codex
# tidbcloud ホストの場合は自動でSSL接続します

# 3. Drizzleマイグレーションを実行
pnpm db:push
# → drizzle-kit generate && drizzle-kit migrate が実行される
```

### マイグレーションファイル

`drizzle/` ディレクトリに `0000_*.sql` 〜 `0015_*.sql` の16個のマイグレーションファイルがあります。`pnpm db:push` で自動適用されます。

### 既存データの移行

本番DBのデータをエクスポートする場合:

```bash
# MySQLダンプ
mysqldump -u user -p invoice_site trade_records invoices invoice_clients invoice_items invoice_settings > backup.sql

# インポート
mysql -u user -p invoice_site < backup.sql
```

### Google Sheetsからのデータインポート

`scripts/import-csv.mjs` を使用してCSVデータをDBにインポートできます:

```bash
node scripts/import-csv.mjs
```

---

## 12. 静的アセット・フォント

### フォントファイル（PDF生成用）

以下のフォントファイルがリポジトリに含まれています:

```
server/fonts/NotoSansJP-Regular.ttf  — 日本語PDF生成用（通常）
server/fonts/NotoSansJP-Bold.ttf     — 日本語PDF生成用（太字）
```

`server/pdfGenerator.ts` で参照されています。

### フロントエンドフォント

Google Fonts CDN経由で読み込まれます（`client/index.html`）。オフライン環境では別途ダウンロードが必要です。

### ロゴ・画像

ロゴ画像はS3に保存され、DBの `invoice_settings.logoUrl` で参照されます。移行時はS3バケットのデータも移行してください。

---

## 13. 本番環境の外部URL一覧

| 用途 | URL |
|---|---|
| 本番サイト | `https://csvsearch-yrduex7p.manus.space` |
| Frankfurter 為替API | `https://api.frankfurter.app` |
| Google Sheets | `https://sheets.googleapis.com/v4/spreadsheets/1yOBlT5PbKGQOILcd0LUqo0_Ql_27g6MbQLb-g5cHVyw` |
| Manus OAuth | `OAUTH_SERVER_URL` 環境変数で設定 |
| Manus Forge API | `BUILT_IN_FORGE_API_URL` 環境変数で設定 |

---

## 14. アクセス制御

- **Manus OAuth認証:** ログインユーザーのみアクセス可能（`AuthGate` コンポーネントで制御）
- **アクセスコード認証:** 追加の入室コード（`verified_users` テーブルで管理）
- **発送管理API:** `protectedProcedure` でログイン必須
- **管理者機能:** `users.role = 'admin'` で制御（現在は未使用）
