ALTER TABLE local_purchases
  ADD COLUMN receiptAckStatus varchar(20) NULL,
  ADD COLUMN receiptAckSource varchar(20) NULL,
  ADD COLUMN receiptAckAt timestamp NULL,
  ADD COLUMN receiptAckNote varchar(255) NULL;

CREATE INDEX idx_local_purchases_receipt_ack
  ON local_purchases (receiptAckStatus, receivedDate);

INSERT IGNORE INTO action_item_assignees (name, sortOrder)
VALUES ('野田さん', 4);
