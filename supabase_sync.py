# -*- coding: utf-8 -*-
"""
Supabase 数据同步工具 (v2)
用于将爬虫数据上传到 Supabase 数据库

变更点:
  - 小红书 sync 补齐了 anchorType / updateTime / duration / advert / include /
    vidPrice / picPrice / contact 这 8 个之前漏掉的字段
  - 小红书热评改用 "---" 分隔(和爬虫 Excel 导出保持一致,前端也更好解析)
  - 微博 sync 增加 keyword 参数
"""

import os
import json
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from supabase import create_client, Client
except ImportError:
    print("请安装 supabase-py: pip install supabase")
    raise

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://nqkeifdkoqddbppxzbes.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY", "")

if not SUPABASE_KEY:
    raise ValueError("请在 .env 中设置 SUPABASE_SECRET_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def get_batch_id():
    """生成批次ID(当前时间戳)"""
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _to_int(v, default=0):
    """把各种奇怪的值安全转成 int"""
    if v is None or v == "":
        return default
    try:
        return int(v)
    except (ValueError, TypeError):
        try:
            return int(float(v))
        except (ValueError, TypeError):
            return default


def _to_float(v, default=None):
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (ValueError, TypeError):
        return default


def sync_weibo_hot(records: list, batch_id: str = None, keyword: str = ""):
    """
    将微博热搜数据同步到 Supabase
    records: 爬虫输出的记录列表(weibo_hot_crawler_v12 的输出)
    keyword: 本次爬取用的关键词(可选,用于多关键词时区分)
    """
    if not batch_id:
        batch_id = get_batch_id()

    rows = []
    for r in records:
        rows.append({
            "rank": _to_int(r.get("rank"), 0),
            "keyword": keyword or "",
            "title": r.get("title", ""),
            "heat": str(r.get("heat", "")) if r.get("heat") not in (None, "") else "",
            "read_count": r.get("read_count", "") or "",
            "ai_summary": r.get("ai_summary") or "",
            "ai_summary_status": r.get("ai_summary_status", "") or "",
            "url": r.get("url", "") or "",
            "crawled_at": r.get("crawled_at") or datetime.now().isoformat(),
            "batch_id": batch_id,
        })

    if rows:
        # 分批插入,避免单次过大
        chunk = 500
        for i in range(0, len(rows), chunk):
            supabase.table("weibo_hot").insert(rows[i:i + chunk]).execute()
        print(f"✓ 已同步 {len(rows)} 条微博热搜到 Supabase (batch: {batch_id})")
    return batch_id


def sync_xhs_hot(notes: list, source_tab: str, batch_id: str = None):
    """
    将小红书热点数据同步到 Supabase
    notes: 爬虫输出的笔记列表(huitun_scraper_v13 flatten 前的原始 dict)
    source_tab: 来源榜单名称(如 "实时热门笔记榜" / "实时低粉爆文榜")
    """
    if not batch_id:
        batch_id = get_batch_id()

    type_map = {"video": "视频", "normal": "图文", "image": "图文"}

    rows = []
    for idx, n in enumerate(notes, 1):
        # 评论处理:有 scraped_comments 用真实抓到的,没有就用 API 自带的 hotComm
        scraped = n.get("scraped_comments", [])
        if scraped:
            # 与爬虫 flatten_note 保持一致,用 "---" 分隔
            comments_str = "\n---\n".join(scraped)
        else:
            comments_str = n.get("hotComm", "") or ""

        rows.append({
            "rank": idx,
            "note_title": n.get("title") or (n.get("desc", "")[:50] if n.get("desc") else ""),
            "note_desc": n.get("desc", "") or "",
            "note_url": n.get("real_xhs_url", "") or "",
            "hot_comments": comments_str,
            "note_id": n.get("noteId", "") or "",
            "note_type": type_map.get(n.get("type", ""), n.get("type", "") or ""),
            "author_nick": n.get("nick", "") or "",
            "author_id": n.get("redId", "") or "",
            "fans": _to_int(n.get("fans"), 0),
            "author_type": n.get("anchorType", "") or "",
            "interaction": _to_int(n.get("stat"), 0),
            "read_count": _to_int(n.get("read"), 0),
            "like_count": _to_int(n.get("like"), 0),
            "collect_count": _to_int(n.get("coll"), 0),
            "comment_count": _to_int(n.get("comm"), 0),
            "share_count": _to_int(n.get("share"), 0),
            "publish_time": str(n.get("ts", "") or ""),
            "update_time": str(n.get("updateTime", "") or ""),
            "video_duration": _to_float(n.get("duration"), None),
            "topics": n.get("topic", "") or "",
            "keywords": n.get("keyw", "") or "",
            "has_ad": "是" if n.get("advert") else "否",
            "is_indexed": "是" if n.get("include") else "否",
            "video_price": _to_int(n.get("vidPrice"), None) if n.get("vidPrice") not in (None, "") else None,
            "image_price": _to_int(n.get("picPrice"), None) if n.get("picPrice") not in (None, "") else None,
            "contact": n.get("contact", "") or "",
            "source_tab": source_tab,
            "batch_id": batch_id,
        })

    if rows:
        chunk = 200  # 小红书字段多,chunk 小一点
        for i in range(0, len(rows), chunk):
            supabase.table("xhs_hot").insert(rows[i:i + chunk]).execute()
        print(f"✓ 已同步 {len(rows)} 条小红书热点到 Supabase (batch: {batch_id}, source: {source_tab})")
    return batch_id


def get_latest_weibo_batch():
    """获取最新一批微博热搜"""
    result = supabase.table("weibo_hot") \
        .select("batch_id") \
        .order("crawled_at", desc=True) \
        .limit(1) \
        .execute()

    if result.data:
        batch_id = result.data[0].get("batch_id")
        if batch_id:
            batch = supabase.table("weibo_hot") \
                .select("*") \
                .eq("batch_id", batch_id) \
                .order("rank") \
                .execute()
            return batch.data
    return []


def get_latest_xhs_batch():
    """获取最新一批小红书热点"""
    result = supabase.table("xhs_hot") \
        .select("batch_id") \
        .order("crawled_at", desc=True) \
        .limit(1) \
        .execute()

    if result.data:
        batch_id = result.data[0].get("batch_id")
        if batch_id:
            batch = supabase.table("xhs_hot") \
                .select("*") \
                .eq("batch_id", batch_id) \
                .order("interaction", desc=True) \
                .execute()
            return batch.data
    return []


if __name__ == "__main__":
    print("测试 Supabase 连接...")
    try:
        wb = get_latest_weibo_batch()
        print(f"  微博热搜最新批次: {len(wb)} 条")
        xhs = get_latest_xhs_batch()
        print(f"  小红书热点最新批次: {len(xhs)} 条")
        print("✓ 连接成功")
    except Exception as e:
        print(f"✗ 连接失败: {e}")
