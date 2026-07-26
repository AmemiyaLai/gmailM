-- D1 初始 migration；請依實際需求擴充資料表。
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
