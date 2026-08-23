INSERT IGNORE INTO action_item_assignees (name, sortOrder)
VALUES ('全員', 0), ('仕入れ担当', 1), ('荷受担当', 2), ('出荷担当', 3);

UPDATE action_item_assignees
SET sortOrder = CASE name
  WHEN '全員' THEN 0
  WHEN '仕入れ担当' THEN 1
  WHEN '荷受担当' THEN 2
  WHEN '出荷担当' THEN 3
  ELSE sortOrder
END
WHERE name IN ('全員', '仕入れ担当', '荷受担当', '出荷担当');

DELETE FROM action_item_assignees WHERE name = 'その他';
