# インボイス画面の段階的整理

## 第1回：I01〜I03

- 基準コミット：`959014b`。担当：`staff/yousunafu/refactor-invoices`。
- 所有範囲：`client/src/pages/InvoicePage.tsx`、`client/src/pages/invoices/`、この文書。
- UI・機能・API契約・保存値を維持する、ローカルのみの整理。

| ID | 単位 | 第1回の結果 |
| --- | --- | --- |
| I01 | 画面入力・明細・顧客候補・プレビューpropsの型 | `invoices/types.ts`へ移動 |
| I02 | 期限計算、顧客の既定通貨、文字正規化・電話番号・送信者照合 | `dates.ts`、`clientRules.ts`へ移動 |
| I03 | インボイスの独立したプレビュー | `InvoicePreview.tsx`へ移動 |
| I04 | PDF生成・ロゴ読込・後処理 | 未着手 |
| I05 | 顧客管理・差出人設定のダイアログ | 未着手 |
| I06 | 編集・一覧・保存・AI・分割処理 | 未着手。後続で細分化 |

InvoicePageは3,553行から3,220行へ縮小。TODAY/EMPTY_FORMの初期化時期、イベント、API呼出し、PDF生成は元の画面に保持した。実行時コードは専用モジュールを直接参照し、テスト用referenceモジュールには依存しない。

## 比較基準と再現方法

変更前に`git show 959014b:client/src/pages/InvoicePage.tsx`を読み、TypeScript ASTから実在する6関数の宣言を取り出して実行した。規則の書き直しや手製の期待値を基準にしていない。`reference.ts`はこの任意の再確認用であり、通常テストは現在のモジュールと保存済みスナップショットだけを使う。

```sh
# 変更前の実関数・コンポーネントと保存済み基準を再比較する（更新しない）
INVOICE_REFERENCE=959014b TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices/contracts.test.tsx
# 現在の分離済み実装と同じ基準を比較する
TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices/contracts.test.tsx
# アプリ・テストの型検証
node_modules/.bin/tsc --noEmit --incremental false
node_modules/.bin/tsc -p tests/regression/tsconfig.json --noEmit --incremental false
```

最初の基準保存時のみ、変更前実装に対して`--update`を使用。以後は更新せず一致を確認する。

- 純粋関数3ケース群：月末・閏年・年跨ぎ・空欄・不正日付・時刻付き入力、通貨候補・既定値、NFKC・部分一致・電話番号の7桁境界・最初の候補選択。入力配列の不変性と返却オブジェクトの同一性も確認。
- プレビューHTML10パターン：EUR/USD/GBP/JPY/CAD、金額非表示、空明細、宛先・差出人未指定、日付なし、番号接頭辞、会社名なし。固定データには端数、ゼロ、負の金額、税、複数行・特殊文字を含む。
- 外部画像・外部フォント・API・DBに接続しないSSR比較。画像取得、画面の実寸、操作、PDF内容の検証ではない。
- 追加のAST差分確認で、移動した6関数の本体と、元ファイルに残した全トップレベル宣言が整理前と完全一致することを確認。

## 既存の違いと保持した注意点

- `calcDueDate`はローカル時刻の`setMonth`/`setDate`とUTCの`toISOString`を組み合わせる。月末の繰り上がり、不正日付の例外、タイムゾーン依存は修正しない。基準のタイムゾーンはAsia/Tokyo。
- `TODAY`はモジュール読込時、後方の`getTodayStr`は呼出時のUTC日付。初期化タイミングを統一しない。
- 顧客の既定通貨は対象名以外USD、EMPTY_FORMはEUR。サーバーの取引通貨推定は文字正規化・戻り値・fallbackが異なり、意味が同じとは扱わない。
- 顧客照合は双方向の部分一致。候補文字列は2文字以上だが送信者側の同条件はなく、複数一致時は配列の先頭を返す。
- 編集欄の「合計」は税抜。プレビューとクライアントPDFの合計は税込。通貨記号・小数表示にも差がある。
- プレビューとPDFの住所整形は前後空白の処理が異なる。
- プレビューとPDFおよびサーバーPDFに金額計算の重複が残る。I04と共有側の所有範囲を合わせて検討する。今回は既存の重複を増やさず、プレビュー内の実装をそのまま移動した。

## 検証結果と引き渡し

- 整理前：13テスト成功、関数出力3件・HTML10件のスナップショットを保存。
- 整理後：同じ13テストと13スナップショットが成功。
- アプリとテストの型チェック：どちらも成功（終了コード0）。
- `git diff --check`成功。React確認では直接import・propsのみの部品境界・テスト専用依存がアプリから参照されないことを確認。
- 統合担当の指定により共有修正`1810bc6`を`e287436`として取り込み。内容はseedログの対象DB名表示のみ。担当実装とは別コミット。
- DB操作・seed・サーバー起動は担当では未実施。統合担当から担当DBの既存回帰45件成功とseed完了の連絡あり。
- 全体テスト、ビルド、3003での実画面確認は統合担当の最終検証で行う。
- push、main変更、Vercel操作、本番DB・鍵の利用なし。
