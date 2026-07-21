# 2026年6月末 棚卸し作業 引き継ぎログ

最終更新: 2026-07-21 JST

対象リポジトリ: `07-hajime-tokyo/invoice-site_byCodex`

基準コミット: `d0d2b2134ffe517774c8279d755cd296e3df3780`

## 目的

2026年6月末棚卸しについて、Googleスプレッドシート、一時照合サイト、請求・入出庫サイト、実装リポジトリの関係を整理し、別PCでも同じ地点から作業を再開できるようにする。

更新: 2026-07-21にGoogleスプレッドシートへ現在在庫金額（N列）を反映し、一時照合サイトの現物数入力が各集計へ連動する修正を実装した。DBと請求・入出庫サイトの在庫データは変更していない。

## 参照先

- 確定・明細スプレッドシート:
  - https://docs.google.com/spreadsheets/d/1PWOeDf9oEvLvGrT7mMHwjhnM3HwdkQJfgRIs_NnOi9E/edit?gid=1275382356#gid=1275382356
  - ファイル名: `20260709棚卸し完了データ`
- 入庫管理:
  - https://invoice-site-bycodex.vercel.app/inventory/purchases
- 月次棚卸し:
  - https://invoice-site-bycodex.vercel.app/inventory/monthly-report
- やること:
  - https://invoice-site-bycodex.vercel.app/inventory/action-items
- 6月末一時照合サイト:
  - https://inventory-reconciliation-2026-06.vercel.app/
- GitHub:
  - https://github.com/07-hajime-tokyo/invoice-site_byCodex
  - 一時照合サイトの正本: https://github.com/07-hajime-tokyo/todo-structure-lab/tree/main/inventory-reconciliation-2026-06

`invoice-site-bycodex` は許可メール制。未ログイン環境ではログイン画面までしか確認できないため、ログイン後の画面構造は `origin/main` の実装を参照した。一時照合サイトは公開中の実画面と配信中の `data.js` / `app.js` を確認した。

## 全体のデータフロー

```text
入庫管理・在庫・出庫・取引データ
  ↓
invoice-site 月次棚卸しプレビュー
  ↓ CSV化した 2026-07-02 朝時点のスナップショット
6月末一時照合サイト
  ↓ 7/9実査、売り先決定、登録漏れを行単位で補正
Googleスプレッドシートの「6月末確定」「6月末在庫明細」
```

## Googleスプレッドシートの構造

シートは3タブ。

1. `棚卸レポート_2026-06末 (1)` (`sheetId=1304934083`)
   - 一時照合サイトの集計を表形式で保存したもの。
   - カテゴリ集計、売り先決定済み、未完了注文、発注済み未到着、7/1出庫を収録。
2. `6月末確定` (`sheetId=490944618`)
   - 税理士報告用の結論と別枠報告。
3. `6月末在庫明細` (`sheetId=1275382356`)
   - 206商品行、数量合計423。
   - 元の200行に、6月末時点の入庫登録漏れ6点を追加。
   - 売り先決定、幽霊在庫、7/1入庫除外を行単位で割当。

重要: 既存のサマリー、カテゴリ小計、I列の総合計は固定値で、L列・M列の後追い修正は自動集計されない。2026-07-21にN列「現在在庫金額」を追加し、M列に数値があればM列、なければI列を採用して現在値を固定反映した。N252だけは `SUM(N10:N249)` の数式。

### 明細の区分別内訳

| 区分 | 商品行 | 数量 | 6月末算入額 |
| --- | ---: | ---: | ---: |
| 追加:登録漏れ | 5 | 6 | 108,000円 |
| 算入 | 94 | 219 | 2,083,146.5円 |
| 一部算入 | 6 | 57 | 125,656円 |
| 調整 | 1 | 0 | -126円 |
| 算入(単価0) | 27 | 28 | 0円 |
| 除外:幽霊在庫 | 23 | 63 | 0円 |
| 除外:売り先決定済み | 46 | 46 | 0円 |
| 除外:7/1入庫分 | 4 | 4 | 0円 |

## 2026-07-21反映後の現在在庫額

```text
月次棚卸しの現在プレビュー       3,539,430.5円
－ 7/1入庫分                       99,810円
＝ 6/30既知在庫                 3,439,620.5円

－ 売り先決定済み                447,132円
－ 幽霊在庫整理                  783,812円
＋ 6月末時点の登録漏れ            108,000円
＝ 従来の6月末棚卸資産確定      2,316,676.5円
－ 後追い修正20行                  110,176円
＝ N列の現在在庫金額合計        2,206,500.5円
```

N列は正の在庫85行と調整行（-126円）を保持し、0円は空欄にした。N列が正の行はA:Nを薄い緑で表示する。

別枠:

- 売り先決定済み: 447,132円、46件
- 発注済み・6/30未到着: 106,385円、9件
- 未入金インボイス0393: 749,181円、29件
- 単価不明・実在品: 0円計上のまま数量管理

## 反映済みの後追い修正

`6月末在庫明細` のL列「修正メモ」とM列「修正後金額」にある20行を、N列「現在在庫金額」へ反映済み。すべてM列は0円で、I列との差額は合計-110,176円。

カテゴリ別のI列からM列への差額:

| カテゴリ | 反映済み減額 |
| --- | ---: |
| 3DS | -13,000円 |
| 3DSLL | -1,280円 |
| New2DSLL | -349円 |
| New3DS | -949円 |
| New3DSLL | -1,623円 |
| PSP | -2,480円 |
| Vita1000 | -8,986円 |
| ゲーム | -5,410円 |
| 未分類 | -76,099円 |
| 合計 | **-110,176円** |

反映後の現在在庫金額は `2,206,500.5円`。3DSピンク13,000円は、2026-07-21のNotion指示で既存のtoynet 3DS グロスピンクとの重複と確定したため0円にした。

個別処理:

- `DSi メタリックブルー` 26,600円は、メモが商品名／カテゴリの誤りを示すだけで在庫不存在とは判断できないため、現在在庫金額を26,600円のまま保持。
- Surface Pro 47,000円とヤマハヘッドホン29,099円は不存在として空欄。
- Vita1000ケーブル5行を含むM列0円の20行は現在在庫金額を空欄。

## 各サイトの役割

### `/inventory/purchases`

- 入庫前の発注データを管理。
- 未仕訳、eBay、オレゴン、直取引、国内卸に分類。
- 発注済み／発送済み、追跡番号、管理番号、仕入単価、入庫工程を保持。
- 2026-06-20より前の旧入庫ワークフロー行は通常表示から除外。
- 主実装: `client/src/inventory/pages/Purchases.tsx`

### `/inventory/monthly-report`

- 現在在庫、発注、出庫履歴、取引注文、未完了インボイスを都度集計。
- 在庫一覧は数量が正の行をカテゴリ・商品別に集計し、仕入単価×数量を計算。
- 支払済みかつ未完了のインボイスだけを抽出。
- 発注済み、在庫、出庫済み、国内卸、手動入力行を表示。
- 保存レポートは `inventorySummaryJson` と `invoiceListJson` のスナップショット。
- 年月選択は保存・国内卸行のキーにはなるが、プレビュー在庫を過去時点へ巻き戻す処理ではない。
- 主実装:
  - `client/src/inventory/pages/MonthlyReport.tsx`
  - `server/inventory/routers.ts` の `monthlyReport.preview`

### `/inventory/action-items`

- 未完了／完了、担当者、記入者、検索、返信を管理。
- 鈴木さん・藤本さんのレビュー確認状態をJSONで保持。
- 6月末一時照合サイトへの導線と作業説明を表示。
- 主実装:
  - `client/src/inventory/pages/ActionItems.tsx`
  - `server/inventory/actionItems.ts`

### 6月末一時照合サイト

- 静的構成: `index.html + styles.css + data.js + calculation.js + app.js`。
- `data.js` の生成日時: `2026-07-01T21:33:00.065Z`（JST 2026-07-02 06:33）。
- 元データ: 月次棚卸しCSV、入庫履歴CSV、出庫履歴CSV。
- `data.js` の主配列:
  - categories: 21
  - inventoryItems: 200
  - july1Arrivals: 9
  - july1Outbounds: 5
  - pendingUnarrived: 9
  - stockAllocatedToUnfinishedInvoices: 47
  - committedDestinationItems: 47
- カテゴリ集計、現物照合、売り先除外、未完了注文、翌日入庫、発注済み未到着、7/1出庫、税理士報告、棚卸レポート、根拠の10ビュー。
- チェック・現物数・進捗はlocalStorageへ保存。パスコードがある場合は `/api/state` にも保存し、更新競合はHTTP 409で検出。
- 2026-07-21修正: スタッフ現物照合の現物数を入力すると、`現物数 × 仕入単価`で6/30既知合計、売り先除外後、現在プレビュー、カテゴリ別、税理士報告、棚卸レポート、CSVを再計算する。既存localStorage入力もページ読込時に反映する。
- GitHub正本の反映コミットは`2098bb8`、Windows向け公開スクリプト修正を含む最新コミットは`6fdbb09`。2026-07-21に本番再公開し、配信5ファイルのSHA-256がGitHub正本と一致することを確認した。
- 本番画面で帳簿11,000円の商品を現物数0にする検証を行い、6/30既知合計が3,439,620.5円から3,428,620.5円へ、売り先除外後が2,992,488.5円から2,981,488.5円へ更新され、税理士報告と棚卸レポートにも同額が反映されることを確認した。

## リポジトリ構造の入口

- `client/src/App.tsx`: アプリ全体のルーティングと認証ゲート
- `client/src/pages/Home.tsx`: 取引・入出庫・インボイスのメインタブ
- `client/src/inventory/InventoryApp.tsx`: `/inventory/*` ルーティング
- `client/src/inventory/components/DashboardLayout.tsx`: 入出庫サイドバーと認証後レイアウト
- `client/src/inventory/pages/Purchases.tsx`: 入庫管理
- `client/src/inventory/pages/MonthlyReport.tsx`: 月次棚卸し
- `client/src/inventory/pages/ActionItems.tsx`: やること
- `server/inventory/routers.ts`: 入出庫tRPC APIと月次棚卸し集計
- `server/inventory/actionItems.ts`: やることAPI
- `server/inventory/db.ts`: 入出庫DBアクセス
- `drizzle/schema.ts`: `local_purchases`、`monthly_reports`、`monthly_report_costs`、`invoice_manual_items`、`monthly_domestic_items`、`action_items` 等

## 次に行う作業

1. N列を現時点の正本として使い、新しい修正メモが増えた場合はN列とN252を更新する。
2. DSi メタリックブルーの正しい商品名／カテゴリを、管理番号または現物で確認する。
3. 必要なら、N列の現在在庫金額を`6月末確定`タブのサマリーへ転記する。既存I列や上部固定値を置き換える場合は、従来値を消さず変更履歴を残す。

## 別PCでの再開

SellerScopeリサーチを含むPC全体のセットアップと、そのまま貼れるCodex用プロンプトは、`07-hajime-tokyo/sellerscope-site` の `initiative/ai-native-research-v1` ブランチにある `MULTI_PC_HANDOFF.md` を正本とする。

```powershell
git clone https://github.com/07-hajime-tokyo/invoice-site_byCodex.git
Set-Location invoice-site_byCodex
git fetch origin
git switch agent/inventory-handoff-log
```

PRが作成済みの場合は次でも取得可能。

```powershell
gh pr checkout <PR番号>
```

作業開始時は必ず `git fetch origin` と `git status -sb` を実行し、`origin/main` との差分を確認する。本番デプロイは `vercel deploy` では行わず、GitHub連携デプロイを使用する。
