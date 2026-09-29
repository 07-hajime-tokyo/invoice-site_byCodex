# 発注登録の段階的整理

2026-09-30。対象は `client/src/inventory/pages/PurchaseRegistration.tsx` と `purchase-registration/`。
基準コミットは `959014b`。UI・API契約・保存値を変えず、SSOTと責務分離を進める。
全体進捗の正本は統合担当の `docs/refactor-roadmap.md`。本書は担当範囲の記録。

## 第1回：R01〜R04

| 単位 | 分離先 | 状態・境界 |
| --- | --- | --- |
| R01 型 | `dataTypes.ts` / `formTypes.ts` / `viewTypes.ts` | データ、画面の選択・入力、表示モデルの型を移動。既存の任意値・null・Date許容を保持 |
| R02 表示書式 | `format.ts` | 数値の有限値化、円・ユーロ・取引通貨、通貨名、日付文字列の表示。利益予測集計や「今日」の計算は未移動 |
| R03 追跡表示 | `tracking.ts` | 保存業者名の解釈、番号整形、URL、表示メタ情報、選択肢。自動判別は既存 `inventory/lib/tracking.ts` を参照。エコ配のフォームPOSTは画面内に保持 |
| R04 行の表示判定 | `purchaseItems.ts` / `rowStatus.ts` / `rowFilters.ts` / `rowOrder.ts` | 数量とラベルの読取、表示状態、絞り込み・集計、並び順を分離。表示期限・完了条件は既存sharedへ統一 |
| R05 管理番号・検索 | 未着手 | 第1回は保留。共通配置の検討を先行する |

画面は9,340行から8,871行へ。行数は領域全体の完了率を表さない。
画面からの関数呼び出しとUI構成は維持し、API・DB更新・保存順序・外部通信は変更していない。

## 共有変更の取り込み

統合担当が明示的に許可した2件のみ、順にcherry-pickした。

- `1810bc6` → 担当ブランチ `93178b7`：seedの対象DB名表示の修正。
- `6244edd` → 担当ブランチ `e2c6998`：共有表示判定の引数を用途別の最小型にする変更。実行ロジックは不変。

`rowFilters.ts` は `shared/purchaseVisibility.ts` の `isInboundCutoffVisible` と `isPurchaseInboundComplete` を直接利用する。
登録画面側の期限定数、日付正規化、期限判定、完了判定の重複4宣言を削除した。
共有型に合わせるための強制キャストや、共有判定の再実装はない。
この2件以外のshared、サーバー、共通テスト設定、package/lock、ロードマップは変更していない。

## 整理前基準と検証

最初に旧画面の実関数を使って7スナップショットを取得し、その後に移動した。
`baseline-source.txt` は、`git show 959014b:client/src/inventory/pages/PurchaseRegistration.tsx` からTypeScript ASTで抽出した35宣言を、そのまま保存したテスト専用fixture。手で業務規則を書き直していない。
`legacy-baseline.ts` は通常テスト時にこのfixtureを読み、指定された宣言の存在を検証して評価する。
画面・APIモジュール全体はimportせず、純粋関数の依存である既存の `detectCarrier` と `isInboundComplete` だけを渡して評価する。
期待値を新実装から生成せず、旧実装の複製はテスト専用fixtureだけに置く。アプリのimport経路には含めない。通常テストはGitコマンド・過去コミットを必要とせず、浅いcloneでも実行できる。
fixtureのSHA-256は `7ca2c5864ad62796929dfbe5f828d0f5eb58351ad1711a6e1158c17329ad71e6`。

`rules.test.ts` の `current` は現行モジュールだけから構成し、`original` へのフォールバックを持たない。
旧実装は比較相手としてのみ利用する。

- 対象テスト6件。金額・空欄・非有限値・通貨、保存業者の別表記とURL、日付境界・無効日付・UTC変換・並び順を確認。
- 状態・ラベル・追跡の1,500通りを旧実装と比較。入力不変と、元の行・明細配列を返す条件も比較。
- 空明細・在庫ゼロ・負数・小数・不正数値・部分絞り込み120通り、分類・工程・null等84通り、複数行の集計を比較。
- 保存済み7スナップショットは整理後も一致。更新モードを使ったのは整理前の取得時のみ。
- 共有表示判定・入庫一覧の関連テストを含め、4ファイル34テストが成功。入庫一覧の既存スナップショットも一致。
- 対象テストを含む型チェックと、アプリ全体の `tsc --noEmit --incremental false` が成功。
- fixture読取への変更後も、対象6テスト・7スナップショット・対象テストを含む型チェックが成功。
- 宣言の比較では、移動を含め250宣言がexport修飾子と空白を除いて一致。削除は共有に統一した4宣言、関数本体の変更は `normalizePurchaseRegistrationRows` の呼出先2箇所のみ。
- `git diff --check` が成功。

再実行コマンド（担当worktreeで実行）：

```sh
TZ=Asia/Tokyo LANG=en_US.UTF-8 node_modules/.bin/vitest run client/src/inventory/pages/purchase-registration/rules.test.ts shared/purchaseVisibility.test.ts client/src/inventory/pages/purchases/contracts.test.ts client/src/inventory/pages/purchases/presentation.test.tsx
node_modules/.bin/tsc -p client/src/inventory/pages/purchase-registration/tsconfig.tests.json --noEmit --incremental false
node_modules/.bin/tsc --noEmit --incremental false
git diff --check
```

任意の再抽出確認（基準コミットがGit内にある場合だけ実行。fixtureを書き換えず、一致を確認する）：

```sh
node --input-type=module <<'JS'
import fs from "node:fs";
import ts from "typescript";
import { execFileSync } from "node:child_process";
const path = "client/src/inventory/pages/purchase-registration/baseline-source.txt";
const saved = fs.readFileSync(path, "utf8");
const old = execFileSync("git", ["show", "959014b:client/src/inventory/pages/PurchaseRegistration.tsx"], { encoding: "utf8" });
const parse = (text) => ts.createSourceFile("baseline.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const name = (node) => ts.isFunctionDeclaration(node) ? node.name?.text
  : ts.isVariableStatement(node) && node.declarationList.declarations.length === 1
    ? node.declarationList.declarations[0].name.getText() : undefined;
const names = new Set(parse(saved).statements.map(name));
const extracted = parse(old).statements.filter((node) => names.has(name(node))).map((node) => node.getText()).join("\n\n") + "\n";
if (saved !== extracted) throw new Error("Baseline fixture differs from 959014b");
console.log("Baseline fixture matches 959014b");
JS
```

DBテスト・seed・サーバー起動・ビルド・実画面操作はこの担当では実施していない。
専用環境の準備完了ファイルは確認済みだが、本変更は純粋関数の比較で検証した。
全体テスト・ビルド・実画面確認は統合担当が行う。純粋関数の比較は全UI操作や保存経路の保証ではない。

## 維持した違いと既存の注意点

- 登録画面は業者名の空白除去・小文字化・日本語別名を受け付ける。入庫一覧とは業者解釈、Amazon URL、未知業者の表示が違うため丸ごと共有しない。
- 入庫一覧の選択肢には「西激運輸」、登録画面には「西濃運輸」がある。表示修正は今回行わない。
- 登録画面の追跡有無はtrim後の文字列で判断する。空白だけとハイフンだけの扱いも既存どおり。
- 登録画面の状態はラベルの全件出庫・一部出庫を優先する。入庫一覧の発注状態とは意味が違う。
- 発注ヘッダーが未完了でも、明細の入庫状態や在庫数量により表示明細が変わる。行や配列の再利用条件を保持する。
- 期限判定は仕入日優先、並び順は作成日時優先。並び順は優先日付が空文字・不正値でも下位日付に再フォールバックせずIDを使う。
- 日付の単純な先頭10文字表示、UTCへ変換する期限判定、端末ローカルの「今日」、東京固定の「今日」は用途が違う。後二者は今回未移動。
- 金額の欠損・不正値は登録側では0円になる。入庫一覧の単価表示の「-」とは違う。
- 管理番号の清掃と `parseEtc` は入庫一覧と同義だがR05まで保留。登録側の3桁インボイス解析と、sharedの全角正規化・3〜5桁解析は同義ではない。
- `labelStatusLabel` と `normalizedLabelStatus` のtrim有無の差も維持する。

## 次の小さな単位

1. R05：管理番号・仕入先表示・検索。共通処理の配置は統合担当が決める。
2. ラベル表示名・印刷配置・QR生成の純粋規則。保存、カメラ、印刷の副作用は別単位。
3. 在庫表示・提案集計・予測値。受注照合と在庫引当は別の比較基準を先に用意する。
4. 表示部品、画面状態、操作処理を用途ごとに分離する。
5. 注文照合・在庫引当・発送・DB更新・外部通信は、各経路の整理前基準と専用環境での検証を用意して段階的に扱う。

本領域全体は未完了。本番反映・push・main変更・Vercel操作は行わない。

## 第2回：R05 管理番号・仕入先・検索（2026-09-30）

第1回後の統合基準 `0471a7f` を、クリーンな担当ブランチにmergeした（`f5074e4`、衝突なし）。
第1回の「R05未着手」は当時の記録。本節でR05を整理・検証した。
統合担当が許可した共有変更 `e473ae2` は `9a5e3b2` としてそのまま取り込んだ。
この共有コミットには他担当用のインボイス金額規則等も含まれるが、担当側では追加編集していない。

### 完了範囲

| 分離先・再利用先 | 対象 |
| --- | --- |
| `managementNumbers.ts` | `normalizeManagementNoForDisplay`、`isStockManagementNoSuffixAlias`、`uniqueManagementNos`、`preferredManagementNo`、`getManagementNos` |
| `purchaseEtc.ts` | `buildEtcWithManagementNo`。保存時に使うetc文字列の純粋な組立だけ |
| `invoiceIdentity.ts` | `parseInvoiceFromManagementNo`、`isEbayManagementNo`、`getInvoiceInfo`、`invoiceNoFromGroupKey`、グループ定数3件 |
| `supplier.ts` | `getSupplier`。CSV由来表示の優先と先頭明細のetcによる補完 |
| `search.ts` | `buildSearchText`、`buildStockSearchText`。検索対象文字列の組立のみ |
| `shared/purchaseMetadata.ts` | 既存の `cleanLegacyManagementNo` と `parsePurchaseEtc` を参照。後者は既存の呼出名 `parseEtc` へalias |
| `shared/ebayInventory.ts` | 既存の `extractManagementNo` を `getInventoryManagementNo` へalias。旧関数との720通りの比較が一致 |

新しいアプリ用モジュールは5ファイル。元画面は8,871行から8,728行へ。
既存の呼出箇所は維持し、共有3関数の重複宣言だけを削除した。
移動した関数の本体は変更していない。商品名の特殊照合、ラベルの商品タイトル変換、注文照合、引当、発送処理は画面側に残した。

### SSOTの一致・違い

- 管理番号の清掃とetc読取は入庫一覧と同義。統合担当が用意した `shared/purchaseMetadata.ts` を正本とし、入庫一覧は互換名を再exportする。
- 登録側の在庫管理番号はカンマより前を読み、空白より後を落とす。`shared/ebayInventory.extractManagementNo` と同義。一方、`server/inventory/managementNo.ts` は番号内部の空白を保持するため、置換対象ではない。
- `getManagementNos` はetc内に管理番号がある場合、その明細のラベル管理番号を候補に追加しない。ヒント抽出は既存 `shared/productMatching.extractManagementHints` を参照する。
- 管理番号の重複判定はNFKC・小文字化を使うが、返す表記は最初の清掃済み値を保持する。「在庫」から始まる候補の末尾と一致する短い別名は除外し、入力配列は変更しない。
- `preferredManagementNo` は現在値、ラベル値、呼出元のfallbackの順。空文字fallbackも保持する。
- etc組立は旧来のカンマ分割であり、引用符付きCSVの解析ではない。仕入先 `undefined` は既存値を残し、`null`・空欄は消す。第4要素以降が落ちる既存挙動も維持する。
- 登録のインボイス解析は半角3桁と `_` が必要。共有 `invoiceKey` のNFKC・3〜5桁仕様に変更していない。管理番号ヒントの段階でNFKC化される経路は、そのまま残す。
- 登録のeBay判定は `ebay` の後が `_`、`-`、終端の場合。共有eBay在庫判定の `/^E/i` とは別規則であり、`E0814_1` 等の扱いを変えない。
- `getInvoiceInfo` は候補中の最初のインボイス識別を優先し、その後にeBay、最後に一般在庫へ分類する。これを注文照合の規則として拡張しない。
- 仕入先名はCSV側のtrim後の非空文字列を優先し、先頭明細etc、`-`の順。URLはCSV側をtrimするだけ。既存supplierライブラリのサイト名整形・URL補正とは同義でない。
- 発注検索は発注番号、仕入先名/URL、ラベルID、管理番号、明細の商品名/カテゴリ/etcを含む。追跡番号はこのローカル検索文字列には追加しない。API側検索や検索の実行順序も変更しない。
- 在庫検索はラベルID、商品名、カテゴリ、管理番号、割当ラベル、仕入先名、状態を含む。URL・価格・日付は追加しない。どちらも検索文字列自体は小文字化のみで、全体をNFKC化しない。

### 整理前基準と確認結果

`metadata-baseline-source.txt` は `0471a7f` の画面からASTで抽出した19宣言（16関数・3定数）をそのまま保存したもの。
SHA-256：`ce9ef2b6819684181c08da7c0eddad971f093e9b376cf5336c65ba73ccc2579d`。
`metadata-baseline.ts` はテスト専用で、通常テストはこの固定fixtureを読む。過去Git履歴は不要。
既存の純粋依存 `extractManagementHints` と `getItemLabels` を渡すだけで、画面やAPIは起動しない。

アプリの編集前に旧実関数で9スナップショットを取得した。在庫検索の生文字列に含まれる末尾空白も保持するため、該当1件の保存表現をJSONエスケープへ変更した際は旧fixtureだけから取り直した。現行実装を期待値の生成元にせず、一致を確認した。
`metadata.test.ts` の `current` は現行モジュールと共有正本のみから作り、旧実装へフォールバックしない。

- R05対象8テスト・9スナップショットが成功。
- 在庫管理番号の旧関数と既存sharedを720入力で比較し、同義を確認。
- etc組立1,176通り、現在値/ラベル値/fallbackの優先順位2,700通り、etc/ラベルの組合せ900通りを旧実装と比較。
- 別名・重複排除、日英・全半角・空/null・不正形式・カンマを含むetc、インボイス/eBay識別、検索対象/対象外を確認。
- 入力非変更、明細配列・明細オブジェクト・仕入先オブジェクトの参照保持、重複排除が別配列を返すことを確認。
- 前回R01〜R04、入庫一覧、sharedのメタデータ・表示条件・インボイス番号・商品ヒントを含む8ファイル95テストが成功。新9件、前回7件、入庫一覧23件のスナップショットが一致。
- アプリ全体と、対象テストを含む型チェックが成功（どちらも `--noEmit --incremental false`）。
- AST宣言比較で移動を含め192宣言がexport修飾子と空白以外同一。本体の変更はなく、共有参照に置換した3宣言だけが画面から消えている。
- fixtureの任意再抽出確認でも `0471a7f` と完全一致。第1回の再抽出確認コマンドのパスを `metadata-baseline-source.txt`、コミットを `0471a7f` に替えて再確認できる。
- `git diff --check` が成功。

再実行コマンド：

```sh
TZ=Asia/Tokyo LANG=en_US.UTF-8 node_modules/.bin/vitest run client/src/inventory/pages/purchase-registration/metadata.test.ts client/src/inventory/pages/purchase-registration/rules.test.ts shared/purchaseMetadata.test.ts shared/purchaseVisibility.test.ts shared/invoiceKey.test.ts shared/productMatching.test.ts client/src/inventory/pages/purchases/contracts.test.ts client/src/inventory/pages/purchases/presentation.test.tsx
node_modules/.bin/tsc -p client/src/inventory/pages/purchase-registration/tsconfig.tests.json --noEmit --incremental false
node_modules/.bin/tsc --noEmit --incremental false
git diff --check
```

DB・ブラウザー・ビルドの確認は統合担当へ引き渡す。この担当では実施していない。
R05完了後は次領域へ着手せず、ラベル表示/印刷、在庫集計、特殊商品照合、注文照合・在庫引当・発送などは未着手のまま引き渡す。

## 第3回：R06 ラベル表示・一覧・印刷規則・QR（2026-09-30）

クリーンな担当ブランチへ統合基準 `ef808dc` をmergeした（`a2dcf23`、衝突なし）。
統合担当がfetch済みの基準を利用し、担当側ではfetch/push/main変更/Vercel操作をしていない。
新たなshared変更は不要だった。第1回・第2回で未着手と記録したラベルのうち、本節の純粋規則を完了した。

### 分離した責務

| ファイル | 内容 |
| --- | --- |
| `productText.ts` | `compactProductText`。画面内の既存全呼出元が同じ正規化を参照 |
| `productPresentation.ts` | `stockModelName`、`getInventoryCategory`、`STOCK_MODEL_ORDER`。ラベルと在庫表示で共用する分類表示 |
| `labelStatus.ts` | 状態の表示文字列とバッジ色。trim有無の差は維持 |
| `labelTitles.ts` | 管理番号由来の注文名、印刷名の旧変換と追加変換、割当先の表示名 |
| `labelTitleOverrides.ts` | override型、空状態、文字列辞書の選別、キー正規化、override適用。保存処理は含めない |
| `inventoryLabelViews.ts` | 印刷可能なラベルの判定、在庫由来ラベルの組立 |
| `purchaseLabelViews.ts` | 発注由来・完了インボイス由来の2ビルダー。既存の商品名resolverを受け取るfactory |
| `labelPrintLayout.ts` | 24面設定、開始/次位置、配列分割、表示日付範囲、印刷グループ、確認一覧の並び順 |
| `qr.ts` | 既存の有限体テーブル、バイト列、固定行列、SVGパス生成。公開は行列・パス・余白値 |

元画面は8,728行から8,069行へ。UI部品・CSS・portal・印刷操作は移動していない。
`actualProductTitle` と特殊商品名fallbackは画面に残し、`createPurchaseLabelBuilders(actualProductTitle)` をモジュール初期化で1回だけ構成する。
構成時にresolverは実行せず、旧関数本体が従来と同じ場所で同じ明細参照を渡す。引数を欠いたtitleやnullのfallbackも維持する。
QRは副作用のない独立計算だったため今回に含めた。テーブルは引き続きモジュール初期化で1度だけ作られる。

同画面の `buildStockItemViewsFromInventories` にあった完全同義のinline filterも、新設 `isInventoryPrintableLabel` に統一した。
在庫数量・ラベル不足分の補完など、その関数の他の処理は変更していない。

### 既存正本と仕様差の確認

- 管理番号・etc・インボイス識別・仕入先・数値化は前回までの既存正本を参照。今回の新モジュールから画面へimportする循環依存は作らない。
- 一般の商品名変換 `inventory/lib/productNameUtils.ts` は機種・色・表記の体系が違う。印刷名の2段階の置換順序や独自名称を置換しない。
- `server/inventory/labelViews.ts` はDBラベルの公開項目、重複排除、受領判定の規則。画面の数量制限・表示名・印刷可否とは別のため流用しない。
- 出庫箱のコード判定は引き続き `shared/outboundBoxes`。QR行列/パス生成と同義の既存実装は見つからなかった。
- 状態文字列の表示は小文字化のみ、バッジ色と印刷可否はtrimも使う。空白だけの状態や空IDの扱いは経路ごとの既存仕様を残す。
- 発注由来ラベルは空IDも組立結果に残す。在庫/完了インボイス由来は空IDと対象外状態を除き、有限値化・floorした在庫数で上限を切る。
- `invoiceSummaries === undefined` は未取得として空配列、`[]` は未完了インボイスなしとして扱う。eBay/一般在庫は完了インボイス経路へ入れない。
- 在庫経路の管理番号fallback `-`、仕入先・価格・日付のnullish/空文字優先、IDの0値、labelの重複は修正しない。
- overrideはラベルID、タイトルキー、自動名の順。新しいラベルオブジェクトを返すが仕入先などの参照は維持する。
- 印刷グループは分類優先順、未定義分類は日本語numeric順。確認一覧だけ管理番号のnumeric順に複製配列を並べ替え、元ラベルは共有する。
- 日付範囲は負のrowIdを除外、日付なしは表示、その他は先頭10文字の比較。一般の日付パーサへ変更しない。
- QRは21×21、固定マスク/余白、trim/大文字化、文字コード下位8bitを使う既存実装。長文/非ASCIIの扱いやQR規格適合性を改善する回ではない。
- `chunkArray` の非空配列＋0/負のsizeは元実装が停止しない。今回も仕様修正せず、それらの実行は避ける。実画面は固定24を使う。

### 整理前基準と確認結果

`label-baseline-source.txt` は `ef808dc` から実宣言をそのまま抽出した固定fixture（39宣言）。
初回38宣言に、同義filterへの参照変更を検証する旧 `buildStockItemViewsFromInventories` も同じコミットから追加した。
最終SHA-256：`bb23ab0437347261ff2811604c9496327074ad315040e9fe812c6c1f1863c23c`。
`label-baseline.ts` は指定した純粋依存だけを渡して評価し、通常テストにGit履歴や外部通信は不要。
第1回の任意再抽出確認のパスを `label-baseline-source.txt`、コミットを `ef808dc` に替えると完全一致を確認できる。実行済み。

アプリ編集前に旧実関数から11スナップショットを取得した。新実装から期待値を生成していない。
現行側の `current` は新モジュールだけで構成し、旧実装へのfallbackを持たない。
画面に残したresolverは `current-page-labels.ts` が現行ソースから必要な純粋宣言だけをAST抽出する。旧resolverで現行動作を代用せず、UI全体やAPIもロードしない。

- R06対象9テスト・11スナップショットが成功。表示名の置換順、全半角、日本語・英語、記号、空欄、状態の空白、overrideの優先順位を確認。
- ラベルの状態/ID/数量429通りで、発注・在庫・完了インボイス・既存在庫表示の全出力を旧関数と比較。未取得/空/未完了インボイスの違いも比較。
- resolverの構成時未評価、呼出時期、受け取る明細参照、未指定/null/空のtitleを確認。
- 120発注・600ラベル、重複ID、350ラベルのグループ化、23/24/25/48/49/1001件の分割、負数・小数・非有限数の位置計算を比較。
- 入力非変更、行内での仕入先オブジェクト共有、行間の独立、override後の参照保持、グループ/ページ内のラベル参照保持を確認。
- QRは空/空白、箱ID、17/18文字境界、1,000文字、非ASCII等12例の全行列とパスSHA-256を旧実装で固定。別途300入力で行列と完全なパス文字列を比較し、入力行列を変更しないことも確認。
- R01〜R05、入庫一覧、sharedを含む関連10ファイル109テストが成功。新11件、前回まで16件、入庫一覧23件のスナップショットが一致。
- アプリ全体と対象テストを含む型チェックが成功（`--noEmit --incremental false`）。
- 宣言比較では移動を含め175宣言がexport修飾子と空白以外同一。消失なし。唯一の既存関数本体変更は在庫表示内filterの同義正本参照で、関数全体の比較で検証済み。

再実行コマンド：

```sh
TZ=Asia/Tokyo LANG=en_US.UTF-8 node_modules/.bin/vitest run client/src/inventory/pages/purchase-registration/labels.test.ts client/src/inventory/pages/purchase-registration/metadata.test.ts client/src/inventory/pages/purchase-registration/rules.test.ts shared/purchaseMetadata.test.ts shared/purchaseVisibility.test.ts shared/invoiceKey.test.ts shared/productMatching.test.ts shared/outboundBoxes.test.ts client/src/inventory/pages/purchases/contracts.test.ts client/src/inventory/pages/purchases/presentation.test.tsx
node_modules/.bin/tsc -p client/src/inventory/pages/purchase-registration/tsconfig.tests.json --noEmit --incremental false
node_modules/.bin/tsc --noEmit --incremental false
git diff --check
```

### 未検証・未着手

DB回帰、ブラウザー、ビルドは統合担当へ引き渡す。この担当では操作していない。
実プリンター出力、カメラ/スキャナーの読取、全QRの規格適合性は今回の比較テストの保証範囲ではない。
localStorageのload/saveとキー、カメラ、React部品/印刷実行、ラベルの発送優先マージ、注文照合・在庫引当・発送は画面側に残した。
本節の区切りで停止し、次領域へ進まない。

## 第4回：R07・R08・R09a（2026-09-30）

速度調整として関連作業をまとめ、担当は対象比較・対象型だけを実行した。全体テスト/全体型/ビルド/DB/ブラウザーは統合担当が最後に実施する。
クリーンな担当ブランチへ `608f1ea` をmerge（`f3570a0`、衝突なし）。今回の共有変更はない。

### 完了範囲と境界

| 単位 | 配置 | 内容 |
| --- | --- | --- |
| R07 | `stockViews.ts` | 在庫由来のラベル付き/不足ラベル分の表示組立、モデル分類と並び順 |
| R07 | `stockWaiting.ts` | 入庫待ちの在庫表示。既存 `actualProductTitle` だけを受け取るfactory |
| R08 | `stockProposalRules.ts` | 提案用の商品名正規化、分類、対象外管理番号、未完了インボイス、付属品/本体、提案対象行 |
| R08 | `stockProposalValues.ts` | 数量・価格・明細・検索文字列の集計用オブジェクトとmap操作 |
| R08 | `stockProposalGroups.ts` | 在庫と入庫待ちを提案商品へ集計・分類。既存 `actualProductTitle` だけを受け取るfactory |
| R08 | `stockProposalDisplay.ts` | 平均価格、価格幅、管理番号の表示 |
| R09a | `stockForecast.ts` | 受取済みの商品集計から売上・粗利・粗利率の表示値を計算 |
| 共通読取 | 既存 `productText.ts` / 新規 `stringValues.ts` | `productKey`、`hasAnyProductText`、`unique`を移動し、全既存呼出元が同じ関数を参照 |

画面は8,069行から7,615行へ。新規アプリモジュール8ファイルと既存 `productText.ts` の拡張。
factory構成時にはresolverを評価せず、既存の関数名で呼び続ける。UI・API・保存・引当・照合の処理は画面に残した。
R06の現行ソース評価用テストアダプターは、移動後の `stockViews.ts` を直接参照するよう更新した。旧実装へのfallbackはない。

**R09全体は完了していない。** `buildProductSummaries`、`buildInvoiceStockProductSummaries`、`filterInvoiceStockItems` 等はR09b以降として未着手。
これらは `invoiceAlignedProductTitle` / `purchaseItemMatchTexts` / `findInvoiceProductNameForStockItem` と特殊商品照合に依存する。複数resolverを束ねて注入する構造を避け、統合担当と合意して今回の境界から外した。

### 維持した意味の違い

- 在庫表示は在庫数を有限値化・floor・0下限にし、ラベル不足数量を別行へ補完する。入庫待ち表示も数量を整数化するが、提案待ち数量は元の小数を保持する。
- 提案に渡る在庫側の負数・非有限数は従来どおり扱い、追加で正規化しない。価格加算だけは既存の `<= 0` 判定を使う。
- `normalizeStockProposalTitle` は先頭の「登録漏れ」、空白、Vita1100/1000、3DS LL/XLの表記を扱う。一般商品照合の正規化やNFKCに置き換えない。
- 付属品語がカテゴリにあっても、商品名に本体語があれば本体として扱う。除外接頭辞 `403_ネレ` と半角3桁インボイス識別の現行条件を維持する。
- 提案対象行の判定と、各明細の未完了インボイス/付属品除外は別段階。行内に複数の管理番号がある場合も、その処理順を維持する。
- 同名商品の価格は数量加重で集計し、0以下の単価は価格件数に含めない。集計中のproduct/mapを更新する内部ヘルパーは従来どおり意図的に可変。元の在庫/発注データは変更しない。
- 詳細の仕入先オブジェクトは入力から引き継ぐ。分類配列は新規でも、その中の在庫オブジェクトは元参照を保持する。
- 提案検索はモデル/正規化商品名/管理番号/ラベルID/仕入先名/状態。URLや日付は検索文字列に追加しない。絞り込み後の数量・価格集計も従来どおり。
- 管理番号表示は完全一致の重複排除と先頭4件＋残件数。全半角・大小文字を追加で同一視しない。
- 利益予測は通貨混在、元通貨/円価格の有無、丸めと粗利率を既存順序で計算する。インボイス金額のshared規則とは用途・入力・丸め方が違うため統合しない。

### 比較基準と対象確認

`stock-baseline-source.txt` は `608f1ea` の実宣言26件をそのまま抽出した固定fixture。
SHA-256：`2adf9b1987b3649fc0667c3c08d50ef5336067c7c211cf6f35d6834d5995f28f`。
通常テストはGit履歴不要。第1回の再抽出確認のパスをこのfixture、コミットを `608f1ea` に替えて完全一致を確認できる（実行済み）。
アプリ編集前に旧関数から10スナップショットを取得し、移動後は更新せず一致を確認した。
現行側は新モジュールと現行画面から取り出した商品名resolverを使用し、旧関数で代用しない。

- 新規対象10テスト・10スナップショットが成功。
- 200通りの数量/発注状態/ラベル状態、70通りの在庫ID/現在庫数、欠損・null・空・負数・小数・非有限数を比較。
- 400在庫の分類・並び順・数量と、入力オブジェクト参照の保持を確認。
- 商品名の日本語/英語/全半角、付属品/本体、除外接頭辞、未完了インボイス、混在した行の提案結果と検索を比較。
- 提案の境界入力180通り、価格更新36通り、平均価格30通り、予測値288通りを旧実装と比較。
- 集計ヘルパーの意図的更新、map再利用、詳細オブジェクト参照、入力非変更、factory構成時未評価、未指定/nullのタイトルfallbackを確認。
- 影響するR06と合わせ、対象2ファイル19テストと新10件＋既存11件のスナップショットが成功。
- `tsconfig.tests.json` による対象テスト/モジュールの型チェックが成功。全体型チェックは担当で実行していない。
- 関数・定数の宣言比較で移動を含め134宣言がexport修飾子と空白以外同一。消失・本体変更なし。構成用factoryとimportだけを追加した。

再実行：

```sh
TZ=Asia/Tokyo LANG=en_US.UTF-8 node_modules/.bin/vitest run client/src/inventory/pages/purchase-registration/stock.test.ts client/src/inventory/pages/purchase-registration/labels.test.ts
node_modules/.bin/tsc -p client/src/inventory/pages/purchase-registration/tsconfig.tests.json --noEmit --incremental false
git diff --check
```

全体型チェック・全アプリテスト・ビルド・DB・ブラウザーは統合担当に引き渡す。この担当では重複実行していない。
本区切りはR07/R08/R09aのみ。R09b以降、UI部品や特殊照合・引当・発送等の次領域へは進まず停止する。

## 第5回：商品名・照合の依存元と関連集計（R09b）

統合基準 `5873dbe` を作業枝へ取り込み、競合なし。商品照合のresolver群を注入する構造は追加せず、依存元から直接importできる形で次の3単位を分離した。

| 単位 | モジュール | 責務 |
| --- | --- | --- |
| 商品名・照合の基礎 | `productTitles.ts` | 表示用の商品名、元の実商品名と欠損時fallback |
| 同上 | `productMatchConstraints.ts` | 登録画面固有の限定版分類、ランダムカラー、購入品/在庫の照合制約 |
| 同上 | `invoiceProductSuggestions.ts` | どうぶつの森、407番、一般候補、モデル一意候補、管理番号優先の候補選択 |
| 商品照合・詳細絞り込み | `productMatching.ts` | 購入品のインボイス名整合、照合文字列、購入品/在庫一致、在庫のインボイス商品選択 |
| 同上 | `productDetailFilters.ts` | 商品別の購入行/在庫/インボイス在庫の絞り込み、詳細見出し |
| 関連商品集計 | `productSummaries.ts` | 購入商品集計、インボイス現在庫集計/絞り込み、インボイス数量・価格の重複集計、現在庫数の置換 |

画面は7,615行から7,017行。既存ラベル/入庫待ち/在庫提案factoryへ渡す `actualProductTitle` は、新しい `productTitles.ts` から参照する。factoryのAPIや評価時期は変えない。
テスト用 `current-page-labels.ts` も現行アプリモジュールの直接参照になり、画面ソースのAST評価は不要になった。旧実装へのfallbackはない。

`CsvProductCandidate` は既存 `@shared/productMatching` の同形型を再利用する。共通のモデル抽出・管理番号ヒント・一般候補選択・407番例外・在庫色制約は引き続きsharedを呼ぶ。sharedへの変更はない。
限定版のローカル規則は共通化しない。sharedは `special edition` を限定版とし、`normalizeLooseText` でゼロ幅文字・中点・アンダースコア・ハイフン等を除くが、登録画面は従来の `compactProductText` と限定語リストを使う。この差を保持する。

### 維持した意味と未移動の境界

- 表示名はモデル/限定版/色をまとめるが、実商品名は元のtrim済み名称を優先する。管理番号だけで名称を補完する欠損/nullタイトルの処理も保持。
- どうぶつの森候補、407番White Base候補、一般候補、同モデル一意候補の順番を変えない。曖昧候補を独自に決め直さず、候補順と重複候補の扱いも維持する。
- 購入品とインボイス集計は管理番号による候補を優先する。在庫は制約を満たす商品名の完全一致を先に採用する。この違いを統合しない。
- 詳細絞り込みは行の状態/ラベルと現在庫数に従う。無条件時の配列同一参照、絞り込み後の元商品/在庫参照、必要な行だけのcloneを維持する。
- 購入集計の数量は有限数化するが小数・負数を保持し、単価合計/件数は数量加重しない。現在庫集計はfloorと0下限を使い、単価は数量加重する。追加の非有限値正規化はしない。
- インボイス重複商品は最初のキー順/名称/通貨を保持し、正の注文数と価格で販売単価を加重する。照合しない購入集計はインボイス側集計へ追加しない。
- 在庫数置換は `invoiceOrdered` がnull/未指定の集計を元参照のまま返す。空のインボイスの場合は元配列を返す。入力の購入品・在庫・インボイスを変更しない。
- `buildAllocationGroups`、`hasOpenInvoiceQuantity`、グループ統合、UI、保存、スキャン、引当変更、発送は画面に残す。R09周辺の画面全体が完了したという意味ではない。

### 比較基準と対象確認

`product-baseline-source.txt` は `5873dbe` の実宣言28件（候補型1件を含む）をそのまま保存した固定fixture。
SHA-256：`bc96aec5444c7ecf6b6ce5bdb250f700502f08d7385679252fc0c95e3024ce56`。
通常テストはGitを呼ばない。テストアダプターは固定fixture内の27関数/定数の存在を検証して評価する。
アプリ編集前に旧実装から13スナップショットを保存し、移動後は更新せず照合した。基準コミットからの再抽出完全一致も確認済み。

- 新規対象12テスト、13スナップショットが成功。
- 表記30種類＋407番の照合文字列と、未指定を含む対象31種類の961組について購入/在庫制約を比較。
- 6種類の入力と7候補集合の42組で、曖昧モデル・同一候補の重複・候補の並び順・管理番号優先を確認。
- タイトル/管理番号/カテゴリ/仕入先のヒント、購入と在庫で異なる色制約、特殊版の拒否を確認。
- 160通りの購入数量/在庫数量/行状態、42通りの在庫数量/単価、42通りの注文数/販売価格を旧実装と比較。
- 除外在庫ID、floor、小数・負数・非有限値、受取済みの待ち数量、価格加重の違い、並び順、入力不変と参照保持を確認。
- 既存ラベル9テスト/在庫10テストと合わせ、3ファイル31テストが成功。新13件と既存21件のスナップショットが一致。
- 対象用 `tsconfig.tests.json` の型チェックが成功。
- 元画面の118宣言は移動後もexport修飾子以外完全一致。ローカル候補型1件だけを既存shared型参照に置換した。関数本体を変更していない。

再実行：

```sh
TZ=Asia/Tokyo LANG=en_US.UTF-8 node_modules/.bin/vitest run client/src/inventory/pages/purchase-registration/products.test.ts client/src/inventory/pages/purchase-registration/labels.test.ts client/src/inventory/pages/purchase-registration/stock.test.ts
node_modules/.bin/tsc -p client/src/inventory/pages/purchase-registration/tsconfig.tests.json --noEmit --incremental false
git diff --check
```

全体型チェック・全アプリテスト・ビルド・DB・ブラウザー比較は統合担当へ集約する。この担当では重複実行せず、ローカルcommit後に引き渡す。push、本番操作、main編集は行わない。

## 第6回：引当グループ規則と充足表示（R10）

共通基準 `7db6054` をcleanな作業枝にmergeし、競合なし。次の3単位を分離した。

| 単位 | モジュール | 内容 |
| --- | --- | --- |
| 引当グループ規則 | `allocationGroups.ts` | インボイス未完了判定、購入行のグループ作成、同キー統合、表示行選択 |
| 同上の依存元 | `labelMerging.ts` / `registrationLabelViews.ts` | ラベル重複統合と出庫可能状態判定、既存ラベルbuilderの構成 |
| 充足表 | `ProductFulfillmentTable.tsx` | 旧表とV2のJSX/CSS・クリック/キーボード通知をそのまま移動 |
| 統計カード | `StatCard.tsx` | 充足・仕入合計・想定売上・粗利のカード表示 |

画面は7,017行から6,510行。`OrderDashboard` は `PurchaseRegistrationCard` / `StockDetailCard` / `EmptyState` と編集・追跡・削除イベントに依存するため画面に残した。表/カードをimportする以外に、ダッシュボードの宣言・hook状態・effect依存・props・コールバック配線は変えていない。ラベルbuilderの既存構成宣言を独立させ、グループ規則から画面をimportしない一方向の依存にした。shared変更なし。

### 保持した意味と利用状況

- `invoiceSummaries` 未指定なら購入行由来の全インボイスを扱い、空配列指定なら通常のインボイスグループを除外する。在庫/eBayは別条件で保持する。
- サマリーだけ存在する空グループの生成、重複サマリー、数値を考慮する逆順、eBay/在庫の末尾配置、相手名の優先順位を維持する。
- ラベルIDのtrim/大文字化、空ID除外、既存在庫IDの優先、出庫可能状態の保持、追加順を変えない。副作用のある出庫処理自体は移動しない。
- 同キー統合ではラベルがある場合に必要/確保/残数をラベル数へ置き換える。ラベルなしの数値加算、nullishによるインボイス情報の継承、元グループ/行/ラベルの参照保持も従来どおり。
- 旧 `ProductFulfillmentTable` はアプリ内呼出0件。削除せずexportしたまま保管・比較する。旧表の不足数は0下限、V2は入庫待ちも差し引き負数を表示し得るため、計算を共通化しない。
- V2は `OrderDashboard` と `ShippingPanel` の2か所、`StatCard` はダッシュボードの4か所で使用する。V2のdesktop/mobile分岐、stockOnly列数、空表示、選択色、button/role/tabIndex、Enter/SpaceのpreventDefault順を保持する。
- コンポーネントはモジュール直下で定義し、hookやinline componentを新設していない。`vercel:react-best-practices` の観点で直接import、状態境界、既存キーボード操作、型を確認した。UI改善を混ぜず移動に限定した。

### 固定基準と対象検証

`allocation-baseline-source.txt` は `7db6054` の実宣言10件（移動9件＋残す `OrderDashboard` 1件）の固定fixture。
SHA-256：`b2a2ddbe75891b45ed1d2fe62c3e5be38e09227f5caf8b6a5ff507d46cf019c9`。
アプリ編集前に旧実装で9テスト・10スナップショットを保存し、移動後は更新せず比較した。通常テストでGitは不要。現在側は新モジュールを直接実行し、旧実装へのfallbackはない。

- 新規9テストと既存ラベル9テスト、計18テストが成功。新10件＋既存11件のスナップショットが一致。
- グループ集計72条件、ラベルの状態/在庫ID優先320条件、未完了数量35条件を旧実装と比較。
- V2の空/非空、stockOnly、選択6状態、ハンドラー有無の96条件で、desktop/mobileを含む生成HTML全体が旧実装と完全一致。スナップショットにはHTMLのSHA-256・表示文字・操作要素のクラス/role/tabIndexを保存。
- クリック通知、Enter/SpaceのpreventDefaultと通知順、Escapeと未指定ハンドラーの無操作を比較。
- `OrderDashboard` の宣言全体を固定fixtureと完全一致比較し、状態初期値・更新・effect依存・JSX・イベントの維持を確認。
- 基準コミットからfixture再抽出完全一致、および元画面91宣言すべてのexport修飾子以外の完全一致を確認。builder構成宣言も同一。
- 対象 `tsconfig.tests.json` の型チェックが成功。新TSXは対象テストからimportされるため型チェックに含まれる。

```sh
TZ=Asia/Tokyo LANG=en_US.UTF-8 node_modules/.bin/vitest run client/src/inventory/pages/purchase-registration/allocation.test.ts client/src/inventory/pages/purchase-registration/labels.test.ts
node_modules/.bin/tsc -p client/src/inventory/pages/purchase-registration/tsconfig.tests.json --noEmit --incremental false
git diff --check
```

全体型チェック・全テスト・build・DB・実ブラウザーでの状態保持/表示比較は統合担当へ集約する。担当のHTML/イベント比較は実ブラウザー検証の代替完了報告ではない。ローカルcommitまでとし、push/main編集/Vercel/本番キー・DB操作は行わない。

### 残る大きな責務と次の候補

画面には発注/在庫カード、OrderDashboard、追跡一覧、印刷と永続設定、カメラスキャン、在庫提案/一覧、出庫箱・申告・発送・返品、最上位のquery/mutationとダイアログ状態が残る。R10で登録画面全体を完了したわけではない。

次の3バッチ候補（親の指定を受けて着手）：

1. `PurchaseRegistrationCard` / `StockDetailCard` / `EmptyState` の依存元を分離してから `OrderDashboard` を移動。編集・追跡・削除コールバックと表示状態を保持する。
2. `StockProposalPanel` / 分類カード / 商品行と `StockPanel` の表示境界を整理。検索・展開状態・引当イベントの所属は維持する。
3. `LabelChecklistView` / 印刷用紙 / 印刷CSSなどの表示部分を先に分離し、`LabelPrintPanel` の設定保存・印刷副作用との境界を整理。スキャン/発送の実行処理へは同時に広げない。

## 第7回：発注カードとOrderDashboard（R11）

共通基準 `4037f50` をcleanな作業枝へmergeし、競合なし。第6回で残したカード依存元から次の3単位を分離した。

| 単位 | モジュール | 内容 |
| --- | --- | --- |
| カードの依存元 | `purchaseRowIdentity.ts` / `trackingNavigation.ts` | ラベル優先の在庫ID選択、エコ配追跡フォーム送信 |
| 表示カード | `PurchaseRegistrationCard.tsx` / `StockDetailCard.tsx` / `EmptyState.tsx` | 発注カード、現在庫カード、空表示 |
| ダッシュボード | `OrderDashboard.tsx` | 集計/充足表、出庫済み表示切替、詳細行・在庫カードの表示 |

画面は6,510行から5,968行。既存propsをそのまま移動し、ダッシュボード→カード→依存元の直接importにした。巨大なprops注入やfactory、循環参照は追加していない。モジュール直下のコンポーネント定義と同じ呼出位置・key・propsを保ち、状態の所属を変更していない。

エコ配の追跡を使うスキャン表示や追跡ダイアログも同じ関数をimportする。DOMフォームの生成・属性/値設定・append・submit・removeの順序を維持し、エラー処理や入力正規化を追加していない。API/mutation、保存、スキャン/発送/削除/引当の実行処理は画面内のまま。

### 維持した表示と操作

- 発注カードの表示商品4件/ラベル8件の上限、残件数、仕入先リンク、追跡キャリア表示、ラベル印刷/削除のdisabled条件、選択時の枠とaria-labelを保持。
- 選択は `checked === true` のみtrueとして通知。編集・追跡編集・出庫履歴・削除は同じ購入行参照、在庫編集は同じID、印刷は既存builderのラベル配列を渡す。
- 在庫IDはラベル→購入品の順で、有限かつ正のNumber変換値を最初に返す。小数を整数へ丸める等の変更はしない。
- ダッシュボードの出庫済み行は初期非表示。切替は関数型setStateを保持し、グループkey・商品key・商品名・modeの値が変わった場合にだけeffectでfalseへ戻す。
- `detailRows` / `products` 上書き、groupの優先、在庫/eBay条件、空表示、フィルター解除、削除中ID、カードへのコールバック転送は従来どおり。
- `vercel:react-best-practices` の観点で、モジュール直下定義、hookの呼出順/依存、直接import、props型、既存の操作性を確認。表示改善や最適化は混ぜていない。

### 固定基準と検証

`dashboard-baseline-source.txt` は `4037f50` の実宣言6件をそのまま保存したfixture。
SHA-256：`df4c04215d2af3f9491389fb32ab4c5412d92cea064ef696137da75c555bc584`。
編集前の旧コードで7テスト・10スナップショットを固定し、移動後に更新せず照合した。通常テストはGitを呼ばず、現行側は新アプリモジュールを直接実行する。

- 新7テスト＋前回allocation9テスト、計16テストが成功。新10件＋既存10件のスナップショットが一致。
- 発注カード12条件＋選択状態、在庫カード3条件、空表示3条件、Dashboard6条件のHTMLを旧実装と完全一致比較。HTMLのSHA-256・表示文字・操作要素属性を固定スナップショットにも保存。
- 在庫IDの56境界条件、空購入行、印刷/削除のdisabled条件、選択値のtrue/false/indeterminateとイベントpayloadの参照を確認。
- エコ配送信はfake documentで生成/属性設定/append/submit/remove順を比較。submit例外時の従来挙動とdocumentなしの無操作も保持。実通信や実フォーム送信は行っていない。
- hook用テストハーネスで出庫済み表示の往復、同じ依存値での状態保持、グループ/フィルター各値の変更時リセットを旧実装と比較。これはブラウザーでの状態保持検証の代替完了報告ではない。
- 第6回のDashboard宣言比較は参照元を移動先へ変更し、旧fixtureとの本体完全一致チェックを継続。
- 対象用 `tsconfig.tests.json` の型チェック成功。fixtureの基準コミットからの再抽出完全一致と、元画面81宣言すべてのexport修飾子以外の完全一致を確認。

```sh
TZ=Asia/Tokyo LANG=en_US.UTF-8 node_modules/.bin/vitest run client/src/inventory/pages/purchase-registration/dashboard.test.ts client/src/inventory/pages/purchase-registration/allocation.test.ts
node_modules/.bin/tsc -p client/src/inventory/pages/purchase-registration/tsconfig.tests.json --noEmit --incremental false
git diff --check
```

全体型/test/build/DB/実ブラウザーは統合担当へ集約。担当はローカルcommitで引き渡し、指定範囲で停止する。push/main/Vercel/本番DB・キー操作なし。

### 残る境界

今回、カードからOrderDashboardまでの前回候補は分離済み。画面には追跡不足一覧、在庫提案・一覧、ラベル印刷/永続設定、カメラスキャン、出庫箱・申告・発送・返品、最上位query/mutationとダイアログ状態が残る。
次候補は①在庫提案の表示部品とStockPanel、②印刷用紙/チェックリスト/CSSからLabelPrintPanelの境界、③追跡不足一覧と追跡ダイアログの表示境界。実行処理の整理は表示移動と分け、次の親指示で範囲を決める。
