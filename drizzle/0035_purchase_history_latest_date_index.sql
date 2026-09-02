SET @idx_purchase_histories_cancelled_inventory_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'purchase_histories'
    AND index_name = 'idx_purchase_histories_cancelled_inventory'
);

SET @idx_purchase_histories_cancelled_inventory_sql := IF(
  @idx_purchase_histories_cancelled_inventory_exists = 0,
  'CREATE INDEX idx_purchase_histories_cancelled_inventory ON purchase_histories (cancelled, inventoryId, purchaseDate)',
  'SELECT 1'
);

PREPARE idx_purchase_histories_cancelled_inventory_stmt FROM @idx_purchase_histories_cancelled_inventory_sql;
EXECUTE idx_purchase_histories_cancelled_inventory_stmt;
DEALLOCATE PREPARE idx_purchase_histories_cancelled_inventory_stmt;
