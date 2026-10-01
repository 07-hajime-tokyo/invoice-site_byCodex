-- Additive observation storage only; does not change stock or shipment counts.
CREATE TABLE IF NOT EXISTS inventory_stocktakes (
  id varchar(36) NOT NULL PRIMARY KEY,
  basis_date varchar(10) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  snapshot_json mediumtext NOT NULL,
  state_json mediumtext NOT NULL,
  revision int NOT NULL DEFAULT 0,
  created_by varchar(200) NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at timestamp NULL
);
