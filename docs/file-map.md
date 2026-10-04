# ファイルマップ（分割後ファイルの辞書）

SSOT整理（16領域）でモノリスから分割したファイルの「何が何か」を一覧にした辞書。
対象コミット: `4f57879`（origin/main 追従マージ後）。
各領域の分割経緯・検証方法は `docs/refactor-roadmap.md` と各 `docs/*-refactor.md` を参照。

## 読み方

- 1ファイル1行で「役割」を書く。詳細は各ファイル冒頭のコメントと領域ドキュメントへ。
- `*.test.ts` / `__snapshots__/` はテスト。`*-baseline.ts` + `*-baseline-source.txt` は「リファクタ前の挙動を凍結したベースライン」（後述）。

## ベースラインテストの仕組み（purchase-registration ほか共通）

- `*-baseline-source.txt` … リファクタ前のモノリス（特定コミット時点）をそのまま保存したテキスト。
- `*-baseline.ts` … 上記テキストから TypeScript AST で関数宣言を抜き出し、実行可能な形に変換して返すローダー。Git も実DOMも不要。
- `*.test.ts` … 「ベースライン（旧実装）」と「分割後の現行実装」を同じ入力で実行し、出力（HTML・戻り値）が一致することを検証。
- main 側で画面が変わった場合は、ベースラインの txt と依存リストも main の内容に更新する（4f57879 のマージで実施済み）。

---

## shared/ — クライアント・サーバー共用ロジック

| ファイル | 役割 |
|---|---|
| types.ts | 全体で共用する基本型 |
| const.ts | 共用定数 |
| invoiceKey.ts | 管理番号⇄インボイス番号の相互変換・判定 |
| invoiceAmounts.ts | インボイス金額の計算 |
| tradeStatus.ts | 取引の発送登録状態の導出（FedEx登録も発送として数える） |
| tradeSheetStatus.ts | 取引シート側の状態判定 |
| inboundDesk.ts | 荷受・検品の結果種別（互換のため旧 defective も保持） |
| inboundPipeline.ts | 入庫パイプライン（荷受→検品→入庫）の共通契約 |
| inventorySnapshot.ts | 在庫スナップショットの形式 |
| outboundBoxes.ts | 出庫箱コードの形式・検証 |
| stocktake.ts (+ fixture) | QR棚卸の照合ロジック |
| productMatching.ts | 商品名の照合（共通版） |
| purchaseMetadata.ts | 旧形式の発注メタ情報（カンマ区切りの管理番号・日付・仕入先） |
| purchaseVisibility.ts | 発注の表示対象判定（表示期限カットオフ） |
| receiptAck.ts | 受領確認の共通ルール |
| actionItems.ts | やること管理の共用定義 |
| defectInspection.ts | 不良検品の選択肢・写真形式 |
| ebayInventory.ts | eBay在庫の共用定義 |
| monthlyReport.ts | 月次レポートの共用定義 |

## server/ — トップレベル

| ファイル | 役割 |
|---|---|
| index.ts | サーバー起動 |
| routers.ts | 全ルーターの束ね |
| db.ts | DB接続 |
| storage.ts | ファイルストレージ |
| tradeRouter.ts | 取引ハブAPI（取引一覧・状態） |
| shipmentRouter.ts | 発送API |
| authRouter.ts / authGateRouter.ts | 認証・アクセスゲート |
| knowledgeBaseRouter.ts | ナレッジベースAPI |
| quoteProxyRouter.ts | 見積プロキシ |
| pdfGenerator.ts | PDF生成（fonts/ を使用） |
| whatsappConversations.ts / whatsappChatsRouter.ts / whatsappHistoryRouter.ts | WhatsApp連携・履歴 |
| _core/ | フレームワーク基盤（trpc等）。リファクタ対象外 |

## server/invoices/ — インボイス

| ファイル | 役割 |
|---|---|
| invoicesRouter.ts | インボイスAPIの入口 |
| invoiceReads.ts / invoiceWrites.ts | 読み出し / 保存 |
| invoiceRows.ts | 行データの組み立て |
| invoiceInput.ts | 入力検証 |
| invoiceNumbering.ts / numbering.ts | 採番ルール |
| invoiceAnalysis.ts / imageAnalysis.ts / chatParsing.ts | AI解析（請求書・画像・チャット文面） |
| invoiceClientsRouter.ts | 取引先API |
| invoiceSettingsRouter.ts | インボイス設定API |

## server/inventory/ — 在庫系サーバー

### ルーター（APIの入口）

| ファイル | 役割 |
|---|---|
| routers.ts | 在庫系ルーターの束ね |
| zaicoRouter.ts / zaico.ts | 在庫本体API / コアロジック |
| orderManagementRouter.ts | 発注管理API |
| purchaseHistoryRouter.ts / purchaseExtraRouter.ts | 発注履歴 / 発注付随情報 |
| deliveryHistoryRouter.ts | 配送履歴API |
| fedexRouter.ts | FedEx発送API |
| partnerRouter.ts / customerRouter.ts | パートナー / 顧客API |
| adminRouter.ts / authRouter.ts / accessCodeRouter.ts | 管理 / 認証 / アクセスコード |
| inventoryMemoRouter.ts / invoiceMemoRouter.ts / invoiceManualItemRouter.ts | メモ・手動明細API |
| monthlyReportRouter.ts / monthlyDomesticItemRouter.ts / domesticProductRouter.ts | 月次レポート・国内品API |
| deletedItemsRouter.ts / restoreManagementRouter.ts / migrationRouter.ts | 削除済み / 復元 / 移行API |
| receiptAckRouter.ts | 受領確認API |

### 入庫（荷受・検品）

| ファイル | 役割 |
|---|---|
| inboundDesk.ts | 荷受デスクAPIの本体 |
| inboundDeskData.ts / inboundDeskQueries.ts | データ組み立て / DB照会 |
| inboundReceipt.ts | 荷受登録 |
| inboundInspection.ts | 検品登録 |
| inboundClassify.ts | 入庫時の分類判定 |
| inboundUndo.ts / inboundUndoOperations.ts | 入庫取り消しとその個別操作 |

### 在庫・ラベル・出庫

| ファイル | 役割 |
|---|---|
| labelViews.ts | ラベル表示の共通変換（表示項目の絞り込み・大小文字無視の重複排除） |
| labelQuantity.ts | ラベル数量の計算 |
| managementNo.ts | 在庫備考から先頭の管理番号を取り出す |
| outboundBoxes.ts | 出庫箱の保存・検証 |
| stocktake.ts | QR棚卸 |
| inventoryMoney.ts | 在庫サービス由来の金額表記の読み取り |
| categoryName.ts | 在庫カテゴリ名の扱い |

### 発注まわり（server/inventory/purchases/ は次節）

| ファイル | 役割 |
|---|---|
| createOrderedPurchase.ts | 発注の新規作成 |
| purchaseRowTypes.ts | 発注行の型 |
| orderProductMatching.ts | 発注と商品の照合 |
| orderTradeRows.ts | 発注と取引行の対応付け |

### 配送・発送

| ファイル | 役割 |
|---|---|
| deliveryService.ts | 配送処理の本体 |
| deliveryInvoiceAttribution.ts | 配送とインボイスの紐付け |
| shipmentDeclarationRules.ts | 発送申告のルール |
| shipmentProgressSheets.ts | 発送進捗シート連携 |
| fedexMissingTasks.ts | FedEx未登録タスクの抽出 |

### 不良品・写真

| ファイル | 役割 |
|---|---|
| defectiveGroups.ts / defectiveListing.ts / defectiveSync.ts | 不良品のグループ化 / 出品 / 同期 |
| defectivePhotos.ts / listingPhotoStorage.ts | 不良写真 / 出品写真の保存 |

### 外部連携・補助

| ファイル | 役割 |
|---|---|
| gasClient.ts | GAS（スプレッドシート）連携クライアント |
| yahooClosedPrices.ts / yahooListingSheet.ts | ヤフオク落札価格 / 出品シート |
| aiInvestigation.ts | AI調査 |
| receiptAck.ts / receiptAckRules.ts / receiptAckDrive.ts | 受領確認の本体 / ルール / Drive連携 |
| actionItems.ts / actionItemAttachmentInput.ts / actionItemAttachmentStorage.ts | やること管理 / 添付の検証・保存 |
| workLogs.ts / workLogRecording.ts / workOperator.ts / stepTimer.ts | 作業記録・作業者・工程タイマー |
| changeLog.ts | 変更履歴の記録 |
| csvLine.ts | CSV1行の組み立て |
| dailySnapshot.ts / fullRestoreSnapshot.ts / localDump.ts / restoreFields.ts | スナップショット・復元 |
| monthlyReportPreview.ts | 月次レポートのプレビュー |
| db.ts | 在庫系DBアクセス |

## server/inventory/purchases/ — 発注の読み書き詳細（README.md あり）

| ファイル | 役割 |
|---|---|
| page.ts | 発注一覧ページデータの組み立て（入口） |
| localRows.ts / localData.ts | ローカルDB行の読み出し / 保存データの形 |
| externalRows.ts | 外部（GAS）行の変換 |
| input.ts / saveInput.ts | 入力の検証 / 保存用入力の組み立て |
| saveEdit.ts / saveSupplier.ts / saveTracking.ts | 編集 / 仕入先 / 追跡番号の保存 |
| items.ts | 明細JSON（itemsJson）の解釈と管理番号の優先順位 |
| labels.ts / labelMatching.ts / reconcileLabels.ts | ラベルの表示・照合 / 突き合わせ / 整合処理 |
| displayStatus.ts | 一覧の表示状態 |
| inboundClassification.ts | 入庫分類 |
| csvSuppliers.ts | 仕入先CSVの解釈 |
| legacyValues.ts / storedExtra.ts | 旧形式値の互換読み取り |
| orphanRecovery.ts / recoveryRules.ts / recoveryCleanup.ts | 孤児データの復旧・後始末 |
| shaftBackfill.ts | シャフト在庫に不足する発注の補完と再取得 |
| trackingFields.ts / trackingSync.ts / trackingAudit.ts | 追跡番号の項目 / 同期 / 監査 |
| snapshotContract.ts | スナップショットとの契約 |

## client/src/inventory/pages/ — 画面の入口（各 .tsx）

各画面の入口コンポーネント。ロジックは同名のサブディレクトリへ分割済み。

| ファイル | 画面 |
|---|---|
| PurchaseRegistration.tsx | 発注登録（→ purchase-registration/） |
| Purchases.tsx | 発注一覧（→ purchases/） |
| PurchaseHistory.tsx | 発注履歴（→ purchase-history/） |
| InboundDesk.tsx | 荷受デスク（→ inbound-desk/） |
| Deliveries.tsx | 在庫・納品（→ deliveries/） |
| DeliveryHistory.tsx | 配送履歴（→ delivery-history/） |
| OrderManagement.tsx | 発注管理（→ order-management/） |
| OverseasShipping.tsx | 海外発送（→ overseas-shipping/） |
| PartnerPortal.tsx | パートナーポータル（→ partner-portal/） |
| EbayInventory.tsx | eBay在庫（→ ebay-inventory/） |
| YahooListings.tsx | ヤフオク出品（→ yahoo-listings/） |
| ActionItems.tsx | やること管理（→ action-items/） |
| AiInvestigation.tsx | AI調査（→ ai-investigation/） |
| MonthlyReport.tsx | 月次レポート（→ monthly-report/） |
| InventoryTrend.tsx | 在庫推移（→ inventory-trend/） |
| WorkManagement.tsx | 作業管理（→ work-management/） |
| WhatsappHistory.tsx | WhatsApp履歴（→ whatsapp-history/） |
| Stocktake.tsx | QR棚卸 |
| Settings.tsx | 設定（→ settings/） |
| DeletedItems.tsx / RestoreManagement.tsx | 削除済み / 復元管理 |
| NotFound.tsx | 404 |

## client/src/inventory/pages/purchase-registration/ — 発注登録（最大の分割領域）

### 型

| ファイル | 役割 |
|---|---|
| dataTypes.ts | DB由来の行・明細・在庫・ラベルの型 |
| formTypes.ts | 登録・編集フォームの入力型 |
| viewTypes.ts | 画面表示用（提案グループ等）の型 |

### 値・文字列・表記

| ファイル | 役割 |
|---|---|
| format.ts | 金額・日付・数値の表記 |
| stringValues.ts | 文字列の正規化・数値変換 |
| fieldStyles.ts | 入力欄の共通クラス名 |
| search.ts | 検索文字列の正規化と照合 |
| scanInput.ts | QR/バーコード読み取り入力の解釈 |

### 発注行・明細

| ファイル | 役割 |
|---|---|
| purchaseEtc.ts | 備考(etc)欄の解釈（管理番号_日付_仕入先） |
| managementNumbers.ts | 管理番号の抽出と優先順位 |
| purchaseItems.ts | 明細の数量・在庫数量の計算 |
| purchaseRowIdentity.ts | 発注行の同一性判定 |
| rowStatus.ts | 行の状態判定（ラベル側の出庫状態を優先） |
| rowFilters.ts | 一覧の絞り込み |
| rowOrder.ts | 並び順（作成時刻優先） |
| supplier.ts | 仕入先名・URLの解釈 |
| tracking.ts | 登録画面用の配送業者判定・追跡番号 |
| trackingNavigation.ts | 追跡ページURLの組み立て |

### インボイス・割当

| ファイル | 役割 |
|---|---|
| invoiceIdentity.ts | インボイス番号によるグループ識別（EBAY/その他） |
| allocationGroups.ts | インボイス割当グループの構築 |
| invoiceProductSuggestions.ts | インボイスからの商品候補 |
| shippingRules.ts | 発送関連の表示ルール（インボイス表示名等） |

### ラベル

| ファイル | 役割 |
|---|---|
| labelMerging.ts | ラベルの統合 |
| labelStatus.ts | ラベル状態のバッジ表現 |
| labelTitles.ts / labelTitleOverrides.ts | ラベルの商品名表示 / 表示名の上書き |
| inventoryLabelViews.ts / purchaseLabelViews.ts | 在庫側 / 発注側ラベルの表示用変換 |
| registrationLabelViews.ts | 登録画面で使うラベル表示の構築 |
| labelPrintLayout.ts | ラベル印刷の面付け・チェックリスト行の計算 |
| labelPrintSettings.ts | 印刷開始位置などの設定 |
| qr.ts | QRコード行列とSVGパス生成（固定サイズ・非ASCII対応を維持） |

### 商品名・商品集計

| ファイル | 役割 |
|---|---|
| productText.ts | 商品名文字列の正規化 |
| productTitles.ts | 実商品名の解決 |
| productMatching.ts / productMatchConstraints.ts | 商品名の照合 / 登録画面固有の制約 |
| productPresentation.ts | 商品の表示（色など） |
| productSummaries.ts | 商品別集計 |
| productDetailFilters.ts | 商品詳細の絞り込み |

### 在庫表示・提案

| ファイル | 役割 |
|---|---|
| stockViews.ts | 在庫一覧の表示用変換 |
| stockWaiting.ts | 0在庫仕入の表示ルール（入庫待ち/動作確認待ち/出庫済み） |
| stockForecast.ts | 入庫予測の集計 |
| stockProposalRules.ts / stockProposalGroups.ts / stockProposalValues.ts / stockProposalDisplay.ts | 在庫提案のルール / 型番グループ化 / 数量・単価計算 / 表示文字列 |
| registrationEditing.ts | 登録・編集の状態遷移 |
| registrationStockBuilders.ts | 登録画面の在庫ビュー構築 |

### 画面コンポーネント（.tsx）

| ファイル | 役割 |
|---|---|
| OrderDashboard.tsx | 発注ダッシュボード全体 |
| PurchaseRegistrationCard.tsx | 発注1件のカード |
| StockDetailCard.tsx / StatCard.tsx / EmptyState.tsx | 在庫詳細カード / 統計カード / 空状態 |
| StockPanel.tsx | 在庫一覧タブ（棚フィルタ・0在庫表示切替・カテゴリ管理） |
| StockProposalPanel.tsx / StockProposalGroupCard.tsx / StockProposalProducts.tsx | 在庫提案タブ / 型番カード / 商品行（PC・モバイル） |
| ProductFulfillmentTable.tsx | 商品別充足表 |
| RegistrationDialogs.tsx | 登録・編集ダイアログ群 |
| ShippingPanels.tsx | 発送関連パネル |
| OutboundBoxes.tsx | 出庫箱（箱詰め）UI・箱明細のインボイス入力 |
| InboundScan.tsx | 入庫スキャンUI |
| LabelPrintPanel.tsx / LabelPrintStyles.tsx / PrintableLabelSheet.tsx | ラベル印刷パネル / 印刷CSS / 印刷シート |
| LabelChecklists.tsx | ラベルチェックリスト表示・印刷 |
| ProductQrCode.tsx | 商品QRコード表示 |
| ReceivedDateLabelPrint.tsx | 入庫日ラベル印刷 |
| MissingTrackingOverview.tsx | 追跡番号未登録の一覧 |

### テスト・ベースライン

| ファイル群 | 役割 |
|---|---|
| rules.test.ts / labels.test.ts / metadata.test.ts / products.test.ts / stock.test.ts / allocation.test.ts / dashboard.test.ts / stock-ui.test.ts / print-ui.test.ts | 旧実装（ベースライン）と現行実装の挙動一致を検証 |
| *-baseline.ts + *-baseline-source.txt | 凍結した旧実装のローダーと本体（冒頭の仕組み説明を参照） |
| legacy-baseline.ts / current-page-labels.ts | 旧コミット宣言のアダプタ / 現行モジュールへの互換アダプタ |
| __snapshots__/ / tsconfig.tests.json | スナップショット / テスト用TS設定 |

## client/src/inventory/pages/purchases/ — 発注一覧（README.md あり）

| ファイル | 役割 |
|---|---|
| usePurchasesPage.ts | 画面全体の状態をまとめるフック（入口） |
| usePurchaseListData.ts / usePurchaseFilters.ts / usePurchaseSelection.ts | 一覧データ / 絞り込み / 選択 |
| usePurchaseEditor.ts / usePurchaseEditorState.ts / editState.ts | 編集フローと編集状態 |
| usePurchaseCompletion.ts / completionInput.ts | 入庫完了処理と入力 |
| usePurchaseBulkTracking.ts | 追跡番号の一括登録 |
| usePurchaseCsv.ts / csv.ts | CSV入出力 |
| usePurchaseDeletion.ts / usePurchaseOperator.ts / usePurchaseStages.ts / useOrderedPurchase.ts | 削除 / 作業者 / 工程 / 発注作成 |
| useDebouncedValue.ts | 入力のデバウンス |
| filters.ts / format.ts / carrier.ts / constants.ts / types.ts | 絞り込み / 表記 / 配送業者 / 定数 / 型 |
| PurchaseList.tsx / PurchaseDesktopRows.tsx / PurchaseCardMobile.tsx | 一覧（PC行・モバイルカード） |
| PurchasesToolbar.tsx / PurchaseFilters.tsx / PurchaseSelectionBar.tsx / PurchaseTotals.tsx | ツールバー / 絞り込みUI / 選択バー / 合計 |
| PurchaseItemsTable.tsx / ItemLabelsBlock.tsx / InboundRowControls.tsx | 明細表 / ラベル表示 / 入庫操作 |
| PurchaseReceiptDialog.tsx / BulkReceiptDialog.tsx / BulkTrackingDialog.tsx / OrderedPurchaseDialog.tsx | 入庫・一括・発注ダイアログ |
| PurchaseShippingEditor.tsx / PurchaseShipmentSummary.tsx / TrackingNumberPanel.tsx | 配送情報の編集 / 概要 / 追跡番号パネル |
| contracts.test.ts / presentation.test.tsx | フック契約と表示の検証 |

## その他の画面サブディレクトリ

### inbound-desk/（荷受デスク）
ReceivePhase / InspectPhase / ReviewPhase（荷受→検品→確認の3段階UI）、inspectionDraft.ts（検品下書きの保存）、presentation.ts（表示用変換）、sharedUi.tsx（共通UI部品）。

### deliveries/（在庫・納品）
stockView.ts（在庫一覧の表示）、stockFilters.ts（絞り込み）、display.ts（表記）、form.ts（入力）、shipmentSheets.ts（発送シート）、exportInventoryCsv.ts（CSV出力）、types.ts。ダイアログ群: CreateInventoryDialog / EditInventoryDialog / CategoryDialogs / MemoHistoryDialog / StockChangeConfirmDialog / InventoryLabelIds。

### delivery-history/（配送履歴）
grouping.ts（グループ化）、aggregateItems.ts（明細集計）、deliveredSummary.ts（納品済みサマリ）、colorMatching.ts（色の照合）、display.ts（表記）、shipmentSheets.ts（発送シート）、exportCsv.ts。ダイアログ: FedexShipmentDialog / FedexBatchDialog / CancelConfirmDialog / InventoryDetailToggle。

### order-management/（発注管理）
aggregateDeliveries.ts（配送集計）、csvProductMatching.ts（CSV商品照合）、colorMatching.ts / colorSummary.ts（色の照合・集計）、display.ts、exportCsv.ts、types.ts。パネル: PurchaseDetailPanel / DeliveryDetailPanel / InventoryDetailPanel / InvoiceMemoField。

### overseas-shipping/（海外発送）
shipmentRows.ts（発送行の組み立て）、invoiceResolution.ts(インボイスの解決)、partnerLabels.ts（パートナー向けラベル）、PartnerView.tsx、DeliveryHistoryFedexSection.tsx、types.ts。

### partner-portal/（パートナーポータル）
shipmentInvoice.ts（発送インボイスの表示）、types.ts。

### purchase-history/（発注履歴）
receiptAck.ts（受領確認）、ReceiptAckCell.tsx、exportCsv.ts、types.ts。

### その他
- ebay-inventory/: display.ts（表示用変換）、types.ts
- yahoo-listings/: view.ts（一覧表示）、AddStockDialog / ManualListingDialog、types.ts
- action-items/: presentation.ts、LinkedText.tsx（リンク化テキスト）
- ai-investigation/: format.ts（整形）、storage.ts（保存）、EvidenceTable / InvestigationAnswer、types.ts
- monthly-report/: model.ts（集計モデル）、csv.ts（CSV、期待値fixture付き）、presentation.ts、types.ts
- inventory-trend/: model.ts（推移モデル）、presentation.ts
- whatsapp-history/: view.ts
- work-management/: model.ts
- settings/: types.ts

## client/src/inventory/components/ ・ lib/ — 画面横断の部品

| ファイル | 役割 |
|---|---|
| components/DashboardLayout.tsx (+Skeleton) | 共通レイアウト |
| components/InvoicePrintPack.tsx / InvoiceStockSection.tsx | インボイス印刷 / 在庫セクション |
| components/StocktakeCamera.tsx | 棚卸カメラ（QR読み取り） |
| components/DefectiveInspectionDialog.tsx | 不良検品ダイアログ |
| components/ActionItemForm.tsx / EbayListingUrlEditor.tsx / PaginationBar.tsx | やること入力 / eBay URL編集 / ページ送り |
| lib/supplier.ts / lib/tracking.ts | 仕入先 / 追跡の共通処理（purchases 系と registration 系で定義が異なる点に注意） |
| lib/inboundDesk.ts / lib/productNameUtils.ts / lib/currentWorker.ts / lib/actionItemAttachments.ts | 荷受 / 商品名 / 作業者 / 添付の共通処理 |

## tests/regression/ — DB再現リグレッション

`node scripts/test-local-regression.mjs` で実行する、ローカルDBダンプを使った実データ検証（trade.test.ts ほか、計236件）。
