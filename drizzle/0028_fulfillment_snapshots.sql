-- 充足状況は「今」の状態から毎回計算しているため、過去のある日を再現できない。
-- 日次で固めて残し、あとから日付を選んで刷れるようにする。
-- TiDBは同一ALTER内の「列追加＋その列へのインデックス追加」を受け付けないため、
-- 列とインデックスは分けて書く（0024で実際に落ちた）。
CREATE TABLE IF NOT EXISTS `fulfillment_snapshots` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `snapshotDate` varchar(10) NOT NULL,
  `rollupsJson` text NOT NULL,
  `capturedBy` varchar(200),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fulfillment_snapshots_date_unique` UNIQUE (`snapshotDate`)
);
