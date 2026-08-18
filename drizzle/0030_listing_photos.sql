-- 出品写真の実体。サービスアカウントはGoogleドライブに保存容量を持てず
-- （共有ドライブはWorkspace限定）、外部ストレージの鍵も本番に無いため、
-- 既にあるDBへ置いて公開エンドポイントから配る。
-- スプレッドシートの =IMAGE() が読めるようURLは認証なしで取れる。
CREATE TABLE IF NOT EXISTS `listing_photos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `photoKey` varchar(512) NOT NULL,
  `labelId` varchar(32) NULL,
  `contentType` varchar(100) NOT NULL,
  `dataBase64` longtext NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `listing_photos_photoKey_unique` (`photoKey`)
);
