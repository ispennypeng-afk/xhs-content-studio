# -*- coding: utf-8 -*-
"""
微博热搜爬虫 + Supabase 同步版 (v3)

更新点:
  - 支持 WEIBO_MAX_ITEMS 环境变量(默认30,可设置5-50)
  - 写入进度文件(用于前端进度条)
  - CRAWL_TASK_ID 环境变量用于前端识别任务
  - 不修改原始 weibo_hot_crawler_v12.py,只在运行时 monkey-patch
"""

import sys
import os
import json
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    # 同时以模块方式导入(为了 monkey-patch MAX_ITEMS)
    import weibo_hot_crawler_v12 as whc
    from weibo_hot_crawler_v12 import (
        ensure_logged_in, collect_hot_list, get_read_count,
        crawl_zhisou, save_all, human_sleep, log,
        OUTPUT_DIR, DEBUG_DIR, REST_EVERY, REST_SECONDS,
        USER_DATA_DIR, UA
    )
except ImportError:
    print("错误: 请确保 weibo_hot_crawler_v12.py 在同一目录下")
    sys.exit(1)

from supabase_sync import sync_weibo_hot, get_batch_id
from playwright.sync_api import sync_playwright


# ============================================================
# 进度跟踪(新增)
# ============================================================
PROJECT_ROOT = Path(__file__).resolve().parent
PROGRESS_DIR = PROJECT_ROOT / ".crawl_progress"
PROGRESS_DIR.mkdir(exist_ok=True)

TASK_ID = os.getenv("CRAWL_TASK_ID") or datetime.now().strftime("%Y%m%d_%H%M%S")
PROGRESS_FILE = PROGRESS_DIR / f"weibo_{TASK_ID}.json"

# 每条热搜平均耗时估算(秒),包含智搜抓取+休息时间
ETA_PER_ITEM = 25


def write_progress(status, **kwargs):
    """向进度文件写入当前状态"""
    data = {
        "task_id": TASK_ID,
        "script": "weibo_crawler_sync",
        "status": status,
        "updated_at": datetime.now().isoformat(),
    }
    data.update(kwargs)
    try:
        PROGRESS_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
    except Exception as e:
        print(f"[进度写入失败] {e}")


# ============================================================
# 主程序
# ============================================================
def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    DEBUG_DIR.mkdir(exist_ok=True)

    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    json_path = OUTPUT_DIR / f"weibo_hot_{stamp}.json"
    xlsx_path = OUTPUT_DIR / f"weibo_hot_{stamp}.xlsx"
    batch_id = get_batch_id()
    keyword = os.getenv("WEIBO_KEYWORD", "热搜榜")

    # 爬取数量(可通过环境变量覆盖,默认30)
    max_items = int(os.getenv("WEIBO_MAX_ITEMS", "30"))
    max_items = max(5, min(max_items, 50))

    # Monkey-patch 原爬虫的 MAX_ITEMS
    whc.MAX_ITEMS = max_items

    # ==========================================================
    # 【v4 新增】无头模式自动判定
    # ==========================================================
    # WEIBO_HEADLESS 取值:
    #   auto / ''   -> 自动: 如 wb_user_data 存在且有内容, 用无头; 否则弹窗口
    #   1 / true    -> 强制无头(不显示窗口, 但若未登录会失败)
    #   0 / false   -> 强制显示窗口(首次登录用)
    headless_env = (os.getenv("WEIBO_HEADLESS", "auto") or "auto").strip().lower()

    def _has_cookies():
        try:
            if not os.path.isdir(USER_DATA_DIR):
                return False
            # 简单判定: 目录存在且有 Default/Cookies 或 Default 子目录
            entries = os.listdir(USER_DATA_DIR)
            if not entries:
                return False
            # 持久化上下文建过后会有 Default 或者 Profile 相关文件
            return any(
                e in ("Default", "Profile 1") or "Cookies" in e or "Preferences" in e
                for e in entries
            ) or len(entries) >= 3  # 非空目录一般有 3+ 个文件
        except Exception:
            return False

    if headless_env in ("1", "true", "yes", "on"):
        HEADLESS = True
        headless_reason = "环境变量强制 (WEIBO_HEADLESS=1)"
    elif headless_env in ("0", "false", "no", "off"):
        HEADLESS = False
        headless_reason = "环境变量强制 (WEIBO_HEADLESS=0)"
    else:  # auto
        HEADLESS = _has_cookies()
        headless_reason = ("检测到 cookies, 使用无头模式" if HEADLESS
                           else "未检测到 cookies, 弹出窗口供扫码登录")

    log(f"本次输出文件: {json_path.name} / {xlsx_path.name}")
    log(f"Supabase 批次ID: {batch_id}, keyword: {keyword}")
    log(f"MAX_ITEMS = {max_items}")
    log(f"HEADLESS = {HEADLESS}  ({headless_reason})")
    log(f"进度文件: {PROGRESS_FILE}")
    log(f"TASK_ID = {TASK_ID}")

    write_progress("starting", total=max_items, current=0,
                   eta_seconds=max_items * ETA_PER_ITEM + 30,
                   message=("正在启动浏览器(无头)..." if HEADLESS else "正在启动浏览器(窗口)..."),
                   headless=HEADLESS)

    results = []
    with sync_playwright() as p:
        launch_kwargs = dict(
            user_data_dir=USER_DATA_DIR,
            headless=HEADLESS,
            channel="msedge",
            user_agent=UA,
            viewport={"width": 1400, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            ctx = p.chromium.launch_persistent_context(**launch_kwargs)
        except Exception as e:
            # msedge 在某些机器上不可用, 回退到默认 chromium
            log(f"⚠️ msedge 启动失败 ({e}), 回退到默认 chromium")
            launch_kwargs.pop("channel", None)
            ctx = p.chromium.launch_persistent_context(**launch_kwargs)
        page = ctx.new_page()

        try:
            write_progress("logging_in", total=max_items,
                           eta_seconds=max_items * ETA_PER_ITEM + 10,
                           message="检查微博登录状态...")
            ensure_logged_in(page)

            write_progress("collecting_list", total=max_items,
                           eta_seconds=max_items * ETA_PER_ITEM,
                           message="加载热搜榜单...")
            hot_list = collect_hot_list(page)
            actual_total = len(hot_list)

            write_progress("crawling", total=actual_total, current=0,
                           eta_seconds=actual_total * ETA_PER_ITEM,
                           message=f"开始抓取 {actual_total} 条热搜")

            start_time = datetime.now()

            for idx, item in enumerate(hot_list, 1):
                # 根据实际速度计算 ETA
                elapsed = (datetime.now() - start_time).total_seconds()
                avg_per_item = elapsed / max(idx - 1, 1) if idx > 1 else ETA_PER_ITEM
                remaining = actual_total - idx + 1
                eta = int(remaining * max(avg_per_item, 8))

                write_progress("crawling",
                               total=actual_total, current=idx - 1,
                               current_title=item['title'],
                               eta_seconds=eta,
                               message=f"正在爬取第 {idx}/{actual_total} 条")

                log(f"[{idx}/{len(hot_list)}] {item['title']}")
                record = {
                    **item,
                    "read_count": "",
                    "ai_summary": None,
                    "ai_summary_status": "",
                    "crawled_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }
                try:
                    record["read_count"] = get_read_count(page, item)
                    summary, status = crawl_zhisou(page, item)
                    record["ai_summary"] = summary
                    record["ai_summary_status"] = status
                    if summary:
                        log(f"  ✓ 智搜 {len(summary)} 字")
                    else:
                        log(f"  ✗ 智搜失败: {status}")
                except Exception as e:
                    log(f"  抓取异常: {e}")
                    record["ai_summary_status"] = f"异常: {e}"

                results.append(record)
                save_all(results, json_path, xlsx_path)

                # 完成一条后更新
                write_progress("crawling",
                               total=actual_total, current=idx,
                               current_title=item['title'],
                               eta_seconds=max(0, int((actual_total - idx) * avg_per_item)),
                               message=f"已完成 {idx}/{actual_total} 条")

                if idx % REST_EVERY == 0 and idx < len(hot_list):
                    log(f"  💤 已爬 {idx} 条,休息 {REST_SECONDS} 秒……")
                    write_progress("resting", total=actual_total, current=idx,
                                   eta_seconds=int((actual_total - idx) * avg_per_item) + REST_SECONDS,
                                   message=f"防风控休息 {REST_SECONDS}s")
                    import time
                    time.sleep(REST_SECONDS)
                else:
                    human_sleep()

            ok = sum(1 for r in results if r.get("ai_summary"))
            log(f"全部完成。共 {len(results)} 条,其中 {ok} 条成功获取智搜")

        except KeyboardInterrupt:
            log("⛔ 收到 Ctrl+C,中止抓取。已抓到的数据已保存。")
            write_progress("cancelled", total=max_items, current=len(results),
                           message="已手动取消")
        except Exception as e:
            log(f"⛔ 主流程异常: {e}。已抓到的数据已保存。")
            write_progress("error", total=max_items, current=len(results),
                           error=str(e), message=f"异常: {e}")
        finally:
            if results:
                save_all(results, json_path, xlsx_path)
                log(f"✓ 本地保存: 共 {len(results)} 条 → {xlsx_path.name}")

            if results:
                write_progress("syncing", total=len(results), current=len(results),
                               eta_seconds=5,
                               message=f"同步 {len(results)} 条到数据库...")
                try:
                    sync_weibo_hot(results, batch_id=batch_id, keyword=keyword)
                    log(f"✓ 已同步到 Supabase (batch: {batch_id})")
                    write_progress("done", total=len(results), current=len(results),
                                   synced=len(results), batch_id=batch_id,
                                   eta_seconds=0,
                                   message=f"✅ 完成!共 {len(results)} 条已入库")
                except Exception as e:
                    log(f"✗ Supabase 同步失败: {e}")
                    write_progress("error", total=len(results), current=len(results),
                                   error=str(e), message=f"同步失败: {e}")
            else:
                write_progress("error", error="未抓取到任何数据",
                               message="未抓取到任何数据")

            try:
                ctx.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
