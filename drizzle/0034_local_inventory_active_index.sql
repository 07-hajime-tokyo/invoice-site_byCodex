SET @idx_local_inventories_deleted_updated_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'local_inventories'
    AND index_name = 'idx_local_inventories_deleted_updated'
);

SET @idx_local_inventories_deleted_updated_sql := IF(
  @idx_local_inventories_deleted_updated_exists = 0,
  'CREATE INDEX idx_local_inventories_deleted_updated ON local_inventories (isDeleted, updatedAt)',
  'SELECT 1'
);

PREPARE idx_local_inventories_deleted_updated_stmt FROM @idx_local_inventories_deleted_updated_sql;
EXECUTE idx_local_inventories_deleted_updated_stmt;
DEALLOCATE PREPARE idx_local_inventories_deleted_updated_stmt;
