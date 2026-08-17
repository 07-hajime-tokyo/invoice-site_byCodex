-- ヤフオク出品の区分を持たせる。
-- NULL は「区分を付ける前の行」＝ジャンクとして扱う（アプリ側で正規化する）。
-- 列の追加のみで、既存列の変更・削除はない。
ALTER TABLE `inventory_item_labels`
  ADD COLUMN `listingKind` varchar(16) NULL;

ALTER TABLE `defective_listing_groups`
  ADD COLUMN `listingKind` varchar(16) NULL;
