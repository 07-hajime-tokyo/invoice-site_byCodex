# 荷受け取消・不良仕分け2軸化 完了レポート

> 指定先 `C:\Users\07haj\repos\Codex-Knowledge\projects\260815-inbound-undo-report.md` はワークスペース外書込が拒否されたため、このファイルへ退避した。

- 実施日: 2026-08-15
- 対象: `C:\Users\07haj\repos\invoice-site_byCodex`
- ブランチ: `codex/inventory-v2`
- 分岐: `e26b636`
- GitHub照合: `main=b5fc1ce`、`codex/inventory-v2=8806731`。mainが4コミット、v2が5コミット進んだdiverged状態。

## STEP 0 棚卸し

### main / v2差分

`InboundDesk.tsx` と `inboundDesk.ts` は双方変更。mainの「動作確認」名称、判定一時保存、まとめ確定、スキャン履歴、`stocked / defective / junk / returned` を土台にし、v2の不良タグ・メモ・写真、相場再取得、不良シート同期、ジャンクまとめ出品、箱ID先行発番を統合した。

### 状態遷移

| 操作 | label.status | 商品ID・ラベル | 在庫・履歴 |
|---|---|---|---|
| 発注・ラベル準備 | `ordered` | 商品IDは①より前に発行済み | 増減なし |
| ①受け取り | `ordered → received` | 既存IDを使用 | 増減なし、`receivedAt`設定 |
| ②OK | `received → stocked` | 在庫個体として使用 | 未計上なら元在庫+1、入庫履歴作成 |
| ②旧defective | `received → stocked` | ID維持 | 元在庫を必要時-1、`在庫_不良_{labelId}` 作成 |
| ②ジャンク売 | `received → stocked` | ID維持 | 元在庫を必要時-1、`在庫_ジャンク_{labelId}` 作成 |
| ②返品 | `received → returned` | ID維持 | 計上済みなら元在庫-1 |
| ③確認 | 変更なし | 変更なし | 表示・集計のみ |
| 出庫 | `stocked → shipped` | 出庫箱へ紐付け | 出庫履歴・在庫減 |

### inspectの副作用

- `inventory_item_labels`: status、localInventoryId、受取時刻、不良情報、相場/同期情報、取消監査列。
- `local_inventories`: OK時の増加、判定時の元在庫減算、不良/ジャンク専用在庫行。
- `purchase_histories`: ②で新規計上した入庫履歴。
- `action_items`: `source=inbound-inspection`、`sourceKey=labelId`。インボイス引当かつ代替品フラグON時のみ。
- `work_logs`: `sourceType=inbound-inspection`。担当者、判定、在庫差分、履歴ID、依頼ID。
- 不良/ジャンクでは写真、Yahoo相場、不良在庫シート非同期同期も発生。

### actionItemsの完了列

`status`（`open / done`）と `completedAt` がある。取消では物理削除せず、未完了は `done` にして取消注記、完了済みは `done` のまま保持注記を残す。

## 作成・変更ファイル

- `C:\Users\07haj\repos\invoice-site_byCodex\client\src\inventory\pages\InboundDesk.tsx`
- `C:\Users\07haj\repos\invoice-site_byCodex\client\src\inventory\pages\PurchaseRegistration.tsx`
- `C:\Users\07haj\repos\invoice-site_byCodex\server\inventory\inboundDesk.ts`
- `C:\Users\07haj\repos\invoice-site_byCodex\server\inventory\inboundUndo.ts`
- `C:\Users\07haj\repos\invoice-site_byCodex\server\inventory\inboundUndo.test.ts`
- `C:\Users\07haj\repos\invoice-site_byCodex\drizzle\schema.ts`
- `C:\Users\07haj\repos\invoice-site_byCodex\drizzle\0027_inbound_undo.sql`
- `C:\Users\07haj\repos\invoice-site_byCodex\docs\260815-inbound-undo-report.md`
- `C:\Users\07haj\repos\invoice-site_byCodex\docs\2026-08-15-worklog.md`

## STEP 1 衝突解決

- クライアント: mainの動作確認・一時保存・junk分岐を採用し、v2の不良詳細・相場・グループ・箱発番を保持。
- `PurchaseRegistration.tsx`: mainの配送履歴詳細折りたたみを採用し、v2の `OutboundBoxIssuer` / `OutboundBoxPanel` を載せ直した。
- サーバー: mainの4判定を採用し、v2の写真・相場・シート・在庫から不良への変更APIを保持。
- 理由: 指定どおりmainを操作フローの土台にし、v2資産を載せ直すため。
- 捨てた機能: なし。

## 実装結果

- ①受け取り取消: 個体、追跡番号の箱、表示中一括。条件付き更新で `received → ordered`、`receivedAt → NULL`。
- 混在箱: 同じ追跡番号の全個体をプレビューし、戻せる個体だけ戻して拒否理由を列挙。
- ②動作確認取消: 個体、表示中一括。個体ID、在庫差分、依頼の取消/保持を確認ダイアログへ表示。
- 二重取消防止: 条件付き更新で状態を先に奪取し、成功した個体だけ副作用を巻き戻す。
- 物理削除なし: 不良/ジャンク在庫は数量0・`isDeleted=1`、入庫履歴は `cancelled=1`、依頼は監査注記、取消は `work_logs`。
- 出庫箱格納済み/`shipped` は拒否。
- 不良UI: 「ジャンク売 / 返品」排他＋「代替品を仕入れる」独立チェック。インボイス初期ON、在庫用初期OFF、手動変更可。OK時は非表示。
- API型: `outcome` と `requestReplacement` を分離。旧 `defective` は既存行を変更せず、旧不良在庫＋代替品依頼ありとして解釈。

## 自己検証

- `pnpm --config.manage-package-manager-versions=false check`: 成功。出力 `> tsc --noEmit`。
- `pnpm install --offline --frozen-lockfile --lockfile-only`: 成功。出力 `Done in 318ms`。
- 通常の `pnpm test`: サンドボックスが親ディレクトリ探索を拒否し、`vitest.config.ts` 読込前に停止。
- 同一root/include/aliasをVitest Node APIへ直接渡して実行: 14ファイル中13成功。失敗は既知の `server/gemini.test.ts` 外部API接続のみ。
- 取消テスト（すべてpass）:
  - 二重取消では巻き戻し1回
  - 受取取消後に同じ個体を再受取
  - 判定済み混在箱の成功/拒否列挙
  - 未完了依頼を取消、完了済みを保持
  - 空入力を空結果として処理
  - 存在しないIDを理由付きで返却
- 通常の `pnpm build`: 前処理成功後、同じサンドボックス制約で `vite.config.ts` 読込前に停止。
- インライン同等Vite設定でクライアントbuild、Vite SSRで `dist/index.js` / `dist/api-app.js` build: 成功。
- `git diff --check`: 成功、エラーなし。

## 質問リスト

- なし。③確認に永続状態がないため、現行コードに合わせて出庫箱格納/出荷を取消拒否境界にした。

## 既知の限界

- `0027_inbound_undo.sql` は未適用。実DB接続・書込は未実行。
- 実DB取消API、写真ストレージ、Yahoo相場、不良シート同期は未確認。
- 旧行は新監査列がNULLのため既存ログ・購入・在庫から巻き戻し情報を推定し、特定不能なら理由付き拒否。
- ③確認は表示のみで、「③到達済み」を永続状態から判定できない。
- 通常のVitest/Vite設定ローダーは環境制約で未完走。Node APIの同等設定で検証。
- 指定されたCodex-Knowledge内のレポート・ログはワークスペース外書込拒否のため未作成。
- `.git` が読み取り専用で `git add` は `index.lock: Permission denied`。ローカルコミットは未作成で、ブランチ参照自体は `8806731` のまま。main/v2統合結果は作業ツリーに反映済み。
