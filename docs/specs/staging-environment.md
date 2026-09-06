# 検証環境と本番切替

本仕様は検証環境の構成と受入手順を定義する。実環境の作成・検証状況は公開仕様とは別に管理する。

## 構成

| 項目 | 現在の本番 | 今回の検証系 |
| --- | --- | --- |
| Git | main | 検証用ブランチ |
| Vercel | 現行Production | 同プロジェクトのPreview。設定を確認してからpush |
| アプリ環境 | production | staging |
| URL | 現行ドメイン | 別のPreview URL |
| DB | 現行DB | 新規の独立したMySQL互換インスタンス、invoice_staging |
| データ | 実業務データ | 架空商品・発注・個体ラベルだけ |
| 外部連携 | 現行運用 | 最小入庫経路では使用しない。認証情報を渡さない |
| Cron・GAS受信・受領確認取込 | 現行運用 | 非本番HTTP入口で遮断 |

GitHubへのpushはソースコードの保存であり、検証用DBの作成や接続先の分離を意味しない。Git連携の非本番ブランチは通常Previewになるが、本番ブランチ設定・対象環境・環境変数のscopeを実際に確認する。公開リポジトリの別ブランチも公開されるため、デプロイ先の分離とは別に公開内容を扱う。

TiDB Cloud Starterを候補とする。新規インスタンスの無料枠・上限を作成画面で確認し、本番インスタンスの複製や本番データのインポートは行わない。課金プランへの変更や支払い登録はこの作業に含めない。新規インスタンスの管理者でDDLを適用し、アプリ用にはinvoice_stagingだけに必要な権限を持つ専用ユーザーを用意する。

## Preview設定

- APP_ENV=staging、DATABASE_URLは新規DB専用の秘密情報。
- NON_PRODUCTION_DATABASE_TARGETは認証情報なしの新規ホスト・ポート・invoice_staging。設定値の一致だけでは独立性の証明にはならず、作成したリソースと権限を確認する。
- DATABASE_SSL=true、DATABASE_SSL_REJECT_UNAUTHORIZED=true（クラウドDB）。
- PUBLIC_SITE_URLは実際の検証用origin。
- RUN_RUNTIME_SCHEMA_CHECK=0、RUN_INVENTORY_ONE_TIME_REPAIRS=0。
- LOCAL_AUTH_BYPASS=false。認証を維持し、JWT_SECRETは本番と別に生成する。
- Google/GAS/Drive/Gemini/Forge/eBay/CSV取得用の認証情報、外部取込secret、CRON_SECRETを本番から引き継がない。不要な外部APIを画面から呼び出す機能は最小経路の対象外であり、環境変数が空であるだけで全ネットワーク通信が遮断されたとは扱わない。
- ブラウザに渡るVITE_*変数へ秘密情報を入れない。

環境値のひな形はdocs/examples/staging.env.example。実値はVercel Preview用の設定またはGit管理外の.env.staging.localへ置く。ソースコード、ログ、会話へ秘密情報を転記しない。

## 作成・評価順序

入口遮断の受入条件は、非本番要求から業務ハンドラーを実行できないこと。正常に解析された対象要求は403。環境設定が不正なら既存の接続検証による起動失敗を維持し、不正JSONは既存パーサーの400も許容する。すべて403に揃えるために起動時検証を弱めたり、HTTP入口を増やしたりしない。

1. 新規DBインスタンスと専用ユーザーを作成し、本番への権限がないことを確認する。
2. 現在のdrizzle/schema.tsから空DB用DDLを生成・確認する。履歴migrationだけで現在のschemaと一致すると仮定しない。
3. 空のinvoice_stagingにDDLを適用し、架空商品1件・発注5個・未入庫ラベル5件をseedする。非空のDBを初期化・上書きしない。
4. VercelのPreview設定と本番ブランチ設定を確認する。公開対象の差分を確認したうえで許可された作業ブランチへpushする。mainへのpush・mergeは行わない。
5. 作成されたDeploymentのtarget=previewと候補SHA、接続先、URLを確認する。
6. purchase-registration-first-slice.mdの操作・永続化・重複要求・失敗時整合性を検証する。Cronなどの直呼び出しでも処理されないことを確認する。

## ブルーグリーンとの関係

今回のダミーデータ環境はステージングであり、そのDBを本番DBへ置き換えて昇格する運用にはしない。評価済みコードを本番用設定で候補デプロイし、本番DBとの互換性を確認した後、別の本番反映判断でトラフィックを切り替える。

本番切替前には、schemaの後方互換性、実行中の旧アプリとの共存、DB変更の適用順、ロールバック可能範囲を設計する。アプリを戻してもDB更新は自動で巻き戻らない。Previewをそのまま昇格させれば環境変数まで安全に切り替わるとは仮定しない。

## 参考

- [Vercel Git連携](https://vercel.com/docs/git)
- [Vercel環境変数](https://vercel.com/docs/environment-variables)
- [Vercel Cron](https://vercel.com/docs/cron-jobs)
- [TiDB Cloudインスタンス作成](https://docs.pingcap.com/tidbcloud/create-tidb-cluster-serverless/)
