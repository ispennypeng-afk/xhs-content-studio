# -*- coding: utf-8 -*-
"""
XHS Content Studio 后端服务 (v4)
================================
v4 更新点:
  - 新增 /api/web_search:  web 搜索接口(短新闻补充资料用)
                          优先 DuckDuckGo (免费,无需 Key), 备用 Bing (可选 Key)
  - AI 代理接口保持不变
  - 爬虫接口保持不变

启动方式:
  pip install -r requirements.txt
  python api_server.py

监听: http://localhost:8000
"""

import os
import sys
import json
import platform
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import quote_plus

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from fastapi import FastAPI, HTTPException, Query
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    import uvicorn
    import requests
except ImportError as e:
    print(f"缺少依赖: {e}")
    print("请运行: pip install fastapi uvicorn requests python-dotenv")
    sys.exit(1)


# ============================================================
# 配置
# ============================================================
AI_PROVIDER = os.getenv("AI_PROVIDER", "deepseek")
AI_API_KEY = os.getenv("AI_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "")
AI_BASE_URL = os.getenv("AI_BASE_URL", "")

PROVIDER_PRESETS = {
    "deepseek": {"base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat"},
    "aliyun": {"base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-plus"},
    "zhipu": {"base_url": "https://open.bigmodel.cn/api/paas/v4", "model": "glm-4-flash"},
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
}

if AI_PROVIDER in PROVIDER_PRESETS:
    preset = PROVIDER_PRESETS[AI_PROVIDER]
    if not AI_BASE_URL:
        AI_BASE_URL = preset["base_url"]
    if not AI_MODEL:
        AI_MODEL = preset["model"]


# ============================================================
# FastAPI
# ============================================================
app = FastAPI(title="XHS Content Studio Backend", version="4.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"],
    allow_credentials=False, allow_methods=["*"], allow_headers=["*"],
)

PROJECT_ROOT = Path(__file__).resolve().parent
PROGRESS_DIR = PROJECT_ROOT / ".crawl_progress"
LOG_DIR = PROJECT_ROOT / ".crawl_logs"
PROGRESS_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)


# ============================================================
# 数据模型
# ============================================================
class AIRequest(BaseModel):
    system: str = ""
    prompt: str
    max_tokens: int = 4000
    temperature: float = 0.7


class SearchRequest(BaseModel):
    query: str
    max_results: int = 5


# ============================================================
# 健康检查
# ============================================================
@app.get("/health")
def health():
    return {
        "ok": True,
        "ai_provider": AI_PROVIDER,
        "ai_model": AI_MODEL,
        "ai_base_url": AI_BASE_URL,
        "ai_configured": bool(AI_API_KEY),
        "platform": platform.system(),
        "project_root": str(PROJECT_ROOT),
        "features": ["ai_chat", "web_search", "crawler_weibo"],
    }


# ============================================================
# AI 代理接口 (OpenAI 兼容)
# ============================================================
@app.post("/api/ai/chat")
def ai_chat(req: AIRequest):
    if not AI_API_KEY:
        raise HTTPException(500, "后端未配置 AI_API_KEY,请在 .env 中设置并重启")
    if not AI_BASE_URL:
        raise HTTPException(500, f"未知的 AI_PROVIDER '{AI_PROVIDER}'")

    messages = []
    if req.system:
        messages.append({"role": "system", "content": req.system})
    messages.append({"role": "user", "content": req.prompt})

    url = AI_BASE_URL.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {AI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": AI_MODEL, "messages": messages,
        "max_tokens": req.max_tokens, "temperature": req.temperature,
    }

    https_proxy = os.getenv("HTTPS_PROXY") or os.getenv("https_proxy") or ""
    if https_proxy:
        proxies = {"http": https_proxy, "https": https_proxy}
        print(f"[AI] 使用代理: {https_proxy}")
    else:
        proxies = {"http": "", "https": ""}
        print(f"[AI] 直连模式")

    print(f"[AI] → {url}  model={AI_MODEL}  tokens={req.max_tokens}")
    try:
        r = requests.post(url, headers=headers, json=payload, timeout=180, proxies=proxies)
        print(f"[AI] 状态: {r.status_code}")
        if r.status_code >= 400:
            detail = r.text[:800] if r.text else f"HTTP {r.status_code}"
            print(f"[AI] 错误: {detail}")
            raise HTTPException(status_code=502, detail=f"AI API 错误 ({r.status_code}): {detail}")
        data = r.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        usage = data.get("usage", {})
        print(f"[AI] ✓ 返回 {len(content)} 字")
        return {"content": content, "usage": usage, "model": AI_MODEL}
    except requests.Timeout:
        raise HTTPException(504, "AI API 超时(>180s),请检查网络")
    except requests.ConnectionError as e:
        print(f"[AI] 连接失败: {e}")
        raise HTTPException(502, f"无法连接到 AI API: {e}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[AI] 异常: {e}")
        raise HTTPException(500, f"AI 调用失败: {e}")


# ============================================================
# Web 搜索接口 (新增,用于短新闻补充资料)
# ============================================================
def _duckduckgo_search(query: str, max_results: int = 5):
    """
    使用 DuckDuckGo HTML 版搜索(免费, 无需 Key).
    返回列表: [{"title": "", "url": "", "snippet": ""}]
    """
    try:
        # DuckDuckGo 的 lite 版返回更干净的 HTML
        url = "https://html.duckduckgo.com/html/"
        params = {"q": query, "kl": "cn-zh"}
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }
        r = requests.post(url, data=params, headers=headers, timeout=20)
        if r.status_code != 200:
            return []

        # 简单解析: 提取 title / url / snippet
        from html.parser import HTMLParser

        class DDGParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.results = []
                self.current = {}
                self.in_title = False
                self.in_snippet = False
                self.current_text = []

            def handle_starttag(self, tag, attrs):
                a = dict(attrs)
                cls = a.get("class", "")
                if tag == "a" and "result__a" in cls:
                    self.in_title = True
                    self.current = {"url": a.get("href", ""), "title": "", "snippet": ""}
                    self.current_text = []
                elif tag == "a" and "result__snippet" in cls:
                    self.in_snippet = True
                    self.current_text = []

            def handle_endtag(self, tag):
                if tag == "a" and self.in_title:
                    self.current["title"] = "".join(self.current_text).strip()
                    self.in_title = False
                elif tag == "a" and self.in_snippet:
                    self.current["snippet"] = "".join(self.current_text).strip()
                    if self.current.get("title"):
                        self.results.append(self.current)
                    self.in_snippet = False

            def handle_data(self, data):
                if self.in_title or self.in_snippet:
                    self.current_text.append(data)

        p = DDGParser()
        p.feed(r.text)
        return p.results[:max_results]
    except Exception as e:
        print(f"[Search] DuckDuckGo 失败: {e}")
        return []


def _bing_search(query: str, max_results: int = 5):
    """使用 Bing API(如果配了 key).否则返回 []"""
    key = os.getenv("BING_SEARCH_KEY", "")
    if not key:
        return []
    try:
        url = "https://api.bing.microsoft.com/v7.0/search"
        headers = {"Ocp-Apim-Subscription-Key": key}
        params = {"q": query, "count": max_results, "mkt": "zh-CN"}
        r = requests.get(url, headers=headers, params=params, timeout=20)
        if r.status_code != 200:
            return []
        data = r.json()
        items = data.get("webPages", {}).get("value", [])[:max_results]
        return [
            {"title": it.get("name", ""), "url": it.get("url", ""), "snippet": it.get("snippet", "")}
            for it in items
        ]
    except Exception as e:
        print(f"[Search] Bing 失败: {e}")
        return []


@app.post("/api/web_search")
def web_search(req: SearchRequest):
    """
    web 搜索(短新闻用). 优先 Bing(如配Key),否则 DuckDuckGo.
    返回: {query, results: [{title, url, snippet}], source}
    """
    print(f"[Search] 查询: {req.query}")

    results = _bing_search(req.query, req.max_results)
    source = "bing"
    if not results:
        results = _duckduckgo_search(req.query, req.max_results)
        source = "duckduckgo"

    print(f"[Search] 来源: {source}, 返回 {len(results)} 条")
    return {
        "query": req.query,
        "results": results,
        "source": source,
        "count": len(results),
    }


# ============================================================
# 爬虫后台启动(不弹终端窗口)
# ============================================================
def _launch_background(script_name: str, task_id: str, extra_env: dict = None):
    """跨平台后台运行 Python 脚本,日志写入文件,Windows 下无窗口"""
    script_path = PROJECT_ROOT / script_name
    if not script_path.exists():
        return False, f"脚本不存在: {script_path}"

    log_path = LOG_DIR / f"{script_name}_{task_id}.log"
    env = os.environ.copy()
    env["CRAWL_TASK_ID"] = task_id
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"
    if extra_env:
        env.update(extra_env)

    try:
        log_f = open(log_path, "w", encoding="utf-8", buffering=1)
    except Exception as e:
        return False, f"无法创建日志文件: {e}"

    try:
        if platform.system() == "Windows":
            CREATE_NO_WINDOW = 0x08000000
            subprocess.Popen(
                [sys.executable, str(script_path)],
                stdout=log_f, stderr=subprocess.STDOUT,
                cwd=str(PROJECT_ROOT), env=env,
                creationflags=CREATE_NO_WINDOW,
            )
        else:
            subprocess.Popen(
                [sys.executable, str(script_path)],
                stdout=log_f, stderr=subprocess.STDOUT,
                cwd=str(PROJECT_ROOT), env=env,
                start_new_session=True,
            )
        return True, str(log_path)
    except Exception as e:
        log_f.close()
        return False, str(e)


@app.post("/api/crawl/weibo")
def crawl_weibo(max_items: int = Query(30, ge=5, le=50, description="爬取条数,5-50")):
    """启动微博爬虫(后台,无窗口)"""
    task_id = datetime.now().strftime('%Y%m%d_%H%M%S')
    ok, info = _launch_background(
        "weibo_crawler_sync.py",
        task_id,
        extra_env={"WEIBO_MAX_ITEMS": str(max_items)}
    )
    if not ok:
        raise HTTPException(500, f"启动失败: {info}")

    placeholder = PROGRESS_DIR / f"weibo_{task_id}.json"
    try:
        placeholder.write_text(json.dumps({
            "task_id": task_id,
            "script": "weibo_crawler_sync",
            "status": "starting",
            "total": max_items,
            "current": 0,
            "eta_seconds": max_items * 25 + 30,
            "message": "爬虫进程已启动,等待初始化...",
            "updated_at": datetime.now().isoformat(),
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

    return {
        "task_id": task_id,
        "max_items": max_items,
        "log_file": info,
        "estimated_seconds": max_items * 25 + 30,
        "message": f"微博爬虫已在后台启动(最多 {max_items} 条),首次运行如未登录会弹出浏览器",
    }


@app.get("/api/crawl/progress/{task_id}")
def crawl_progress(task_id: str):
    """查询爬虫进度"""
    progress_file = PROGRESS_DIR / f"weibo_{task_id}.json"
    if not progress_file.exists():
        return {"task_id": task_id, "status": "unknown", "message": "任务不存在或已清理"}
    try:
        return json.loads(progress_file.read_text(encoding="utf-8"))
    except Exception as e:
        return {"task_id": task_id, "status": "error", "error": str(e)}


@app.get("/api/crawl/log/{task_id}")
def crawl_log(task_id: str, tail: int = Query(5000, description="返回最后多少字符")):
    """获取爬虫日志(调试用)"""
    log_path = LOG_DIR / f"weibo_crawler_sync.py_{task_id}.log"
    if not log_path.exists():
        raise HTTPException(404, f"日志不存在: {log_path}")
    try:
        content = log_path.read_text(encoding="utf-8", errors="replace")
        return {"task_id": task_id, "log": content[-tail:]}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/crawl/cleanup")
def cleanup_progress(keep_latest: int = 10):
    """清理旧的进度文件和日志"""
    try:
        pf = sorted(PROGRESS_DIR.glob("weibo_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in pf[keep_latest:]:
            p.unlink(missing_ok=True)
        lf = sorted(LOG_DIR.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in lf[keep_latest:]:
            p.unlink(missing_ok=True)
        return {"ok": True, "progress_kept": min(len(pf), keep_latest), "logs_kept": min(len(lf), keep_latest)}
    except Exception as e:
        raise HTTPException(500, str(e))


# ============================================================
# 启动入口
# ============================================================
if __name__ == "__main__":
    print("=" * 60)
    print("  XHS Content Studio 后端服务 v4")
    print("=" * 60)
    print(f"  工作目录     : {PROJECT_ROOT}")
    print(f"  AI Provider  : {AI_PROVIDER}")
    print(f"  AI Model     : {AI_MODEL or '(未设置)'}")
    print(f"  AI Base URL  : {AI_BASE_URL or '(未设置)'}")
    print(f"  AI Key 状态  : {'✓ 已配置 (' + AI_API_KEY[:8] + '...)' if AI_API_KEY else '✗ 未配置'}")
    print(f"  Web Search   : ✓ DuckDuckGo(默认) {'+ Bing' if os.getenv('BING_SEARCH_KEY') else ''}")
    print(f"  监听地址     : http://localhost:8000")
    print(f"  健康检查     : http://localhost:8000/health")
    print("=" * 60)
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
