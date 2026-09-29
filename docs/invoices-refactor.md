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

## 第2回：I04 クライアントPDF

基準は統合済み`0471a7f`。クリーン確認後、担当ブランチへ`fe707db`でmergeした。統合担当の共有化`e473ae2`も`a19519b`として取り込んだ。担当外ファイルはこれらの指定コミットの取り込みのみ。

| ファイル | 責務 |
| --- | --- |
| `generateInvoicePdf.ts` | 描画→後処理→ダウンロード→成功通知の順序 |
| `pdfDrawing.ts` | jsPDF/autotableの動的import、レイアウト・明細・サマリー・備考・文書プロパティ |
| `pdfLogo.ts` | MIME/拡張子判定、ロゴ読込、FileReader変換、失敗時の継続 |
| `pdfBlob.ts` | pdf-libの動的import、OpenAction、Blob化、失敗時の元PDFへのfallback |
| `pdfDownload.ts` | blob URL・アンカー・クリック・10秒後のURL解放 |
| `pdfTypes.ts` | PDF入力型。宛先は既存PreviewPropsから参照 |
| `amountFormat.ts` | クライアントプレビュー/PDFの通貨記号と表示書式 |

プレビューとPDFは統合担当の`shared/invoiceAmounts.ts`にある`calculateInvoiceTotals`を参照する。計算式は担当内に再定義しない。サーバーの通貨表示や編集欄の金額表示には変更を加えていない。InvoicePageは3,220行から2,868行へ縮小した。

### 整理前のPDF比較基準

`pdf-baseline-source.txt`は`0471a7f`のPDF型・関数群をそのまま保存した固定fixture。Git履歴がなくても`pdfReference.ts`で実行できる。AST/文字列比較で当該コミットとの完全一致を確認済み。手製のPDF生成器に置き換えず、変更前後とも実際のjsPDF・jspdf-autotable・pdf-libを使用する。

9つの基本出力（EUR/USD/GBP/JPY/CAD、金額非表示、空明細、空明細＋金額非表示、90明細・6ページ）とロゴ成功/埋込失敗を比較。PDFをpdf-libで読み直し、ページ内容ストリームのSHA-256、文字描画命令、ページサイズ、リソース、タイトル等、OpenActionの先頭ページ・XYZ/null/null/1を固定スナップショットで検証する。日時・ランダムID・圧縮結果など可変metadataを含むPDFファイル全体のバイト比較はしない。

ロゴは固定の小さなPNG、fetchは必ず固定応答または拒否。外部画像・フォント・API・DBへの接続はない。テスト用依存は既存パッケージのみ。PDFはメモリ上で生成・検証し、配布用ファイルは作成しない。

```sh
# 固定した整理前の実処理を再実行し、既存スナップショットと比較
INVOICE_PDF_REFERENCE=1 TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices/pdf.test.ts
# 整理後のPDF・既存プレビュー・共有計算を比較
TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices shared/invoiceAmounts.test.ts
```

基準の初回記録だけに`--update`を使用。実装変更後はスナップショット更新なし。テストのlocale/タイムゾーンは整理前後で同じ環境を使う。

### 検証範囲と結果

- PDF27テスト：基本9出力、形式判定、ロゴ未指定・空白、成功・HTTP失敗・非対応・fetch/body/FileReader失敗、実PNG埋込・埋込失敗、後処理parse/save失敗、初期output例外、ページ0、クリック/URL生成例外、fallback後の実ダウンロード継続。
- ファイル名の数字4桁補完/文字列番号、クリック前のURL生成、成功通知、9,999ms時点ではURL保持・10,000msで解放、例外時の通知やタイマー有無を確認。
- 変更前fixtureで27テスト成功。分離・共有計算適用後はPDF27＋プレビュー13＋共有計算5＝45テスト成功。保存済みスナップショット25件（I01〜I03の13件＋PDF12件）一致。
- 元画面の無関係なトップレベル宣言、ロゴ関連関数とPDF後処理関数の本体が基準と完全一致することをASTで確認。
- アプリ/テストの型チェックはどちらも成功（終了コード0）。テスト型のライブラリoverload不一致2件は修正済み。`git diff --check`も成功。
- DB/seed/サーバー起動は担当では実施していない。実画面ダウンロード・PDF画像確認・全体ビルドは統合担当へ引き継ぐ。

### 保持した違い・未着手

- Previewは空明細時サマリーを表示しないがPDFは`showAmounts`がtrueなら表示する。
- JPYはクライアントの`toLocaleString`を維持。サーバーPDFの整数丸めは持ち込まない。税計算は表示前に丸めない。
- PDFは従来の組込みHelveticaを使用し、追加フォントを読まない。既存の日本語描画・ページ末尾配置の改善は行わない。
- ロゴ失敗は警告して継続、後処理失敗は元PDFへfallback。初期`pdf.output`の例外はそのまま上位へ伝播する。
- URL作成後のクリック失敗ではcleanupタイマーに到達しない既存挙動も維持。修正は別作業。
- 編集画面の保存→生成、一覧画面の取得→生成、エラー文言・ローディング解除は元画面に保持し、この回では変更しない。
- I05顧客/差出人ダイアログ、I06編集・一覧・AI・保存・採番・分割は引き続き未着手。

## 第3回：I05 差出人設定・顧客管理ダイアログ

統合済み`ef808dc`をクリーンな担当ブランチへ`3fbfd5e`でmergeして開始。担当外ファイルはこの取り込み以外変更していない。

| ファイル | 責務 |
| --- | --- |
| `SenderSettingsDialog.tsx` | 差出人設定の入力・ロゴ・保存ボタンのUI |
| `useSenderSettings.ts` | query、既存タイミングの初期化、FileReader、ロゴupload→設定保存、通知/閉じ方 |
| `ClientManagerDialog.tsx` | 顧客一覧・作成/編集フォーム・削除ボタンのUI |
| `useClientManager.ts` | query、編集/作成状態、入力検証、CRUD mutation、invalidateと通知 |
| `clientForm.ts` | 従来3か所にあった同一の空フォームを毎回新しいオブジェクトとして生成 |

ダイアログ外部へのpropsは引き続き`open/onClose`のみ。汎用フォーム部品や共有側の変更は追加していない。ClientFormは親コンポーネント内の定義を保持した。外へ移すと入力時の既存remount挙動が変わるため、今回のUI不変条件では移動しない。InvoicePageは2,868行から2,494行へ縮小。

### 整理前基準とテスト方法

`dialog-baseline-source.txt`は`ef808dc`の実SenderSettingsDialog/ClientManagerDialog宣言をそのまま保存したfixture。`dialogReference.ts`で実行し、整理後と同じAPI・状態・ブラウザー依存の固定アダプターを使う。元コミットとのソース完全一致と、InvoicePageに残した他のトップレベル宣言が無変更であることをASTで確認。

既存依存にjsdom/happy-dom/react-test-renderer/testing-libraryがないため、新規依存は追加していない。テストは実コンポーネントが返した要素の実onChange/onClick/onOpenChangeを呼び、useState/useRefの決定的なアダプターで次の描画まで進める。query/mutationは固定応答と手動の成功/失敗通知。フォームの実payloadと通知・invalidate・閉じる呼出し順を記録する。

UI基盤のDialog/Button/Input/Labelは固定HTMLタグへ置き換え、アプリ側JSXの文言・属性・条件分岐を比較する。**実RadixのHTML、React DOMのライフサイクル、フォーカス、ポータル、ブラウザーのファイル選択を保証するテストではない。** これらは統合担当の実UI検証対象。

```sh
# 旧実コンポーネントと固定スナップショットを比較（更新しない）
INVOICE_DIALOG_REFERENCE=1 node_modules/.bin/vitest run client/src/pages/invoices/dialogs.test.tsx
# 整理後と既存のプレビュー/PDFも確認
TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices
```

旧実装だけで最初の基準を記録し、分離後はスナップショット更新なしで一致を確認。追加した境界条件も旧実装側で先に記録した。

### 検証結果

- ダイアログ18テスト・21スナップショット：空一覧/読込中/登録済み/作成/編集/差出人初期値のHTML、入力→保存payload、名前の必須判定と空白保持、作成/更新/削除の成功失敗、削除確認の取消、編集取消、外側の閉じ直し、pending表示。
- 差出人：非同期データ到着時の初期化、再取得時の編集保持、閉じ直した際の再初期化、全入力値保存、FileReader完了後の状態、空ファイル/2MiB境界、ロゴupload待機・成功・失敗・空URL、選択取消、ロゴ削除時のpayload、save成功/失敗、invalidate→通知→closeの順序。
- 整理前18テスト成功。整理後は既存13プレビュー＋27PDF＋18ダイアログ＝58テスト成功。既存基準も一致。
- 最後の境界条件2件を含め、アプリ/テストの型チェックは両方成功（終了コード0）。`git diff --check`も成功。
- DB・実外部ロゴupload・サーバー起動は未実施。新規依存、shared/server、API契約、保存形式の変更なし。

### 既存挙動として保持した点と統合UIチェック

- 初期化はuseEffectに変更せず、`open && settings && !initialized`でのrender中更新を保持。settingsが無いまま選択したlogoFileは、閉じてもinitializedがfalseなら残る。
- 設定にlogoUrlが無い場合は既存logoPreviewを消さない。UIのロゴ削除も保存payloadに削除値を付けず、プレビュー/選択ファイルだけを消す。
- ロゴ説明はPNG/JPGだがacceptはGIF/WebPも含む。2MiBちょうどは許容。FileReaderの読込失敗用ハンドラーは既存同様追加しない。
- saveMutation.mutateはawaitせず、ロゴuploadの待機とsaveMutation.isPendingを組み合わせる。通知文言・エラーの捕捉範囲を維持。
- 顧客notesは画面に入力欄が無いが、編集時は既存値を保持して保存する。名前のtrimは必須判定だけに使い、保存値自体はtrimしない。
- 顧客フォームのモード/下書きは外側の閉じ直しだけではresetしない。フォーム内キャンセルで作成/編集を解除し、新規開始で空フォームに戻す。
- 統合UIでは顧客の作成→入力→保存、編集→保存/取消、削除確認→取消/削除、差出人の閉じ直しと再初期化、ロゴ選択/削除/保存を確認する。実upload成功は外部送信しないため固定応答比較まで。実DOM・フォーカス・DB永続化は担当テストの検証範囲外。
- I06編集・一覧・AI・保存・採番・分割は未着手。I05の引き渡し後は停止する。

## 第4回：I06前半 フォーム変換・一覧規則・通常カード

統合基準`608f1ea`をクリーンな担当ブランチへmergeして開始。今回から関連3単位をまとめ、担当では対象テスト・対象型チェックだけを実施する。全体テスト/型/ビルド/DB/ブラウザーは統合担当で行う。

| 単位 | 整理内容 |
| --- | --- |
| I06a | `storedInvoiceForm.ts`：一覧プレビュー/PDFで同一の保存済み→フォーム変換を統一。編集経路は共通フィールドだけ再利用し相違を保持 |
| I06b | `listRules.ts`：通貨の収集順、EUR/USD/GBP/CHFのレートマップ、円換算、明細数/合計の既定値と100万円以上判定。`StatusBadge.tsx`：既存の状態表示 |
| I06c | `InvoiceCard.tsx`：通常一覧のカード。既存の状態変更/プレビュー/編集/PDF/クローン/削除イベントをpropsで受ける |

InvoicePageは2,494行から2,325行へ縮小。通常一覧の空/読込中表示、query/mutation、状態、プレビュー/PDF実行、削除復元、AI、画面切替は元画面に保持。カード内の削除確認は既存UIのままで、mutation自体は親の既存イベントに委譲。削除済み一覧やモーダルの分割、絞り込み機能の追加はしていない。共有側・依存パッケージの変更なし。

### 基準と対象検証

`list-baseline.json`は608f1eaの実フォーム初期化式3経路、useMemo/useCallback内の実規則、StatusBadge宣言、実一覧JSXを抽出した固定fixture。`listReference.tsx`で実行し、整理後は実際の新関数/カードと、現在のInvoicePageの一覧JSXを同じ固定依存で評価する。手製の新ルールを比較基準にしていない。

- 11対象テスト成功、9スナップショットが整理前後で一致。
- フォーム変換は空明細/欠損/null/空文字/ゼロ/小数/非数値を確認。数量7条件×税5条件×実旧変換3経路＝105比較が一致。入力データ不変も確認。
- 複数通貨、未知通貨、レート未取得/ゼロ/負数、丸め、欠損した件数/合計、100万円境界、未知statusの下書き表示を比較。
- 一覧の空/読込中/複数行/処理中HTML、状態変更・プレビュー・編集・PDF・クローン・削除の引数、削除確認の取消、空一覧の新規イベントを比較。
- Select/Buttonは固定HTMLタグへ置換。実Radix DOMやフォーカスを保証するものではない。外部為替/PDF/DBは呼び出さない。
- `tsconfig.list-tests.json`による新規関数/表示部品/比較テストの対象型チェック成功。
- AST差分確認で、承認範囲の変換呼出し以外のquery/mutation/状態/副作用ハンドラーと、他の画面宣言が無変更であることを確認。`git diff --check`成功。

```sh
INVOICE_LIST_REFERENCE=1 TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices/list.test.tsx
TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices/list.test.tsx
node_modules/.bin/tsc -p client/src/pages/invoices/tsconfig.list-tests.json --noEmit
```

### 保持した相違・引き継ぎ

- 一覧プレビュー/PDFはtaxを数値化して渡すが、編集画面は既存同様tax自体を含めない。編集のsortOrderはそのまま、一覧プレビュー/PDFはnullをundefinedへ変換する。この相違を修正していない。
- 一覧の明細数・合計はAPIの集計値を使い、明細から再計算しない。金額は正数のみ表示し、円換算はゼロも表示。既定値はnullishだけに適用する。
- JPYレートは1、他通貨は既存の4種類だけを取得。未知通貨のレートは追加しない。通貨配列の初出順を保持する。
- clientId=0は顧客照合しない既存のtruthy判定を維持。通常一覧の金額表示と削除済み一覧の表示書式は統一していない。
- 統合担当は全体型/全テスト/ビルド、実一覧の表示・プレビュー/編集導線を確認する。担当で実画面/DB/外部為替/ダウンロードは実施していない。
- I06後半の編集/保存/採番/分割/AI/一覧の副作用は未着手。この3単位の引き渡しで停止。

## 第5回：I06d〜f 明細操作・保存入力・分割規則

統合基準`5873dbe`をクリーンな担当ブランチへ`c38e4cb`でmerge。今回も関連3単位をまとめ、全体検証は統合担当に集約する。

| 単位 | ファイルと責務 |
| --- | --- |
| I06d | `editorItems.ts`：明細追加/更新/削除、顧客選択の解決、選択に伴う通貨反映 |
| I06e | `editorPayload.ts`：通常保存/分割保存の入力組立。同義のclientSnapshot照合とsubText→variantを共通化 |
| I06f | `splitInvoices.ts`：上限でのグループ分割・分割番号の計算 |

フォーム初期化、query/mutation、採番、新規保存前の為替取得/上限確認、保存の実行順序、dirty判定、通知、UIは元のInvoiceEditorに保持。巨大hookは追加していない。InvoicePageは2,325行から2,241行へ縮小。shared/server/依存追加なし。

### 比較基準と結果

`editor-baseline.json`は5873dbeの実コードから7つの関数初期化式をそのまま固定したfixture。`editorReference.ts`で旧処理を実行する。setFormは渡された実更新関数を評価し、分割保存mutationはpayloadを記録する固定依存に差し替えた。計算やpayloadの旧規則は書き直していない。

- 対象8テスト成功、5スナップショットが旧処理と分離後で一致。
- 明細の追加、対象外indexの更新/削除、ゼロ/小数/空欄、sortOrder保持、未変更明細のオブジェクト同一性と入力不変を確認。
- 顧客切替は対象/対象外/ID0/未選択/非数値を確認。フォーム通貨と異なる既存明細の通貨・参照を維持する。
- 通常保存は顧客全体のsnapshot、追加フィールド、空文字/nullishのsubText/variant、税、空明細を比較。分割保存はrate情報なし/空グループのguard、rate0と小数、明細順とpayloadを比較。
- 分割は上限ちょうど/直上、単独で上限超過、税あり、負数/ゼロ、空明細、数字/文字列/空番号と桁幅を比較。rate5条件×limit3条件の15比較で旧実計算と一致し、元明細の順序・参照保持も確認。
- 対象tsconfigによる型チェック成功。AST比較で承認した7宣言以外のInvoiceEditor本文（JSXを含む）および他のトップレベル宣言が完全一致することを確認。`git diff --check`成功。

```sh
INVOICE_EDITOR_REFERENCE=1 TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices/editor.test.ts
TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices/editor.test.ts
node_modules/.bin/tsc -p client/src/pages/invoices/tsconfig.editor-tests.json --noEmit
```

### 保持した相違・未検証

- 分割は数量×単価×rateの税抜金額を明細ごとに足し、丸めない。PDFの税込計算や一覧の円換算丸めとは統一しない。上限ちょうどは同じグループ、超過時だけ次へ移る。数量自体は分割しない。
- 明細削除後にsortOrderを詰め直さず、追加のsortOrderは現在の配列長。更新値の型や税率をこの処理で補正しない。
- 顧客選択のID0は照合しないが、保存snapshotはID0でもfindで照合する。既存の意味の違いを保持。
- 顧客照合は従来同様イベント時点で実行し、その結果をsetFormの関数へ渡す。通貨の適用は従来の`clientRules`を再利用する。
- 分割保存はフォームの特定フィールドだけを列挙し、通常保存はformをspreadする。双方のpayloadを無理に同じ形にしない。
- 初期化/採番/保存/失敗通知/外部為替/DB/実UIの実行検証は担当では行わない。全体型・全テスト・ビルドも未実行で、統合担当へ引き継ぐ。
- 編集UI、AI入力、保存等の副作用自体の整理は未着手。この3単位を引き渡して停止する。

## 第6回：I06g〜i 編集UIとプレビュー寸法

共通基準`7db6054`をクリーンな担当ブランチへ`d2d4248`でmerge。調査後、保存処理と密接な確認ダイアログ群は次へ残し、巨大props束を避けられる以下の3単位に限定した。

| 単位 | ファイルと境界 |
| --- | --- |
| I06g | `InvoiceMetadata.tsx`：基本情報（番号/状態/発行日/期限/通貨/金額表示/色）。propsはformとsetFormのみ |
| I06h | `InvoiceItemsEditor.tsx`：明細入力・追加/削除・合計。propsはformと既存の3操作のみ |
| I06i | `ScaledPreview.tsx`：幅に合わせるScaledPreviewと幅/高さに合わせるScaledPreviewFit。共通のA4寸法定数、異なるサイズ規則は保持 |

InvoicePageは2,241行から1,975行へ縮小。初期化、保存query/mutation、AI、採番、印刷/PDFの実行順序、確認ダイアログのイベントは変更なし。元画面で不要になったSwitch importのみ削除。

### 旧JSX・イベント・サイズ計算の比較

`editor-ui-baseline.json`は7db6054の実基本情報JSX・実明細JSX・2つの実プレビュー関数を固定したfixture。`editorUiReference.tsx`で同じ固定依存を与えて実行し、旧実装側で先にスナップショットを保存した。

- 13対象テスト・24スナップショットが整理前後で一致。
- 基本情報は4通貨のHTML、番号/状態/日付/期限/通貨/金額表示/色の実イベントを比較。手動期限が設定済みでも発行日変更で期限を再計算する既存挙動を保持。
- 明細は空/通常/金額非表示、EUR/USD/JPY/GBPの既存表示を比較。追加、商品名/subText、数量の空欄→Number("")=0、単価小数、削除index、数値入力focus時のselect呼出しを確認。
- プレビューは初期scale1、幅397/高さ280.75、上限1、幅/高さ0、幅794/高さ561.5、親なし、ResizeObserverのobserve対象/更新/cleanupを固定依存で比較。
- 対象型チェック成功。AST比較で対象JSX2か所とサイズ調整関数以外の画面宣言が不変であることを確認。移動したJSXはそのまま一致。`git diff --check`成功。
- UI基盤は固定HTMLタグ、React hooks/ResizeObserverは決定的なアダプター。実Radix・ブラウザーlayout・observer配信タイミング・フォーカスの再現保証ではない。実UI比較は統合担当へ引き継ぐ。全体テスト/型/build/DB/browserは担当では未実施。

```sh
INVOICE_EDITOR_UI_REFERENCE=1 TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices/editorUi.test.tsx
TZ=Asia/Tokyo node_modules/.bin/vitest run client/src/pages/invoices/editorUi.test.tsx
node_modules/.bin/tsc -p client/src/pages/invoices/tsconfig.editor-ui-tests.json --noEmit
```

### 保持した注意点

- 編集合計は税抜で、USD/EURだけ記号化する。PDF/プレビューの税/記号/書式に統一しない。
- ScaledPreviewは親なしでも自身の幅で調整するが、Fitは親なしで初期scale1を保持する。負数やゼロ寸法への補正は追加しない。
- 統合担当が旧画面で、JPYのquantity2×600000=120万円の単一明細が1グループとなり「分割不要です」「合計1,200,000円で100万円以下です」と表示される既存矛盾を確認した。今回の担当では実UIを再確認していないが、該当ダイアログと分割規則を変更せず、この制約を引き継ぐ。

### 残る大きな責務と次の候補

1. 戻る/上限/分割の確認ダイアログ、編集ツールバー・宛先/備考表示。副作用は親イベントとして残し、表示境界と保存成功/失敗/取消の順序を固定して分割する。
2. KnowledgeBaseDialogのファイル入力・履歴表示・チャットUI。アップロード/AI呼出しと表示を段階分離し、実外部通信を使わない比較を先行する。
3. 編集/一覧の残る処理（保存、印刷/PDF操作、削除済み/検知結果モーダル）の責務別整理。大きな汎用hookへ集めず、実行順序・初期化・取消を個別に固定する。

これらは今回未着手。I06g〜iのローカルコミットを引き渡して停止する。
