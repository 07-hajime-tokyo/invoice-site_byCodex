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
