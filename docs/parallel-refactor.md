# 並行リファクタリングの分担

2026-09-30。ユーザーの指定は「作業用2チャット＋元のチャットで全体管理」です。
共通のアプリ基準は入庫一覧P01〜P09を整理した `0574249`。その上に担当別のDB制限とこの運用を追加して各作業を分岐します。

## 共通の条件

- SSOTと1ファイル1責務を進め、UI・機能・API契約・保存値は維持する。
- ユーザーの指定によりローカルのみ。mainへの変更、GitHubへのpush、Vercel操作、本番DB/キーの利用は禁止。AGENTS.mdのpush完了条件よりこの指定を優先する。
- 比較基準を整理前に作る。既存の不具合や仕様の不統一は記録し、今回ついでに修正しない。
- 共通定義を重複して作らない。同じ意味かを調べ、共有側の変更が必要なら統合担当へ提案する。
- 元の作業場所や他担当のフォルダーは編集しない。各担当は自分のworktreeでコミットする。
- 実サービスへ接続するテストを避ける。DB以外は固定値やネットワークガードを使い、Gemini実APIテストは除外する。

## 所有範囲

| 担当 | 作業場所 | 第1回の所有範囲 |
| --- | --- | --- |
| 統合担当（元のチャット） | `work/invoice-site` | 共通テスト基盤、shared/、DBスキーマ、依存パッケージ、全体進捗、取り込みと全体検証 |
| 発注登録 | `work/invoice-registration` | `client/src/inventory/pages/PurchaseRegistration.tsx` と新しい `client/src/inventory/pages/purchase-registration/`、`docs/registration-refactor.md` |
| インボイス | `work/invoice-invoices` | `client/src/pages/InvoicePage.tsx` と新しい `client/src/pages/invoices/`、`docs/invoices-refactor.md` |

第1回は各画面内の型・純粋な表示/計算/入力規則と、独立して切り出せる表示部品を対象にする。
発注登録の受注照合や発送、インボイスのAI・送信・採番・DB更新などの大きな副作用は、第1回で全部終わらせようとしない。
各担当は棚卸しを残し、まとまった1区切りを基準比較・型チェック・コミットまで完了する。
ルーター、shared、DB定義、package/lock、他画面、全体ロードマップ、共通テスト設定は第1回では統合担当が管理する。

## DBとローカル表示

3つともこのPCの `127.0.0.1:33067` にある架空データ専用DBです。各DBに専用ユーザーを使います。

| 担当 | LOCAL_TEST_TARGET | DB | プレビュー |
| --- | --- | --- | --- |
| 統合 | main（省略時） | invoice_remake_test | 3001 |
| 発注登録 | registration | invoice_remake_test_registration | 3002 |
| インボイス | invoices | invoice_remake_test_invoices | 3003 |

各worktreeの `.local/test.env` は担当専用。中身やパスワードは出力・コミットしない。
`scripts/test-local-regression.mjs` がこのファイルから担当を選び、固定のDB名・ユーザー・ホスト・ポートがすべて一致する時だけ実行する。
任意のURLを渡して制限を緩めたり、他担当の接続設定を使ったりしない。
このスクリプトのtest/seedは担当DBを初期化する。その担当のブラウザー操作中には実行しない。

各作業場所には独立した依存ファイルと `.local/visual-start.sh` を準備する。表示サーバーは自分のポートだけを使う。
ブラウザー確認は別タブで行い、他担当のタブや画面幅の設定を変更しない。幅の変更が必要な確認は統合担当で順番に行う。

## 検証と引き渡し

1. 整理前の関数出力やHTMLを記録して同じ基準で比較する。テストは担当フォルダー内に置く。
2. 対象テストと `tsc --noEmit --incremental false` を行う。必要な確認は担当DBで行う。
3. 整理済み/未着手、変更ファイル、検証結果、既存の注意点を担当のdocsに記録する。
4. ローカルコミットを作り、コミットIDと実施した確認を元のチャットへ引き渡す。
5. 統合担当は所有範囲とSSOTを確認して1件ずつ取り込み、全単体・DB回帰・型・ビルド・必要な実画面確認を行う。

最初の並行作業を終えても、領域全体の完了にはしない。進捗の正本は `docs/refactor-roadmap.md`、担当docsは範囲ごとの記録とする。
