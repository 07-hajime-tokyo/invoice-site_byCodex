# Project TODO

- [x] 全文検索・列フィルター・ソート・ページネーション・スマホ対応の検索サイト構築
- [x] KPIカード・チャートセクション実装
- [x] 年フィルター追加（2025年・2026年を別々に表示）
- [x] No.337 Vita 1000 レッドの列ずれ修正
- [x] 未完了のみ表示トグル追加
- [x] スペース無視検索（New3DSLLとNew 3DS LLを同一視）
- [x] No.123の列ずれ修正（数値カンマ区切り）
- [x] No.261の列ずれ修正
- [x] ナビゲーションをタブ切替方式に変更
- [x] Zaico APIとの連携による仕入れ・発送進捗表示
- [x] 仕入れ進捗列を非表示にする
- [x] 入出庫管理タブに管理番号・商品名で検索できる検索窓を追加する
- [x] 新規取引データ登録フォーム（Google Sheets書き込み）
- [x] スプレッドシートIDの変更
- [x] 取引データの編集機能（テーブルの各行に編集ボタン追加）
- [x] サーバー側にupdateTransactionプロシージャを追加（No.でスプシの行を検索して更新）
- [x] EditTradeDialogコンポーネントを作成
- [x] DataTableに編集ボタン列を追加

## インボイス機能
- [x] DBスキーマ追加: clients（宛先）テーブル
- [x] DBスキーマ追加: invoices（請求書）テーブル
- [x] DBスキーマ追加: invoice_items（明細行）テーブル
- [x] pnpm db:push でマイグレーション実行
- [x] tRPCプロシージャ: 宛先CRUD (clients)
- [x] tRPCプロシージャ: 請求書CRUD (invoices + items)
- [x] tRPCプロシージャ: WhatsAppチャット解析 (parseWhatsApp)
- [x] インボイスタブをヘッダーに追加
- [x] 宛先管理UI（登録・編集・削除）
- [x] WhatsAppチャット貼り付け→自動解析UI
- [x] 請求書編集フォーム（差出人固定・宛先選択・明細編集・通貨/合計表示切替）
- [x] 請求書プレビュー（freeinvoicebuilder風デザイン）
- [x] PDF出力（印刷ダイアログ）
- [x] 請求書一覧（保存済み一覧・再編集・削除）

## 差出人デフォルト設定
- [x] DBにinvoiceSettingsテーブルを追加してマイグレーション
- [x] サーバー側にgetSenderSettings/saveSenderSettingsプロシージャを追加
- [x] インボイスページに「差出人設定」ボタンを追加してダイアログで編集・保存
- [x] 請求書プレビューに保存済み差出人情報を反映する

## 請求書デザイン刷新・ロゴ・自動採番
- [ ] DBスキーマ: invoiceSettingsにlogoUrl・logoKey・taxRate列を追加してマイグレーション
- [ ] DBスキーマ: invoice_itemsにtax列を追加してマイグレーション
- [ ] サーバー: invoiceSettings.saveにlogoUrl/logoKey/taxRateを追加
- [ ] サーバー: invoices.getNextNumberプロシージャを追加（過去の最大番号+1を返す）
- [ ] サーバー: ロゴ画像アップロード用プロシージャを追加（S3保存）
- [ ] 請求書プレビューを参考PDF風に全面刷新（ロゴ・大きな番号・Tax列・Invoice Summary）
- [ ] 差出人設定ダイアログにロゴアップロードUIを追加
- [ ] 新規請求書作成時にgetNextNumberで自動採番
- [ ] 明細フォームにTax列を追加

## WhatsAppアップロード・インボイス番号自動採番
- [ ] Gemini APIキーを環境変数として設定・接続テスト
- [ ] DBにinvoice_numbersテーブルを追加（抽出済み番号の保存）
- [ ] サーバー側: PDFファイル名からInvoice番号を抽出するロジック
- [ ] サーバー側: _chat.txtからInvoice番号を抽出するロジック
- [ ] サーバー側: スクリーンショット画像をGemini Vision APIで解析するロジック
- [ ] サーバー側: 抽出した全番号の最大値+1を次のインボイス番号として返すプロシージャ
- [ ] インボイスページにWhatsAppアップロードUIを追加（複数ファイル選択・結果表示）
- [ ] 新規請求書作成時に自動採番された番号を入力欄にセット

## 機能改善バッチ2
- [ ] 次番号を新規請求書に自動セット（WhatsAppアップロードダイアログから直接作成ボタン）
- [ ] PDFファイル名を「Invoice - 0373.pdf」形式に統一
- [ ] 金額表示（showAmounts）のデフォルトをtrueに変更
- [ ] WhatsApp解析で宛先（To）を自動抽出してフォームに反映
- [ ] メッセージ履歴から支払い検出して自動で支払済みステータスに変更
- [ ] スクリーンショットから明細解析（Forge API Vision）

## チャット履歴永続保存・スクショ解析ステータス更新
- [x] DBスキーマ: whatsapp_chat_historyテーブルを追加してマイグレーション
- [x] サーバー: whatsappHistory.saveHistory（S3に画像アップロード・DBに保存）
- [x] サーバー: whatsappHistory.listHistory（保存済み一覧取得）
- [x] サーバー: whatsappHistory.deleteHistory（履歴削除）
- [x] サーバー: whatsappHistory.analyzeHistoryItem（保存済み画像を再解析・送信/支払い検出）
- [x] 画像解析プロンプト改善（商品名正規化: N2dsll→New 2DS LL等・カラー/バリアント抽出）
- [x] 「画面解析」タブに「履歴に保存」ボタンを追加
- [x] 「履歴管理」タブを追加（保存済み一覧・再解析・削除）
- [x] 履歴管理タブに送信済み・支払い済みのステータス更新ボタンを追加

## PDF自動ダウンロード機能
- [x] Puppeteerをインストール（puppeteer-coreでシステムChromiumを使用）
- [x] サーバー側: /api/invoice-pdf エンドポイントを追加（HTML→PDF変換、ヘッダー/フッターなし、背景グラフィックあり）
- [x] 商品数が多い場合に1枚に収まるよう自動フォントサイズ調整（20件まで対応）
- [x] フロントエンド: 「PDFで保存」ボタンを追加して自動ダウンロード
- [x] 「1 / 1」ページ番号フッターを削除

## PDF・プレビュー修正
- [x] html2canvasのoklchカラーエラーを修正（InvoicePreviewのTailwindクラスをインラインスタイルに変更）
- [x] プレビューの余白を修正（ScaledPreviewのコンテンツに合わせた高さに調整）
- [x] 一覧に戻るボタンクリック時に保存確認ダイアログを表示（isDirty検知）

## oklch・余白の再修正
- [x] oklchエラー根本修正（キャプチャ前に全要素のcomputedStyleをインライン化）
- [x] プレビュー余白修正（ScaledPreviewの外側コンテナ幅をコンテンツにピッタり合わせる）リップ）

## PDF生成方式の切り替え（weasyprint）
- [x] dom-to-image-moreを廃止してサーバー側weasyprintに切り替え
- [x] InvoicePreviewのHTMLをサーバーに送信してPDFを生成するエンドポイント（python3.11 -m weasyprint、PYTHONPATHクリーン化）
- [x] フロントエンドのPDF保存ボタンをサーバーエンドポイントに切り替え

## 知識ベース・AIチャット機能（WhatsApp履歴解析タブ全面刷新）
- [x] DBスキーマ: chat_knowledgeテーブルを追加（sourceType, sourceLabel, content, imageUrl, imageKey, dateRange）
- [x] DBスキーマ: ai_chat_messagesテーブルを追加（role, content）
- [x] pnpm db:push でマイグレーション実行
- [x] サーバー: knowledgeBase.upload（テキスト/画像/PDF対応、AI解析してDBに保存）
- [x] サーバー: knowledgeBase.list（学習済みデータ一覧取得）
- [x] サーバー: knowledgeBase.delete（学習データ削除）
- [x] サーバー: knowledgeBase.chat（知識ベースを参照してAIが回答）
- [x] サーバー: knowledgeBase.getChatHistory（チャット履歴取得）
- [x] サーバー: knowledgeBase.clearChatHistory（チャット履歴クリア）
- [x] サーバー: knowledgeBase.extractFromKnowledge（注文抽出・支払い検知）
- [x] フロントエンド: KnowledgeBasePageを新規作成
- [x] フロントエンド: ファイルアップロードUI（ドラッグ&ドロップ対応、複数ファイル）
- [x] フロントエンド: 学習済みデータ一覧（削除ボタン付き）
- [x] フロントエンド: 注文抽出・支払い検知ボタンと結果表示
- [x] フロントエンド: AIチャットUI（知識ベース参照・会話履歴・サジェスト）
- [x] Home.tsxに「知識ベース」タブを追加

## 支払日オプショナル化
- [x] DBスキーマ: invoicesのpaymentDate列をNULL許容に変更してマイグレーション（スプシはそのまま空文字列で対応）
- [x] サーバー: addRecordのpaymentDateバリデーションをオプショナルに変更
- [x] フロントエンド: 支払日フィールドの必須チェックを削除・ラベルを「（任意）」に変更

## 知識ベース統合・最新インボイス番号抽出
- [x] ヘッダーから「知識ベース」タブを削除
- [x] InvoicePage内の既存「履歴アップロード」ダイアログをKnowledgeBaseDialogに全面割り替え
- [x] サーバー: knowledgeBase.getLatestInvoiceNumber（学習データから最大番号+1を返す）
- [x] フロントエンド: 知識ベースダイアログに「最新インボイス番号を抽出」ボタンを追加
- [x] フロントエンド: 抽出した番号で「インボイスを作成」ボタンを追加（新規作成フォームに番号をセット）

## 知識ベースアップロードエラー修正
- [x] AI API（Forge API）のService Unavailableエラーを適切にハンドリング（res.okチェック・ try/catchフォールバック）
- [x] AI解析なしでもファイルをDBに保存できるようフォールバック処理を追加

## 知識ベースアップロード失敗修正・ダイアログ拡大
- [x] アップロード失敗の原因を特定（古いキャッシュのWhatsAppUploadDialogエラー）
- [x] 知識ベースダイアログを大きく表示（max-w-5xl w-[95vw]）

## PDF generation failed エラー修正（再発）
- [x] 本番環境でのPDF生成エラーの原因を特定（pdfkitのDynamic require of "fs" エラー）
- [x] PDF生成をサーバー不要のhtml2canvas+jsPDF（フロントエンド生成）に変更

## AIチャット改善・スクショ貼り付け
- [x] AIチャット履歴の保存・セッション間で維持する
- [x] AIチャット履歴の完全削除ボタンを実装する
- [x] AIチャットのEnterキー送信を実装する（既存実装を確認・isPending時の二重送信防止を追加）
- [x] 知識ベースアップロードでCtrl/Cmd+Vによるスクリーンショット貼り付けを実装する

## スクショ日付入力・チャットセッション管理
- [x] DBスキーマ: chat_conversationsテーブルを追加（セッション管理）
- [x] DBスキーマ: ai_chat_messagesにconversationId列を追加
- [x] pnpm db:push でマイグレーション実行
- [x] サーバー: knowledgeBase.createConversation（新規会話セッション作成）
- [x] サーバー: knowledgeBase.listConversations（会話一覧取得）
- [x] サーバー: knowledgeBase.deleteConversation（会話とメッセージを削除）
- [x] サーバー: knowledgeBase.chatにconversationId対応を追加（セッション別保存・タイトル自動更新）
- [x] サーバー: knowledgeBase.getChatHistoryにconversationId対応を追加
- [x] サーバー: knowledgeBase.uploadのscreenshotDate対応（画像ファイルに撮影日を設定）
- [x] フロントエンド: アップロードタブの画像ファイルに「撮影日」入力欄を追加
- [x] フロントエンド: AIチャットタブをManusスタイルの2カラムレイアウトに刷新
- [x] フロントエンド: 左サイドバーに会話リスト（選択・削除機能付き）
- [x] フロントエンド: 「新規チャット」ボタンで新しい会話セッションを作成
- [x] フロントエンド: 会話ごとにチャット履歴を分離して表示

## 請求書ステータス管理・クローン・削除・自動採番
- [x] DBスキーマ: invoicesにstatus列を追加（draft/sent/paid）してマイグレーション（既存）
- [x] サーバー: invoices.updateStatus（ステータス変更）（既存）
- [x] サーバー: invoices.clone（請求書クローン・最新番号+1で採番）
- [x] サーバー: invoices.delete（請求書削除）（既存）
- [x] サーバー: invoices.getNextNumber（削除後も最大番号+1を返す）（既存）
- [x] サーバー: knowledgeBase.detectStatusFromKnowledge（学習データから送信/支払い検知）
- [x] フロントエンド: 請求書一覧にステータスバッジ表示（既存）
- [x] フロントエンド: 請求書一覧にステータス変更ボタン（下書き→送信済み→支払済み）（既存）
- [x] フロントエンド: 請求書一覧にクローンボタン（最新番号+1で新規作成）
- [x] フロントエンド: 請求書一覧に削除ボタン（確認ダイアログ付き）（既存）
- [x] フロントエンド: 知識ベースダイアログに「送信/支払い検知」ボタンを追加
- [x] フロントエンド: 検知結果から一括ステータス更新UI

## インボイスカラー保存・一覧からPDF保存
- [x] DB: invoicesテーブルにaccentColor列を追加してマイグレーション
- [x] サーバー: invoices.create/updateにaccentColorを追加
- [x] フロントエンド: InvoiceFormDataにaccentColorフィールドを追加
- [x] フロントエンド: 編集フォームにアクセントカラーピッカーを追加
- [x] フロントエンド: InvoicePreviewのハードコード色をaccentColorに置き換え
- [x] フロントエンド: jsPDFのPDF生成コードもaccentColorに対応
- [x] フロントエンド: generateInvoicePdf共通関数として切り出し
- [x] フロントエンド: 一覧の各行にPDF保存ボタン（FileDownアイコン）を追加

## invoice_items variantカラム・PDF生成修正
- [x] DB: invoice_itemsテーブルにvariant列を追加してマイグレーション
- [x] サーバー: invoices.create/update/cloneにvariantを追加
- [x] フロントエンド: editFormとhandleSaveでsubText↔variantの変換を追加
- [x] サーバー: invoices.listのinvoice_itemsクエリをCOUNT(*)に最適化（Failed queryエラー根本修正）
- [x] サーバー再起動によりDrizzle ORMスキーマキャッシュをリフレッシュ

## 知識ベース スクショ名変更・撮影日デフォルト
- [x] フロントエンド: スクリーンショットのファイル名を変更できる入力欄を追加
- [x] フロントエンド: 撮影日フィールドのデフォルト値を今日の日付に設定

## インボイス アクセントカラー統一
- [x] InvoicePage: アクセントカラーをデフォルト #db8b1a に統一

## 取引データ検索をボタン押下・Enter実行に変更
- [x] 検索バーの入力値をローカルステートで保持し、ボタン押下またはEnterキーで検索実行

## スプシ再同期・あいまい検索
- [x] スプシからDBを再同期（307件・状況・仕入れ合計を反映）
- [x] 検索をスペース無視のあいまい検索に対応（「New3DSLL」→「New 3DS LL」にもマッチ）

## No.337 列ずれ修正
- [x] No.337の状況列に数値が入っている列ずれをCSVパーサー修正で対応

## プライベートリポジトリ対応
- [x] CSVデータ取得元を07-hajime-tokyo/csv-data-siteに変更
- [x] GitHub Personal Access Token（GITHUB_TOKEN）による認証をスクリプトに追加
- [x] GITHUB_TOKENシークレットを登録してDBを再同期

## 新規作成時DB同時保存
- [x] addRecordプロシージャでスプシ書き込みと同時にDBにも保存する
- [x] No.378をDBに手動登録してサイトに表示する

## インボイス自動入力ダイアログ
- [x] サーバー: invoices.getLatestプロシージャを追加（番号最大のインボイスを返す）
- [x] フロントエンド: 新規登録ボタンクリック時に最新インボイスを取得して確認ダイアログを表示
- [x] 「はい」でインボイス内容をフォームに自動入力して登録フォームを開く

## 為替レート自動取得と状況自由記述
- [x] 支払日入力時にfrankfurter.dev/v1でEUR/USDレートを自動取得
- [x] 取得したレートで商品価格（円）を自動計算してフォームに表示
- [x] 支払日未入力の場合は現在のレートを使用
- [x] 状況フィールドをドロップダウン+自由記述に変更

## 編集フォームの為替レート連動・自動計算・還付入力
- [x] 編集フォームに支払日連動の為替レート自動取得を追加
- [x] 商品価格(円)を自動計算（単価×レート）
- [x] 売上合計を自動計算（注文数×商品価格円）
- [x] 仕入れ合計を手動入力可能に
- [x] 還付入力欄を追加
- [x] 還付込利益を自動計算（売上合計-仕入れ合計+還付-送料）

## 送料自動計算（550×注文数）
- [x] AddTradeDialog: 注文数変更時に送料を550×注文数で自動計算（手動編集可）
- [x] EditTradeDialog: 注文数・既存データ読み込み時に送料を550×注文数で自動計算（手動編集可）
- [x] 還付込利益の再計算に送料を反映

## 為替レートCORS修正
- [x] サーバー側にgetRateByDateプロシージャを追加（frankfurter.devをサーバーから呼び出す）
- [x] AddTradeDialog・EditTradeDialogの為替レート取得をtrpcプロシージャ経由に変更

## 編集機能のDB同時更新と日本語変換
- [x] updateRecordプロシージャでスプシ更新と同時にDBも更新する
- [x] 自動入力時の取引相手名を日本語に変換（Luca→ルカ、samee→サミー等）
- [x] 自動入力時の商品名を日本語に変換（random color→ランダムカラー等）
- [x] 今回スプシのみ更新されたNew3DSLLランダムカラーをDBに手動反映

## ステータス検知AIプロンプト改嚄
- [x] 現在のdetectStatusFromKnowledgeプロンプトを確認して問題点を特定
- [x] 会話の流れ（インボイス送付→「i paid」）から支払済みを正しく判定するようプロンプト改嚄
- [x] インボイス番号の文脈的な紐付けを強化（「Invoice: 0378」送付後の「i paid」を0378の支払いと判定）
- [x] 知識ベースのコンテンツ切り詰め量を1000文字を2000文字に増加、撮影日で時系列ソートしてAIに渡す

## Manusログイン＋認証コード認証フロー
- [x] DBにverified_usersテーブルを追加（openId, verifiedAt）
- [x] pnpm db:pushでマイグレーション実行（直接SQLで作成）
- [x] サーバー: verifyCode手続きを追加（zaicoinvの/api/verify-codeを呼び出して照合）
- [x] サーバー: checkVerified手続きを追加（DBで認証済みか確認）
- [x] フロントにAuthGate（認証ゲート）コンポーネントを作成
- [x] App.tsxでAuthGateを全体に適用

## ログアウト機能とzaicoinv AuthGate適用
- [x] ヘッダーにログアウトボタンを追加（ユーザー名表示＋ログアウト）
- [ ] zaicoinvサイトのAuthGate適用手順を案内

## 発送記録機能（分割発送対応・送料自動按分）
- [ ] DBスキーマにshipments（発送記録）テーブルを追加（発送日・追跡番号・実際の送料）
- [ ] DBスキーマにshipment_items（発送明細）テーブルを追加（発送ID・インボイスNo・発送台数）
- [ ] マイグレーション実行
- [ ] tRPCプロシージャ: createShipment（発送記録作成＋明細登録）
- [ ] tRPCプロシージャ: getShipments（発送記録一覧取得）
- [ ] tRPCプロシージャ: deleteShipment（発送記録削除）
- [ ] 送料自動計算ロジック: 各インボイスの発送済み台数が発注数に達したら実際の送料合計に上書き、未達なら550×台数の仮送料を維持
- [ ] 発送記録管理UI（取引データタブ内に「発送管理」ボタンを追加）
- [ ] 発送記録一覧・追加ダイアログ（発送日・追跡番号・送料・インボイスNo＋台数を複数追加可能）
- [ ] 発送記録削除機能

## 発送記録 閲覧・編集機能改善
- [x] 発送記録の編集機能（発送日・追跡番号・送料・メモの編集）
- [x] 発送一覧ダイアログ（全発送記録を一覧表示・編集・削除）

## バグ修正・機能追加
- [x] 編集時にスプレッドシートI列（商品価格(円)）が空白になるバグを修正（A～H列とJ列を別々に更新しI列の数式を保護）
- [x] 状況編集時にスプレッドシートへ反映する機能（updateRecordプロシージャはJ列も同時更新済み）

- [x] 発送登録の完了判定をインボイスNo単位の合計数量ベースに変更（同一インボイスの全商品が一括完了扱い）
- [x] 発送登録ダイアログにインボイスNo入力時の発注数合計・発送済み・残数リアルタイム表示を追加
- [x] インボイス一覧への円換算金額表示（リアルタイム為替レート使用）

## インボイス保存時100万円超過自動分割確認ダイアログ
- [x] handleSaveを非同期化して保存前に円換算合計を計算する
- [x] JPY通貨の場合はそのまま合計を使用、外貨の場合はFrankfurter APIで為替レートを取得
- [x] 100万円超過時に「分割しますか？」確認ダイアログを表示する（shadcn/ui Dialog使用）
- [x] ダイアログの「分割する」ボタンで既存のhandleOpenSplitDialogを実行
- [x] ダイアログの「そのまま保存」ボタンで通常の保存処理を実行
- [x] 既存の分割ボタンはそのまま残す

## タブ切り替え時の入力内容維持
- [x] Home.tsxのタブ切り替えを条件レンダリングからdisplay:none方式に変更
- [x] 取引データ・インボイス・入出庫管理の全タブでDOMを維持しステートを保持

## 月フィルターを範囲指定に変更
- [x] FilterPanelの月フィルターを「開始月〜終了月」の2つのSelectに変更
- [x] routers.tsのlistFromDbをmonthFrom/monthToの範囲クエリに変更
- [x] Home.tsxのfilters状態型をmonthFrom/monthTo対応に更新
- [x] KPIカード・チャートも月範囲フィルターに対応（サーバー側フィルターなので自動対応）

## 四半期ショートカットボタン
- [x] FilterPanel.tsxにQ1～Q4ボタンを追加（月範囲Selectの上部に配置）
- [x] ボタンクリックでmonthFrom/monthToを自動設定
- [x] 現在選択中の四半期のボタンをハイライト表示（同じボタンを再クリックで解除）

## 還付込み利益計算バグ修正
- [x] updateRecord保存後にrecalcShippingCostsが上書きする問題を調査
- [x] 為替レート未取得時にprofitWithRefundがスキップされるバグを修正（既存totalSalesを使用）
- [x] No.381のprofitWithRefundを正しい値（¥11,137.10）に直接修正

## 新規登録ダイアログ：為替レート取得中でも登録できるよう修正
- [x] AddTradeDialogのバリデーションでレート取得中（null）をブロックしていた箇所を特定
- [x] レート取得中は登録ボタンを無効化（「レート取得中...」表示）
- [x] レート取得失敗時は手動入力を促すエラーメッセージを表示
- [x] ダイアログを開くたびにレートを必ず再フェッチするよう修正
## 関税機能実装
- [x] DBスキーマ（schema.ts）にcustomsDutyカラムを追加（DECIMAL(14,4) NULLable）
- [x] SQLで直接DBにカラムを追加（ALTER TABLE trade_records ADD COLUMN customsDuty）
- [x] recalcShippingCosts関数を拡張：USD取引の場合、発送日レートで関税を自動計算（商品価格円換算×台数×10%）
- [x] updateRecordプロシージャのinputスキーマにcustomsDuty: z.number().optional()を追加
- [x] updateRecordの利益計算式に関税を含める（profitWithRefund = totalSales - procurementTotal + refund - shippingCost - customsDuty）
- [x] updateRecordのDB更新にcustomsDutyフィールドを追加
- [x] EditTradeDialogにcustomsDutyフィールドを追加（USD取引のみ表示・手動修正可能）
- [x] EditTradeDialogの利益プレビュー計算に関税を含める
- [x] Home.tsxのkpis集計に還付金合計・送料合計・関税合計を追加
- [x] ダッシュボードKPIカードを2行構成に変更（1行目: 還付金合計・還付込み利益合計、2行目: 売上・注文数・取引先・送料・関税）
