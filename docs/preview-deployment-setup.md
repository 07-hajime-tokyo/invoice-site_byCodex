# プレビューデプロイメント設定ガイド

このドキュメントは、`cursor/preview-deployment-merge-e261` ブランチのVercelプレビューデプロイメントをセットアップする手順を説明します。

## 概要

このブランチは `staff/yousunafu/local-remake-setup` の大規模リファクタリングに、mainブランチの最新の修正（Vita正規化、インボイス・外装ダメージマッチング改善）を統合したものです。

プレビュー環境は **staging環境** として動作し、本番データベースや外部サービスへの書き込みを行いません。

## 統合された main の変更

### 1. Vita正規化 (10/8)
- `stockProposalProductKey` 関数を追加し、Vita 1100 を Vita 1000 として正規化
- 在庫提案のグルーピングで一貫性のある製品マッチングを実現

### 2. インボイスマッチング改善 (10/11)
- 状態修飾子（good/screen-defect/junk）によるマッチングを追加
- 管理番号の状態表記とインボイス状態行を正確に照合

### 3. 外装ダメージマッチング (10/13)
- "exterior-damage" 条件を追加
- 外装傷ありの管理番号を適切なインボイス行に分類

## Vercel環境変数の設定

プレビュー環境を動作させるには、以下の環境変数を **Preview scope** で設定してください：

### 必須環境変数

```bash
# アプリケーション環境（staging に設定）
APP_ENV=staging

# データベースURL（本番とは別のstaging/test用DB）
DATABASE_URL=mysql://user:password@host:port/staging_db

# 認証関連
JWT_SECRET=<staging用のシークレット>
OAUTH_SERVER_URL=<OAuth サーバーURL>
OWNER_OPEN_ID=<オーナーのOpenID>

# ログイン許可メールアドレス（カンマ区切り）
ALLOWED_LOGIN_EMAILS=01.murakami@gmail.com,07.hajime.tokyo@gmail.com
```

### オプション環境変数

外部サービス連携が必要な場合のみ設定：

```bash
# Google関連（必要に応じて）
GOOGLE_SHEETS_CREDENTIALS=<JSON>
GAS_WEBHOOK_SECRET=<シークレット>

# Forge AI（必要に応じて）
BUILT_IN_FORGE_API_URL=<URL>
BUILT_IN_FORGE_API_KEY=<キー>

# Gemini AI（必要に応じて）
GEMINI_API_KEY=<キー>

# eBay/FedEx（必要に応じて）
# これらを設定しない場合、該当機能は無効化されます
```

## Staging データベースのセットアップ

### オプション1: TiDB ブランチを使用

TiDB Cloudを使用している場合、本番DBのブランチを作成：

```bash
# TiDB CLIでブランチを作成
ticloud branch create --cluster <cluster-id> --branch-name staging-preview
```

ブランチのDATABASE_URLを取得して、Vercel Preview環境変数に設定。

### オプション2: 新規DBを作成してマイグレーション

```bash
# 1. 新しいMySQL/TiDB インスタンスを作成
# 2. スキーマをマイグレート
pnpm drizzle-kit push

# 3. 初期データをインポート（必要に応じて）
# 本番DBからダンプを取得してインポート
```

### オプション3: ローカルのテストDB

開発用の架空データでテスト：

```bash
# tests/regression/ のシードデータを使用
# DATABASE_URLを設定後、テストを実行してデータを作成
pnpm check:regression
```

## Staging環境での制限事項

`APP_ENV=staging` が設定されている場合、以下の機能は **無効化** されます：

### 無効化される機能

1. **Cronジョブ** - すべてのcronエンドポイントは早期returnし、`{ skipped: true, reason: "staging environment" }` を返します
   - `/api/cron/fedex-missing`
   - `/api/cron/inbound-classify`
   - `/api/cron/inventory-snapshot`
   - `/api/cron/defective-yahoo-prices`
   - `/api/cron/receipt-ack-import`
   - `/api/cron/receipt-ack-stale`

2. **GAS Webhook** - Google Apps Scriptからの書き込みを拒否

3. **外部サービスへの書き込み**
   - Google Sheets更新
   - eBay API呼び出し
   - FedEx API呼び出し
   - zaico API呼び出し

### 動作する機能

- 認証・ログイン（ALLOWED_LOGIN_EMAILSで制限）
- すべての読み取り専用API
- UIの表示・操作
- staging DBへの読み書き
- ローカルファイルストレージ（添付ファイルなど）

## デプロイメント手順

### 1. ブランチをプッシュ

```bash
git push origin cursor/preview-deployment-merge-e261
```

### 2. Vercel環境変数を設定

Vercel Dashboard → Project Settings → Environment Variables で、上記の環境変数を **Preview** scopeで設定。

### 3. プレビューデプロイメントの確認

- GitHub PRが作成されると、Vercelが自動的にプレビューをデプロイ
- デプロイURLはPRコメントに表示されます
- `https://invoice-site-bycodex-<hash>.vercel.app` のような形式

### 4. 動作確認

以下を確認：

1. **ログイン** - 許可されたメールアドレスでログイン可能
2. **在庫一覧** - データが表示される
3. **発注登録** - Vita正規化が動作
4. **インボイス** - 状態修飾子マッチングが動作
5. **Cronエンドポイント** - スキップメッセージが返される

## トラブルシューティング

### ログインできない

- `ALLOWED_LOGIN_EMAILS` が正しく設定されているか確認
- 使用しているメールアドレスがリストに含まれているか確認

### データベース接続エラー

- `DATABASE_URL` が正しく設定されているか確認
- staging DBが起動しているか確認
- マイグレーションが実行されているか確認

### 外部サービスエラー

- staging環境では外部サービスへの書き込みは無効化されています
- エラーではなく、スキップメッセージが返されるのが正常です

### ビルドエラー

- 型チェック: `pnpm check`
- テスト: `pnpm test`
- ビルド: `pnpm build`

## 既知の問題

### テスト失敗

以下のテストは環境依存で失敗する可能性があります：

1. **Gemini API テスト** - `GEMINI_API_KEY` が未設定の環境では失敗（既知）
2. **tradeStatus 399ルール** - 特定のインボイス番号条件（ドキュメント参照）

これらは既知の問題で、staging環境の動作には影響しません。

## 本番デプロイへの移行

プレビューで動作を確認後、本番への統合手順：

1. PRをレビュー
2. テストがすべて成功することを確認
3. `staff/yousunafu/local-remake-setup` へマージ
4. 本番デプロイは別途計画・実施

**注意**: このブランチは自動的に本番デプロイされません。`vercel.json` でデプロイメントが制御されています。
