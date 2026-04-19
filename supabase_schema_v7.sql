-- ============================================================
-- v7 数据库迁移 —— 追加 ai_match_history 表
-- ============================================================
-- 本次迁移只新增一张表, 不会影响现有任何表和数据.
-- 可安全重复执行.
--
-- 执行方式:
--   打开 https://supabase.com/dashboard/project/nqkeifdkoqddbppxzbes/sql
--   粘贴整个文件内容 → 运行 Run
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_match_history (
  id              BIGSERIAL PRIMARY KEY,
  matched_at      TIMESTAMPTZ DEFAULT NOW(),
  long_recs       JSONB,         -- 长文推荐数组
  short_recs      JSONB,         -- 短新闻推荐数组
  weibo_batch_id  TEXT,          -- 对应的微博热搜批次(可选)
  note            TEXT           -- 模式 / 自选话题等元信息 (JSON 字符串)
);

CREATE INDEX IF NOT EXISTS idx_match_history_at ON ai_match_history(matched_at DESC);

ALTER TABLE ai_match_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_match_history"   ON ai_match_history;
DROP POLICY IF EXISTS "service_all_match_history" ON ai_match_history;

CREATE POLICY "anon_read_match_history"
  ON ai_match_history FOR SELECT USING (true);

CREATE POLICY "service_all_match_history"
  ON ai_match_history FOR ALL USING (true) WITH CHECK (true);

-- 验证:
--   SELECT count(*) FROM ai_match_history;
--   (刚建表时应该是 0)
