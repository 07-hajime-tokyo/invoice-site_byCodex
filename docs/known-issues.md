# 既知の問題バックログ（known-issues）

本文書は、SSOTリファクタリング中に「修正せず記録」された既存バグ・注意点のバックログである。
リファクタでは挙動維持（逐語移動・API契約固定）を原則としたため、ここに挙げる問題はいずれも**意図的に修正していない**。
今後の修正は、この一覧から優先順位を決めて行う。各項目は出典docの記述のみに基づく（推測による追加なし）。

- 集計日: 2026-10-02
- 総件数: **80件**（A: 9件 / B: 6件 / C: 13件 / D: 52件）
- 出典doc: refactor-roadmap.md / ebay-yahoo-refactor.md / trade-refactor.md / orders-partner-refactor.md / stock-refactor.md / auth-settings-refactor.md / purchase-history-refactor.md / overseas-refactor.md / deliveries-refactor.md / knowledge-refactor.md / invoices-refactor.md / registration-refactor.md / action-items-refactor.md（計13文書）

---

## A. データ破損・計算誤りの恐れ（優先度高）

| No | 症状・内容 | 場所（ファイル名） | 出典doc | 想定影響 |
|---|---|---|---|---|
| A-1 | `purchaseHistory.cancel` が冪等でない。同じ取り消しを2回実行すると在庫が二重減算される（回帰テストで現状動作として固定済み） | server/inventory/purchaseHistoryRouter.ts | ebay-yahoo / purchase-history | 在庫数の不正減少 |
| A-2 | 受取連絡: 手動済み→未実施に戻した行の note「手動済み取消: …」が、再度の巡回結果取り込みで通常 note に上書きされ情報が消える | server/inventory/receiptAck.ts | purchase-history | 手動対応履歴の消失 |
| A-3 | `invoiceManualItem.update` は unitPrice 未指定時に null で上書き（`input.unitPrice ?? null`。回帰テストで固定済み） | server/inventory/invoiceManualItemRouter.ts | auth-settings | 単価データの消失 |
| A-4 | `domesticProduct.update` も unitPrice 未指定で null 上書き（`monthlyDomesticItem.update` は対照的に patch 方式で非対称） | server/inventory/domesticProductRouter.ts | auth-settings | 単価データの消失 |
| A-5 | `upsertLocalInventory` が drizzle/mysql2 の戻り値を誤 cast し insertId が常に 0 → `zaico.createInventory`（Zaico OFF経路）は data_id:0 を返し、ラベル未作成・変動メモは inventoryId=0 で記録される | server/inventory/db.ts（1687行） | ebay-yahoo | ラベル欠落・メモの紐付け不正 |
| A-6 | `zaico.updateEbayListingUrl` の Zaico連携ON経路は `ebayListingUrl` を保存せず、既存 supplierName/supplierUrl を upsert し直すだけで success を返す | server/inventory/zaicoRouter.ts | ebay-yahoo | URL未保存（現状はC-1により到達不能） |
| A-7 | `fedex.updateWithGas` は GAS未設定時、trackingNumber/shippingDate/itemsJson のDB更新前に return し、spreadsheetStatus/spreadsheetError のみ更新（本体未更新のまま status=error） | server/inventory/fedexRouter.ts | overseas | 更新内容が本体に反映されない |
| A-8 | `trade.updateRecord` の通貨は `inferTradeCurrencyForPartner` により入力より取引相手名を優先（例: 相手「ルカ」なら入力"ドル"でも"ユーロ"で保存） | server/tradeRouter.ts | trade | 意図しない通貨での保存 |
| A-9 | 分割確認ダイアログ: quantity2×単価600,000（計120万円）の単一明細が「分割不要」「合計1,200,000円で100万円以下」と表示される矛盾（分割規則が数量を分けない既存挙動） | client/src/pages/invoices（分割確認ダイアログ） | refactor-roadmap / invoices | 分割要否判定の誤り |

## B. 認可・セキュリティ関連の注意

| No | 症状・内容 | 場所（ファイル名） | 出典doc | 想定影響 |
|---|---|---|---|---|
| B-1 | `const publicProcedure = protectedProcedure;` の別名: 「public」と命名された手続きも実効は認証必須。抽出先の多数のルーター（zaicoRouter / partnerRouter / authRouter / fedexRouter / deliveryHistoryRouter ほか）で別名を逐語再現 | server/inventory/routers.ts ほか抽出先各ルーター | ebay-yahoo / orders-partner / auth-settings / overseas / deliveries | 命名と実効認可の乖離（読み誤りによる認可変更の恐れ） |
| B-2 | quoteProxy のキー無しローカルバイパスは `NODE_ENV==="development" && LOCAL_AUTH_BYPASS!=="false"` 限定（NODE_ENV=test では UNAUTHORIZED） | server/quoteProxyRouter.ts | auth-settings | 環境変数次第で認証バイパスが有効化 |
| B-3 | `inventory.auth.authorize` は access_code 未設定時に常に valid:true で authorized_users へ登録 | server/inventory/authRouter.ts | auth-settings | コード未設定時は誰でも認可される |
| B-4 | `accessCode.set("")` は system_settings に value="" の行が残り、未設定扱いでアクセス制限が解除される（回帰テストで固定済み） | server/inventory/accessCodeRouter.ts | auth-settings | 意図せぬアクセス制限解除 |
| B-5 | `partner.deleteMyMessage` は他パートナーのメッセージIDを指定しても success を返す（行は変更されないサイレント no-op） | server/inventory/partnerRouter.ts | orders-partner | エラー非通知（誤操作の検知不能） |
| B-6 | `partner.listMessages`（管理側一覧）は isDeleted=1 の行も返す（管理画面側でフィルタされない） | server/inventory/partnerRouter.ts | orders-partner | 削除済みメッセージの表示 |

## C. デッドコード・到達不能経路

| No | 症状・内容 | 場所（ファイル名） | 出典doc | 想定影響 |
|---|---|---|---|---|
| C-1 | `isZaicoEnabled()` は設定値に関係なく常に false を返す実装 → `purchaseHistory.cancel` や `zaico` 各手続きのZaico連携ON経路が全体として到達不能 | server/inventory/db.ts（2179行） | ebay-yahoo / purchase-history | Zaico連携が機能しない（回帰テストもOFF経路のみ） |
| C-2 | `zaico.getInventoryById`: `return await buildFromLocalDb();` 直後の Zaico APIフォールバック try/catch が到達不能 | server/inventory/zaicoRouter.ts | ebay-yahoo | — |
| C-3 | `recalcShippingCostsLegacy` はどこからも呼ばれない未使用コード | server/tradeRouter.ts | trade | — |
| C-4 | `PRODUCT_WORD_MAP` は `/pink/gi` が `/coral\s*pink/gi` より先に評価され、「コーラルピンク」置換が到達不能（"coral pink"→"coral ピンク"。単体テストで固定済み） | client/src/components/trade/addTradeModel.ts | trade | 置換結果の不自然さ |
| C-5 | `managementNoMatchesColor` は未参照のデッドコード | client/src/inventory/pages/order-management/colorMatching.ts | orders-partner | — |
| C-6 | `extractColorFromCsvName` 末尾の「最後トークンにフォールバック」分岐は、既知機種に一致しない非空文字列では到達しない | client/src/inventory/pages/order-management/colorMatching.ts | orders-partner | — |
| C-7 | 商品詳細ダイアログは `detailItem` が常に null（開く手段なし。インライン詳細トグル移行済みの名残） | client/src/inventory/pages/Deliveries.tsx | stock | — |
| C-8 | DeliveryHistory の `_` 接頭辞関数群（`_extractColorFromCsvName` 等）は未参照のデッドコード | client/src/inventory/pages/delivery-history/deliveredSummary.ts | deliveries | — |
| C-9 | `aggregateItemsByCsvProducts` は関数中央の return（suggestCsvProduct経路）以降（extractColorKeywords〜旧照合ロジック）が到達不能 | client/src/inventory/pages/delivery-history/aggregateItems.ts | deliveries | — |
| C-10 | `deletedItemsRouter.restore` に `return { success: true };` 直後の到達不能コードが存在 | server（deletedItemsRouter） | knowledge | — |
| C-11 | `zaico.upsertInventoryExtra`・`deletePurchaseOnly` などで `ctx` を受けるが未使用の手続きがある | server/inventory/zaicoRouter.ts | ebay-yahoo | — |
| C-12 | routers.ts に基準時点から未使用の import が複数残存（google / revertPurchase / invoiceKeyクラスタ / tradeSheetStatusクラスタ ほか） | server/inventory/routers.ts | ebay-yahoo | — |
| C-13 | 旧 ProductFulfillmentTable は非使用だが保持（新表と不足数の意味が異なるため同一処理扱いしない） | client（発注登録領域） | registration / refactor-roadmap | — |

## D. 仕様上の注意・不整合（実害は条件次第）

| No | 症状・内容 | 場所（ファイル名） | 出典doc | 想定影響 |
|---|---|---|---|---|
| D-1 | 通貨判定が3実装で不一致: `getCurrencyForPartner` Add版（デフォルト"ドル"）/ Edit版（サミー/デボン→"ドル"、該当なし→null）/ server `inferTradeCurrencyForPartner`（hennes kamusien もEUR判定）。判定集合・デフォルトすべて相違 | addTradeModel.ts / editTradeModel.ts / server/tradeRouter.ts | trade | 画面と保存値の通貨不一致 |
| D-2 | `trade.getFilterOptions` の返却契約: DB未接続時は `months` なし、接続時はあり（呼び出し側は optional 扱いで実害なし） | server/tradeRouter.ts | trade | 契約の非一貫性 |
| D-3 | `trade.listFromDb` はページングをアプリ側 slice で実施（page/pageSize はSQLに反映されず毎回全件取得） | server/tradeRouter.ts | trade | データ増で性能劣化 |
| D-4 | `trade.updateRecord` はシート書き戻し無効時でも `no === null` の場合 `{ success: true, updatedRow: null }` を返しDBを更新しない（インボイスNoが数値でない行は編集不可） | server/tradeRouter.ts | trade | 成功応答だが未保存 |
| D-5 | `repairKnownEuroRateRows` / `applyDisplayedEuroRateRepairs` は特定インボイスNo（385/386/387）・特定取引相手名をハードコードした読み取り時自己修復で、listFromDb のたびに外部レートAPIへ依存し得る | server/tradeRouter.ts | trade | 外部API依存・ハードコード |
| D-6 | `shipment.create` の insertId は `(result as any).insertId` で取得しており型安全でない | server/shipmentRouter.ts | trade | 型安全性の欠如 |
| D-7 | `applyTradeShipmentRegistrationStatuses` 等のステータス導出はインボイスNo>399 のみ対象（399以下は complete 系へ丸め。境界値はマジックナンバー） | server/tradeRouter.ts | trade | 境界値の保守性 |
| D-8 | listFromDb 内のローカル `toNumber` がモジュールレベル定義をシャドウ（挙動は同一） | server/tradeRouter.ts | trade | 可読性のみ |
| D-9 | `dbRecordToTradeRecord` は数値文字列を Math.round / 小数2桁丸めで変換するため、DB保存値と画面表示値が厳密には不一致（例: "100.5049"→100.5） | client/src/pages/home/model.ts | trade | 表示と保存値の差 |
| D-10 | `customer.create` は insertId を返さない（{success:true} のみ。domesticProduct 等と非対称） | server/inventory/customerRouter.ts | auth-settings | 呼び出し側でID取得不可 |
| D-11 | `partner.sendMessage` の notifyOwner は失敗しても握りつぶす（try/catch） | server/inventory/partnerRouter.ts | orders-partner | 通知失敗の検知不能 |
| D-12 | インボイスNo境界のハードコード: PartnerPortal の Pending フィルタはコメント「370以降」だが実装は `>= 384`、OverseasShipping は `invoiceNumber <= 383` をレガシー完了扱い | PartnerPortal.tsx / OverseasShipping.tsx | orders-partner / overseas | コメントと実装の不一致・保守性 |
| D-13 | `parseDateStr` は「M/D」形式の年を 2026 固定で解釈（2画面とも） | PartnerPortal.tsx / OverseasShipping.tsx | orders-partner / overseas | 年跨ぎで日付誤り |
| D-14 | `getTodayTrackingNumbers` は `toISOString()` のUTC日付で「当日」を判定（JSTの日付境界とずれる） | server/inventory/fedexRouter.ts | overseas | 朝9時前の判定ずれ |
| D-15 | 出荷シート名/取引先の対応表が計5実装に分散し内容不一致（`detectShipmentSheetName` 5種+フォールバック / shared/outboundBoxes `shipmentSheetForPartner` / OverseasShipping 4種 / Deliveries 4種 / DeliveryHistory 5種=+デボン発送管理） | fedexRouter.ts / shared/outboundBoxes.ts / overseas-shipping/partnerLabels.ts / deliveries/shipmentSheets.ts / delivery-history/shipmentSheets.ts | overseas / deliveries | SSOT不統一（挙動が異なるため統合には仕様確認要） |
| D-16 | `partnerLabel` は「デボン発送管理」を変換しない（そのままシート名表示。PartnerTab にも devon なし） | overseas-shipping/partnerLabels.ts | overseas | 表示の不統一 |
| D-17 | `fedex.mergeByTracking` の合算は trackingNumber のみで対象抽出（deliveryNo/sheetName 不問）。書き込み payload に deliveryNo/invoiceNo を含まない（create系と非対称） | server/inventory/fedexRouter.ts | overseas | 意図しない行の合算の恐れ |
| D-18 | `fedex.create` の同一追跡番号合算は `productNameJa` キーのみでマージ（`mergeShipmentGasItems` の labelId 考慮と非対称） | server/inventory/fedexRouter.ts | overseas | 合算粒度の不一致 |
| D-19 | work_logs への記録は create/createBatch で登録・合算どちらの経路でも「FedEx発送登録」が毎回追加される（合算時も新規行） | server/inventory/fedexRouter.ts | overseas | ログの重複 |
| D-20 | `cancelItem`/`cancelItems` の取消済み判定は inventoryId 単位（同一商品が複数回出庫された履歴では2回目以降を取り消せない） | server/inventory/deliveryHistoryRouter.ts | deliveries | 正当な取消が拒否される |
| D-21 | `getManagementNo` / `formatPrice` が2画面で別実装（Deliveries側のみ Number.isFinite チェックあり。DeliveryHistory側は NaN→"¥NaN"。挙動が異なるため統合対象外のまま） | deliveries/display.ts / delivery-history/display.ts | deliveries | 表示差・NaN表示 |
| D-22 | `extractModelName` のJSDoc例「PSP3000 ブラック→そのまま」は実装と不一致（実際は機種パターンが先に一致し "PSP3000" を返す。単体テストは実挙動を固定） | delivery-history/colorMatching.ts | deliveries | ドキュメントと実装の乖離 |
| D-23 | `normalizeColorText` の除去対象文字クラスに長音符「ー」が含まれる（"グレー黒"→"グレ黒"。テストで固定済み） | delivery-history/colorMatching.ts | deliveries | 色照合の揺れ |
| D-24 | `purchaseHistory.list` のラベル復元行（負ID）は行自体の数量が1でも、在庫ID経由で一致した発注データの数量で補完される | server/inventory/purchaseHistoryRouter.ts | purchase-history | 数量表示の差 |
| D-25 | `zaico.createDelivery` の GAS Webhook 経路は `GAS_WEBHOOK_URL` 未設定時に `fedexResult.success=false`（"GAS_WEBHOOK_URLが未設定です"）を返す（テストは未設定経路で固定） | server/inventory/zaicoRouter.ts | ebay-yahoo | 環境未設定時の失敗契約 |
| D-26 | 一回限り修理クラスタ（EBAY_7696 / MAXIM_404 等）は import 時の setTimeout で自動実行される（NODE_ENV!==production 時） | server/inventory/routers.ts | ebay-yahoo / auth-settings | 起動時の暗黙的副作用 |
| D-27 | `whatsappHistory.analyzeHistoryItem` は chat_text の解析（正規表現のみでAI不要）でも Forge API の env が無いと即エラー（env チェックが分岐より先） | server/whatsappHistoryRouter.ts | knowledge | 不要な環境要求 |
| D-28 | `knowledgeBase.getLatestInvoiceNumber` は `db!` の非nullアサーションで getDb() の失敗を握りつぶす（他の手続きは null チェックあり） | server/knowledgeBaseRouter.ts | knowledge | DB未接続時の例外 |
| D-29 | WhatsApp の窓定数（14日/3ヶ月/20件）はサーバー定義だが、クライアントが表示文言用に 14 / 3 を別定義（片側だけ変えるとズレる） | server/whatsappChatsRouter.ts / WhatsappHistory.tsx | knowledge | 文言と実挙動の乖離の恐れ |
| D-30 | `knowledgeBase.upload` のPDF解析は `image_url` に `data:application/pdf` を渡しており、ビジョンAPIがPDFを受けない場合はフォールバック文言のまま保存される | server/knowledgeBaseRouter.ts | knowledge | 要約品質の劣化 |
| D-31 | aiInvestigation: クライアント `ai-investigation/format.ts` と同名・同旨の関数が重複（invoiceNoFromDeliveryNo / toNumber / getEbayStatusCode / formatEbayStatus / formatEbayOrderSummary。判定条件が似て非なるものあり） | server/inventory/aiInvestigation.ts / client ai-investigation/format.ts | knowledge | SSOT不統一（共有化は仕様確認込みの別作業） |
| D-32 | `collectInvestigationContext` は5テーブルを毎回全件SELECTしてからメモリ上で絞り込む | server/inventory/aiInvestigation.ts | knowledge | データ増で性能劣化 |
| D-33 | `lookupSellingPrice` は部分一致で見つからない場合「同インボイスの最初の sellingPrice 付き行」へフォールバックし、別商品の価格が表示され得る | deliveries/stockView.ts | stock | 誤った販売価格の表示 |
| D-34 | 行内の販売価格更新ロジックは `lookupSellingPrice` と同等の照合をインライン再実装しており、管理番号 prefix を見ない点が異なる（重複・不統一） | client/src/inventory/pages/Deliveries.tsx | stock | 照合結果の差 |
| D-35 | `categoryOptions` は在庫0品も集計対象、`categoryTotals` は在庫0を除外（表示仕様の差） | deliveries/stockFilters.ts / stockView.ts | stock | 件数と金額の見かけの不整合 |
| D-36 | 一括出庫フッターと出庫確認ダイアログで出庫No再生成ロジックがほぼ同一のまま3箇所に重複 | client/src/inventory/pages/Deliveries.tsx | stock | 修正漏れの恐れ |
| D-37 | `calcDueDate` はローカル時刻の setMonth/setDate と UTC の toISOString を併用（月末繰り上がり・不正日付の例外・タイムゾーン依存。基準TZは Asia/Tokyo） | client/src/pages/invoices | invoices | TZ依存の日付ずれ |
| D-38 | `TODAY` はモジュール読込時、`getTodayStr` は呼出時のUTC日付（初期化タイミング不統一） | client/src/pages/invoices | invoices | 日付の不一致 |
| D-39 | 顧客の既定通貨は対象名以外 USD、EMPTY_FORM は EUR。サーバーの取引通貨推定とは文字正規化・戻り値・fallback が異なる別実装 | client/src/pages/invoices | invoices | 既定通貨の不統一 |
| D-40 | 顧客照合は双方向の部分一致で、候補文字列は2文字以上だが送信者側に同条件なし。複数一致時は配列の先頭を返す | client/src/pages/invoices | invoices | 誤った顧客への一致 |
| D-41 | 編集欄の「合計」は税抜、プレビューとクライアントPDFの合計は税込。通貨記号・小数表示にも差（USD/EURだけ記号化） | client/src/pages/invoices | invoices | 画面間の金額表示差 |
| D-42 | プレビューとPDFの住所整形は前後空白の処理が異なる | client/src/pages/invoices | invoices | 表示差 |
| D-43 | 金額計算の重複がプレビュー/クライアントPDF/サーバーPDFに残存（共有 `calculateInvoiceTotals` への統合はプレビュー/PDFのみ） | client/src/pages/invoices / server | invoices | 計算式の修正漏れの恐れ |
| D-44 | ScaledPreview は親なしでも自身の幅で調整するが、Fit は親なしで初期 scale1 を保持（負数・ゼロ寸法への補正なし） | client/src/pages/invoices（プレビュー） | invoices | 端ケースの表示差 |
| D-45 | 登録画面と入庫一覧で業者名の解釈（空白除去・小文字化・日本語別名）・Amazon URL・未知業者の表示が相違（丸ごと共有しない方針で維持） | 発注登録画面 / 入庫一覧 | registration | 表示・解釈の不統一 |
| D-46 | 運送業者の選択肢: 入庫一覧には「西激運輸」、登録画面には「西濃運輸」（表記不一致のまま） | 発注登録画面 / 入庫一覧 | registration | 表記誤りの疑い |
| D-47 | 日付の扱いが用途別に混在: 先頭10文字表示 / UTC変換する期限判定 / 端末ローカルの「今日」/ 東京固定の「今日」 | 発注登録領域 | registration | 日付境界のずれ |
| D-48 | 金額の欠損・不正値は登録側では0円になる（入庫一覧の単価表示「-」とは異なる） | 発注登録画面 | registration | 0円の誤表示 |
| D-49 | 登録のインボイス解析（半角3桁+`_` 必須）・eBay判定（`ebay` の後が `_`/`-`/終端）は、共有実装（invoiceKey の NFKC・3〜5桁 / eBay在庫判定 `/^E/i`）と別規則（E0814_1 等の扱いを変えない方針で維持） | purchase-registration/invoiceIdentity.ts ほか / shared/invoiceKey.ts / shared/ebayInventory.ts | registration | 解析規則の不統一 |
| D-50 | `labelStatusLabel` と `normalizedLabelStatus` の trim 有無の差を維持。`chunkArray` は size 0/負で停止しない（実画面は固定24で使用） | 発注登録領域 | registration | 端ケースでの無限ループの恐れ |
| D-51 | やることリスト: 確認JSONの空キーは画面読取では保持しサーバー保存では除外。create の記入者 fallback と update の空欄 null 化も非対称（意図的に保持した違い） | shared/actionItems.ts / server/inventory/actionItems.ts | action-items | 保存結果の差 |
| D-52 | コメント・文言の誤字等が残存: routers.ts 誤字「戺す」・「取り消すす」、deleteGroup 直前のJSDoc「出庫取り消し（一括）」の位置ズレ（実体は cancelItems）、OrderManagement 文字化け「場傈」、Deliveries placeholder「取得中...」」の全角カッコ誤字・useMemo 終端のインデントずれ、`server/gemini.test.ts` は GEMINI_API_KEY 未設定環境で失敗する環境依存テスト | server/inventory/routers.ts / deliveryHistoryRouter.ts / OrderManagement 抽出先 / Deliveries.tsx / server/gemini.test.ts | purchase-history / deliveries / orders-partner / stock / auth-settings | 可読性・テスト環境依存 |

---

## 修正時の進め方

1. **1修正 = 1コミット**。挙動変更を伴う修正はリファクタコミットと混ぜない。
2. **回帰テスト236件を先に流す**（`node scripts/test-local-regression.mjs test`）。修正前にグリーンであることを確認してから着手する。
3. **修正ごとに基準テストを追加**する。既存の回帰テストは「現状挙動の固定」になっている項目が多い（A-1 / A-3 / A-4 / B-4 / C-4 / D-9 / D-23 など）ため、修正時は該当テストの期待値を新仕様へ更新し、新しい挙動を固定するテストを追加する。
4. 修正の優先順位は A → B → C/D の順を基本とし、C（デッドコード削除）は挙動に影響しないことを逐語比較・テストで確認のうえ実施する。
5. Zaico連携ON経路・GAS/Google Sheets/eBay/Forge/Gemini 実接続経路は各docの「未検証範囲」のとおり未検証のため、関連項目（A-6 / A-7 / C-1 / D-25 など）の修正時は実環境での確認計画を別途立てる。
