# ENV_EXAMPLE.md — 環境変数一覧

> **注意:** このファイルの内容を `.env` にコピーして実際の値を設定してください。秘密鍵は絶対にGitにコミットしないでください。

```bash
# =============================================================================
# データベース
# =============================================================================
# 必須 | MySQL / TiDB 接続文字列
# 取得元: 自前のMySQL / PlanetScale / TiDB Cloud / Railway 等
DATABASE_URL=mysql://user:password@localhost:3306/invoice_site

# TiDB Cloud example (Retro-game-quote / main / invoice_site_by_codex)
# DATABASE_URL=mysql://user:password@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/invoice_site_by_codex

# 任意 | DB SSL設定
# 未設定の場合、ホスト名に tidbcloud が含まれていれば自動でSSL接続します。
DATABASE_SSL=
DATABASE_SSL_REJECT_UNAUTHORIZED=true
DATABASE_POOL_LIMIT=10

# =============================================================================
# 認証 (JWT / セッション)
# =============================================================================
# 必須 | セッションCookieの署名に使用するシークレットキー（32文字以上推奨）
JWT_SECRET=your-super-secret-jwt-key-change-this

# =============================================================================
# Manus OAuth（Manus環境専用 — Codex/Vercel移行時は別の認証に置き換える）
# =============================================================================
# Manus環境必須 | ManusアプリのID（Manusダッシュボードで確認）
VITE_APP_ID=your-manus-app-id

# Manus環境必須 | Manus OAuthバックエンドのベースURL
OAUTH_SERVER_URL=https://api.manus.im

# Manus環境必須 | ManusログインポータルのフロントエンドURL
VITE_OAUTH_PORTAL_URL=https://manus.im

# Manus環境必須 | アプリオーナーのOpenID（通知送信先の特定に使用）
OWNER_OPEN_ID=your-owner-open-id

# Manus環境任意 | アプリオーナーの表示名
OWNER_NAME=your-owner-name

# =============================================================================
# Manus Forge API（Manus環境専用 / 現在は未使用でも可）
# Codex/Vercelでは画像解析に GEMINI_API_KEY を使用
# =============================================================================
# 任意 | Manus Forge APIのベースURL（サーバーサイド用）
BUILT_IN_FORGE_API_URL=https://forge.manus.im

# 任意 | Manus Forge APIのBearerトークン（サーバーサイド用）
BUILT_IN_FORGE_API_KEY=your-forge-api-key

# 任意 | Manus Forge APIのBearerトークン（フロントエンド用）
VITE_FRONTEND_FORGE_API_KEY=your-frontend-forge-api-key

# 任意 | Manus Forge APIのURL（フロントエンド用）
VITE_FRONTEND_FORGE_API_URL=https://forge.manus.im

# =============================================================================
# Google Sheets API（取引データのスプレッドシート連携）
# =============================================================================
# 必須 | Google Cloud サービスアカウントのJSONキー（1行のJSON文字列）
# 取得元: Google Cloud Console → IAM → サービスアカウント → キーを作成
# 権限: Google Sheets API の編集権限が必要
# 対象スプレッドシートID: 1yOBlT5PbKGQOILcd0LUqo0_Ql_27g6MbQLb-g5cHVyw
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n","client_email":"...@....iam.gserviceaccount.com"}

# =============================================================================
# Gemini API（インボイス画像解析）
# =============================================================================
# 任意 | Google Gemini APIキー（無料枠で画像解析を使う場合に設定）
# 取得元: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your-gemini-api-key

# 任意 | Geminiモデル（未設定時は gemini-2.5-flash-lite）
GEMINI_MODEL=gemini-2.5-flash-lite

# =============================================================================
# eBay API（AI調査のOrderページ確認）
# =============================================================================
# 任意 | eBay本番APIは production、Sandboxを使う場合のみ sandbox
EBAY_ENV=production

# 任意 | eBay Developer App ID。EBAY_CLIENT_ID の代わりに EBAY_APP_ID でも可
EBAY_CLIENT_ID=your-ebay-client-id

# 任意 | eBay Developer Cert ID。EBAY_CLIENT_SECRET の代わりに EBAY_CERT_ID でも可
EBAY_CLIENT_SECRET=your-ebay-client-secret

# 任意 | eBay OAuth refresh token（Sell Fulfillment APIの読み取り権限が必要）
EBAY_REFRESH_TOKEN=your-ebay-refresh-token

# 任意 | refresh tokenで使用するscope。未設定時はSell Fulfillment読み取りのみ
EBAY_SCOPES=https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly

# 任意 | 一時的なaccess tokenを直接使う場合のみ設定（通常はrefresh token推奨）
EBAY_ACCESS_TOKEN=

# 任意 | AI調査で使用するモデル名（未設定時は gpt-4o）
AI_INVESTIGATION_MODEL=gpt-4o

# 任意 | AI調査でGeminiを使う場合のモデル名（未設定時は GEMINI_MODEL を使用）
AI_INVESTIGATION_GEMINI_MODEL=gemini-2.5-flash-lite

# =============================================================================
# AWS S3（ロゴ・WhatsApp解析ファイル・ナレッジベースファイルの保存）
# =============================================================================
# 必須 | AWSアクセスキーID
# 取得元: AWS Console → IAM → ユーザー → アクセスキー
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE

# 必須 | AWSシークレットアクセスキー
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# 必須 | S3バケットのリージョン
AWS_REGION=ap-northeast-1

# 必須 | S3バケット名（パブリック読み取り可能に設定すること）
AWS_S3_BUCKET=your-s3-bucket-name

# =============================================================================
# アプリ設定（フロントエンド表示用）
# =============================================================================
# 任意 | ブラウザタブに表示するアプリタイトル
VITE_APP_TITLE=ゲーム機取引データ 検索サイト

# 任意 | ヘッダーに表示するロゴ画像のURL
VITE_APP_LOGO=https://your-cdn.example.com/logo.png

# =============================================================================
# アナリティクス（任意）
# =============================================================================
# 任意 | アナリティクスエンドポイント（Umami等）
VITE_ANALYTICS_ENDPOINT=

# 任意 | アナリティクスのウェブサイトID
VITE_ANALYTICS_WEBSITE_ID=

# =============================================================================
# 入出庫管理
# =============================================================================
# 外部Zaico/ManusアプリURLは使用しません。入出庫管理はサイト内DBで動作します。

# 任意 | 出庫時に発送管理スプレッドシートへ書き込むGAS Web App URL
GAS_WEBHOOK_URL=https://script.google.com/macros/s/your-deployment-id/exec

# 任意 | GAS連携で使用する共有シークレット
GAS_WEBHOOK_SECRET=replace-with-a-long-random-secret

# 任意 | Vercel Cron認証用。設定した場合はVercel側にも同じ値を設定してください。
CRON_SECRET=replace-with-a-long-random-secret

# 任意 | FedEx発送登録漏れの自動チェック対象日数（未設定時: 7日）
FEDEX_MISSING_LOOKBACK_DAYS=7

# 任意 | 出庫登録から何時間後に漏れ判定するか（未設定時: 6時間）
FEDEX_MISSING_GRACE_HOURS=6

# =============================================================================
# 移行時に追加が必要な環境変数（Manus OAuth置き換え後）
# =============================================================================
# 例: NextAuth.jsを使う場合
# NEXTAUTH_SECRET=your-nextauth-secret
# NEXTAUTH_URL=http://localhost:3000

# 例: OpenAI APIを使う場合（Forge APIの代替）
# OPENAI_API_KEY=sk-...
# OPENAI_BASE_URL=https://api.openai.com/v1
```

## 環境変数の必須/任意まとめ

| 変数名 | 必須/任意 | 用途 | 取得元 |
|---|---|---|---|
| `DATABASE_URL` | **必須** | MySQL/TiDB接続 | 自前DB / PlanetScale / TiDB Cloud |
| `JWT_SECRET` | **必須** | セッションCookie署名 | 任意の32文字以上ランダム文字列 |
| `VITE_APP_ID` | Manus必須 | Manus OAuth アプリID | Manusダッシュボード |
| `OAUTH_SERVER_URL` | Manus必須 | Manus OAuth バックエンドURL | Manusダッシュボード |
| `VITE_OAUTH_PORTAL_URL` | Manus必須 | Manusログインポータルフロント | Manusダッシュボード |
| `OWNER_OPEN_ID` | Manus必須 | オーナー通知送信先 | Manusダッシュボード |
| `OWNER_NAME` | 任意 | オーナー表示名 | 任意 |
| `BUILT_IN_FORGE_API_URL` | 任意 | Manus Forge API URL | Manusダッシュボード |
| `BUILT_IN_FORGE_API_KEY` | 任意 | Manus Forge API キー | Manusダッシュボード |
| `VITE_FRONTEND_FORGE_API_KEY` | 任意 | フロントエンドForge APIキー | Manusダッシュボード |
| `VITE_FRONTEND_FORGE_API_URL` | 任意 | フロントエンドForge API URL | Manusダッシュボード |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **必須** | Google Sheets API認証 | Google Cloud Console |
| `GEMINI_API_KEY` | 任意 | インボイス画像解析（無料枠利用） | Google AI Studio |
| `GEMINI_MODEL` | 任意 | Geminiモデル名 | Google AI Studio |
| `EBAY_ENV` | 任意 | eBay API環境（production/sandbox） | eBay Developer |
| `EBAY_CLIENT_ID` | 任意 | eBay API App ID | eBay Developer |
| `EBAY_CLIENT_SECRET` | 任意 | eBay API Cert ID | eBay Developer |
| `EBAY_REFRESH_TOKEN` | 任意 | eBay OAuth refresh token | eBay Developer |
| `EBAY_SCOPES` | 任意 | eBay OAuth scope | eBay Developer |
| `EBAY_ACCESS_TOKEN` | 任意 | eBay access token直接指定 | eBay Developer |
| `AI_INVESTIGATION_MODEL` | 任意 | AI調査のモデル名 | Forge/OpenAI互換API |
| `AI_INVESTIGATION_GEMINI_MODEL` | 任意 | AI調査用Geminiモデル名 | Google AI Studio |
| `AWS_ACCESS_KEY_ID` | **必須** | S3ファイルストレージ | AWS Console |
| `AWS_SECRET_ACCESS_KEY` | **必須** | S3ファイルストレージ | AWS Console |
| `AWS_REGION` | **必須** | S3バケットリージョン | AWS Console |
| `AWS_S3_BUCKET` | **必須** | S3バケット名 | AWS Console |
| `VITE_APP_TITLE` | 任意 | ブラウザタブタイトル | 任意 |
| `VITE_APP_LOGO` | 任意 | ヘッダーロゴURL | 任意 |
| `VITE_ANALYTICS_ENDPOINT` | 任意 | アナリティクスURL | Umami等 |
| `VITE_ANALYTICS_WEBSITE_ID` | 任意 | アナリティクスID | Umami等 |
| `GAS_WEBHOOK_SECRET` | 任意 | GASから発注済みデータを登録するWebhook認証 | 任意の長いランダム文字列 |
| `CRON_SECRET` | 任意 | Vercel Cron API認証 | 任意の長いランダム文字列 |
| `FEDEX_MISSING_LOOKBACK_DAYS` | 任意 | FedEx発送登録漏れチェック対象日数 | 例: 7 |
| `FEDEX_MISSING_GRACE_HOURS` | 任意 | 出庫登録後、漏れ判定まで待つ時間 | 例: 6 |
