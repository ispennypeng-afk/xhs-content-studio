-- ============================================================
-- 小红书内容自动生成系统 - Supabase 数据库表结构 (v3 幂等版)
-- 适配 weibo_hot_crawler_v12 与 huitun_scraper_v13 的实际输出
--
-- ✨ 这份脚本可以安全重复执行:
--    - 所有 CREATE 都带 IF NOT EXISTS
--    - 如果之前建过老版本且字段不对,请先手动 DROP 对应表
--    - articles 表不在本脚本管辖范围,不会被动到
-- ============================================================

-- ============================================================
-- 1. 微博热搜表
-- ============================================================
CREATE TABLE IF NOT EXISTS weibo_hot (
  id                BIGSERIAL PRIMARY KEY,
  rank              INTEGER,
  keyword           TEXT,
  title             TEXT NOT NULL,
  heat              TEXT,
  read_count        TEXT,
  ai_summary        TEXT,
  ai_summary_status TEXT,
  url               TEXT,
  crawled_at        TIMESTAMPTZ DEFAULT NOW(),
  batch_id          TEXT
);

CREATE INDEX IF NOT EXISTS idx_weibo_hot_batch   ON weibo_hot(batch_id);
CREATE INDEX IF NOT EXISTS idx_weibo_hot_crawled ON weibo_hot(crawled_at DESC);
CREATE INDEX IF NOT EXISTS idx_weibo_hot_keyword ON weibo_hot(keyword);

-- ============================================================
-- 2. 小红书热点笔记表
-- ============================================================
CREATE TABLE IF NOT EXISTS xhs_hot (
  id                BIGSERIAL PRIMARY KEY,
  rank              INTEGER,
  note_title        TEXT,
  note_desc         TEXT,
  note_url          TEXT,
  hot_comments      TEXT,
  note_id           TEXT,
  note_type         TEXT,
  author_nick       TEXT,
  author_id         TEXT,
  fans              BIGINT    DEFAULT 0,
  author_type       TEXT,
  interaction       BIGINT    DEFAULT 0,
  read_count        BIGINT    DEFAULT 0,
  like_count        BIGINT    DEFAULT 0,
  collect_count     BIGINT    DEFAULT 0,
  comment_count     BIGINT    DEFAULT 0,
  share_count       BIGINT    DEFAULT 0,
  publish_time      TEXT,
  update_time       TEXT,
  video_duration    REAL,
  topics            TEXT,
  keywords          TEXT,
  has_ad            TEXT,
  is_indexed        TEXT,
  video_price       BIGINT,
  image_price       BIGINT,
  contact           TEXT,
  source_tab        TEXT,
  crawled_at        TIMESTAMPTZ DEFAULT NOW(),
  batch_id          TEXT
);

CREATE INDEX IF NOT EXISTS idx_xhs_hot_batch   ON xhs_hot(batch_id);
CREATE INDEX IF NOT EXISTS idx_xhs_hot_crawled ON xhs_hot(crawled_at DESC);
CREATE INDEX IF NOT EXISTS idx_xhs_hot_source  ON xhs_hot(source_tab);

-- ============================================================
-- 3. AI推荐记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id                    BIGSERIAL PRIMARY KEY,
  hot_topic_title       TEXT NOT NULL,
  hot_topic_source      TEXT,
  matched_article_id    INTEGER,
  matched_article_title TEXT,
  match_score           REAL,
  match_reason          TEXT,
  recommendation_rank   INTEGER,
  batch_id              TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_rec_batch   ON ai_recommendations(batch_id);
CREATE INDEX IF NOT EXISTS idx_ai_rec_created ON ai_recommendations(created_at DESC);

-- ============================================================
-- 4. 生成的小红书内容表
-- ============================================================
CREATE TABLE IF NOT EXISTS generated_content (
  id                  BIGSERIAL PRIMARY KEY,
  hot_topic           TEXT NOT NULL,
  hot_topic_source    TEXT,
  article_id          INTEGER,
  article_title       TEXT,
  xhs_title           TEXT,
  xhs_caption         TEXT,
  xhs_tags            TEXT[],
  article_content_md  TEXT,
  status              TEXT DEFAULT 'draft',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  published_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gen_content_status  ON generated_content(status);
CREATE INDEX IF NOT EXISTS idx_gen_content_created ON generated_content(created_at DESC);

-- ============================================================
-- 行级安全(RLS)
-- ============================================================
ALTER TABLE weibo_hot          ENABLE ROW LEVEL SECURITY;
ALTER TABLE xhs_hot            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_content  ENABLE ROW LEVEL SECURITY;

-- 幂等创建策略(存在则先删)
DROP POLICY IF EXISTS "anon_read_weibo_hot"          ON weibo_hot;
DROP POLICY IF EXISTS "anon_read_xhs_hot"            ON xhs_hot;
DROP POLICY IF EXISTS "anon_read_ai_recommendations" ON ai_recommendations;
DROP POLICY IF EXISTS "anon_read_generated_content"  ON generated_content;
DROP POLICY IF EXISTS "service_all_weibo_hot"          ON weibo_hot;
DROP POLICY IF EXISTS "service_all_xhs_hot"            ON xhs_hot;
DROP POLICY IF EXISTS "service_all_ai_recommendations" ON ai_recommendations;
DROP POLICY IF EXISTS "service_all_generated_content"  ON generated_content;

CREATE POLICY "anon_read_weibo_hot"          ON weibo_hot          FOR SELECT USING (true);
CREATE POLICY "anon_read_xhs_hot"            ON xhs_hot            FOR SELECT USING (true);
CREATE POLICY "anon_read_ai_recommendations" ON ai_recommendations FOR SELECT USING (true);
CREATE POLICY "anon_read_generated_content"  ON generated_content  FOR SELECT USING (true);

CREATE POLICY "service_all_weibo_hot"          ON weibo_hot          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_xhs_hot"            ON xhs_hot            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_ai_recommendations" ON ai_recommendations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_generated_content"  ON generated_content  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 验证建表:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('weibo_hot','xhs_hot','ai_recommendations','generated_content');
-- ============================================================
