# ゲーム機取引データ 検索・分析サイト

ゲーム機の輸出入取引データを検索・可視化し、インボイス（請求書）の作成・管理を一元化するプライベートWebアプリケーションです。

**本番URL:** https://csvsearch-yrduex7p.manus.space

---

## 主な機能

### 取引データ タブ

GitHubリポジトリ上のCSVファイル（[rara-wq/csv-data-site](https://github.com/rara-wq/csv-data-site)）をリアルタイムで読み込み、以下の操作が行えます。

| 機能 | 説明 |
|------|------|
| 全文検索 | 商品名・取引相手・状況などをキーワードで横断検索 |
| カラムフィルター | 年・月・取引相手・通貨・ステータスで絞り込み |
| ソート | 各列ヘッダーをクリックして昇順/降順切り替え |
| ページネーション | 大量データを50件単位で表示 |
| KPIカード | 還付込み利益合計・売上合計・総注文数・取引相手数をリアルタイム集計 |
| チャート | 月別利益/売上・取引相手別・商品TOP10・累積利益の4種グラフ |
| 新規登録 | フォームからCSVへ追記（GitHub API経由） |
| URLシェア | 検索条件・フィルターをURLクエリパラメータで保持・共有 |

### 入出庫管理 タブ

入出庫管理はこのアプリ内に統合され、ログイン後にサイト内DBの在庫・発注・出庫データを表示します。
Google Apps Scriptから `POST /api/gas/purchase-order` に送信すると、スプレッドシートのA列チェックをこのサイトの発注済みデータとして反映できます。設定例は [references/gas-purchase-order.md](references/gas-purchase-order.md) を参照してください。

### インボイス タブ

WhatsAppのチャット履歴からインボイス（請求書）を自動生成・管理します。

| 機能 | 説明 |
|------|------|
| チャット解析 | WhatsAppテキストまたはスクリーンショットを貼り付けると、Gemini AIが商品・数量・単価を自動抽出 |
| インボイス編集 | 品目・数量・単価・税率・通貨・メモを自由に編集 |
| 宛先管理 | クライアント（請求先）情報をDBに保存・再利用 |
| 差出人設定 | 会社名・住所・ロゴ画像（S3）を保存 |
| PDF出力 | Node.js（pdfkit）でサーバーサイドPDF生成、NotoSansJPフォントで日本語対応 |
| インボイス番号管理 | チャット履歴から既存番号を自動検出し、次番号を提案 |
| ステータス管理 | draft / sent / paid の3段階 |

---

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui |
| ルーティング | Wouter 3 |
| API通信 | tRPC 11 + TanStack Query 5 |
| バックエンド | Express 4 + TypeScript (tsx watch) |
| データベース | MySQL / TiDB (Drizzle ORM) |
| AI | Google Gemini API（チャット解析・スクリーンショット解析） |
| PDF生成 | pdfkit（Node.jsネイティブ、Python不要） |
| ファイルストレージ | AWS S3（ロゴ画像・チャット画像） |
| 認証 | Manus OAuth |
| ビルドツール | Vite 7 + esbuild |

---

## データソース

取引データはGitHubリポジトリのCSVファイルから取得しています。

```
https://raw.githubusercontent.com/rara-wq/csv-data-site/refs/heads/main/data.csv
```

CSVの主なカラム：月・取引相手・No・支払日・商品名・数量・単価・通貨・円換算単価・状況・仕入先・東京発送・売上合計・仕入合計・還付・送料・還付込み利益・累積利益

---

## ディレクトリ構成

```
csv-search-site/
├── client/
│   └── src/
│       ├── pages/
│       │   ├── Home.tsx          # メインページ（取引データ・入出庫・インボイス タブ）
│       │   └── InvoicePage.tsx   # インボイス管理UI
│       ├── components/
│       │   ├── DataTable.tsx     # 取引データテーブル
│       │   ├── FilterPanel.tsx   # フィルターパネル
│       │   ├── ChartSection.tsx  # チャート（Recharts）
│       │   ├── KpiCard.tsx       # KPIカード
│       │   └── AddTradeDialog.tsx # 新規取引登録ダイアログ
│       └── lib/
│           └── csvUtils.ts       # CSV取得・パース・フィルタリング
├── server/
│   ├── routers.ts                # tRPC ルーター（全API定義）
│   ├── db.ts                     # DBクエリヘルパー
│   ├── pdfGenerator.ts           # pdfkitによるPDF生成
│   ├── fonts/                    # NotoSansJPフォント（ローカル用）
│   └── _core/                    # フレームワーク基盤（OAuth・tRPC設定等）
├── drizzle/
│   └── schema.ts                 # DBスキーマ定義
└── shared/
    └── types.ts                  # 共有型定義
```

---

## データベーススキーマ

| テーブル | 説明 |
|----------|------|
| `users` | 認証ユーザー（Manus OAuth） |
| `invoice_clients` | インボイス宛先（クライアント）情報 |
| `invoices` | インボイスヘッダー（番号・日付・通貨・ステータス等） |
| `invoice_items` | インボイス明細行（商品名・数量・単価・税率） |
| `invoice_settings` | 差出人設定（会社名・住所・ロゴURL等） |
| `invoice_number_history` | チャット履歴から抽出したインボイス番号の履歴 |
| `whatsapp_chat_history` | アップロード済みWhatsAppチャット履歴 |

---

## ローカル開発

```bash
# 依存パッケージのインストール
pnpm install

# 環境変数の設定（.envファイルを作成）
# DATABASE_URL, JWT_SECRET, GEMINI_API_KEY 等が必要

# TiDB Cloudを使う場合:
# DATABASE_URL に TiDB Cloud の接続文字列を設定
# 今回のDB名: invoice_site_by_codex
# ホスト名に tidbcloud が含まれる場合は自動でSSL接続

# DBスキーマの適用
pnpm db:push

# 開発サーバーの起動（http://localhost:3000）
pnpm dev

# テストの実行
pnpm test
```

---

## PDF生成について

インボイスのPDF出力は **pdfkit**（Node.jsネイティブライブラリ）を使用しており、Pythonや外部コマンドへの依存はありません。日本語テキストのレンダリングには **NotoSansJP** フォントを使用しています。

- **ローカル環境:** `server/fonts/` ディレクトリのフォントファイルを使用
- **本番環境:** 初回リクエスト時にCDNから自動ダウンロード・キャッシュ

---

## ライセンス

Private repository — 無断転載・再配布禁止
