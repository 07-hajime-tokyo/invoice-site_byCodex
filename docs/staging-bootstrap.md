# 独立検証DBのschema exportとseed

## 境界

`drizzle/schema.ts` を唯一のschema定義として、新しい空のMySQL/TiDBデータベース用DDLをオフライン生成する。既存の `drizzle/` migrationsは現行schemaとの同期が保証されていないため、この手順では適用しない。

このリポジトリのスクリプトはDB/schemaを作成せず、DDLも適用しない。クラウドDB作成、権限設定、DDL適用、デプロイは別工程とする。schema exportは接続設定を子プロセスから除外して `drizzle-kit generate` を実行するため、DB接続を必要としない。

seedは架空データだけを使い、`local_inventories`、`local_purchases`、`inventory_item_labels` の3表を同一トランザクション内で検査する。3表がすべて空の場合だけ、現在庫0の商品1件、数量5・`ordered`の発注1件、未入庫ラベル5件を挿入する。いずれかが非空なら変更せず失敗する。truncate、delete、dropは行わない。

## schema export

依存関係を用意したworktreeで、対象コミットから次を実行する。

```powershell
node scripts/staging/export-schema.mjs baseline-<commit-sha>
```

DDLとDrizzle snapshotは `scripts/staging/generated/baseline-<commit-sha>/` に新規生成される。既存出力先は上書きしないため、再生成時は別名を使う。生成された `*_baseline.sql` が空DB向けの全DDLであり、適用はDB作成後に承認済みの別工程で行う。

## seed

外部工程で次を完了してから実行する。

1. 専用DBと最小権限ユーザーを作る。
2. DB/schema名を厳密に `invoice_staging` とする。
3. 上記exportで生成したDDLを空DBへ適用する。
4. アプリ本体や別のseedを起動していないことを確認する。

PowerShellでは秘密値をファイルやコマンド履歴へ残さない方法で環境変数を設定し、次を実行する。

```powershell
$env:APP_ENV = "staging"
$env:DATABASE_URL = "<secret-managed mysql URL ending in /invoice_staging>"
$env:NON_PRODUCTION_DATABASE_TARGET = "mysql://<host>:<port>/invoice_staging"
$env:DATABASE_SSL = "1" # TiDB Cloudは既存接続コードでも自動有効。明示を推奨する。
$env:DATABASE_SSL_REJECT_UNAUTHORIZED = "1"
.\node_modules\.bin\tsx.CMD scripts\staging\seed.ts
```

`NON_PRODUCTION_DATABASE_TARGET` は認証情報を含めず、`DATABASE_URL` とhost・port・DB名が一致しなければならない。seedは接続前に `APP_ENV=staging`、既存の `assertDatabaseTarget`、`invoice_staging`、TLS設定を検証する。リモートの非TiDB接続では `DATABASE_SSL=1` が必須で、証明書検証の無効化は拒否する。接続情報はログに出さず、DBドライバの例外は固定メッセージへ置き換える。transaction失敗時はcommit状態を断定せず不明と表示する。transaction成功後の接続cleanup失敗はcommit済みと明示し、seedの再実行前に対象3表を確認する。

## 既存実装との整合

既存schemaと購入登録APIが使う永続化名は `labelCode` ではなく `labelId` である。`labelId` はIとOを除く英大文字7文字で、未入庫は `status: "ordered"` と `receivedAt: null` で表す。発注の `itemsJson` は既存 `createOrderedPurchase` と同じく、文字列の `quantity`、`unit_price`、`status`、`inventory_id`、`inventoryId`、`etc` を持つ配列とした。

単体テストは接続前ガード、TLS、JSON snapshot、空表だけへの挿入、再実行拒否、トランザクションのロールバック、commit後のcleanup失敗、例外の秘匿をfake DBで検証する。実DBへの接続とDDL適用後の動作は未検証であり、受入試験では別途確認が必要である。
