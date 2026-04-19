// ============================================================
// 小红书内容工作台 v5
// 三联生活周刊 · AI驱动的内容运营
// ============================================================
// v5 更新点:
//   - UI 恢复旧版风格(红橙渐变 + Noto Serif SC + 顶部Header + 左侧Sidebar 6项)
//   - 导航拆分: AI匹配推荐 / 内容生成 / 历史记录 三个独立页面
//   - 内容生成: 文风改为官号第三人称客观视角(不再"我刷到/想起《三联》")
//   - 内容生成预览顺序: 笔记预览(手机真机比例) → 封面 → 正文页1-N
//   - 修复页码遮挡正文
//   - 清理孤立 # / (作者供图) / 未识别的小标题
//   - 长文封面参考短新闻风格(三联logo + 引号 + 衬线标题)
//   - 字号整体上调(正文 15.5, 标题 26)
//   - 历史记录: 左侧筛选(类型/日期/状态) + 右侧列表
// ============================================================

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// 配置
// ============================================================
// Supabase 和后端配置优先从环境变量读取, 没有则报错(避免硬编码泄露)
// 本地开发请在 frontend/.env 文件里填入:
//   REACT_APP_SUPABASE_URL=https://你的项目ID.supabase.co
//   REACT_APP_SUPABASE_ANON_KEY=sb_publishable_xxx
//   REACT_APP_BACKEND_URL=http://localhost:8000
const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  "";
const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  "";
const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BACKEND_URL) ||
  "http://localhost:8000";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "[配置错误] 缺少 Supabase 配置。\n" +
    "请在 frontend/.env 文件里填入 REACT_APP_SUPABASE_URL 和 REACT_APP_SUPABASE_ANON_KEY。\n" +
    "参考 frontend/env.example 模板。"
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// 字体 & 主题
// ============================================================
const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700;800;900&family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap');`;

const palette = {
  red: "#FF2442",
  redDark: "#D91A36",
  redLight: "#FFE4E8",
  orange: "#FF6B35",
  bg: "#F8F6F3",
  card: "#FFFFFF",
  cardAlt: "#FAFAF8",
  text: "#1A1A1A",
  textSec: "#666666",
  textTri: "#999999",
  border: "#EEEAE5",
  borderMed: "#DDD8D0",
  blue: "#2E5BFF",
  green: "#17B978",
  purple: "#7B61FF",
  warm: "#F5F0EB",
  warmDark: "#EBE4DC",
};

const gradPrimary = `linear-gradient(135deg, ${palette.red}, ${palette.orange})`;

// 小红书图片标准尺寸(3:4 竖版,实际导出 1242×1660)
const CARD_W = 414;
const CARD_H = 552;
// 手机真机笔记预览尺寸(iPhone 15 Pro Max 比例 ≈ 430:932)
const PHONE_W = 375;
const PHONE_H = 812;

// ============================================================
// Toast
// ============================================================
const ToastContext = React.createContext(null);
function useToast() { return React.useContext(ToastContext); }

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((msg, type = "info", duration = 3500) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts, { id, msg, type }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), duration);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div style={{
        position: "fixed", top: 20, right: 20, zIndex: 9999,
        display: "flex", flexDirection: "column", gap: 8, maxWidth: 420,
      }}>
        {toasts.map((t) => {
          const bg = {
            success: palette.green, error: palette.red,
            warning: palette.orange, info: palette.blue,
          }[t.type] || palette.blue;
          return (
            <div key={t.id} style={{
              padding: "12px 18px", borderRadius: 12, color: "#fff",
              background: bg, fontSize: 14, fontWeight: 500,
              fontFamily: "'Noto Sans SC', sans-serif",
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              animation: "slideIn 0.3s ease",
            }}>{t.msg}</div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// ============================================================
// 工具函数
// ============================================================

// 清洗 markdown 噪声 —— v8: 修复单侧 ** 残留 / 广义"xx供图xx"图注
function cleanArticleText(md) {
  if (!md) return "";
  let s = String(md);

  // ---- Phase 1: 先干掉公众号尾部的大块垃圾(在其它清理之前做) ----
  // v11: 增加更多实际出现的 cutoff 标记
  // 注意: 字符类里 [,，] 才是"半角逗号 + 全角逗号"
  const tailCutoffPatterns = [
    // 【v11 新增】常见的引流/订阅收尾
    /如果你和我们一样[,，][^\n]{0,50}(订阅|关注|买一本|杂志|感兴趣)/,
    /更多精彩报道详见/,
    /点击[下上]图[,，]?\s*一键下单/,
    /开通三联数字刊年卡/,
    /让深度阅读再全一点/,
    /本周新刊/,
    /一键下单纸刊/,
    /本\*?\*?期更多精彩/,
    // 封面故事/文化/专栏索引
    /^\s*\|\s*(封面故事|文化|专栏|社会|经济|访谈|科技|文章|时事|读者|生活圆桌)\s*\|/m,
    // 原有
    /「?三联生活小物分享群」?[^\n]*等你来玩/,
    /「?三联生活小物分享群」?[^\n]*开始试运行/,
    /三联生活周刊.{0,15}招撰稿人/,
    /[「"]这是一个什么群[」"]/,
    /大家都在看\s*\n/,
    /欢迎文末分享[、,，]?\s*点赞[、,，]?\s*在看/,
    /本文为原创内容[,，]?\s*版权归/,
    /\*?本文为[「"]三联生活周刊[」"]原创内容/,
    /未经许可[,，]\s*严禁复制[、,，]转载/,
    /[""]点赞[""].?[""]在看[""][,，]?让更多人看到/,
    /作为一家以[""]生活[""]命名的媒体/,
  ];
  for (const pat of tailCutoffPatterns) {
    const m = s.match(pat);
    if (m && m.index > 200) {
      s = s.slice(0, m.index).trim();
    }
  }
  // ---- Phase 1.5 (v11): 头部的引流广告行(不是尾部 cutoff,是独立一行的广告) ----
  //   如: "新刊出炉!点击上图,一键下单↑↑↑"
  //   这些行出现在正文前后都有, 单独清理
  const headAdPatterns = [
    /^.*新刊出炉.*$/gm,
    /^.*点击[上下]?图.*一键下单.*$/gm,
    /^.*点击图片.*一键下单.*$/gm,
    /^.*一键下单纸刊.*$/gm,
    /^.*扫码关注我们.*$/gm,
    /^.*长按识别.*二维码.*$/gm,
  ];
  for (const pat of headAdPatterns) s = s.replace(pat, "");

  // 1. 图片 markdown
  s = s.replace(/!\[[^\]]*\]\([^)]*\)?/g, "");
  // 2. 完整/残缺 markdown 链接
  s = s.replace(/\*{0,2}\[[^\]]*\]\([^)]*\)?\*{0,2}/g, (m) => {
    const mm = m.match(/\[([^\]]+)\]\([^)]+\)/);
    return mm ? mm[1] : "";
  });
  s = s.replace(/\[\]\(\S*\)?/g, "");
  // 3. 裸 URL
  s = s.replace(/https?:\/\/\S+/g, "");
  // 4. 分隔线
  s = s.replace(/^[-*=]{3,}\s*$/gm, "");
  // 5. 独占一行的 *
  s = s.replace(/^\s*\*+\s*$/gm, "");
  // 6. 独占的 #
  s = s.replace(/^\s*#{1,6}\s*$/gm, "");

  // ---- Phase 3 (v11): 图注 / 括注清理 ----
  //
  // 【v11 关键 bug 修复】: 之前的字符类 [^(()\)\n] 里只有半角 () , 没包含全角 （）
  //   导致 (蔡小川 摄)、(视觉中国 供图) 这种全角括号里的内容不被匹配
  //   新的字符类: [^()()（）\n] 同时排除中英文两种括号
  //
  // 【广义图注规则】: 括号内任何位置出现"供图/摄影/剧照/截图/插图/插画/图源/拍摄/图片来自/图//..."
  // 都视为图注, 整个括号删除.
  s = s.replace(/[(（]([^()()（）\n]{0,40}(?:供图|摄影|剧照|截图|插图|插画|图源|图片来自|图片来源|图\s*\/|拍摄|受访者提供|采访者提供|本刊记者摄|资料图|视觉中国|东方IC|CFP)[^()()（）\n]{0,30})[)）]/g, "");
  // 【v11 新增】 "(人名 摄)" 模式 - 单字"摄"前必须是空格 + 人名,后跟闭括号
  //   例子: (蔡小川 摄) (张三 摄) (赵钱孙 摄)
  s = s.replace(/[(（]\s*[^()()（）\n]{1,20}\s+摄\s*[)）]/g, "");
  // 不带空格的 (xxx摄) —— 但要排除"拍摄/摄影/摄制/摄像"
  s = s.replace(/[(（]\s*[^()()（）\n]{1,20}摄\s*[)）]/g, (m) => {
    if (/拍摄|摄影|摄制|摄像/.test(m)) return m;
    return "";
  });
  // 兼容: 独立成行 "xxx摄 / xxx 摄"
  s = s.replace(/^\s*[^\n]{1,30}\s+摄\s*$/gm, "");
  // 兼容: 一些文章图注后面没闭括号, 单独成行 "xxx供图" / "xxx摄"
  s = s.replace(/^\s*[^\n]{0,50}(供图|摄影|剧照|截图|插图|插画|图源[^\n]*|拍摄[^\n]*|受访者提供|采访者提供|本刊记者摄|视觉中国\s*供图|图片来自[^\n]*|图片来源[^\n]*|资料图)\s*$/gm, "");

  // ---- Phase 3.5 (v12): 整行图注检测 —— 即使(蔡小川 摄)已被删, 前面的图注描述也应整行删 ----
  // 典型模式:
  //   "2024年7月,永宁城隍庙的拜亭前面祭城隍的祭台已经搭建完毕,仪式即将开场" (括号已被删掉的图注)
  //   "正月初九拜天公,是永宁延续多年的民俗"
  //   "在永宁城隍庙的天井庭院里,人们抬着神轿进行冲撞,以示娱神"
  //   "从各地过来进香的民众,在永宁城隍庙的大殿当中朝拜城隍"
  //   "2024 年, 永宁老街上有不少老房子正在进行修复"
  // 特征: 这种句子经常以"日期/地点/描述"开头, 整句就是图片描述,
  //       一般长度在 15-60 字, 不以句号结尾 (因为真的图注通常就是标题式短语)
  // 启发式: 独立成段(前后空行) + 不以 。!? 结尾 + 长度 10-80 字
  //       并且内容特征匹配(有时间/地点/场景描述)
  //
  // 保守起见, 只检测已知特征强的行:
  //   开头是 "YYYY年" / "YYYY 年" / "从各地" / "在XX庙" / "正月" / "农历" 等
  //   且以"修复/巡游/烧香/朝拜/进香/祭城隍/进行/民俗/搭建/开场/仪式"等图注动词结尾
  const captionLinePatterns = [
    // 日期开头 + 图注特征
    /^\s*\d{4}\s*年[\s\d月日,，][^\n]{5,70}(修复|巡游|烧香|朝拜|进香|祭城隍|搭建|开场|仪式|民俗|绕境|诞辰|祭祖|游神|出巡|抬着|冲撞|娱神|建筑|现场)\s*$/gm,
    // 正月/农历/春节 开头
    /^\s*(正月|农历|春节|中元节|清明)[^\n]{5,60}(民俗|仪式|节日|活动|绕境|游神|祭祖|拜天)\s*$/gm,
    // 以"在 XX庙/宫/祠/堂/城/城隍庙..."开头的图注
    /^\s*(从各地|各地|来自)?[^\n]{0,20}(庙|宫|祠|堂|城隍|神庙|祠堂)[^\n]{5,60}(朝拜|进香|烧香|祭|参拜|游神|冲撞|娱神|巡游|抬着|仪式)\s*$/gm,
    // 通用短图注:"XX,YY,ZZ(没句号结尾,描述场面)"
    //   只匹配明显特征:包含(拜|朝|祭|进香|游神|巡游|仪式)动词 + 不以句号结尾
    /^\s*[^\n。!?]{10,70}(朝拜|进香|烧香|拜祭|祭城隍|游神|巡游|抬着.{0,15}冲撞|娱神|祭台)[^\n。!?]{0,20}$/gm,
    // 老房子修复/修建等独立一行
    /^\s*\d{4}\s*年[,，\s]?[^\n]{0,40}(老房子|古建筑|古街|古城)[^\n]{0,30}(修复|修建|改造|重建)\s*$/gm,
  ];
  for (const pat of captionLinePatterns) s = s.replace(pat, "");

  // ---- Phase 3.6 (v15): 封面副标题和章节小标题 ----
  //  关键:
  //  (a) 「永宁游神,出行」** 这种放在文章开头 3 行内的 = 本期主题标签, 删除
  //  (b) 「物理AI与中国机会」** / 当AI走入物理世界** —— 这些是**正文中的小标题**
  //     应该去掉 ** 保留文字, 前后加空行让 parseArticleBlocks 识别为独立小标题
  //
  //  v15 的做法: 只删"开头3行内"的「xxx」** 行(主题标签), 其他位置保留并去除 **
  //  结合 Phase 5 的成对 ** 清理, 这些小标题会变成独立行, 符合 parseArticleBlocks 的 heading 启发式

  // 先处理开头 3 行内的主题标签(删除)
  {
    const headLines = s.split("\n").slice(0, 8);  // 前 8 行
    for (let i = 0; i < headLines.length; i++) {
      if (/^\s*「[^」]{2,30}」\*{0,4}\s*$/.test(headLines[i])) {
        headLines[i] = "";
      }
    }
    s = headLines.concat(s.split("\n").slice(8)).join("\n");
  }

  // ---- Phase 3.7 (v15): 开头的 "*本文为..." "*XXX刊..." 类 —— 全文任何位置都可能出现, 不仅开头 ----
  s = s.replace(/^\s*\*\s*本文为[「"]?[^\n]{0,40}[」"]?原创内容[^\n]*$/gm, "");
  s = s.replace(/^\s*\*\s*本文原载于[^\n]*$/gm, "");

  // ---- Phase 4: 机构 / 署名 / 版权 ----
  s = s.replace(/\n\n(三联生活周刊|三联生活传媒|三联人文城市|三联中读|三联书店|三联·爱乐)\s*(是|作为|旗下|隶属)[^\n]{20,}(?:\n[^\n]+){0,3}/g, "");
  s = s.replace(/^\s*(运营编辑|编辑|责编|主编|撰稿|采写|审校|校对|排版|图片编辑|视觉设计)\s*[:：][^\n]{0,30}\s*$/gm, "");
  s = s.replace(/^\s*\*?\s*本文原载于[^\n]*$/gm, "");
  s = s.replace(/^\s*\*?\s*本文为[「"][^「"]*[」"]原创内容[^\n]*$/gm, "");

  // ---- Phase 5 (v8 新增): 单侧 ** 残留清理 ----
  //
  // 现实中文章经常出现这些怪异情形:
  //   "** 张雪机车在世界比赛中夺冠" → 段首孤立 ** (剩余 text)
  //   "那几年是... **\"" → 段尾 **" 残留
  //   "**直接夺冠**的消息" → 成对正常(保留, 由 inline md 渲染成粗体)
  //
  // 算法: 统计行内成对 ** 的数量; 如果是奇数, 说明有单侧残留, 干掉全部 ** 改成普通文字
  s = s.split("\n").map((line) => {
    const count = (line.match(/\*\*/g) || []).length;
    if (count % 2 === 1) {
      // 奇数: 单侧残留, 全部干掉
      return line.replace(/\*\*/g, "").replace(/^\s+/, (m) => m);
    }
    return line;
  }).join("\n");

  // 孤立位置的单个 **、行尾 **"、行首 ** 等进一步清理
  s = s.replace(/(^|\n)[ \t]*\*\*[ \t]*(?=[^\*])/g, "$1");
  s = s.replace(/(\s)\*\*(\s)/g, "$1$2");
  // 孤立 *
  s = s.replace(/(^|\n)\*{1,4}\s*(\n|$)/g, "$1$2");
  // 行尾 ****
  s = s.replace(/\s\*{2,}\s*$/gm, "");
  // 像 `** "` 这种: 尾部 ** + 引号
  s = s.replace(/^\s*\*{1,4}\s*["""'']\s*$/gm, "");

  // ---- Phase 6: 短行广告残留 ----
  s = s.replace(/^[^\n]{0,35}(点赞|在看|分享|转发|关注我们|扫码|加群|加入我们)[^\n]{0,20}$/gm, (m) => {
    if (/^[「"『]/.test(m.trim()) || m.length > 30) return m;
    return "";
  });

  // ---- Phase 7: 合并空行 ----
  s = s.replace(/\n{3,}/g, "\n\n");
  // 合并段首的多余空白
  s = s.replace(/^[ \t]+/gm, (m) => m.length > 4 ? "" : m);
  return s.trim();
}

// 把清洗后的 md 拆成 blocks (paragraph / heading)
function parseArticleBlocks(md) {
  if (!md) return [];
  const cleaned = cleanArticleText(md);
  const lines = cleaned.split("\n");
  const blocks = [];
  let buf = [];
  const flushPara = () => {
    if (buf.length) {
      const text = buf.join(" ").trim();
      if (text) blocks.push({ type: "paragraph", text });
      buf = [];
    }
  };
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { flushPara(); continue; }
    // # 标题
    const hm = t.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      flushPara();
      blocks.push({ type: "heading", level: Math.min(hm[1].length, 4), text: hm[2].trim() });
      continue;
    }
    // **xxx** 整行加粗 = 小标题
    const bm = t.match(/^\*\*(.+)\*\*$/);
    if (bm) {
      flushPara();
      blocks.push({ type: "heading", level: 3, text: bm[1].trim() });
      continue;
    }
    // 短句无标点 + 无空格 + 长度短 = 推定为小标题 (v10 修复: 真正作为 heading 输出)
    if (
      t.length >= 2 && t.length <= 16 &&
      !/[,。!?,;:;：、]/.test(t) &&
      /^[\u4e00-\u9fa5\w:：「」""\-—]+$/.test(t)
    ) {
      flushPara();
      blocks.push({ type: "heading", level: 3, text: t });
      continue;
    }
    buf.push(t);
  }
  flushPara();

  // v11: 第二道防护 —— 对每个 block 的 text 再过一次括号图注清理
  //     字符类同时排除中英文括号 [^()()（）\n]
  const CAPTION_RE = /[(（][^()()（）\n]{0,70}(?:供图|摄影|剧照|截图|插图|插画|图源|图片来自|图片来源|图\s*\/|拍摄|受访者提供|采访者提供|本刊记者摄|资料图|视觉中国|东方IC|CFP|IC\s*photo)[^()()（）\n]{0,30}[)）]/g;
  // v11: (人名 摄) 专项规则
  const CAPTION_SHE_RE = /[(（]\s*[^()()（）\n]{1,20}\s+摄\s*[)）]/g;
  // 不带空格的 (xxx摄) —— 但要排除"拍摄/摄影/摄制/摄像"
  const CAPTION_SHE_RE2 = /[(（]\s*[^()()（）\n]{1,20}摄\s*[)）]/g;
  // 独占尾部的"xx供图"句(没括号)
  const TAIL_CAPTION_RE = /[\s。,!?;]\s*[^\s。,!?;]{0,20}(供图|摄影|剧照|图源|拍摄者?)\s*$/;

  for (const b of blocks) {
    if (!b.text) continue;
    b.text = b.text.replace(CAPTION_RE, "")
                   .replace(CAPTION_SHE_RE, "")
                   .replace(CAPTION_SHE_RE2, (m) => /拍摄|摄影|摄制|摄像/.test(m) ? m : "")
                   .replace(TAIL_CAPTION_RE, "")
                   .trim();
    b.text = b.text.replace(/[(（]\s*[)）]/g, "");  // 清理因删除导致的空括号
  }

  // 过滤掉变空的 block
  return blocks.filter((b) => (b.text || "").trim().length > 0);
}

// 行内 **bold** 渲染
// v16: 先清理孤立 **(奇数个 → 全删, 只保留成对的), 再渲染
function renderInlineMarkdown(text) {
  if (!text) return null;
  let s = String(text);
  // 奇偶检查: ** 数量为奇数说明有孤立残留, 全删后处理剩余成对
  const count = (s.match(/\*\*/g) || []).length;
  if (count % 2 === 1) {
    s = s.replace(/\*\*/g, "");
  }
  // 处理成对 **xxx**
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\*\*([^*]+)\*\*$/);
    if (m) return <strong key={i} style={{ fontWeight: 700 }}>{m[1]}</strong>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

// v16: 智搜摘要智能分段
// 爬下来的智搜有时已有 \n\n 分段, 有时却是一长段; 用启发式在 @来源名 / emoji 标签前断行
function segmentSmartSummary(text) {
  if (!text) return [];
  const raw = String(text).trim();
  // 情况 A: 本身有双换行 → 直接用
  if (/\n\s*\n/.test(raw)) {
    return raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  }
  // 情况 B: 有单换行也用
  if (/\n/.test(raw)) {
    return raw.split(/\n/).map(s => s.trim()).filter(Boolean);
  }
  // 情况 C: 合并成一行, 在 @来源名 前断段
  //   匹配 "空格 + @中文/英文/数字(2-15字)" 作为新段起点
  const parts = raw.split(/(?=\s@[\u4e00-\u9fa5A-Za-z0-9_·]{2,15})/);
  const cleaned = parts.map(s => s.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : [raw];
}

// 从 content_md 提取作者名
function extractAuthorInfo(md) {
  if (!md) return null;
  const patterns = [
    /(?:^|\n)\s*文\s*[\|｜\/]\s*([^\n(（]+)/,
    /(?:^|\n)\s*记者\s*[\|｜:：]\s*([^\n(（]+)/,
    /(?:^|\n)\s*作者\s*[\|｜:：]\s*([^\n(（]+)/,
    /(?:^|\n)\s*撰文\s*[\|｜:：]\s*([^\n(（]+)/,
  ];
  for (const p of patterns) {
    const m = md.match(p);
    if (m) {
      const name = m[1].trim().replace(/\*+/g, "").replace(/\s+/g, " ").slice(0, 30);
      if (name && !/[a-zA-Z]{5,}/.test(name)) return name;
    }
  }
  return null;
}

function formatPubDateToYM(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}年${d.getMonth() + 1}月`;
  } catch { return ""; }
}

function formatPubDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr).slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch { return String(dateStr).slice(0, 10); }
}

function formatNumber(n) {
  if (n === null || n === undefined) return "";
  const num = typeof n === "number" ? n : parseInt(String(n).replace(/,/g, "")) || 0;
  if (num >= 10000) return (num / 10000).toFixed(1) + "万";
  return String(num);
}

// ============================================================
// html-to-image 动态加载
// ============================================================
let _htmlToImagePromise = null;
async function loadHtmlToImage() {
  if (_htmlToImagePromise) return _htmlToImagePromise;
  _htmlToImagePromise = (async () => {
    try {
      return await import("html-to-image");
    } catch {
      if (window.htmlToImage) return window.htmlToImage;
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js";
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      return window.htmlToImage;
    }
  })();
  return _htmlToImagePromise;
}

// 下载 DOM 为 PNG (默认 1242×1660 = 414×553 @ pixelRatio 3)
async function downloadAsImage(elRef, filename = "image.png", width = CARD_W, height = CARD_H) {
  if (!elRef?.current) return false;
  try {
    const htmlToImage = await loadHtmlToImage();
    const toPng = htmlToImage.toPng || htmlToImage.default?.toPng;
    if (!toPng) throw new Error("toPng not found");
    const dataUrl = await toPng(elRef.current, {
      pixelRatio: 3, width, height,
      backgroundColor: "#ffffff", cacheBust: true,
    });
    const a = document.createElement("a");
    a.download = filename; a.href = dataUrl; a.click();
    return true;
  } catch (e) {
    console.error("download error:", e);
    return false;
  }
}

// ============================================================
// API 客户端
// ============================================================
async function callAI(prompt, { system = "", maxTokens = 4000, temperature = 0.7 } = {}) {
  const r = await fetch(`${BACKEND_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, prompt, max_tokens: maxTokens, temperature }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail || `HTTP ${r.status}`);
  }
  const data = await r.json();
  return data.content || "";
}

async function webSearch(query, maxResults = 5) {
  try {
    const r = await fetch(`${BACKEND_URL}/api/web_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, max_results: maxResults }),
    });
    if (!r.ok) return { results: [] };
    return await r.json();
  } catch (e) {
    console.warn("web_search failed:", e);
    return { results: [] };
  }
}

async function pingBackend() {
  try {
    const r = await fetch(`${BACKEND_URL}/health`);
    if (!r.ok) return { ok: false };
    return await r.json();
  } catch { return { ok: false }; }
}

async function startWeiboCrawler(maxItems = 30) {
  const r = await fetch(`${BACKEND_URL}/api/crawl/weibo?max_items=${maxItems}`, { method: "POST" });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail || `HTTP ${r.status}`);
  }
  return await r.json();
}

async function getCrawlProgress(taskId) {
  try {
    const r = await fetch(`${BACKEND_URL}/api/crawl/progress/${taskId}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ============================================================
// Supabase 数据层
// ============================================================
async function fetchArticlesAll() {
  const all = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("articles")
      .select("id, title, pub_date, summary, content_md")
      .order("pub_date", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

async function fetchLatestWeiboHot() {
  const { data: latestRow, error: e1 } = await supabase
    .from("weibo_hot").select("batch_id")
    .order("crawled_at", { ascending: false }).limit(1);
  if (e1) {
    if (String(e1.message || "").includes("does not exist")) {
      throw new Error("表 weibo_hot 不存在,请先执行 supabase_schema.sql");
    }
    throw e1;
  }
  if (!latestRow?.length) return [];
  const batchId = latestRow[0].batch_id;
  if (!batchId) return [];
  const { data, error } = await supabase
    .from("weibo_hot").select("*")
    .eq("batch_id", batchId)
    .order("rank", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchGeneratedHistory() {
  const { data, error } = await supabase
    .from("generated_content").select("*")
    .order("created_at", { ascending: false }).limit(200);
  if (error) {
    if (String(error.message || "").includes("does not exist")) return [];
    throw error;
  }
  return data || [];
}

async function saveGeneratedContent(payload) {
  const { error } = await supabase.from("generated_content").insert([payload]);
  if (error) throw error;
}

// v7: AI 匹配历史(持久化到 DB)
async function saveMatchHistory({ long_recs, short_recs, weibo_batch_id, mode, custom_topic }) {
  try {
    const { error } = await supabase.from("ai_match_history").insert([{
      long_recs, short_recs, weibo_batch_id: weibo_batch_id || null,
      note: JSON.stringify({ mode: mode || "auto", custom_topic: custom_topic || null }),
    }]);
    if (error) {
      if (String(error.message || "").includes("does not exist")) {
        console.warn("表 ai_match_history 不存在, 跳过保存。请执行 supabase_schema_v7.sql");
        return false;
      }
      throw error;
    }
    return true;
  } catch (e) {
    console.warn("saveMatchHistory 失败:", e);
    return false;
  }
}

async function fetchMatchHistory(limit = 60) {
  try {
    const { data, error } = await supabase
      .from("ai_match_history").select("*")
      .order("matched_at", { ascending: false }).limit(limit);
    if (error) {
      if (String(error.message || "").includes("does not exist")) return [];
      throw error;
    }
    return data || [];
  } catch (e) {
    console.warn("fetchMatchHistory 失败:", e);
    return [];
  }
}

// v7: 北京时间显示
function fmtBeijing(dt, opts = {}) {
  if (!dt) return "";
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return "";
  const defaults = {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  };
  return d.toLocaleString("zh-CN", { ...defaults, ...opts });
}

function fmtBeijingDate(dt) {
  return fmtBeijing(dt, {
    hour: undefined, minute: undefined,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

// ============================================================
// 基础 UI 组件(旧版风格)
// ============================================================

function Btn({ children, onClick, variant = "primary", size = "md", disabled, loading, style }) {
  const base = {
    padding: size === "sm" ? "7px 14px" : size === "lg" ? "13px 26px" : "10px 20px",
    borderRadius: 12, border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "'Noto Sans SC', sans-serif", fontWeight: 500,
    fontSize: size === "sm" ? 13 : size === "lg" ? 15 : 14,
    display: "inline-flex", alignItems: "center", gap: 8,
    transition: "all .2s", opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
  const variants = {
    primary: { background: gradPrimary, color: "#fff" },
    secondary: { background: palette.warm, color: palette.text, border: `1px solid ${palette.borderMed}` },
    ghost: { background: "transparent", color: palette.textSec, border: `1px solid ${palette.border}` },
    green: { background: palette.green, color: "#fff" },
    red: { background: palette.red, color: "#fff" },
    purple: { background: palette.purple, color: "#fff" },
    danger: { background: "#FEF2F2", color: palette.red, border: `1px solid ${palette.red}40` },
  };
  return (
    <button
      onClick={onClick} disabled={disabled || loading}
      style={{ ...base, ...(variants[variant] || variants.primary), ...style }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
    >
      {loading && <Spinner size={13} color="#fff" />}
      {children}
    </button>
  );
}

function Spinner({ size = 20, color }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: `2px solid ${color ? color + "30" : palette.border}`,
      borderTopColor: color || palette.red,
      animation: "spin 0.8s linear infinite",
      display: "inline-block",
    }} />
  );
}

function StatCard({ icon, label, value, color, sub }) {
  return (
    <div style={{
      background: palette.card, borderRadius: 16, padding: "20px 24px",
      border: `1px solid ${palette.border}`, flex: 1, minWidth: 160,
      transition: "transform .2s, box-shadow .2s",
    }}
    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,.06)"; }}
    onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18,
        }}>{icon}</div>
        <span style={{ fontSize: 13, color: palette.textSec, fontFamily: "'Noto Sans SC'" }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: palette.text, fontFamily: "'Noto Serif SC'" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: palette.textTri, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ icon, title, subtitle, action, color = palette.red }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-end",
      marginBottom: 22, paddingBottom: 14,
      borderBottom: `2px solid ${palette.border}`,
      flexWrap: "wrap", gap: 12,
    }}>
      <div>
        <h2 style={{
          fontSize: 22, fontWeight: 700, color: palette.text,
          fontFamily: "'Noto Serif SC'", display: "flex", alignItems: "center", gap: 10,
          margin: 0,
        }}>
          <span style={{
            width: 4, height: 26, borderRadius: 2,
            background: `linear-gradient(180deg, ${color}, ${palette.orange})`,
            display: "inline-block",
          }} />
          {icon && <span style={{ fontSize: 24 }}>{icon}</span>}
          {title}
        </h2>
        {subtitle && <p style={{ fontSize: 13, color: palette.textTri, margin: "6px 0 0 14px" }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function Tag({ children, color = palette.blue, onClick }) {
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-block",
        padding: "5px 12px", borderRadius: 100,
        background: `${color}12`, color, fontSize: 12, fontWeight: 500,
        fontFamily: "'Noto Sans SC'", cursor: onClick ? "pointer" : "default",
        border: `1px solid ${color}25`,
      }}
    >{children}</span>
  );
}

function Pill({ children, color = "#F3F4F6", textColor = "#374151", style }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "4px 10px", borderRadius: 100, fontSize: 12,
      background: color, color: textColor, fontWeight: 500,
      whiteSpace: "nowrap", ...style,
    }}>{children}</span>
  );
}

function EmptyState({ icon = "📭", title = "暂无数据", desc = "", action }) {
  return (
    <div style={{
      textAlign: "center", padding: "80px 20px",
      background: palette.card, borderRadius: 16,
      border: `1px dashed ${palette.border}`,
    }}>
      <div style={{ fontSize: 56, marginBottom: 14 }}>{icon}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: palette.text, marginBottom: 8, fontFamily: "'Noto Serif SC'" }}>{title}</div>
      {desc && <div style={{ fontSize: 13, color: palette.textSec, marginBottom: 20, lineHeight: 1.8, maxWidth: 460, margin: "0 auto 20px" }}>{desc}</div>}
      {action}
    </div>
  );
}

// 排名徽章
function RankBadge({ rank, size = 30 }) {
  let bg;
  if (rank === 1) bg = "linear-gradient(135deg, #FFD700, #FFA500)";
  else if (rank === 2) bg = "linear-gradient(135deg, #C0C0C0, #A8A8A8)";
  else if (rank === 3) bg = "linear-gradient(135deg, #CD7F32, #A0522D)";
  else bg = "linear-gradient(135deg, #E5E7EB, #D1D5DB)";
  const color = rank <= 3 ? "#fff" : palette.textSec;
  return (
    <div style={{
      width: size, height: size, borderRadius: 8, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: bg, color, fontWeight: 700,
      fontSize: size > 26 ? 14 : 12,
      fontFamily: "'Noto Serif SC'",
    }}>{rank || "-"}</div>
  );
}

// 状态圆点
function StatusDot({ color = palette.green, size = 8 }) {
  return (
    <span style={{
      display: "inline-block",
      width: size, height: size, borderRadius: size / 2,
      background: color,
      boxShadow: `0 0 0 3px ${color}20`,
    }} />
  );
}

// 简单进度条
function ProgressBar({ value = 0, max = 100, color = palette.red }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{
      width: "100%", height: 8, borderRadius: 4,
      background: palette.warm, overflow: "hidden",
    }}>
      <div style={{
        width: `${pct}%`, height: "100%",
        background: `linear-gradient(90deg, ${color}, ${palette.orange})`,
        transition: "width 0.3s",
      }} />
    </div>
  );
}

// ============================================================
// 图片预览组件 - 所有导出尺寸 1242×1660 (414×553 @ pixelRatio 3)
// ============================================================

// ---- 长文封面 v9: 支持 compactMode (手机预览用) ----
function XHSCoverLongForm({
  innerRef, hook, xhsTitle, articleTitle, pubDate,
  magazine = "三联生活周刊", tagLabel = "旧文重温",
  compactMode = false, compactW, compactH,
}) {
  const quote = hook || xhsTitle || "";
  const showSubtitle = articleTitle && articleTitle.trim();

  // compact 模式按比例缩小内部尺寸 (手机预览用), 否则用标准 414x552
  const W = compactMode ? compactW : CARD_W;
  const H = compactMode ? compactH : CARD_H;
  // 计算缩放系数(以标准尺寸为 1)
  const s = compactMode ? Math.min(W / CARD_W, H / CARD_H) : 1;
  // 用 s 缩放所有内部 px
  const sp = (n) => Math.round(n * s);

  return (
    <div
      ref={innerRef}
      style={{
        width: W, height: H,
        background: "#FAFAF7", color: "#1A1A1A",
        fontFamily: '"Noto Serif SC", "Songti SC", "SimSun", serif',
        padding: `${sp(38)}px ${sp(32)}px ${sp(28)}px`,
        display: "flex", flexDirection: "column",
        boxShadow: compactMode ? "none" : "0 8px 32px rgba(0,0,0,0.08)",
        borderRadius: compactMode ? 0 : 18,
        position: "relative", overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* 顶栏 三联logo */}
      <div style={{
        display: "flex", alignItems: "center", gap: sp(10), marginBottom: sp(14),
        fontFamily: '"Noto Sans SC", sans-serif',
      }}>
        <div style={{
          width: sp(38), height: sp(38), borderRadius: sp(8), background: palette.red,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: sp(10), fontWeight: 800, color: "#fff", letterSpacing: 0.3, lineHeight: 1.15,
          textAlign: "center",
        }}>三联<br/>生活</div>
        <div>
          <div style={{ fontSize: sp(14), fontWeight: 700, color: palette.text }}>{magazine}</div>
          <div style={{ fontSize: sp(11), color: palette.red, fontWeight: 600 }}>{tagLabel}</div>
        </div>
      </div>

      {/* 装饰短横线 */}
      <div style={{ height: sp(3), width: sp(42), background: palette.red, marginBottom: sp(20) }} />

      {/* 金句区:左上引号 + 内容 + 右下引号 */}
      <div style={{ position: "relative", marginBottom: sp(20) }}>
        <div style={{
          fontSize: sp(62), color: palette.red, lineHeight: 0.7,
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 700, marginBottom: sp(6), letterSpacing: -2,
        }}>&ldquo;</div>
        <div style={{
          fontSize: sp(27), fontWeight: 800, lineHeight: 1.45,
          color: "#1A1A1A", letterSpacing: 0.3,
          fontFamily: '"Noto Serif SC", serif',
          paddingLeft: 2,
        }}>{quote}</div>
        <div style={{
          fontSize: sp(62), color: palette.red, lineHeight: 0.4,
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 700, textAlign: "right",
          marginTop: sp(4), letterSpacing: -2, paddingRight: sp(4),
        }}>&rdquo;</div>
      </div>

      {/* 副标题:文章原名 */}
      {showSubtitle && (
        <div style={{
          fontSize: sp(13.5), color: palette.textSec, lineHeight: 1.55,
          fontFamily: '"Noto Sans SC", sans-serif', fontWeight: 500,
          paddingLeft: 2,
        }}>—《{articleTitle}》</div>
      )}

      {/* 填充区 */}
      <div style={{ flex: 1 }} />

      {/* 底栏 */}
      <div style={{
        paddingTop: sp(12), borderTop: "1px solid #E5E5E0",
        textAlign: "center",
        fontSize: sp(11), color: palette.textTri, letterSpacing: 2,
        fontFamily: '"Noto Sans SC", sans-serif',
      }}>
        深度阅读 · {magazine}
      </div>
    </div>
  );
}

// ---- 短新闻封面 ----
function ShortNewsCover({
  innerRef, title, summary, magazine = "三联生活周刊", tag = "热点速递",
  compactMode = false, compactW, compactH,
}) {
  // v15: compact 模式按比例缩放 (手机预览用)
  const W = compactMode ? compactW : CARD_W;
  const H = compactMode ? compactH : CARD_H;
  const s = compactMode ? Math.min(W / CARD_W, H / CARD_H) : 1;
  const sp = (n) => Math.round(n * s);

  return (
    <div
      ref={innerRef}
      style={{
        width: W, height: H,
        background: "#FAFAF7", color: "#1A1A1A",
        fontFamily: '"Noto Serif SC", "Songti SC", "SimSun", serif',
        padding: `${sp(38)}px ${sp(32)}px ${sp(28)}px`,
        display: "flex", flexDirection: "column",
        boxShadow: compactMode ? "none" : "0 8px 32px rgba(0,0,0,0.08)",
        borderRadius: compactMode ? 0 : 18,
        position: "relative", overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* 顶栏 */}
      <div style={{
        display: "flex", alignItems: "center", gap: sp(10), marginBottom: sp(14),
        fontFamily: '"Noto Sans SC", sans-serif',
      }}>
        <div style={{
          width: sp(38), height: sp(38), borderRadius: sp(8), background: palette.red,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: sp(10), fontWeight: 800, color: "#fff", letterSpacing: 0.3, lineHeight: 1.15,
          textAlign: "center",
        }}>三联<br/>生活</div>
        <div>
          <div style={{ fontSize: sp(14), fontWeight: 700, color: palette.text }}>{magazine}</div>
          <div style={{ fontSize: sp(11), color: palette.red, fontWeight: 600 }}>{tag}</div>
        </div>
      </div>

      {/* 装饰短横线 */}
      <div style={{ height: sp(3), width: sp(42), background: palette.red, marginBottom: sp(18) }} />

      {/* 标题区:左上引号 + 标题 + 右下引号 */}
      <div style={{ position: "relative", marginBottom: sp(16) }}>
        <div style={{
          fontSize: sp(54), color: palette.red, lineHeight: 0.7,
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 700, marginBottom: sp(4), letterSpacing: -2,
        }}>&ldquo;</div>
        <div style={{
          fontSize: sp(26), fontWeight: 800, lineHeight: 1.42,
          color: "#1A1A1A", letterSpacing: 0.3,
          fontFamily: '"Noto Serif SC", serif',
          paddingLeft: 2,
        }}>{title || "(标题)"}</div>
        <div style={{
          fontSize: sp(54), color: palette.red, lineHeight: 0.4,
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 700, textAlign: "right",
          marginTop: sp(4), letterSpacing: -2, paddingRight: sp(4),
        }}>&rdquo;</div>
      </div>

      {/* 摘要 */}
      <div style={{
        fontSize: sp(14.5), lineHeight: 1.9, color: "#2A2A2A",
        flex: 1, overflow: "hidden", textAlign: "justify",
        fontFamily: '"Noto Serif SC", "Songti SC", serif',
      }}>{summary}</div>

      {/* 底栏 */}
      <div style={{
        marginTop: sp(10), paddingTop: sp(12),
        borderTop: "1px solid #E5E5E0",
        fontSize: sp(11), color: "#888", textAlign: "center", letterSpacing: 2,
        fontFamily: '"Noto Sans SC", sans-serif',
      }}>深度阅读 · {magazine}</div>
    </div>
  );
}

// ---- 正文页 v13: 修复首行/末行被遮挡 + 提高容量 ----
// 核心:
//   * 用 padding 顶部给第一行留出完整高度 (避免 overflow 切上半)
//   * 用 padding 底部同理
//   * fontSize 16 → 15.5, lineHeight 1.92 → 1.88 提升单页容量
function XHSContentPage({ innerRef, blocks, pageIndex, totalPages, showHeader, articleTitle, pubDate, authorLine, isLast }) {
  const PAGE_NUM_AREA = 68;
  return (
    <div
      ref={innerRef}
      style={{
        width: CARD_W, height: CARD_H,
        padding: "34px 32px 0",
        paddingBottom: PAGE_NUM_AREA,
        background: "#FAFAF7", color: "#1A1A1A",
        fontFamily: '"Noto Serif SC", "Songti SC", "SimSun", serif',
        display: "flex", flexDirection: "column",
        boxShadow: "0 8px 32px rgba(0,0,0,0.08)", borderRadius: 18,
        position: "relative", overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* 首页标题区 */}
      {showHeader && (
        <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #E5E5E0", flexShrink: 0 }}>
          <div style={{
            fontSize: 22, fontWeight: 800, lineHeight: 1.38, color: "#1A1A1A",
            fontFamily: '"Noto Serif SC", serif', marginBottom: 8,
          }}>{articleTitle}</div>
          <div style={{
            fontSize: 12, color: "#888", letterSpacing: 0.5,
            fontFamily: '"Noto Sans SC", sans-serif',
          }}>三联生活周刊</div>
        </div>
      )}

      {/* 正文 - v14: 行高从 1.88 → 1.78, 每页可多放 2-3 行, 消除下方大片空白 */}
      <div style={{
        flex: 1, minHeight: 0, overflow: "hidden",
        fontSize: 15.5, lineHeight: 1.78,
        paddingTop: 10,
        paddingBottom: 6,
      }}>
        {blocks.map((b, i) => {
          if (b.type === "heading") {
            const fz = b.level <= 2 ? 18 : 16.5;
            return (
              <div key={i} style={{
                fontSize: fz, fontWeight: 700, color: "#1A1A1A",
                marginTop: i === 0 ? 0 : 14, marginBottom: 8,
                letterSpacing: 0.3, lineHeight: 1.5,
                fontFamily: '"Noto Sans SC", -apple-system, sans-serif',
              }}>{renderInlineMarkdown(b.text)}</div>
            );
          }
          return (
            <p key={i} style={{
              margin: b.isContinuation ? "0 0 10px 0" : "0 0 10px 0",
              textAlign: "justify",
              color: "#2A2A2A",
              textIndent: b.isContinuation ? "0" : "2em",
            }}>{renderInlineMarkdown(b.text)}</p>
          );
        })}
      </div>

      {/* 最后一页的 作者+原刊 */}
      {isLast && authorLine && (authorLine.author || authorLine.source) && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: "1px solid #E5E5E0",
          fontSize: 12, color: "#666", lineHeight: 1.7,
          fontFamily: '"Noto Sans SC", sans-serif', flexShrink: 0,
        }}>
          {authorLine.author && <div>{authorLine.author}</div>}
          {authorLine.source && <div style={{ fontStyle: "italic", color: "#888", marginTop: 2 }}>{authorLine.source}</div>}
        </div>
      )}

      {/* 页码 */}
      <div style={{
        position: "absolute", bottom: 20, left: 0, right: 0,
        textAlign: "center", fontSize: 11, color: "#B5B5B5",
        letterSpacing: 2,
        fontFamily: '"Noto Sans SC", sans-serif',
      }}>{pageIndex + 1} / {totalPages}</div>
    </div>
  );
}

// ---- 手机真机笔记预览 v9 ----
// 核心修复:
//   1. 封面区不再用 scale, 而是给 XHSCoverLongForm 一个 prop 让它直接生成手机尺寸的封面
//      避免缩放时底部 borderTop 被遮
//   2. 文案区不显示 tag (真机展示顺序:标题→正文→最后滑到底才见 tag)
//   3. 标题最多 2 行, 正文最多 3 行 (接近真机首屏效果)
function XHSNotePreview({
  innerRef, xhsTitle, caption, tags, hook, articleTitle, magazine = "三联生活周刊",
  isShort = false, summary = "",  // v15: 短新闻模式
}) {
  const PHONE_SCALE = 0.72;

  // 封面区: 宽度跟手机内容区同宽, 高度按 3:4
  const COVER_W = PHONE_W;
  const COVER_H = Math.round(PHONE_W * 4 / 3);

  return (
    <div style={{
      display: "flex", justifyContent: "center", alignItems: "flex-start",
      height: PHONE_H * PHONE_SCALE + 10,
    }}>
      <div
        ref={innerRef}
        style={{
          width: PHONE_W, height: PHONE_H, background: "#fff",
          fontFamily: '-apple-system, "PingFang SC", "Noto Sans SC", sans-serif',
          display: "flex", flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.12)",
          borderRadius: 40, overflow: "hidden",
          border: `8px solid #1a1a1a`,
          boxSizing: "border-box",
          position: "relative",
          transform: `scale(${PHONE_SCALE})`,
          transformOrigin: "top center",
        }}
      >
        {/* 状态栏 */}
        <div style={{
          height: 28, background: "#fff",
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          padding: "0 20px", fontSize: 12, color: "#000",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 12 }}>📶 5G 📡</span>
        </div>

        {/* 顶栏 */}
        <div style={{
          padding: "6px 14px", display: "flex", alignItems: "center",
          justifyContent: "space-between", borderBottom: `1px solid ${palette.border}`,
          background: "#fff", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>‹</span>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", background: palette.red,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 8, fontWeight: 800, lineHeight: 1.1, textAlign: "center",
            }}>三联<br/>生活</div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{magazine}</div>
          </div>
          <button style={{
            padding: "3px 12px", borderRadius: 12, border: `1px solid ${palette.red}`,
            color: palette.red, fontSize: 10, background: "#fff", fontWeight: 600,
          }}>+ 关注</button>
        </div>

        {/* 封面区 —— v15: 短新闻用 ShortNewsCover, 长文用 XHSCoverLongForm */}
        <div style={{
          flexShrink: 0,
          width: COVER_W, height: COVER_H,
          position: "relative",
          borderBottom: `1px solid ${palette.border}`,
          background: "#FAFAF7",
        }}>
          {isShort ? (
            <ShortNewsCover
              compactMode={true}
              compactW={COVER_W}
              compactH={COVER_H}
              title={xhsTitle}
              summary={summary || caption}
              tag="热点速递"
            />
          ) : (
            <XHSCoverLongForm
              compactMode={true}
              compactW={COVER_W}
              compactH={COVER_H}
              hook={hook || xhsTitle}
              xhsTitle={xhsTitle}
              articleTitle={articleTitle}
              pubDate=""
            />
          )}
          {/* 页数指示器 */}
          <div style={{
            position: "absolute", bottom: 10, right: 12,
            fontSize: 10, color: "#666", background: "rgba(255,255,255,0.9)",
            padding: "2px 8px", borderRadius: 8,
            fontFamily: '"Noto Sans SC", sans-serif',
            zIndex: 2,
          }}>1/N</div>
        </div>

        {/* 文案区 —— v10: 字号再加大 */}
        <div style={{
          padding: "12px 14px 8px", flex: 1, overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{
            fontSize: 17, fontWeight: 700, marginBottom: 8, lineHeight: 1.4,
            color: palette.text,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>{xhsTitle}</div>
          <div style={{
            fontSize: 14.5, lineHeight: 1.75, color: "#333",
            whiteSpace: "pre-wrap", flex: 1, overflow: "hidden",
            display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical",
          }}>{caption}</div>
          <div style={{
            fontSize: 11, color: palette.textTri, marginTop: 4,
            fontFamily: '"Noto Sans SC", sans-serif',
          }}>... 展开</div>
        </div>

        {/* 底部互动栏 */}
        <div style={{
          padding: "8px 14px", borderTop: `1px solid ${palette.border}`,
          display: "flex", justifyContent: "space-around", background: "#fafafa",
          flexShrink: 0,
        }}>
          {[
            { icon: "♡", txt: "208" },
            { icon: "☆", txt: "23" },
            { icon: "💬", txt: "45" },
            { icon: "↗", txt: "分享" },
          ].map((b, i) => (
            <div key={i} style={{ textAlign: "center", fontSize: 10, color: palette.textSec }}>
              <div style={{ fontSize: 16 }}>{b.icon}</div>
              <div>{b.txt}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- 分页逻辑 ----
// v11: 段落拆分 —— 保证每个子段长度不超过 maxLen, 优先中文句末标点,
//      其次逗号分号,实在不行直接硬切(绝不允许超长)
// v12: 段落拆分 —— 优先找 [maxLen*0.4, maxLen] 区间内**最靠后**的标点,找不到才硬切
function splitLongParagraph(text, maxLen) {
  if (!text || text.length <= maxLen) return [text];
  const chunks = [];
  let rest = text;

  while (rest.length > maxLen) {
    // v12: 搜索区扩大到 [maxLen*0.4, maxLen], 保证一定能找到中文标点
    const lo = Math.floor(maxLen * 0.4);
    const hi = maxLen;
    const search = rest.slice(lo, hi + 1);

    let breakAt = -1;

    // 优先级 1: 句末标点
    const p1 = /[。!?…][""」』]?/g;
    let m, lastIdx = -1;
    while ((m = p1.exec(search)) !== null) lastIdx = m.index + m[0].length;
    if (lastIdx > 0) breakAt = lo + lastIdx;

    // 优先级 2: 分号/逗号
    if (breakAt < 0) {
      const p2 = /[;,;,]/g;
      lastIdx = -1;
      while ((m = p2.exec(search)) !== null) lastIdx = m.index + 1;
      if (lastIdx > 0) breakAt = lo + lastIdx;
    }

    // 优先级 3: 顿号
    if (breakAt < 0) {
      const p3 = /、/g;
      lastIdx = -1;
      while ((m = p3.exec(search)) !== null) lastIdx = m.index + 1;
      if (lastIdx > 0) breakAt = lo + lastIdx;
    }

    // 优先级 4: 空白/破折号
    if (breakAt < 0) {
      const p4 = /[\s—-]/g;
      lastIdx = -1;
      while ((m = p4.exec(search)) !== null) lastIdx = m.index + 1;
      if (lastIdx > 0) breakAt = lo + lastIdx;
    }

    // 兜底硬切
    if (breakAt < 0) breakAt = maxLen;

    chunks.push(rest.slice(0, breakAt));
    rest = rest.slice(breakAt);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// v13: paginateBlocks —— 按行数估算容量 (字数 cap 不准, 因为段落数不同占的行数不同)
//
// 容量模型:
//   正文区高度 444px, 每行 30px (fontSize 16 * lineHeight 1.88)
//   每行中文字 ≈ 21 字
//   每段末 margin 12px = 0.4 行开销
//   首页要减去 header 占的 3 行
//
// 所以:
//   maxLines 非首页 = 14 行
//   maxLines 首页 = 11 行
//   每段开销 = ceil(text.length / CHARS_PER_LINE) + 0.4 (段间 margin)
//
// 续段 isContinuation: 不算段间 margin, 紧贴上段
function paginateBlocks(blocks, opts = {}) {
  // v14: 重新计算容量
  //   正文区高度: 552 - 34(顶) - 68(底页码区) - 10(内顶padding) - 6(内底padding) = 434px
  //   首页多扣 header: 22*1.38 + 8 + 14 + 12 + 1 ≈ 65px → 实际正文 ~370px
  //   每行 15.5 * 1.78 = 27.6px
  //   非首页 = floor(434 / 27.6) = 15 行
  //   首页  = floor(370 / 27.6) = 13 行
  const CHARS_PER_LINE = opts.charsPerLine || 22;
  const FIRST_MAX_LINES = opts.firstMaxLines || 13;
  const MAX_LINES = opts.maxLines || 15;
  const HEADING_LINES = opts.headingLines || 1.6;
  const PARA_MARGIN = 0.35;

  // 每段/每标题占多少行
  const linesFor = (b) => {
    if (b.type === "heading") return HEADING_LINES;
    // 计算段落行数: 首行缩进 32px 约占 1.5 字, 所以首行少 2 字
    const text = b.text || "";
    // 数清段内强制换行 (用户 \n)
    const hardBreaks = (text.match(/\n/g) || []).length;
    const plainText = text.replace(/\n/g, "");
    const firstLine = Math.min(plainText.length, CHARS_PER_LINE - 2);  // 首行缩进
    const restChars = plainText.length - firstLine;
    const restLines = Math.ceil(restChars / CHARS_PER_LINE);
    const indent = b.isContinuation ? 0 : 0;  // 续段不算缩进差异, 因为都从行首开始
    const totalLines = 1 + Math.max(0, restLines) + hardBreaks +
                       (b.isContinuation ? 0 : PARA_MARGIN);
    return totalLines;
  };

  // 按行切一段: 给定剩余行数, 返回能塞多少字
  const fitCharsInLines = (text, availLines, isContinuation) => {
    // 续段不算缩进差异
    const firstLineCap = isContinuation ? CHARS_PER_LINE : CHARS_PER_LINE - 2;
    if (availLines < 1) return 0;
    if (availLines < 2) return Math.min(firstLineCap, text.length);
    const fullLines = Math.floor(availLines);
    return firstLineCap + (fullLines - 1) * CHARS_PER_LINE;
  };

  const pages = [];
  let buf = [];
  let usedLines = 0;
  let isFirstPage = true;

  const flush = () => {
    if (buf.length) {
      pages.push(buf);
      buf = [];
      usedLines = 0;
      isFirstPage = false;
    }
  };

  const curMax = () => isFirstPage ? FIRST_MAX_LINES : MAX_LINES;
  const MIN_CHARS_TO_SPLIT = 15;  // 剩余空间能放至少 15 字才值得切一段进来

  let queue = blocks.map(b => ({...b}));
  let qi = 0;

  while (qi < queue.length) {
    const b = queue[qi];
    const need = linesFor(b);
    const remaining = curMax() - usedLines;

    if (need <= remaining + 0.01) {
      // 放得下
      buf.push(b);
      usedLines += need;
      qi++;
    } else if (b.type === "heading") {
      // 小标题不拆, 换页
      flush();
    } else {
      // paragraph 太长, 按剩余行数切一部分
      const availLines = remaining - PARA_MARGIN * (b.isContinuation ? 0 : 1);
      const fitChars = fitCharsInLines(b.text, availLines, b.isContinuation);
      if (fitChars < MIN_CHARS_TO_SPLIT) {
        // 剩余空间放不下有意义的内容 → 直接换页
        flush();
      } else {
        // 按 fitChars 切
        const parts = splitLongParagraph(b.text, fitChars);
        buf.push({
          type: "paragraph",
          text: parts[0],
          isContinuation: b.isContinuation || false,
        });
        // 剩余的塞回队列作为续段
        if (parts.length > 1) {
          queue.splice(qi + 1, 0, {
            type: "paragraph",
            text: parts.slice(1).join(""),
            isContinuation: true,
          });
        }
        qi++;
        flush();
      }
    }
  }
  flush();
  return pages.length > 0 ? pages : [[]];
}

// ============================================================
// 【实时热点】页 - 手风琴展开
// ============================================================
function HotTopicsPage({ weiboHot, loading, onRefresh }) {
  const [expandedId, setExpandedId] = useState(null);
  const [kw, setKw] = useState("");

  const filtered = useMemo(() => {
    if (!kw.trim()) return weiboHot;
    const k = kw.trim().toLowerCase();
    return weiboHot.filter((w) =>
      (w.title || "").toLowerCase().includes(k) ||
      (w.ai_summary || "").toLowerCase().includes(k)
    );
  }, [weiboHot, kw]);

  return (
    <div>
      <SectionHeader
        icon="🔥"
        title="实时热点"
        subtitle={`微博热搜 · 共 ${weiboHot.length} 条  (点击条目展开查看 AI 智搜详情)`}
        action={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              value={kw} onChange={(e) => setKw(e.target.value)}
              placeholder="🔍 搜索关键词..."
              style={{
                padding: "9px 14px", border: `1px solid ${palette.border}`,
                borderRadius: 10, fontSize: 13, width: 240, outline: "none",
                fontFamily: "'Noto Sans SC'", background: palette.card,
              }}
            />
            <Btn variant="secondary" onClick={onRefresh} disabled={loading}>
              {loading ? <Spinner size={14} /> : "🔄"} 刷新
            </Btn>
          </div>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon="🔥"
          title={weiboHot.length === 0 ? "还没有微博热搜数据" : "没有匹配的结果"}
          desc={weiboHot.length === 0 ? "请到仪表盘点击「启动微博爬虫」,或上传本地的 JSON 备份文件" : "换个关键词试试"}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((item, idx) => {
            const isOpen = expandedId === item.id;
            return (
              <div
                key={item.id || idx}
                style={{
                  background: palette.card,
                  border: `1px solid ${isOpen ? palette.red : palette.border}`,
                  borderRadius: 14, overflow: "hidden",
                  transition: "all 0.2s",
                  boxShadow: isOpen ? "0 4px 16px rgba(255,36,66,0.08)" : "none",
                }}
              >
                {/* 主栏 - 可点 */}
                <div
                  onClick={() => setExpandedId(isOpen ? null : item.id)}
                  style={{
                    padding: "14px 18px", cursor: "pointer",
                    display: "flex", alignItems: "flex-start", gap: 14,
                  }}
                >
                  <RankBadge rank={item.rank} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 15, fontWeight: 600, color: palette.text,
                      marginBottom: 8, lineHeight: 1.45,
                      fontFamily: "'Noto Serif SC'",
                    }}>{item.title}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {item.heat && <Pill color="#FEF3C7" textColor="#92400E">🔥 {item.heat}</Pill>}
                      {item.read_count && <Pill color="#DBEAFE" textColor="#1E40AF">👁 {item.read_count}</Pill>}
                      {item.ai_summary && <Pill color="#D1FAE5" textColor="#065F46">🤖 AI智搜</Pill>}
                      {item.url && (
                        <a
                          href={item.url} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 12, color: palette.blue, textDecoration: "none" }}
                        >↗ 跳转</a>
                      )}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 18, color: palette.textTri,
                    transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.2s",
                  }}>›</div>
                </div>

                {/* 展开详情 */}
                {isOpen && (
                  <div style={{
                    padding: "16px 20px 20px",
                    background: palette.cardAlt,
                    borderTop: `1px solid ${palette.border}`,
                  }}>
                    {item.ai_summary ? (
                      <>
                        <div style={{
                          fontSize: 12, fontWeight: 600, color: palette.red,
                          marginBottom: 10, letterSpacing: 0.5,
                          fontFamily: "'Noto Sans SC'",
                        }}>🤖 AI 智搜摘要</div>
                        <div style={{
                          fontSize: 14, lineHeight: 2, color: palette.text,
                          fontFamily: "'Noto Serif SC', serif",
                          padding: "14px 18px",
                          background: "#fff", borderRadius: 10,
                          border: `1px solid ${palette.border}`,
                          maxHeight: 420, overflowY: "auto",
                        }}>
                          {segmentSmartSummary(item.ai_summary).map((para, pi) => (
                            <p key={pi} style={{
                              margin: pi === 0 ? 0 : "10px 0 0 0",
                              textAlign: "justify",
                            }}>{renderInlineMarkdown(para)}</p>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: palette.textTri, textAlign: "center", padding: 16 }}>
                        {item.ai_summary_status || "本条没有 AI 智搜摘要"}
                      </div>
                    )}
                    <div style={{
                      marginTop: 10, fontSize: 11, color: palette.textTri,
                      display: "flex", gap: 12, flexWrap: "wrap",
                    }}>
                      {item.crawled_at && <span>🕐 爬取时间: {String(item.crawled_at).slice(0, 19).replace("T", " ")}</span>}
                      {item.batch_id && <span>🏷 批次: {item.batch_id}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 【文章库】页 - 点击进入详情页
// ============================================================
function ArticlesPage({ articles, loading, onRefresh, onOpenArticle }) {
  const [kw, setKw] = useState("");
  const [year, setYear] = useState("all");

  const years = useMemo(() => {
    const s = new Set();
    articles.forEach((a) => {
      const y = (a.pub_date || "").slice(0, 4);
      if (y && /^\d{4}$/.test(y)) s.add(y);
    });
    return ["all", ...[...s].sort().reverse()];
  }, [articles]);

  const filtered = useMemo(() => {
    let list = articles;
    if (year !== "all") list = list.filter((a) => (a.pub_date || "").slice(0, 4) === year);
    if (kw.trim()) {
      const k = kw.trim().toLowerCase();
      list = list.filter((a) =>
        (a.title || "").toLowerCase().includes(k) ||
        (a.summary || "").toLowerCase().includes(k)
      );
    }
    return list;
  }, [articles, kw, year]);

  return (
    <div>
      <SectionHeader
        icon="📚"
        title="文章库"
        subtitle={`三联历史文章 · 共 ${articles.length} 篇,当前筛选 ${filtered.length} 篇  (点击查看原文)`}
        color={palette.blue}
        action={
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={year} onChange={(e) => setYear(e.target.value)}
              style={{
                padding: "9px 12px", border: `1px solid ${palette.border}`,
                borderRadius: 10, fontSize: 13, outline: "none",
                background: palette.card, fontFamily: "'Noto Sans SC'",
              }}
            >
              {years.map((y) => <option key={y} value={y}>{y === "all" ? "全部年份" : `${y}年`}</option>)}
            </select>
            <input
              value={kw} onChange={(e) => setKw(e.target.value)}
              placeholder="🔍 搜索标题或摘要..."
              style={{
                padding: "9px 14px", border: `1px solid ${palette.border}`,
                borderRadius: 10, fontSize: 13, width: 240, outline: "none",
                fontFamily: "'Noto Sans SC'", background: palette.card,
              }}
            />
            <Btn variant="secondary" onClick={onRefresh} disabled={loading}>
              {loading ? <Spinner size={14} /> : "🔄"} 刷新
            </Btn>
          </div>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon="📚"
          title={articles.length === 0 ? "文章库是空的" : "没有匹配的文章"}
          desc={articles.length === 0 ? "请确认 Supabase 的 articles 表已有数据" : "试试换个关键词或年份"}
        />
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 14,
        }}>
          {filtered.slice(0, 600).map((a) => (
            <div
              key={a.id}
              onClick={() => onOpenArticle(a)}
              style={{
                background: palette.card, border: `1px solid ${palette.border}`,
                borderRadius: 14, padding: 18, cursor: "pointer",
                transition: "all 0.2s", display: "flex", flexDirection: "column", gap: 8,
                minHeight: 150,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.06)";
                e.currentTarget.style.borderColor = palette.red;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "";
                e.currentTarget.style.boxShadow = "";
                e.currentTarget.style.borderColor = palette.border;
              }}
            >
              <div style={{
                fontSize: 11, color: palette.textTri, letterSpacing: 0.5,
                fontFamily: "'Noto Sans SC'",
              }}>{formatPubDate(a.pub_date)}</div>
              <div style={{
                fontSize: 16, fontWeight: 700, color: palette.text,
                lineHeight: 1.4, fontFamily: "'Noto Serif SC'",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}>{a.title}</div>
              <div style={{
                fontSize: 13, color: palette.textSec, lineHeight: 1.7,
                display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                overflow: "hidden", flex: 1,
              }}>{a.summary || "(无摘要)"}</div>
              <div style={{
                fontSize: 11, color: palette.red, marginTop: 4, fontWeight: 500,
              }}>查看原文 →</div>
            </div>
          ))}
        </div>
      )}
      {filtered.length > 600 && (
        <div style={{ textAlign: "center", padding: 20, color: palette.textTri, fontSize: 12 }}>
          为避免卡顿,仅显示前 600 篇,请用筛选或搜索缩小范围
        </div>
      )}
    </div>
  );
}

// ============================================================
// 【文章详情】页
// ============================================================
function ArticleDetailPage({ article, onBack, onPickForGenerate }) {
  const blocks = useMemo(() => parseArticleBlocks(article.content_md || ""), [article]);
  const author = extractAuthorInfo(article.content_md || "");

  return (
    <div style={{ maxWidth: 780, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <Btn variant="secondary" onClick={onBack}>← 返回文章库</Btn>
        {onPickForGenerate && (
          <Btn variant="primary" onClick={() => onPickForGenerate(article)}>
            ✍️ 用这篇文章生成内容 →
          </Btn>
        )}
      </div>

      <div style={{
        background: "#FAFAF7", borderRadius: 18,
        padding: "48px 56px",
        border: `1px solid ${palette.border}`,
        fontFamily: '"Noto Serif SC", "Songti SC", serif',
        lineHeight: 1.95,
      }}>
        {/* 标题 */}
        <h1 style={{
          fontSize: 32, fontWeight: 800, color: palette.text,
          margin: 0, marginBottom: 14, lineHeight: 1.4,
          fontFamily: '"Noto Serif SC", serif',
        }}>{article.title}</h1>
        <div style={{
          fontSize: 13, color: palette.textTri, marginBottom: 30,
          paddingBottom: 20, borderBottom: `1px solid ${palette.border}`,
          fontFamily: '"Noto Sans SC", sans-serif',
        }}>
          三联生活周刊 · {formatPubDate(article.pub_date)}
          {author && <span> · {author}</span>}
        </div>

        {/* 摘要 */}
        {article.summary && (
          <div style={{
            padding: "16px 20px", marginBottom: 30,
            background: palette.warm, borderRadius: 10,
            fontSize: 14.5, color: palette.textSec, lineHeight: 1.9,
            borderLeft: `3px solid ${palette.red}`,
          }}>{article.summary}</div>
        )}

        {/* 正文 */}
        <div style={{ fontSize: 16.5, color: "#2A2A2A" }}>
          {blocks.length === 0 ? (
            <div style={{ color: palette.textTri, textAlign: "center", padding: 40 }}>
              (本篇文章没有正文内容)
            </div>
          ) : blocks.map((b, i) => {
            if (b.type === "heading") {
              const fz = b.level <= 2 ? 22 : 18.5;
              return (
                <h3 key={i} style={{
                  fontSize: fz, fontWeight: 700, color: palette.text,
                  margin: "32px 0 14px", fontFamily: '"Noto Sans SC", sans-serif',
                }}>{renderInlineMarkdown(b.text)}</h3>
              );
            }
            return (
              <p key={i} style={{
                margin: "0 0 18px 0", textAlign: "justify", textIndent: "2em",
              }}>{renderInlineMarkdown(b.text)}</p>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 【AI 匹配推荐】页
// ============================================================

// 推荐卡片 - 长文型
function LongMatchCard({ rec, article, hotTopic, onPick }) {
  const [expanded, setExpanded] = useState(false);
  if (!article) return null;
  const score = Math.round((rec.match_score || 0) * 100);
  const scoreColor = score >= 85 ? palette.green : score >= 70 ? palette.orange : palette.textSec;

  return (
    <div style={{
      background: palette.card, borderRadius: 16,
      border: `1px solid ${palette.border}`,
      padding: 22, marginBottom: 14,
      transition: "all 0.2s",
    }}>
      {/* 顶部: 分数 + 热点 */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        marginBottom: 14, gap: 16, flexWrap: "wrap",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "6px 14px", borderRadius: 100,
          background: `${scoreColor}12`, color: scoreColor,
          fontSize: 13, fontWeight: 700,
        }}>
          ⭐ 匹配度 {score}%
        </div>
        {hotTopic && (
          <Pill color="#FFF2E4" textColor={palette.orange}>
            🔥 关联热搜: {hotTopic.title?.slice(0, 30)}{hotTopic.title?.length > 30 ? "..." : ""}
          </Pill>
        )}
      </div>

      {/* 文章 */}
      <div style={{
        padding: "14px 18px", background: palette.warm, borderRadius: 12,
        marginBottom: 14, borderLeft: `3px solid ${palette.blue}`,
      }}>
        <div style={{ fontSize: 11, color: palette.textTri, marginBottom: 4 }}>
          📖 三联历史文章 · {formatPubDate(article.pub_date)}
        </div>
        <div style={{
          fontSize: 17, fontWeight: 700, color: palette.text, lineHeight: 1.45,
          fontFamily: "'Noto Serif SC'",
        }}>《{article.title}》</div>
        {article.summary && (
          <div style={{
            fontSize: 13, color: palette.textSec, lineHeight: 1.8, marginTop: 8,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{article.summary}</div>
        )}
      </div>

      {/* 推荐理由 - v16: 支持 **加粗** + 清理孤立 ** */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 6, fontWeight: 500 }}>💡 推荐理由</div>
        <div style={{
          fontSize: 14, color: palette.text, lineHeight: 1.85,
          fontFamily: "'Noto Serif SC', serif",
        }}>{renderInlineMarkdown(rec.reason)}</div>
      </div>

      {/* 可展开的热点详情 - v16: 分段显示 */}
      {hotTopic?.ai_summary && (
        <div style={{ marginBottom: 14 }}>
          <div
            onClick={() => setExpanded(!expanded)}
            style={{
              fontSize: 12, color: palette.red, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 500,
            }}
          >
            {expanded ? "▼" : "▶"} {expanded ? "收起" : "展开"} 热点 AI 智搜详情
          </div>
          {expanded && (
            <div style={{
              marginTop: 8, padding: "12px 16px",
              background: palette.cardAlt, borderRadius: 10,
              fontSize: 13, lineHeight: 1.85, color: palette.textSec,
              maxHeight: 260, overflowY: "auto",
              fontFamily: "'Noto Serif SC', serif",
            }}>
              {segmentSmartSummary(hotTopic.ai_summary).map((para, i) => (
                <p key={i} style={{
                  margin: i === 0 ? 0 : "10px 0 0 0",
                  textAlign: "justify",
                }}>{renderInlineMarkdown(para)}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 操作 */}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn variant="primary" onClick={() => onPick(article, hotTopic)}>
          ✍️ 用这篇生成内容 →
        </Btn>
      </div>
    </div>
  );
}

// 推荐卡片 - 短新闻型
function ShortMatchCard({ rec, hotTopic, onPick }) {
  const [expanded, setExpanded] = useState(false);
  if (!hotTopic) return null;
  const score = Math.round((rec.suitability || 0) * 100);
  const scoreColor = score >= 85 ? palette.green : score >= 70 ? palette.orange : palette.textSec;

  return (
    <div style={{
      background: palette.card, borderRadius: 16,
      border: `1px solid ${palette.border}`,
      padding: 22, marginBottom: 14,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        marginBottom: 14, gap: 16, flexWrap: "wrap",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "6px 14px", borderRadius: 100,
          background: `${scoreColor}12`, color: scoreColor,
          fontSize: 13, fontWeight: 700,
        }}>
          📰 适配度 {score}%
        </div>
        <RankBadge rank={hotTopic.rank} size={26} />
      </div>

      {/* 热搜标题 */}
      <div style={{
        padding: "14px 18px", background: palette.warm, borderRadius: 12,
        marginBottom: 14, borderLeft: `3px solid ${palette.orange}`,
      }}>
        <div style={{ fontSize: 11, color: palette.textTri, marginBottom: 4 }}>
          🔥 微博热搜
        </div>
        <div style={{
          fontSize: 17, fontWeight: 700, color: palette.text, lineHeight: 1.45,
          fontFamily: "'Noto Serif SC'",
        }}>{hotTopic.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {hotTopic.heat && <Pill color="#FEF3C7" textColor="#92400E">🔥 {hotTopic.heat}</Pill>}
          {hotTopic.read_count && <Pill color="#DBEAFE" textColor="#1E40AF">👁 {hotTopic.read_count}</Pill>}
        </div>
      </div>

      {/* 推荐理由 - v16 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 6, fontWeight: 500 }}>💡 为什么适合做短新闻</div>
        <div style={{
          fontSize: 14, color: palette.text, lineHeight: 1.85,
          fontFamily: "'Noto Serif SC', serif",
        }}>{renderInlineMarkdown(rec.reason)}</div>
      </div>

      {/* 展开热点 AI 智搜 - v16: 分段 */}
      {hotTopic.ai_summary && (
        <div style={{ marginBottom: 14 }}>
          <div
            onClick={() => setExpanded(!expanded)}
            style={{
              fontSize: 12, color: palette.red, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 500,
            }}
          >
            {expanded ? "▼" : "▶"} {expanded ? "收起" : "展开"} 热搜 AI 智搜详情
          </div>
          {expanded && (
            <div style={{
              marginTop: 8, padding: "12px 16px",
              background: palette.cardAlt, borderRadius: 10,
              fontSize: 13, lineHeight: 1.85, color: palette.textSec,
              maxHeight: 260, overflowY: "auto",
              fontFamily: "'Noto Serif SC', serif",
            }}>
              {segmentSmartSummary(hotTopic.ai_summary).map((para, i) => (
                <p key={i} style={{
                  margin: i === 0 ? 0 : "10px 0 0 0",
                  textAlign: "justify",
                }}>{renderInlineMarkdown(para)}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn variant="purple" onClick={() => onPick(hotTopic)}>
          ⚡ 生成短新闻 →
        </Btn>
      </div>
    </div>
  );
}

// AI 匹配主页
function MatchPage({
  articles, weiboHot, onPickLongForm, onPickShortNews,
  longRecs, setLongRecs, shortRecs, setShortRecs,
  lastMatchedAt, setLastMatchedAt, activeTab: tabProp, setActiveTab: setTabProp,
  matchHistory, reloadMatchHistory,
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  // 如果父层没传 tab 控制, 用本地 state 兜底
  const [localTab, setLocalTab] = useState("long");
  const activeTab = tabProp ?? localTab;
  const setActiveTab = setTabProp ?? setLocalTab;

  // v7: 匹配模式
  const [mode, setMode] = useState("auto");  // auto | custom_topic | custom_article
  const [customTopic, setCustomTopic] = useState({ title: "", summary: "" });
  const [customArticle, setCustomArticle] = useState({ title: "", content: "", pub_date: "" });
  const [showHistory, setShowHistory] = useState(false);
  const [historyDateFilter, setHistoryDateFilter] = useState("all");  // all/today/week

  const runMatch = async () => {
    // 按模式取不同数据源
    let hotForAI, articlesForAI;
    if (mode === "auto") {
      if (weiboHot.length === 0) { toast("还没有微博热搜数据,请先到仪表盘启动爬虫", "warning"); return; }
      if (articles.length === 0) { toast("文章库是空的", "warning"); return; }
      articlesForAI = articles.slice(0, 500).map((a) => ({
        id: a.id, title: a.title,
        summary: (a.summary || "").slice(0, 200),
        date: formatPubDate(a.pub_date),
      }));
      hotForAI = weiboHot.map((h, idx) => ({
        idx, rank: h.rank, title: h.title,
        summary: (h.ai_summary || "").slice(0, 400),
      }));
    } else if (mode === "custom_topic") {
      if (!customTopic.title.trim()) { toast("请输入自选话题标题", "warning"); return; }
      if (articles.length === 0) { toast("文章库是空的", "warning"); return; }
      articlesForAI = articles.slice(0, 500).map((a) => ({
        id: a.id, title: a.title,
        summary: (a.summary || "").slice(0, 200),
        date: formatPubDate(a.pub_date),
      }));
      hotForAI = [{
        idx: 0, rank: 0, title: customTopic.title,
        summary: customTopic.summary || "",
      }];
    } else {
      // custom_article 不需要 AI 匹配, 直接跳转生成
      if (!customArticle.title.trim() || !customArticle.content.trim()) {
        toast("请填写自选文章的标题和正文", "warning"); return;
      }
      const pseudoArticle = {
        id: -Date.now(),  // 用负数标识自选
        title: customArticle.title,
        content_md: customArticle.content,
        summary: customArticle.content.slice(0, 150),
        pub_date: customArticle.pub_date || new Date().toISOString(),
      };
      const pseudoTopic = customTopic.title.trim() ? {
        title: customTopic.title,
        ai_summary: customTopic.summary,
      } : null;
      onPickLongForm(pseudoArticle, pseudoTopic);
      return;
    }

    setLoading(true);
    try {
      const systemMsg = "你是《三联生活周刊》小红书账号的内容编辑,深度理解三联的严肃、人文、关怀导向。你善于把当下热点与三联历史文章联系起来,为官方账号挑选既贴合热点又能提供思想增量的内容。";

      const shortNewsInstruction = mode === "auto"
        ? `任务2 · 短新闻推荐 (3-5 条):
从今日热搜挑 3-5 条适合做短新闻图文(不绑定历史文章)。
- 是具体可陈述的事件/政策/宣布(如"某法案通过""某新规发布""某考古发现")
- 信息密度高、有时效
- 三联受众(关心公共议题、文化、深度话题的人)会感兴趣
- 回避: 纯娱乐/情绪/需要长文阐述的复杂议题`
        : `任务2 · 短新闻推荐: 自选话题模式下,不需要生成短新闻推荐,short_news 返回空数组 []`;

      const prompt = `下面有两份资料:

【A. ${mode === "auto" ? "今日微博热搜" : "自选话题"}】
${hotForAI.map((h) => `[${h.idx}] ${mode === "auto" ? "排名" + h.rank + " | " : ""}${h.title}\n  摘要: ${h.summary || "无"}`).join("\n\n")}

【B. 三联生活周刊历史文章库(最近500篇)】
${articlesForAI.map((a) => `ID=${a.id} | ${a.date} | 《${a.title}》\n  摘要: ${a.summary || "无"}`).join("\n\n")}

任务: 同时完成两件事:

任务1 · 长文推荐 (${mode === "auto" ? "3-5 篇" : "5-8 篇"}):
从历史文章库挑若干篇,${mode === "auto" ? "每篇要和某一条热搜形成深度呼应——当下事件触发,旧文给出思想背景或人文视角" : "和自选话题形成深度呼应"}。

【匹配的铁律】:
1. **话题真相关**——文章和热点必须有一个明确、具体的共同话题,而不是泛泛的"都讨论社会"。
   ❌ 错误示范: 热点是"日本军舰经台海" + 文章是"伊朗国宝在战火中来到中国" → 理由硬扯"都涉及战争与文化记忆"。实际上一个讲地缘挑衅,一个讲文物抢救,不相关。
   ✓ 正确示范: 热点是"游神仪式走红" + 文章是"年轻人扎堆去看游神" → 都在讲同一现象,直接对应。
   
2. **越直接越好**——如果有两篇文章都能勉强对应热点,优先选那篇话题**直接**的。不要为了"有深度"而选远的。

3. **内容真实对应**——仔细读热点摘要和文章摘要,确认两者的核心事件/人物/主题有实际重叠。

4. **保守起见,宁缺勿滥**——如果一条热搜找不到合适文章,**不要推荐**。宁可少给 2 条,不要给 5 条牵强的。${mode === "auto" ? "热搜有 50 条,从中挑 3-5 条**真能匹配的**就够了。" : ""}

5. **match_score 标准**: 
   - 0.9+ = 文章核心议题 = 热搜核心议题(同一事件/同一现象)
   - 0.8-0.9 = 文章议题和热搜议题是同一母题的不同侧面
   - 0.7-0.8 = 文章能从一个角度回应热搜,但不完全对应
   - < 0.7 = **别推荐**

- 话题价值: 优先社会议题、性别、劳动、城市、代际、公共事件; 回避纯娱乐八卦
- 时宜性: 文章内容现在读是否仍有相关性

${shortNewsInstruction}

严格只返回 JSON,不加 markdown 代码块标记:
{
  "recommended_articles": [
    {
      "article_id": 123,
      "hot_topic_idx": 0,
      "match_score": 0.85,
      "reason": "200-300 字中文。**首句就点明两者的共同话题是什么**,然后说文章给出了怎样的深入视角。不要打空话(如'体现了三联的人文关怀'),要具体到事实对应"
    }
  ],
  "short_news": [
    {
      "hot_topic_idx": 5,
      "suitability": 0.9,
      "reason": "100-180 字中文,说清为什么这条热搜适合做成短新闻"
    }
  ]
}`;

      const resp = await callAI(prompt, { system: systemMsg, maxTokens: 4000, temperature: 0.7 });
      let cleaned = resp.trim()
        .replace(/^```json\s*/, "").replace(/\s*```$/, "").replace(/^```\s*/, "");
      let parsed;
      try { parsed = JSON.parse(cleaned); }
      catch {
        const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
        if (s >= 0 && e > s) parsed = JSON.parse(cleaned.slice(s, e + 1));
        else throw new Error("AI 返回不是有效 JSON");
      }
      const longs = parsed.recommended_articles || [];
      const shorts = parsed.short_news || [];
      setLongRecs(longs);
      setShortRecs(shorts);
      setLastMatchedAt(new Date());
      toast(`匹配完成: ${longs.length} 篇长文 + ${shorts.length} 条短新闻`, "success");

      // 【v7】保存到 DB
      const saved = await saveMatchHistory({
        long_recs: longs, short_recs: shorts,
        mode,
        custom_topic: mode === "custom_topic" ? customTopic : null,
      });
      if (saved && reloadMatchHistory) reloadMatchHistory();
    } catch (e) {
      console.error(e);
      toast(`AI 匹配失败: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // 载入历史匹配的某一次
  const restoreHistory = (h) => {
    setLongRecs(h.long_recs || []);
    setShortRecs(h.short_recs || []);
    setLastMatchedAt(new Date(h.matched_at));
    setShowHistory(false);
    toast(`已载入 ${fmtBeijing(h.matched_at)} 的匹配结果`, "success");
  };

  // 历史按日期筛选
  const filteredHistory = useMemo(() => {
    if (!matchHistory) return [];
    if (historyDateFilter === "all") return matchHistory;
    const now = Date.now();
    const limits = { today: 24 * 3600 * 1000, week: 7 * 24 * 3600 * 1000, month: 30 * 24 * 3600 * 1000 };
    const lim = limits[historyDateFilter];
    return matchHistory.filter((h) => now - new Date(h.matched_at).getTime() <= lim);
  }, [matchHistory, historyDateFilter]);

  return (
    <div>
      <SectionHeader
        icon="✨"
        title="AI 匹配推荐"
        subtitle={lastMatchedAt
          ? `上次匹配于 ${fmtBeijing(lastMatchedAt)} · 长文 ${longRecs.length} 篇 / 短新闻 ${shortRecs.length} 条`
          : "AI 将同时推荐适合做旧文重温的长文 和 适合做短新闻的实时热搜"
        }
        color={palette.orange}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)}>
              📜 历史匹配 ({matchHistory?.length || 0})
            </Btn>
            <Btn variant="primary" onClick={runMatch} disabled={loading} loading={loading}>
              {loading ? "AI 分析中..." : mode === "custom_article" ? "🚀 直接生成" : "🚀 开始 AI 匹配"}
            </Btn>
          </div>
        }
      />

      {/* v7: 模式切换器 */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 18, padding: 4,
        background: palette.card, borderRadius: 12, border: `1px solid ${palette.border}`,
        maxWidth: 620,
      }}>
        {[
          { key: "auto", label: "🤖 AI 自动匹配", desc: "用今日微博热搜" },
          { key: "custom_topic", label: "✍️ 自选话题", desc: "手动输入话题,匹配文章" },
          { key: "custom_article", label: "📄 自选文章", desc: "上传自己的文章,直接生成" },
        ].map((m) => (
          <div key={m.key}
            onClick={() => setMode(m.key)}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 8, cursor: "pointer",
              textAlign: "center", transition: "all .15s",
              background: mode === m.key ? gradPrimary : "transparent",
              color: mode === m.key ? "#fff" : palette.textSec,
              fontFamily: "'Noto Sans SC'",
            }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</div>
            <div style={{ fontSize: 10.5, opacity: 0.85, marginTop: 2 }}>{m.desc}</div>
          </div>
        ))}
      </div>

      {/* v7: 自选话题表单 */}
      {mode === "custom_topic" && (
        <div style={{
          padding: 20, marginBottom: 18, background: palette.card,
          border: `1px solid ${palette.border}`, borderRadius: 14,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14, color: palette.text }}>
            ✍️ 自选话题 — AI 将从文章库匹配相关文章
          </div>
          <input
            value={customTopic.title}
            onChange={(e) => setCustomTopic({ ...customTopic, title: e.target.value })}
            placeholder="话题标题,如:女性生理期在公共空间的困境"
            style={{
              width: "100%", padding: "10px 14px", fontSize: 14,
              border: `1px solid ${palette.borderMed}`, borderRadius: 8, marginBottom: 10,
              fontFamily: "'Noto Sans SC'", outline: "none", boxSizing: "border-box",
            }}
          />
          <textarea
            value={customTopic.summary}
            onChange={(e) => setCustomTopic({ ...customTopic, summary: e.target.value })}
            placeholder="话题背景/补充说明(可选),如:近日XX事件引发公共讨论..."
            rows={3}
            style={{
              width: "100%", padding: "10px 14px", fontSize: 13,
              border: `1px solid ${palette.borderMed}`, borderRadius: 8,
              fontFamily: "'Noto Sans SC'", outline: "none", boxSizing: "border-box", resize: "vertical",
            }}
          />
        </div>
      )}

      {/* v7: 自选文章表单 */}
      {mode === "custom_article" && (
        <div style={{
          padding: 20, marginBottom: 18, background: palette.card,
          border: `1px solid ${palette.border}`, borderRadius: 14,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14, color: palette.text }}>
            📄 自选文章 — 跳过匹配,直接进入内容生成
          </div>
          <input
            value={customArticle.title}
            onChange={(e) => setCustomArticle({ ...customArticle, title: e.target.value })}
            placeholder="文章标题,如:改造一座女性友好厕所,增加厕位数就够了吗?"
            style={{
              width: "100%", padding: "10px 14px", fontSize: 14,
              border: `1px solid ${palette.borderMed}`, borderRadius: 8, marginBottom: 10,
              fontFamily: "'Noto Sans SC'", outline: "none", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <input
              value={customArticle.pub_date}
              onChange={(e) => setCustomArticle({ ...customArticle, pub_date: e.target.value })}
              placeholder="发表时间(可选),如 2023-07 或 2023-07-15"
              style={{
                flex: 1, padding: "10px 14px", fontSize: 13,
                border: `1px solid ${palette.borderMed}`, borderRadius: 8,
                fontFamily: "'Noto Sans SC'", outline: "none", boxSizing: "border-box",
              }}
            />
            <label style={{
              padding: "10px 16px", border: `1px dashed ${palette.borderMed}`,
              borderRadius: 8, cursor: "pointer", fontSize: 13, color: palette.textSec,
              background: palette.warm,
            }}>
              📁 上传 .txt/.md
              <input type="file" accept=".txt,.md,.markdown" style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const text = await f.text();
                  setCustomArticle({
                    ...customArticle,
                    content: text,
                    title: customArticle.title || f.name.replace(/\.(txt|md|markdown)$/, ""),
                  });
                  toast(`✅ 已读入 ${text.length} 字`, "success");
                }}
              />
            </label>
          </div>
          <textarea
            value={customArticle.content}
            onChange={(e) => setCustomArticle({ ...customArticle, content: e.target.value })}
            placeholder="文章正文(支持 Markdown)..."
            rows={10}
            style={{
              width: "100%", padding: "12px 14px", fontSize: 13, lineHeight: 1.8,
              border: `1px solid ${palette.borderMed}`, borderRadius: 8,
              fontFamily: "'Noto Serif SC', serif", outline: "none", boxSizing: "border-box", resize: "vertical",
            }}
          />
          <div style={{ marginTop: 12, padding: 12, background: palette.cardAlt, borderRadius: 8, fontSize: 12, color: palette.textSec }}>
            💡 可选:也可以在上方"自选话题"填入关联的热点话题,生成时 AI 会参考
          </div>
          {mode === "custom_article" && (
            <input
              value={customTopic.title}
              onChange={(e) => setCustomTopic({ ...customTopic, title: e.target.value })}
              placeholder="(可选) 关联热点话题标题"
              style={{
                width: "100%", marginTop: 10, padding: "9px 14px", fontSize: 13,
                border: `1px solid ${palette.borderMed}`, borderRadius: 8,
                fontFamily: "'Noto Sans SC'", outline: "none", boxSizing: "border-box",
              }}
            />
          )}
        </div>
      )}

      {/* v7: 历史匹配面板 */}
      {showHistory && (
        <div style={{
          padding: 20, marginBottom: 18, background: palette.card,
          border: `1px solid ${palette.border}`, borderRadius: 14,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: palette.text }}>📜 历史匹配记录</div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {[
                { key: "all", label: "全部" },
                { key: "today", label: "今天" },
                { key: "week", label: "近7天" },
                { key: "month", label: "近30天" },
              ].map((f) => (
                <div key={f.key}
                  onClick={() => setHistoryDateFilter(f.key)}
                  style={{
                    padding: "4px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                    background: historyDateFilter === f.key ? palette.red : "transparent",
                    color: historyDateFilter === f.key ? "#fff" : palette.textSec,
                    border: `1px solid ${historyDateFilter === f.key ? palette.red : palette.border}`,
                    fontFamily: "'Noto Sans SC'",
                  }}>{f.label}</div>
              ))}
            </div>
          </div>
          {filteredHistory.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: palette.textTri, fontSize: 13 }}>
              还没有保存的历史匹配记录
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 380, overflowY: "auto" }}>
              {filteredHistory.map((h) => {
                const meta = (() => { try { return JSON.parse(h.note || "{}"); } catch { return {}; } })();
                return (
                  <div key={h.id}
                    onClick={() => restoreHistory(h)}
                    style={{
                      padding: "10px 14px", background: palette.cardAlt, borderRadius: 8,
                      border: `1px solid ${palette.border}`, cursor: "pointer",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = palette.warm}
                    onMouseLeave={(e) => e.currentTarget.style.background = palette.cardAlt}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: palette.text }}>
                        {fmtBeijing(h.matched_at)}
                        {meta.mode && meta.mode !== "auto" && (
                          <span style={{ marginLeft: 8, padding: "2px 8px", fontSize: 10.5,
                            background: palette.purple + "20", color: palette.purple, borderRadius: 4 }}>
                            {meta.mode === "custom_topic" ? "自选话题" : "自选文章"}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11.5, color: palette.textTri, marginTop: 3 }}>
                        长文 {(h.long_recs || []).length} 篇 · 短新闻 {(h.short_recs || []).length} 条
                        {meta.custom_topic?.title && ` · 话题: ${meta.custom_topic.title.slice(0, 28)}`}
                      </div>
                    </div>
                    <Btn variant="secondary" size="sm">载入 →</Btn>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 数据源状态 */}
      <div style={{
        display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap",
      }}>
        <div style={{
          padding: "10px 16px", borderRadius: 10,
          background: weiboHot.length > 0 ? `${palette.green}10` : `${palette.orange}10`,
          border: `1px solid ${weiboHot.length > 0 ? palette.green : palette.orange}30`,
          fontSize: 13, color: weiboHot.length > 0 ? palette.green : palette.orange,
          fontWeight: 500,
        }}>
          🔥 微博热搜: {weiboHot.length} 条
        </div>
        <div style={{
          padding: "10px 16px", borderRadius: 10,
          background: articles.length > 0 ? `${palette.blue}10` : `${palette.orange}10`,
          border: `1px solid ${articles.length > 0 ? palette.blue : palette.orange}30`,
          fontSize: 13, color: articles.length > 0 ? palette.blue : palette.orange,
          fontWeight: 500,
        }}>
          📚 历史文章: {articles.length} 篇
        </div>
      </div>

      {loading && (
        <div style={{
          padding: 60, textAlign: "center", background: palette.card,
          borderRadius: 20, border: `1px solid ${palette.border}`,
        }}>
          <Spinner size={40} color={palette.red} />
          <div style={{
            fontSize: 18, fontWeight: 700, marginTop: 18,
            fontFamily: "'Noto Serif SC'", color: palette.text,
          }}>✨ AI 正在分析热点与文章...</div>
          <div style={{ fontSize: 13, color: palette.textTri, marginTop: 8 }}>
            预计需要 20-40 秒
          </div>
        </div>
      )}

      {!loading && longRecs.length === 0 && shortRecs.length === 0 && (
        <EmptyState
          icon="✨"
          title="等待 AI 匹配"
          desc="点击右上角「开始 AI 匹配」按钮,AI 会同时给出长文推荐和短新闻推荐"
        />
      )}

      {!loading && (longRecs.length > 0 || shortRecs.length > 0) && (
        <>
          {/* Tab 切换 */}
          <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: `1px solid ${palette.border}` }}>
            {[
              { key: "long", label: `📖 长文推荐 (${longRecs.length})`, color: palette.red },
              { key: "short", label: `⚡ 短新闻推荐 (${shortRecs.length})`, color: palette.purple },
            ].map((t) => (
              <div
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  padding: "10px 20px", cursor: "pointer",
                  fontSize: 14, fontWeight: activeTab === t.key ? 700 : 500,
                  color: activeTab === t.key ? t.color : palette.textSec,
                  borderBottom: activeTab === t.key ? `3px solid ${t.color}` : "3px solid transparent",
                  marginBottom: -1, transition: "all 0.15s",
                  fontFamily: "'Noto Sans SC'",
                }}
              >{t.label}</div>
            ))}
          </div>

          {activeTab === "long" && (
            <div>
              {longRecs.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: palette.textTri }}>暂无长文推荐</div>
              ) : longRecs.map((rec, i) => {
                const article = articles.find((a) => a.id === rec.article_id);
                const hotTopic = weiboHot[rec.hot_topic_idx];
                return (
                  <LongMatchCard
                    key={i} rec={rec} article={article} hotTopic={hotTopic}
                    onPick={onPickLongForm}
                  />
                );
              })}
            </div>
          )}

          {activeTab === "short" && (
            <div>
              {shortRecs.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: palette.textTri }}>暂无短新闻推荐</div>
              ) : shortRecs.map((rec, i) => {
                const hotTopic = weiboHot[rec.hot_topic_idx];
                return (
                  <ShortMatchCard
                    key={i} rec={rec} hotTopic={hotTopic}
                    onPick={onPickShortNews}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// 【仪表盘】页
// ============================================================
function DashboardPage({ articles, weiboHot, genHistory, backend, onStartCrawler, crawlTask, crawlProgress }) {
  const toast = useToast();
  const [crawlCount, setCrawlCount] = useState(30);

  const latestWeiboTime = weiboHot[0]?.crawled_at
    ? String(weiboHot[0].crawled_at).slice(0, 16).replace("T", " ")
    : "";

  const uploadWeiboJson = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const records = JSON.parse(txt);
      if (!Array.isArray(records) || records.length === 0) {
        toast("JSON 格式不对或为空", "error");
        return;
      }
      // 上传到 weibo_hot 表
      const batch_id = `upload_${Date.now()}`;
      const rows = records.map((r) => ({
        rank: parseInt(r.rank) || 0,
        title: r.title || "",
        heat: String(r.heat || ""),
        read_count: r.read_count || "",
        ai_summary: r.ai_summary || "",
        ai_summary_status: r.ai_summary_status || "",
        url: r.url || "",
        crawled_at: r.crawled_at || new Date().toISOString(),
        batch_id,
      }));
      const { error } = await supabase.from("weibo_hot").insert(rows);
      if (error) throw error;
      toast(`✅ 已上传 ${rows.length} 条微博热搜`, "success");
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      toast(`上传失败: ${err.message}`, "error");
    }
  };

  return (
    <div>
      <SectionHeader icon="📊" title="今日概览" subtitle="系统数据一览" />

      {/* 数据卡片 */}
      <div style={{ display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        <StatCard
          icon="🔥" label="微博热搜" value={weiboHot.length}
          color={palette.red}
          sub={latestWeiboTime ? `最新批次: ${latestWeiboTime}` : "点击下方启动爬虫"}
        />
        <StatCard
          icon="📚" label="文章库" value={articles.length}
          color={palette.blue} sub="三联历史文章"
        />
        <StatCard
          icon="✨" label="已生成内容" value={genHistory.length}
          color={palette.purple} sub="历史生成记录"
        />
      </div>

      {/* 后端 + AI 状态诊断 */}
      <div style={{
        padding: 20, borderRadius: 14, marginBottom: 20,
        background: backend?.ok && backend?.ai_configured ? `${palette.green}08` : `${palette.orange}08`,
        border: `1px solid ${backend?.ok && backend?.ai_configured ? palette.green + "30" : palette.orange + "30"}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <StatusDot color={backend?.ok ? palette.green : palette.red} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            后端服务: {backend?.ok ? "运行中" : "未连接"}
          </span>
          {backend?.ok && (
            <>
              <span style={{ color: palette.textTri, fontSize: 12 }}>·</span>
              <span style={{ fontSize: 13, color: palette.textSec }}>
                AI Provider: {backend.ai_provider || "-"}
              </span>
              <StatusDot color={backend?.ai_configured ? palette.green : palette.red} />
              <span style={{ fontSize: 13, color: backend?.ai_configured ? palette.green : palette.red }}>
                {backend?.ai_configured ? "API Key 已配置" : "未配置 API Key"}
              </span>
            </>
          )}
        </div>
        {!backend?.ok && (
          <div style={{ fontSize: 12, color: palette.textSec, lineHeight: 1.8 }}>
            ❌ 请打开一个终端,运行: <code style={{ background: palette.warm, padding: "1px 6px", borderRadius: 4 }}>python api_server.py</code>
          </div>
        )}
        {backend?.ok && !backend?.ai_configured && (
          <div style={{ fontSize: 12, color: palette.orange, lineHeight: 1.8 }}>
            ⚠️ 后端没有配置 AI_API_KEY,请在 .env 中设置后重启后端
          </div>
        )}
      </div>

      {/* 快捷操作区 */}
      <div style={{
        padding: 22, background: palette.card, borderRadius: 16,
        border: `1px solid ${palette.border}`, marginBottom: 20,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, fontFamily: "'Noto Serif SC'" }}>
          ⚡ 爬虫操作
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: palette.textSec }}>爬取数量:</label>
          <select
            value={crawlCount} onChange={(e) => setCrawlCount(parseInt(e.target.value))}
            disabled={!!crawlTask}
            style={{
              padding: "8px 12px", border: `1px solid ${palette.border}`,
              borderRadius: 8, fontSize: 13, outline: "none", background: palette.card,
              fontFamily: "'Noto Sans SC'",
            }}
          >
            {[10, 20, 30, 40, 50].map((n) => <option key={n} value={n}>{n} 条</option>)}
          </select>
          <Btn
            variant="primary"
            onClick={() => onStartCrawler(crawlCount)}
            disabled={!backend?.ok || !!crawlTask}
          >
            🚀 启动微博爬虫
          </Btn>
          <label>
            <input
              type="file" accept=".json" onChange={uploadWeiboJson}
              style={{ display: "none" }}
            />
            <span style={{
              padding: "10px 20px", borderRadius: 12, cursor: "pointer",
              background: palette.warm, color: palette.text,
              border: `1px solid ${palette.borderMed}`,
              fontSize: 14, fontFamily: "'Noto Sans SC'",
              display: "inline-flex", alignItems: "center", gap: 8,
            }}>📤 上传 weibo_hot.json</span>
          </label>
        </div>
        <div style={{ fontSize: 12, color: palette.textTri, lineHeight: 1.8 }}>
          💡 首次运行爬虫会弹出浏览器让你扫码登录微博,之后 cookie 会保存在 ./wb_user_data/ 全程后台静默运行
        </div>

        {/* 爬虫进度 */}
        {crawlTask && crawlProgress && (
          <div style={{
            marginTop: 16, padding: 16, borderRadius: 12,
            background: palette.cardAlt, border: `1px solid ${palette.border}`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: palette.red }}>
                🕷 爬虫进度: {crawlProgress.status === "done" ? "✅ 完成" : crawlProgress.message || "运行中"}
              </span>
              {crawlProgress.eta_seconds > 0 && crawlProgress.status !== "done" && (
                <span style={{ fontSize: 12, color: palette.textTri }}>
                  ⏱ 预计剩余 {Math.round(crawlProgress.eta_seconds / 60)} 分钟
                </span>
              )}
            </div>
            <ProgressBar value={crawlProgress.current || 0} max={crawlProgress.total || 30} />
            <div style={{ fontSize: 12, color: palette.textSec, marginTop: 8 }}>
              {crawlProgress.current || 0} / {crawlProgress.total || 0}
              {crawlProgress.current_title && (
                <span style={{ marginLeft: 10, color: palette.textTri }}>
                  当前: {crawlProgress.current_title.slice(0, 40)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 三联文风示例(改写: 删除"我刷到/我想起《三联》"的自指漏洞)
// ============================================================
const SANLIAN_STYLE_RULES = `
你是《三联生活周刊》官方小红书账号的内容编辑。你的写作代表"三联"的编辑声音——温和、克制、有人文关怀,但不机械、不官腔、不套话。

═════════════════════════════════════════════
【核心原则 1 - 视角】
你就是三联。不要把自己当读者,也不要把"三联"当作第三方来引用。

✗ 错误示范(这些是你必须彻底避免的):
  ✗ "我刷到..." / "我看到..." / "今天让我想起..."
  ✗ "想起《三联》写过的一篇..." / "让我想起《三联》的一篇报道"
  ✗ "作为一名编辑,我..." / "作为读者,我们..."
  ✗ "我们之前写过的这篇《...》"(听起来像在引用别人的文章)

✓ 正确姿态(任选其一,自然即可):
  ✓ 直接用"我们/我们曾",这是编辑部复数"我们",不是自称"我"
    例:"我们曾记录过一位..." "这让我们重新翻开2022年的一篇旧稿"
  ✓ 用客观时间状语+事件陈述,不带主语
    例:"近日...再次引发关注" "这些天,关于XX的讨论仍在持续"
  ✓ 直接让文章本身说话
    例:"文中记录了..." "一位受访者曾说..." "这篇2022年的报道写过..."

═════════════════════════════════════════════
【核心原则 2 - 写作风格:学习三联的柔软起笔】

三联小红书的真实样貌——不是机械地"本刊X年X月的报道曾记录过",而是:

示范 A(抒情式起笔,柔和切入):
---
"当我们讨论欲望,我们在讨论什么"

关于欲望,我们总是太晚开始谈论。现实中,也没有太多讨论性的空间。观察影视剧中的女性,她们在不同的人生阶段如何开始直面欲望,对我们来说是一个安全距离。她们有的在更年期,有的正值盛年,差别只是早与晚。

近期,几部女性题材影视剧把这个被回避的主题再次拉回公共视野。而我们曾在2023年夏天,专门写过一期封面——《直面欲望》。

编辑部想重新翻出这份旧稿,分享给今天关心这个话题的你。

文 | 驳静
*本文原载于《三联生活周刊》2023年7月
---

示范 B(事件引入型,克制陈述):
---
"同样是止血,怎么只有卫生巾处处缺席?"

近日,"女子乘坐火车时突发生理期,不慎沾染卧铺床单,列车员要求其自行清洗或赔偿180元"一事在网络上持续发酵。"高铁上为什么不卖卫生巾",再一次被推到了舆论焦点。

这一次次的讨论与争议,折射出的是女性长期未被正视的生理期困境。

我们重发一篇写于2022年9月的文章,希望女性的生理期权益——包括在内的所有"不被看到的需求"——都可以被正视、被保障。

文 | 王有有
*本文原载于《三联生活周刊》2022年9月
---

示范 C(人物纪念型,带情感重量):
---
"没有什么最终的胜利"

"历史是一种辩证发展过程,各种利益与张力在很大程度上是无法预料的。应当时刻保持警惕,无论对女性还是男性而言,没有什么最终的胜利。"

2022年,在西蒙娜·德·波伏瓦1954年所写的中篇小说《形影不离》中译版首次面世之际,我们采访过波伏瓦的养女兼文学遗产继承人——希尔维·勒邦·德·波伏瓦。

今天是2026年4月14日,波伏瓦逝世的40周年。我们重发这篇采访,向这位存在主义哲学家、作家和女权主义先驱,献上最崇高的敬意。

文 | 孙若茜
*本文原载于《三联生活周刊》2022年11月
---

═════════════════════════════════════════════
【核心原则 3 - 节奏与句式】

- 起笔不急着说事件——可以先抛一句有分量的话、一个观察、一句引文
- 事件陈述要克制、具体,用"近日/这些天/近期",不用"在这个信息爆炸的时代"
- 中间衔接用"我们曾/我们在X年写过/编辑部想/文中记录了...",自然过渡
- 结尾一句就好——收束一下,或直接以事实性留白结束。不要总结、不要升华

严格禁止的 AI 套话:
✗ "揭示了..." ✗ "指出..." ✗ "折射出..." ✗ "值得我们深思"
✗ "在这个快节奏的时代" ✗ "让我们一起..." ✗ "这个故事告诉我们"
✗ "在无数个夜晚" ✗ "那些日子里" ✗ "永恒的话题"
✗ "令人动容" ✗ "引人深思" ✗ "发人深省"

═════════════════════════════════════════════
【核心原则 4 - 格式要求】

- 封面金句(cover_hook):15-35 字,从文章中找一句有重量的原话 / 核心观察,或自己凝练一句
- 小红书标题(xhs_title):12-22 字。**不能**直接用原文标题,**不能**包含书名号《》。
  应当结合热点与文章核心,起一个口语化、有钩子的标题。
  例:原文《改造一座女性友好厕所,增加厕位数就够了吗?》
     不能直接用,要改成如"当我们说女性友好厕所时,我们在说什么"或"厕所设计里藏着的城市性别观"
- 文案(caption):280-450 字,学习 A/B/C 三种示范中任选一种或融合风格
- 结尾必须有两行:
  文 | 作者名
  *本文原载于《三联生活周刊》XXXX年X月
`;

// ============================================================
// 【内容生成 - 长文模式】
// ============================================================
function GenerateLongPage({ article, hotTopic, onBack, onSaved }) {
  const toast = useToast();
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState(null);
  const [activeTab, setActiveTab] = useState("note");  // note → cover → page-i

  // refs
  const noteRef = useRef(null);
  const coverRef = useRef(null);
  const pageRefs = useRef([]);

  // 作者信息
  const authorInfo = useMemo(() => {
    const author = extractAuthorInfo(article?.content_md || "");
    const ym = formatPubDateToYM(article?.pub_date);
    return {
      authorName: author || "",
      author: author ? `文 | ${author}` : "",
      source: ym ? `*本文原载于《三联生活周刊》${ym}` : "",
    };
  }, [article]);

  // 文章分页
  const articleBlocks = useMemo(() => parseArticleBlocks(article?.content_md || ""), [article]);
  const articlePages = useMemo(() => paginateBlocks(articleBlocks), [articleBlocks]);

  const runGenerate = useCallback(async () => {
    if (!article) return;
    setGenerating(true);
    setContent(null);
    try {
      const hotTitle = hotTopic?.title || "";
      const hotSummary = (hotTopic?.ai_summary || "").slice(0, 600);
      const articleSummary = (article.summary || "").slice(0, 500);
      const articleExcerpt = cleanArticleText(article.content_md || "").slice(0, 1800);

      const systemMsg = SANLIAN_STYLE_RULES;

      const userPrompt = `任务: 为下面这篇三联旧文,结合今天的微博热搜,写一条三联官方小红书。

【今日微博热搜】
标题: ${hotTitle}
背景摘要: ${hotSummary || "(无)"}

【三联历史文章】
标题: 《${article.title}》
发布时间: ${formatPubDate(article.pub_date)}
${authorInfo.authorName ? `作者: ${authorInfo.authorName}` : ""}
摘要: ${articleSummary}
正文节选:
${articleExcerpt}

【写作要求——极其重要】
请研读 system prompt 中的示范 A / B / C,自由选择风格或融合,但必须做到:
1. 起笔不机械——不要一上来就"近日XX事件"+"本刊X年X月的报道曾记录过",这种僵化的套路请完全避免
   可以先抛一句有分量的话、一段柔软的观察、甚至直接从文章原话切入
2. 使用"我们/我们曾/编辑部"作为编辑部集体声音,**不要**说"本刊"(过于机关式)
3. 绝对不允许:"我刷到""我看到""让我想起《三联》"
4. 结尾收束一句克制观察,或直接收尾,不要升华、不要喊口号
5. 必须以两行结尾:
   文 | ${authorInfo.authorName || "(作者)"}
   *本文原载于《三联生活周刊》${formatPubDateToYM(article.pub_date)}

严格只返回 JSON(不加 markdown 代码块标记):
{
  "xhs_title": "小红书帖子标题,**严格要求:不超过 20 字**(含标点、引号、空格)。\n【最关键的要求】:**标题的核心必须来自文章本身的内容,而不是热点的内容**。热点只是一个引子,但这条笔记讲的是《${article.title}》这篇文章,标题要让人一看就知道文章讲了啥。如果文章内容和热点有关联,可以在标题里体现衔接(比如热点是A,文章是B,两者共同的话题是C,标题就围绕C来写);如果文章和热点关联较弱,标题**完全以文章内容为主**,不要硬扯热点。\n例: 文章《年轻人为什么扎堆去福建、潮汕看游神》+ 热点《项羽回到足球场》 → 共同话题是"传统文化在年轻人中复兴",标题应写 \"年轻人为什么扎堆看游神\" 或 \"游神,年轻人的新热闹\",**不能写成** \"当项羽重返足球场\"(那只讲了热点,没讲文章)。\n往往是一句带情绪/观点的短句或短引语。**禁止直接用原文标题《${article.title}》全文**,**禁止包含书名号《》**",
  "cover_hook": "封面金句,14-30 字。\n【最关键的要求】:**内容核心来自文章,不来自热点**。这是事实性叙述,说清文章讲了什么(某人做了什么事 / 某事件背后的什么议题),可带具体人物/地点/数字/场景。\n如果文章与热点能自然衔接,可以提一下关联;如果关联弱,就只讲文章。\n与标题**互补**:标题是情绪短句,金句是事实叙述。\n**不是**直接摘原文句子,而是你自己凝练的一句描述。",
  "caption": "正文文案,280-450字。自由选择示范 A/B/C 之一的风格或融合,起笔柔软自然,不要机械套式。可以从热点切入,但主体必须讲《${article.title}》这篇文章的内容/观察/采访。结尾必须包含两行:'文 | ${authorInfo.authorName || "(作者)"}' 和 '*本文原载于《三联生活周刊》${formatPubDateToYM(article.pub_date)}'",
  "tags": ["5-8个标签,具体不抽象"]
}

【标题 vs 金句 对照案例 —— 极其重要】
案例 1:
  标题:"我要像成年人一样活着。"
  金句:父母去世后,一个19岁男孩辍学抚养妹妹

案例 2:
  标题:有时我觉得我们上一代的抗压能力不一定有我们好
  金句:放弃编制、辞掉工作,一个28岁女孩"假装上班"的两年

案例 3:
  标题:将不可能变成可能,超越所有版本的自己
  金句:樊振东,在巴黎超越所有版本的自己

案例 4:
  标题:"同样是止血,怎么只有卫生巾处处缺席?"
  金句:"高铁上卖不卖卫生巾"背后,那些看不见的女性需求

可以看出:
- 标题往往是带引号的人物原话、感叹、反问、观点短句,情绪浓、钩子强
- 金句是叙述性句子,"某类人做了某事"/"某事件背后的某议题",直陈事实
- 两者不重复,各自承担不同功能`;

      const resp = await callAI(userPrompt, { system: systemMsg, maxTokens: 3000, temperature: 0.85 });
      let cleaned = resp.trim()
        .replace(/^```json\s*/, "").replace(/\s*```$/, "").replace(/^```\s*/, "");
      let parsed;
      try { parsed = JSON.parse(cleaned); }
      catch {
        const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
        if (s >= 0 && e > s) parsed = JSON.parse(cleaned.slice(s, e + 1));
        else throw new Error("AI 返回不是有效 JSON");
      }

      // 后处理 caption: 保证结尾有 文|作者 和 原刊信息
      let caption = String(parsed.caption || "").trim();
      // 兜底清理 AI 可能的视角漏洞 + 把过于官腔的"本刊"软化为"我们"
      caption = caption
        .replace(/我刷到了?/g, "近日")
        .replace(/我看到/g, "")
        .replace(/今天让我想起/g, "这让我们重新想起")
        .replace(/让我想起《三联》/g, "让我们重新想起")
        .replace(/《三联》的(一篇)?报道/g, "我们的一篇报道")
        .replace(/作为一名编辑/g, "")
        .replace(/作为读者/g, "")
        // 把过度机关化的"本刊XXXX年X月的报道曾记录过"软化
        .replace(/本刊(\d{4}年\d+月)的报道曾记录过/g, "我们在$1写过")
        .replace(/本刊的(一篇)?报道/g, "我们的一篇报道")
        .replace(/本刊记者/g, "我们的记者")
        // 去除常见 AI 套话
        .replace(/揭示了/g, "").replace(/折射出/g, "")
        .replace(/值得我们深思/g, "").replace(/引人深思/g, "")
        .replace(/发人深省/g, "").replace(/令人动容/g, "");

      if (authorInfo.author && !caption.includes("文 |") && !caption.includes("文|")) {
        caption += `\n\n${authorInfo.author}`;
      }
      if (authorInfo.source && !caption.includes("原载于")) {
        caption += `\n${authorInfo.source}`;
      }
      parsed.caption = caption;

      setContent(parsed);
      toast("✨ 内容已生成,请查看右侧预览", "success");

      // 【新增】自动保存为草稿到历史记录,不需要用户手动点保存
      try {
        await saveGeneratedContent({
          hot_topic: hotTopic?.title || "",
          hot_topic_source: "weibo",
          article_id: article.id,
          article_title: article.title,
          xhs_title: parsed.xhs_title,
          xhs_caption: parsed.caption,
          xhs_tags: parsed.tags || [],
          article_content_md: (article.content_md || "").slice(0, 10000),
          status: "draft",
        });
        onSaved?.();
      } catch (se) {
        console.warn("自动保存到历史失败:", se);
      }
    } catch (e) {
      console.error(e);
      toast(`生成失败: ${e.message}`, "error");
    } finally {
      setGenerating(false);
    }
  }, [article, hotTopic, authorInfo, toast, onSaved]);

  // v8: 不再自动生成, 必须用户点按钮才触发 (避免每次进来就浪费 token 和保存重复历史)

  const copyAll = () => {
    if (!content) return;
    const txt = [
      content.xhs_title, "", content.caption, "",
      (content.tags || []).map((t) => `#${t}`).join(" "),
    ].join("\n");
    navigator.clipboard.writeText(txt).then(() => toast("✅ 已复制全部内容", "success"));
  };

  const copyCaption = () => {
    if (!content?.caption) return;
    navigator.clipboard.writeText(content.caption).then(() => toast("✅ 已复制文案", "success"));
  };

  const handleDownload = async (tabKey) => {
    if (!content) return;
    const safeTitle = (content.xhs_title || "内容").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    if (tabKey === "note") {
      const ok = await downloadAsImage(noteRef, `${safeTitle}_笔记预览.png`, PHONE_W, PHONE_H);
      toast(ok ? "✅ 笔记预览已下载" : "下载失败", ok ? "success" : "error");
    } else if (tabKey === "cover") {
      const ok = await downloadAsImage(coverRef, `${safeTitle}_封面.png`, CARD_W, CARD_H);
      toast(ok ? "✅ 封面已下载 (1242×1660)" : "下载失败", ok ? "success" : "error");
    } else if (tabKey.startsWith("page-")) {
      const idx = parseInt(tabKey.slice(5));
      const ref = { current: pageRefs.current[idx] };
      const ok = await downloadAsImage(ref, `${safeTitle}_第${idx + 1}页.png`, CARD_W, CARD_H);
      toast(ok ? `✅ 第 ${idx + 1} 页已下载 (1242×1660)` : "下载失败", ok ? "success" : "error");
    }
  };

  const downloadAllPages = async () => {
    if (!content) return;
    const safeTitle = (content.xhs_title || "内容").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    let ok = await downloadAsImage(coverRef, `${safeTitle}_00_封面.png`, CARD_W, CARD_H);
    for (let i = 0; i < articlePages.length; i++) {
      const ref = { current: pageRefs.current[i] };
      await new Promise(r => setTimeout(r, 300));
      const r2 = await downloadAsImage(ref, `${safeTitle}_${String(i + 1).padStart(2, "0")}_正文.png`, CARD_W, CARD_H);
      ok = ok && r2;
    }
    toast(ok ? `✅ 已批量下载 封面 + ${articlePages.length} 页正文` : "部分页面下载失败", ok ? "success" : "warning");
  };

  const saveAsHistory = async () => {
    if (!content || !article) return;
    try {
      await saveGeneratedContent({
        hot_topic: hotTopic?.title || "",
        hot_topic_source: "weibo",
        article_id: article.id,
        article_title: article.title,
        xhs_title: content.xhs_title,
        xhs_caption: content.caption,
        xhs_tags: content.tags || [],
        article_content_md: (article.content_md || "").slice(0, 10000),
        status: "draft",
      });
      toast("✅ 已保存到历史记录", "success");
      onSaved?.();
    } catch (e) {
      toast(`保存失败: ${e.message}`, "error");
    }
  };

  // Tab 列表
  const tabs = useMemo(() => {
    const t = [
      { key: "note", label: "📱 笔记预览" },
      { key: "cover", label: "🎨 封面" },
    ];
    articlePages.forEach((_, i) => t.push({ key: `page-${i}`, label: `📄 正文 ${i + 1}` }));
    return t;
  }, [articlePages]);

  if (!article) {
    return (
      <div>
        <SectionHeader
          icon="✍️" title="内容生成"
          subtitle="请先从「AI 匹配推荐」页点击「用这篇生成内容」按钮,或到「文章库」选一篇文章"
          color={palette.purple}
        />
        <EmptyState
          icon="✍️" title="还没有选择文章"
          desc="到「AI 匹配推荐」让 AI 给你推荐,或到「文章库」直接挑一篇"
        />
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        icon="✍️" title="内容生成 · 长文"
        subtitle={`文章: 《${article.title}》${hotTopic ? ` · 关联热点: ${hotTopic.title?.slice(0, 40)}` : ""}`}
        color={palette.purple}
        action={
          <div style={{ display: "flex", gap: 10 }}>
            <Btn variant="secondary" onClick={onBack}>← 返回</Btn>
            {content && (
              <Btn variant="primary" onClick={runGenerate} disabled={generating}>
                {generating ? <><Spinner size={13} color="#fff" /> 生成中</> : "🔄 重新生成"}
              </Btn>
            )}
          </div>
        }
      />

      {/* v8: 空态 —— 必须用户手动点按钮才开始 */}
      {!content && !generating && (
        <div style={{
          padding: "60px 40px", textAlign: "center", background: palette.card,
          borderRadius: 20, border: `1px solid ${palette.border}`,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✨</div>
          <div style={{
            fontSize: 22, fontWeight: 700, color: palette.text,
            fontFamily: "'Noto Serif SC'", marginBottom: 10,
          }}>准备生成小红书内容</div>
          <div style={{ fontSize: 14, color: palette.textSec, marginBottom: 8, lineHeight: 1.8 }}>
            文章: 《{article.title}》
          </div>
          {hotTopic && (
            <div style={{ fontSize: 13, color: palette.red, marginBottom: 8 }}>
              🔥 关联热点: {hotTopic.title}
            </div>
          )}
          <div style={{ fontSize: 13, color: palette.textTri, marginBottom: 28, marginTop: 10 }}>
            点击下方按钮开始,AI 会学习三联文风并结合热点与旧文
          </div>
          <Btn variant="primary" size="lg" onClick={runGenerate}>
            🚀 开始生成
          </Btn>
          <div style={{ fontSize: 11, color: palette.textTri, marginTop: 16 }}>
            预计 20-40 秒 · 生成后会自动保存到历史记录
          </div>
        </div>
      )}

      {generating && !content && (
        <div style={{
          padding: 60, textAlign: "center", background: palette.card,
          borderRadius: 20, border: `1px solid ${palette.border}`,
        }}>
          <Spinner size={40} color={palette.purple} />
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 18, fontFamily: "'Noto Serif SC'" }}>
            ✨ 正在为你创作内容...
          </div>
          <div style={{ fontSize: 13, color: palette.textTri, marginTop: 8 }}>
            学习三联文风,结合热点与旧文
          </div>
        </div>
      )}

      {content && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 460px", gap: 28, alignItems: "flex-start" }}>
          {/* 左侧: 文案 */}
          <div>
            {/* 热点标签 */}
            {hotTopic && (
              <div style={{
                padding: "10px 16px", borderRadius: 10, marginBottom: 14,
                background: `${palette.red}08`, border: `1px solid ${palette.red}20`,
                fontSize: 13, color: palette.red,
              }}>
                🔥 关联热点: <strong>{hotTopic.title}</strong>
              </div>
            )}

            {/* 标题 */}
            <div style={{
              background: palette.card, borderRadius: 14, padding: 22, marginBottom: 14,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 8, fontWeight: 500 }}>📌 小红书标题</div>
              <div style={{
                fontSize: 22, fontWeight: 700, color: palette.text,
                fontFamily: "'Noto Serif SC'", lineHeight: 1.5,
              }}>{content.xhs_title}</div>
            </div>

            {/* 封面金句 */}
            {content.cover_hook && (
              <div style={{
                background: palette.card, borderRadius: 14, padding: 22, marginBottom: 14,
                border: `1px solid ${palette.border}`,
              }}>
                <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 8, fontWeight: 500 }}>💬 封面金句</div>
                <div style={{
                  fontSize: 16, color: palette.text, lineHeight: 1.7,
                  fontFamily: "'Noto Serif SC', serif", fontStyle: "italic",
                }}>&ldquo;{content.cover_hook}&rdquo;</div>
              </div>
            )}

            {/* 文案 */}
            <div style={{
              background: palette.card, borderRadius: 14, padding: 22, marginBottom: 14,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 10, fontWeight: 500 }}>📝 引语文案</div>
              <textarea
                value={content.caption}
                onChange={(e) => setContent({ ...content, caption: e.target.value })}
                style={{
                  width: "100%", minHeight: 300, padding: 14,
                  border: `1px solid ${palette.border}`, borderRadius: 8,
                  fontSize: 14.5, lineHeight: 2, color: palette.text,
                  fontFamily: "'Noto Serif SC', serif", resize: "vertical",
                  background: palette.cardAlt, outline: "none",
                }}
              />
            </div>

            {/* 标签 */}
            <div style={{
              background: palette.card, borderRadius: 14, padding: 20, marginBottom: 14,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 10, fontWeight: 500 }}>🏷️ 话题标签</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(content.tags || []).map((t, i) => (
                  <Tag key={i} color={palette.blue}>#{t}</Tag>
                ))}
              </div>
            </div>

            {/* 操作 */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn variant="primary" onClick={copyAll}>📋 复制全部内容</Btn>
              <Btn variant="secondary" onClick={copyCaption}>📋 仅复制文案</Btn>
              <Btn variant="green" onClick={saveAsHistory}>💾 保存到历史</Btn>
              <Btn variant="purple" onClick={downloadAllPages}>📦 批量下载所有图片</Btn>
            </div>
          </div>

          {/* 右侧: 预览 (v10 重做导航) */}
          <div style={{ position: "sticky", top: 92, alignSelf: "flex-start" }}>
            {/* v10: 固定 Tab —— 笔记预览 / 封面 */}
            <div style={{
              display: "flex", gap: 2, marginBottom: 10,
              background: palette.card, borderRadius: 10, padding: 4,
              border: `1px solid ${palette.border}`,
            }}>
              {[
                { key: "note", label: "📱 笔记预览" },
                { key: "cover", label: "🎨 封面" },
              ].map((t) => (
                <div key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={{
                    flex: 1, padding: "8px 14px", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", borderRadius: 6, textAlign: "center",
                    background: activeTab === t.key ? gradPrimary : "transparent",
                    color: activeTab === t.key ? "#fff" : palette.textSec,
                    whiteSpace: "nowrap", transition: "all 0.15s",
                    fontFamily: "'Noto Sans SC'",
                  }}>{t.label}</div>
              ))}
            </div>

            {/* v10: 正文页选择器 —— 网格式,一眼看到所有 N 页 */}
            {articlePages.length > 0 && (
              <div style={{
                background: palette.card, borderRadius: 10, padding: "10px 12px",
                border: `1px solid ${palette.border}`, marginBottom: 10,
              }}>
                <div style={{
                  fontSize: 11, color: palette.textTri, marginBottom: 8,
                  fontFamily: "'Noto Sans SC'",
                }}>
                  📄 正文页 (共 {articlePages.length} 页) {/^page-/.test(activeTab) && ` · 当前第 ${parseInt(activeTab.slice(5)) + 1} 页`}
                </div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(auto-fill, minmax(40px, 1fr))`,
                  gap: 4, maxHeight: 120, overflowY: "auto",
                }}>
                  {articlePages.map((_, i) => {
                    const key = `page-${i}`;
                    const active = activeTab === key;
                    return (
                      <div key={key} onClick={() => setActiveTab(key)} style={{
                        padding: "6px 0", fontSize: 12, fontWeight: 600,
                        textAlign: "center", cursor: "pointer", borderRadius: 6,
                        background: active ? palette.red : palette.cardAlt,
                        color: active ? "#fff" : palette.textSec,
                        border: `1px solid ${active ? palette.red : palette.border}`,
                        transition: "all 0.12s",
                        fontFamily: "'Noto Sans SC'",
                      }}>{i + 1}</div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 尺寸提示 */}
            <div style={{
              textAlign: "center", fontSize: 11, color: palette.textTri,
              marginBottom: 10, fontFamily: "'Noto Sans SC'",
            }}>
              {activeTab === "note"
                ? `📱 手机真机效果预览 · 模拟 iPhone 15 Pro Max`
                : `导出尺寸: 1242 × 1660 px (小红书 3:4 竖版)`
              }
            </div>

            {/* 下载按钮 */}
            <div style={{ textAlign: "center", marginBottom: 14, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <Btn variant="secondary" size="sm" onClick={() => handleDownload(activeTab)}>
                💾 下载当前{activeTab === "note" ? "预览" : "图片"}
              </Btn>
              <Btn variant="primary" size="sm" onClick={downloadAllPages}>
                📦 批量下载全部 ({1 + articlePages.length} 张)
              </Btn>
            </div>

            {/* 预览画布 */}
            <div style={{
              display: "flex", justifyContent: "center",
              background: palette.warm, borderRadius: 14, padding: 20,
              minHeight: 400,
            }}>
              {/* note tab: 手机真机预览 */}
              <div style={{ display: activeTab === "note" ? "block" : "none" }}>
                <XHSNotePreview
                  innerRef={noteRef}
                  xhsTitle={content.xhs_title}
                  caption={content.caption}
                  tags={content.tags}
                  hook={content.cover_hook}
                  articleTitle={article.title}
                />
              </div>

              {/* cover tab: 封面 */}
              <div style={{ display: activeTab === "cover" ? "block" : "none" }}>
                <XHSCoverLongForm
                  innerRef={coverRef}
                  hook={content.cover_hook}
                  xhsTitle={content.xhs_title}
                  articleTitle={article.title}
                  pubDate={formatPubDateToYM(article.pub_date)}
                  tagLabel="旧文重温"
                />
              </div>

              {/* 每个正文页(全部渲染,用 display 控制显示,确保 ref 都能生效便于批量下载) */}
              {articlePages.map((pageBlocks, i) => (
                <div key={i} style={{ display: activeTab === `page-${i}` ? "block" : "none" }}>
                  <XHSContentPage
                    innerRef={(el) => pageRefs.current[i] = el}
                    blocks={pageBlocks}
                    pageIndex={i}
                    totalPages={articlePages.length}
                    showHeader={i === 0}
                    articleTitle={article.title}
                    pubDate={formatPubDate(article.pub_date)}
                    authorLine={{ author: authorInfo.author, source: authorInfo.source }}
                    isLast={i === articlePages.length - 1}
                  />
                </div>
              ))}
            </div>

            {/* v10: 底部翻页器 —— 上一页 / 当前 X/N / 下一页 */}
            {/^(cover|page-)/.test(activeTab) && (
              <div style={{
                marginTop: 14, display: "flex",
                alignItems: "center", justifyContent: "center", gap: 10,
                fontFamily: "'Noto Sans SC'",
              }}>
                <Btn variant="secondary" size="sm"
                  onClick={() => {
                    if (activeTab === "cover") return; // 封面已经是第一张
                    const idx = parseInt(activeTab.slice(5));
                    if (idx === 0) setActiveTab("cover");
                    else setActiveTab(`page-${idx - 1}`);
                  }}
                  disabled={activeTab === "cover"}
                >← 上一页</Btn>
                <div style={{ fontSize: 13, color: palette.textSec, minWidth: 80, textAlign: "center" }}>
                  {activeTab === "cover"
                    ? `封面 / ${articlePages.length + 1}`
                    : `${parseInt(activeTab.slice(5)) + 2} / ${articlePages.length + 1}`}
                </div>
                <Btn variant="secondary" size="sm"
                  onClick={() => {
                    if (activeTab === "cover") setActiveTab("page-0");
                    else {
                      const idx = parseInt(activeTab.slice(5));
                      if (idx < articlePages.length - 1) setActiveTab(`page-${idx + 1}`);
                    }
                  }}
                  disabled={/^page-/.test(activeTab) && parseInt(activeTab.slice(5)) === articlePages.length - 1}
                >下一页 →</Btn>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 【内容生成 - 短新闻模式】
// ============================================================
function GenerateShortPage({ hotTopic, onBack, onSaved }) {
  const toast = useToast();
  const [generating, setGenerating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [content, setContent] = useState(null);
  const [activeTab, setActiveTab] = useState("note");

  const noteRef = useRef(null);
  const coverRef = useRef(null);

  const runGenerate = useCallback(async () => {
    if (!hotTopic) return;
    setGenerating(true);
    setContent(null);

    try {
      // 第1步: 补充搜索
      setSearching(true);
      const q = hotTopic.title.replace(/#/g, "").slice(0, 40);
      const search = await webSearch(q, 5);
      const refs = search.results || [];
      setSearchResults(refs);
      setSearching(false);

      const searchContext = refs.length > 0
        ? refs.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n来源: ${r.url}`).join("\n\n")
        : "(无搜索结果)";

      const systemMsg = `${SANLIAN_STYLE_RULES}

本次任务是写"短新闻"图文: 把一条实时热搜做成一张图(标题+2-3段摘要),发在小红书。参考示范A的结构——"据XX报道:时间+事件+具体信息+关键引语/数字"。`;

      const userPrompt = `任务: 为下面这条微博热搜写一条短新闻图文。

【微博热搜】
标题: ${hotTopic.title}
排名: ${hotTopic.rank}
${hotTopic.heat ? `热度: ${hotTopic.heat}` : ""}
${hotTopic.read_count ? `阅读: ${hotTopic.read_count}` : ""}
微博 AI 智搜摘要: ${(hotTopic.ai_summary || "(无)").slice(0, 700)}

【网络搜索补充资料】
${searchContext}

要求:
1. 找到这件事的 5W1H(谁/何时/何地/何事/为何/如何),用具体的时间、数字、人名、机构名
2. 如果搜索资料里有关键人物的原话,请保留(用引号)
3. 视角: 三联官方,不自称"我"
4. 语气: 克制、客观、信息密度高
5. 必须核心保真——如果有不确定的,可以含糊化(用"据报道""据悉"),严禁编造

严格只返回 JSON(不加 markdown 代码块):
{
  "xhs_title": "短新闻帖子标题,12-22字。可以是事实陈述式(如'法国全票通过「文物归还法案」')或带引号的人物话,禁止'揭示'等词",
  "cover_hook": "封面图上的主标题,15-35字,即帖子主标题或其精炼版",
  "cover_summary": "封面图上的摘要正文,120-200字。结构:'据XX报道+时间+事件主体+关键信息+补充细节'。必须有具体的时间、地点、数字、人名或机构。写作示范可参考:'据央视新闻报道:当地时间4月13日,法国国民议会以170票赞成、0票反对通过一项法案...'",
  "caption": "小红书正文文案,180-300字。比封面摘要更详细一些,可以多讲一个细节或背景。结尾不需要'文|XX'(因为是实时新闻没有作者)但可以有一句克制的评价或上下文提示",
  "tags": ["5-8个具体的标签,不带#号"],
  "sources_used": ["这条短新闻里引用到的资料来源名,用于标注可信度。如['央视新闻','法新社','微博热搜AI智搜']"]
}`;

      const resp = await callAI(userPrompt, { system: systemMsg, maxTokens: 3000, temperature: 0.7 });
      let cleaned = resp.trim()
        .replace(/^```json\s*/, "").replace(/\s*```$/, "").replace(/^```\s*/, "");
      let parsed;
      try { parsed = JSON.parse(cleaned); }
      catch {
        const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
        if (s >= 0 && e > s) parsed = JSON.parse(cleaned.slice(s, e + 1));
        else throw new Error("AI 返回不是有效 JSON");
      }

      setContent(parsed);
      toast("⚡ 短新闻已生成,请查看右侧预览", "success");

      // 【新增】自动保存为草稿到历史记录
      try {
        await saveGeneratedContent({
          hot_topic: hotTopic?.title || "",
          hot_topic_source: "weibo_short_news",
          article_id: null,
          article_title: "(短新闻)",
          xhs_title: parsed.xhs_title,
          xhs_caption: parsed.caption,
          xhs_tags: parsed.tags || [],
          article_content_md: parsed.cover_summary || "",
          status: "draft",
        });
        onSaved?.();
      } catch (se) {
        console.warn("自动保存到历史失败:", se);
      }
    } catch (e) {
      console.error(e);
      toast(`生成失败: ${e.message}`, "error");
    } finally {
      setGenerating(false);
      setSearching(false);
    }
  }, [hotTopic, toast, onSaved]);

  // v8: 不再自动生成, 必须用户点按钮才触发

  const copyAll = () => {
    if (!content) return;
    const txt = [
      content.xhs_title, "", content.caption, "",
      (content.tags || []).map((t) => `#${t}`).join(" "),
    ].join("\n");
    navigator.clipboard.writeText(txt).then(() => toast("✅ 已复制全部内容", "success"));
  };

  const handleDownload = async (tabKey) => {
    if (!content) return;
    const safeTitle = (content.xhs_title || "短新闻").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    if (tabKey === "note") {
      const ok = await downloadAsImage(noteRef, `${safeTitle}_笔记预览.png`, PHONE_W, PHONE_H);
      toast(ok ? "✅ 笔记预览已下载" : "下载失败", ok ? "success" : "error");
    } else if (tabKey === "cover") {
      const ok = await downloadAsImage(coverRef, `${safeTitle}_封面.png`, CARD_W, CARD_H);
      toast(ok ? "✅ 封面已下载 (1242×1660)" : "下载失败", ok ? "success" : "error");
    }
  };

  const saveAsHistory = async () => {
    if (!content) return;
    try {
      await saveGeneratedContent({
        hot_topic: hotTopic?.title || "",
        hot_topic_source: "weibo_short_news",
        article_id: null,
        article_title: "(短新闻)",
        xhs_title: content.xhs_title,
        xhs_caption: content.caption,
        xhs_tags: content.tags || [],
        article_content_md: content.cover_summary || "",
        status: "draft",
      });
      toast("✅ 已保存到历史记录", "success");
      onSaved?.();
    } catch (e) {
      toast(`保存失败: ${e.message}`, "error");
    }
  };

  if (!hotTopic) {
    return (
      <div>
        <SectionHeader
          icon="⚡" title="内容生成 · 短新闻"
          subtitle="请先从「AI 匹配推荐」的短新闻 Tab 选一条热搜"
          color={palette.purple}
        />
        <EmptyState icon="⚡" title="没有选择热搜" desc="到「AI 匹配推荐」挑一条想做成短新闻的热搜" />
      </div>
    );
  }

  const tabs = [
    { key: "note", label: "📱 笔记预览" },
    { key: "cover", label: "🎨 封面" },
  ];

  return (
    <div>
      <SectionHeader
        icon="⚡" title="内容生成 · 短新闻"
        subtitle={`热搜: ${hotTopic.title}`}
        color={palette.purple}
        action={
          <div style={{ display: "flex", gap: 10 }}>
            <Btn variant="secondary" onClick={onBack}>← 返回</Btn>
            {content && (
              <Btn variant="primary" onClick={runGenerate} disabled={generating}>
                {generating ? <><Spinner size={13} color="#fff" /> 生成中</> : "🔄 重新生成"}
              </Btn>
            )}
          </div>
        }
      />

      {/* v8: 空态 —— 必须手动点按钮才开始 */}
      {!content && !generating && (
        <div style={{
          padding: "60px 40px", textAlign: "center", background: palette.card,
          borderRadius: 20, border: `1px solid ${palette.border}`,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
          <div style={{
            fontSize: 22, fontWeight: 700, color: palette.text,
            fontFamily: "'Noto Serif SC'", marginBottom: 10,
          }}>准备生成短新闻</div>
          <div style={{ fontSize: 13, color: palette.red, marginBottom: 8 }}>
            🔥 热搜: {hotTopic.title}
          </div>
          <div style={{ fontSize: 13, color: palette.textTri, marginBottom: 28, marginTop: 10 }}>
            点击下方按钮,AI 会先联网搜索补充资料,再生成三联风格短新闻
          </div>
          <Btn variant="primary" size="lg" onClick={runGenerate}>
            🚀 开始生成
          </Btn>
          <div style={{ fontSize: 11, color: palette.textTri, marginTop: 16 }}>
            预计 20-40 秒 · 生成后会自动保存到历史记录
          </div>
        </div>
      )}

      {generating && !content && (
        <div style={{
          padding: 60, textAlign: "center", background: palette.card,
          borderRadius: 20, border: `1px solid ${palette.border}`,
        }}>
          <Spinner size={40} color={palette.purple} />
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 18, fontFamily: "'Noto Serif SC'" }}>
            {searching ? "🌐 正在联网搜索补充资料..." : "✨ AI 正在生成短新闻..."}
          </div>
          <div style={{ fontSize: 13, color: palette.textTri, marginTop: 8 }}>
            可能需要 20-40 秒
          </div>
        </div>
      )}

      {content && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 460px", gap: 28, alignItems: "flex-start" }}>
          {/* 左侧 */}
          <div>
            <div style={{
              padding: "10px 16px", borderRadius: 10, marginBottom: 14,
              background: `${palette.red}08`, border: `1px solid ${palette.red}20`,
              fontSize: 13, color: palette.red,
            }}>
              🔥 热搜原题: <strong>{hotTopic.title}</strong>
            </div>

            {/* 参考资料 */}
            {searchResults.length > 0 && (
              <div style={{
                background: palette.card, borderRadius: 14, padding: 20, marginBottom: 14,
                border: `1px solid ${palette.border}`,
              }}>
                <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 10, fontWeight: 500 }}>
                  🌐 补充资料来源 ({searchResults.length} 条)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {searchResults.map((r, i) => (
                    <a
                      key={i} href={r.url} target="_blank" rel="noreferrer"
                      style={{
                        padding: "8px 12px", background: palette.cardAlt,
                        borderRadius: 8, fontSize: 12, color: palette.textSec,
                        textDecoration: "none", lineHeight: 1.7,
                      }}
                    >
                      <div style={{ fontWeight: 600, color: palette.blue }}>[{i + 1}] {r.title}</div>
                      <div style={{ color: palette.textTri, fontSize: 11, marginTop: 2 }}>
                        {(r.snippet || "").slice(0, 120)}...
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* 警示 */}
            <div style={{
              padding: "12px 16px", marginBottom: 14, borderRadius: 10,
              background: "#FEF3C7", border: "1px solid #FBBF24",
              fontSize: 13, color: "#92400E", lineHeight: 1.8,
            }}>
              ⚠️ 短新闻内容由 AI 综合实时热搜 + 网络搜索结果撰写,发布前请核对事实、数字和人名
            </div>

            {/* 标题 */}
            <div style={{
              background: palette.card, borderRadius: 14, padding: 22, marginBottom: 14,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 8, fontWeight: 500 }}>📌 短新闻标题</div>
              <div style={{
                fontSize: 22, fontWeight: 700, color: palette.text,
                fontFamily: "'Noto Serif SC'", lineHeight: 1.5,
              }}>{content.xhs_title}</div>
            </div>

            {/* 封面摘要(可编辑) */}
            <div style={{
              background: palette.card, borderRadius: 14, padding: 22, marginBottom: 14,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 10, fontWeight: 500 }}>🎨 封面摘要(显示在封面图上)</div>
              <textarea
                value={content.cover_summary || ""}
                onChange={(e) => setContent({ ...content, cover_summary: e.target.value })}
                style={{
                  width: "100%", minHeight: 160, padding: 14,
                  border: `1px solid ${palette.border}`, borderRadius: 8,
                  fontSize: 14.5, lineHeight: 2, color: palette.text,
                  fontFamily: "'Noto Serif SC', serif", resize: "vertical",
                  background: palette.cardAlt, outline: "none",
                }}
              />
            </div>

            {/* 文案 */}
            <div style={{
              background: palette.card, borderRadius: 14, padding: 22, marginBottom: 14,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 10, fontWeight: 500 }}>📝 小红书正文文案</div>
              <textarea
                value={content.caption || ""}
                onChange={(e) => setContent({ ...content, caption: e.target.value })}
                style={{
                  width: "100%", minHeight: 200, padding: 14,
                  border: `1px solid ${palette.border}`, borderRadius: 8,
                  fontSize: 14.5, lineHeight: 2, color: palette.text,
                  fontFamily: "'Noto Serif SC', serif", resize: "vertical",
                  background: palette.cardAlt, outline: "none",
                }}
              />
            </div>

            {/* 标签 */}
            <div style={{
              background: palette.card, borderRadius: 14, padding: 20, marginBottom: 14,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 10, fontWeight: 500 }}>🏷️ 话题标签</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(content.tags || []).map((t, i) => <Tag key={i} color={palette.purple}>#{t}</Tag>)}
              </div>
            </div>

            {/* 操作 */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn variant="primary" onClick={copyAll}>📋 复制全部内容</Btn>
              <Btn variant="green" onClick={saveAsHistory}>💾 保存到历史</Btn>
            </div>
          </div>

          {/* 右侧预览 */}
          <div style={{ position: "sticky", top: 92, alignSelf: "flex-start" }}>
            <div style={{
              display: "flex", gap: 2, marginBottom: 16,
              background: palette.card, borderRadius: 10, padding: 4,
              border: `1px solid ${palette.border}`,
            }}>
              {tabs.map((t) => (
                <div
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={{
                    flex: 1, padding: "7px 14px", fontSize: 12, fontWeight: 600,
                    cursor: "pointer", borderRadius: 6, textAlign: "center",
                    background: activeTab === t.key ? gradPrimary : "transparent",
                    color: activeTab === t.key ? "#fff" : palette.textSec,
                    transition: "all 0.15s", fontFamily: "'Noto Sans SC'",
                  }}
                >{t.label}</div>
              ))}
            </div>

            <div style={{
              textAlign: "center", fontSize: 11, color: palette.textTri,
              marginBottom: 10, fontFamily: "'Noto Sans SC'",
            }}>
              {activeTab === "note" ? "📱 手机真机效果预览" : "导出尺寸: 1242 × 1660 px"}
            </div>

            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <Btn variant="secondary" size="sm" onClick={() => handleDownload(activeTab)}>
                💾 下载当前{activeTab === "note" ? "预览" : "图片"}
              </Btn>
            </div>

            <div style={{
              display: "flex", justifyContent: "center",
              background: palette.warm, borderRadius: 14, padding: 20,
            }}>
              <div style={{ display: activeTab === "note" ? "block" : "none" }}>
                <XHSNotePreview
                  innerRef={noteRef}
                  xhsTitle={content.xhs_title}
                  caption={content.caption}
                  tags={content.tags}
                  hook={content.cover_hook || content.xhs_title}
                  isShort={true}
                  summary={content.cover_summary || content.caption}
                />
              </div>
              <div style={{ display: activeTab === "cover" ? "block" : "none" }}>
                <ShortNewsCover
                  innerRef={coverRef}
                  title={content.cover_hook || content.xhs_title}
                  summary={content.cover_summary || content.caption}
                  tag="热点速递"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 【历史记录】页 v14 - 支持多选批量删除
// ============================================================
function HistoryPage({ genHistory, onRefresh, onOpen }) {
  const toast = useToast();
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [kw, setKw] = useState("");
  // v14: 多选 / 批删
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const filtered = useMemo(() => {
    let list = genHistory;
    if (typeFilter === "long") list = list.filter((h) => h.hot_topic_source !== "weibo_short_news");
    if (typeFilter === "short") list = list.filter((h) => h.hot_topic_source === "weibo_short_news");
    if (statusFilter !== "all") list = list.filter((h) => h.status === statusFilter);
    if (dateFilter !== "all") {
      const now = new Date();
      const limits = {
        today: 24 * 3600 * 1000,
        week: 7 * 24 * 3600 * 1000,
        month: 30 * 24 * 3600 * 1000,
      };
      const limit = limits[dateFilter];
      list = list.filter((h) => {
        const d = new Date(h.created_at);
        return (now - d) <= limit;
      });
    }
    if (kw.trim()) {
      const k = kw.trim().toLowerCase();
      list = list.filter((h) =>
        (h.xhs_title || "").toLowerCase().includes(k) ||
        (h.article_title || "").toLowerCase().includes(k) ||
        (h.hot_topic || "").toLowerCase().includes(k)
      );
    }
    return list;
  }, [genHistory, typeFilter, statusFilter, dateFilter, kw]);

  // v14: 切换多选模式
  const toggleSelectMode = () => {
    setSelectMode(!selectMode);
    setSelectedIds(new Set());
  };

  // v14: 单个勾选
  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // v14: 全选/全不选
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((h) => h.id)));
    }
  };

  // v14: 批量删除
  const bulkDelete = async () => {
    if (selectedIds.size === 0) {
      toast("请先勾选要删除的记录", "warning");
      return;
    }
    if (!window.confirm(`确定删除已选中的 ${selectedIds.size} 条记录吗?删除后无法恢复。`)) return;
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from("generated_content")
        .delete()
        .in("id", ids);
      if (error) throw error;
      toast(`✅ 已删除 ${ids.length} 条`, "success");
      setSelectedIds(new Set());
      setSelectMode(false);
      onRefresh();
    } catch (e) {
      toast(`批量删除失败: ${e.message}`, "error");
    }
  };

  // v14: 删除全部(包括未勾选的, 需要二次确认)
  const deleteAllFiltered = async () => {
    if (filtered.length === 0) return;
    if (!window.confirm(`这将删除当前筛选下的全部 ${filtered.length} 条记录,确定吗?`)) return;
    if (!window.confirm(`再次确认:真的要删除 ${filtered.length} 条?此操作不可撤销。`)) return;
    try {
      const ids = filtered.map((h) => h.id);
      const { error } = await supabase
        .from("generated_content")
        .delete()
        .in("id", ids);
      if (error) throw error;
      toast(`✅ 已删除全部 ${ids.length} 条`, "success");
      setSelectedIds(new Set());
      setSelectMode(false);
      onRefresh();
    } catch (e) {
      toast(`删除失败: ${e.message}`, "error");
    }
  };

  const copyItem = (h) => {
    const txt = [
      h.xhs_title, "", h.xhs_caption, "",
      (h.xhs_tags || []).map((t) => `#${t}`).join(" "),
    ].join("\n");
    navigator.clipboard.writeText(txt).then(() => toast("✅ 已复制", "success"));
  };

  const togglePublish = async (h) => {
    try {
      const newStatus = h.status === "published" ? "draft" : "published";
      const { error } = await supabase
        .from("generated_content")
        .update({
          status: newStatus,
          published_at: newStatus === "published" ? new Date().toISOString() : null,
        })
        .eq("id", h.id);
      if (error) throw error;
      toast(newStatus === "published" ? "✅ 已标记为已发布" : "已改为草稿", "success");
      onRefresh();
    } catch (e) {
      toast(`操作失败: ${e.message}`, "error");
    }
  };

  const deleteItem = async (h) => {
    if (!window.confirm(`确定删除「${h.xhs_title}」吗?`)) return;
    try {
      const { error } = await supabase.from("generated_content").delete().eq("id", h.id);
      if (error) throw error;
      toast("✅ 已删除", "success");
      onRefresh();
    } catch (e) {
      toast(`删除失败: ${e.message}`, "error");
    }
  };

  // 筛选项配置
  const typeOptions = [
    { key: "all", label: "全部", count: genHistory.length },
    { key: "long", label: "📖 长文", count: genHistory.filter(h => h.hot_topic_source !== "weibo_short_news").length },
    { key: "short", label: "⚡ 短新闻", count: genHistory.filter(h => h.hot_topic_source === "weibo_short_news").length },
  ];
  const statusOptions = [
    { key: "all", label: "全部", count: genHistory.length },
    { key: "draft", label: "📝 草稿", count: genHistory.filter(h => h.status === "draft" || !h.status).length },
    { key: "published", label: "✅ 已发布", count: genHistory.filter(h => h.status === "published").length },
  ];
  const dateOptions = [
    { key: "all", label: "全部时间" },
    { key: "today", label: "今天" },
    { key: "week", label: "近 7 天" },
    { key: "month", label: "近 30 天" },
  ];

  return (
    <div>
      <SectionHeader
        icon="📋" title="历史记录"
        subtitle={`共 ${genHistory.length} 条,当前筛选 ${filtered.length} 条${selectMode ? ` · 已选中 ${selectedIds.size} 条` : ""}`}
        color={palette.purple}
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {selectMode ? (
              <>
                <Btn variant="secondary" onClick={toggleSelectAll}>
                  {selectedIds.size === filtered.length && filtered.length > 0 ? "☐ 取消全选" : "☑ 全选当前"}
                </Btn>
                <Btn variant="danger" onClick={bulkDelete} disabled={selectedIds.size === 0}>
                  🗑 删除选中 ({selectedIds.size})
                </Btn>
                <Btn variant="danger" onClick={deleteAllFiltered}>
                  ⚠️ 删除全部筛选 ({filtered.length})
                </Btn>
                <Btn variant="ghost" onClick={toggleSelectMode}>取消</Btn>
              </>
            ) : (
              <>
                <Btn variant="secondary" onClick={onRefresh}>🔄 刷新</Btn>
                <Btn variant="secondary" onClick={toggleSelectMode}>☑ 批量删除</Btn>
              </>
            )}
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
        {/* 左侧筛选栏 */}
        <div style={{
          background: palette.card, borderRadius: 14, padding: 18,
          border: `1px solid ${palette.border}`,
          position: "sticky", top: 92, alignSelf: "flex-start",
        }}>
          <input
            value={kw} onChange={(e) => setKw(e.target.value)}
            placeholder="🔍 搜索..."
            style={{
              width: "100%", padding: "9px 12px",
              border: `1px solid ${palette.border}`, borderRadius: 8,
              fontSize: 13, outline: "none", marginBottom: 18, boxSizing: "border-box",
              fontFamily: "'Noto Sans SC'",
            }}
          />

          <FilterGroup title="类型" options={typeOptions} value={typeFilter} onChange={setTypeFilter} />
          <FilterGroup title="状态" options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
          <FilterGroup title="时间" options={dateOptions} value={dateFilter} onChange={setDateFilter} />
        </div>

        {/* 右侧列表 */}
        <div>
          {filtered.length === 0 ? (
            <EmptyState icon="📋" title="没有匹配的记录" desc="换一组筛选条件看看,或去生成新内容" />
          ) : filtered.map((h) => {
            const isShort = h.hot_topic_source === "weibo_short_news";
            const isSelected = selectedIds.has(h.id);
            return (
              <div
                key={h.id}
                onClick={() => {
                  if (selectMode) {
                    toggleSelect(h.id);
                  } else {
                    onOpen?.(h);
                  }
                }}
                style={{
                  background: isSelected ? `${palette.red}08` : palette.card,
                  borderRadius: 14, padding: 20, marginBottom: 12,
                  border: `2px solid ${isSelected ? palette.red : palette.border}`,
                  transition: "all 0.15s",
                  cursor: "pointer",
                  position: "relative",
                }}
                onMouseEnter={(e) => { if (!selectMode) { e.currentTarget.style.borderColor = palette.red; e.currentTarget.style.boxShadow = "0 4px 12px rgba(255,36,66,0.08)"; } }}
                onMouseLeave={(e) => { if (!selectMode) { e.currentTarget.style.borderColor = palette.border; e.currentTarget.style.boxShadow = ""; } }}
              >
                {/* v14: 勾选框 */}
                {selectMode && (
                  <div style={{
                    position: "absolute", top: 16, left: 16,
                    width: 22, height: 22, borderRadius: 6,
                    background: isSelected ? palette.red : "#fff",
                    border: `2px solid ${isSelected ? palette.red : "#C8C8C8"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#fff", fontSize: 14, fontWeight: 800,
                    zIndex: 2,
                  }}>
                    {isSelected ? "✓" : ""}
                  </div>
                )}
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  alignItems: "flex-start", gap: 12, flexWrap: "wrap",
                  paddingLeft: selectMode ? 36 : 0,  // 给勾选框让位
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                      <Pill color={isShort ? "#EDE4FF" : "#FFE4E8"} textColor={isShort ? palette.purple : palette.red}>
                        {isShort ? "⚡ 短新闻" : "📖 长文"}
                      </Pill>
                      {h.status === "published"
                        ? <Pill color="#D1FAE5" textColor="#065F46">✅ 已发布</Pill>
                        : <Pill color="#F3F4F6" textColor="#6B7280">📝 草稿</Pill>
                      }
                      <span style={{ fontSize: 11, color: palette.textTri }}>
                        {fmtBeijing(h.created_at)}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 17, fontWeight: 700, color: palette.text,
                      fontFamily: "'Noto Serif SC'", marginBottom: 6, lineHeight: 1.45,
                    }}>{h.xhs_title}</div>
                    {!isShort && h.article_title && (
                      <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 6 }}>
                        基于旧文: 《{h.article_title}》
                      </div>
                    )}
                    {h.hot_topic && (
                      <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 8 }}>
                        🔥 关联热点: {h.hot_topic}
                      </div>
                    )}
                    <div style={{
                      fontSize: 13, color: palette.textSec, lineHeight: 1.8,
                      display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
                      whiteSpace: "pre-wrap",
                    }}>{h.xhs_caption}</div>
                    {(h.xhs_tags || []).length > 0 && (
                      <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(h.xhs_tags || []).slice(0, 8).map((t, i) => (
                          <span key={i} style={{ fontSize: 11, color: palette.blue }}>#{t}</span>
                        ))}
                      </div>
                    )}
                    <div style={{
                      marginTop: 12, fontSize: 11, color: palette.red, fontWeight: 500,
                    }}>点击查看完整内容 / 下载图片 →</div>
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Btn variant="secondary" size="sm" onClick={() => copyItem(h)}>📋 复制</Btn>
                    <Btn variant={h.status === "published" ? "ghost" : "green"} size="sm" onClick={() => togglePublish(h)}>
                      {h.status === "published" ? "📝 撤回" : "✅ 标记已发布"}
                    </Btn>
                    <Btn variant="danger" size="sm" onClick={() => deleteItem(h)}>🗑 删除</Btn>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 【历史记录详情】页 v7 - 显示完整文案 + 重新渲染图片预览
// ============================================================
function HistoryDetailPage({ item, onBack }) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("note");

  // refs
  const noteRef = useRef(null);
  const coverRef = useRef(null);
  const pageRefs = useRef([]);

  const isShort = item.hot_topic_source === "weibo_short_news";

  // 重建 content 对象(兼容原来的 xxx_caption / xxx_title 字段命名)
  const content = useMemo(() => ({
    xhs_title: item.xhs_title || "",
    caption: item.xhs_caption || "",
    tags: item.xhs_tags || [],
    cover_hook: "",   // 历史中没存, 降级用 title
    cover_summary: item.article_content_md || "",  // 短新闻的 summary 存在这里
  }), [item]);

  // 长文: 把原文分页
  const articleBlocks = useMemo(
    () => isShort ? [] : parseArticleBlocks(item.article_content_md || ""),
    [item, isShort]
  );
  const articlePages = useMemo(
    () => paginateBlocks(articleBlocks),
    [articleBlocks]
  );

  const copyAll = () => {
    const txt = [content.xhs_title, "", content.caption, "",
                 (content.tags || []).map((t) => `#${t}`).join(" ")].join("\n");
    navigator.clipboard.writeText(txt).then(() => toast("✅ 已复制", "success"));
  };

  const handleDownload = async (tabKey) => {
    const safeTitle = (content.xhs_title || "内容").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    if (tabKey === "note") {
      const ok = await downloadAsImage(noteRef, `${safeTitle}_笔记预览.png`, PHONE_W, PHONE_H);
      toast(ok ? "✅ 已下载" : "下载失败", ok ? "success" : "error");
    } else if (tabKey === "cover") {
      const ok = await downloadAsImage(coverRef, `${safeTitle}_封面.png`, CARD_W, CARD_H);
      toast(ok ? "✅ 已下载 (1242×1660)" : "下载失败", ok ? "success" : "error");
    } else if (tabKey.startsWith("page-")) {
      const idx = parseInt(tabKey.slice(5));
      const ref = { current: pageRefs.current[idx] };
      const ok = await downloadAsImage(ref, `${safeTitle}_第${idx + 1}页.png`, CARD_W, CARD_H);
      toast(ok ? `✅ 第 ${idx + 1} 页已下载` : "下载失败", ok ? "success" : "error");
    }
  };

  // 长文多张图批下载
  const downloadAll = async () => {
    const safeTitle = (content.xhs_title || "内容").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    let ok = await downloadAsImage(coverRef, `${safeTitle}_00_封面.png`, CARD_W, CARD_H);
    if (!isShort) {
      for (let i = 0; i < articlePages.length; i++) {
        const ref = { current: pageRefs.current[i] };
        await new Promise(r => setTimeout(r, 300));
        const r2 = await downloadAsImage(ref, `${safeTitle}_${String(i + 1).padStart(2, "0")}_正文.png`, CARD_W, CARD_H);
        ok = ok && r2;
      }
    }
    toast(ok ? "✅ 已批量下载" : "部分下载失败", ok ? "success" : "warning");
  };

  const tabs = useMemo(() => {
    const t = [
      { key: "note", label: "📱 笔记预览" },
      { key: "cover", label: "🎨 封面" },
    ];
    articlePages.forEach((_, i) => t.push({ key: `page-${i}`, label: `📄 正文 ${i + 1}` }));
    return t;
  }, [articlePages]);

  return (
    <div>
      <SectionHeader
        icon="📋"
        title={`${isShort ? "短新闻" : "长文"}详情`}
        subtitle={`创建于 ${fmtBeijing(item.created_at)} · 状态: ${item.status === "published" ? "已发布" : "草稿"}`}
        color={palette.purple}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" onClick={onBack}>← 返回列表</Btn>
            <Btn variant="primary" onClick={copyAll}>📋 复制全部</Btn>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 460px", gap: 28, alignItems: "flex-start" }}>
        {/* 左侧:文案 */}
        <div>
          {item.hot_topic && (
            <div style={{
              padding: "10px 16px", borderRadius: 10, marginBottom: 14,
              background: `${palette.red}08`, border: `1px solid ${palette.red}20`,
              fontSize: 13, color: palette.red,
            }}>
              🔥 关联热点: <strong>{item.hot_topic}</strong>
            </div>
          )}

          <div style={{
            padding: 20, background: palette.card, borderRadius: 14,
            border: `1px solid ${palette.border}`, marginBottom: 14,
          }}>
            <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 8 }}>📌 小红书标题</div>
            <div style={{
              fontSize: 22, fontWeight: 800, lineHeight: 1.45, color: palette.text,
              fontFamily: "'Noto Serif SC', serif",
            }}>{content.xhs_title}</div>
          </div>

          {!isShort && item.article_title && (
            <div style={{
              padding: "14px 20px", background: palette.cardAlt, borderRadius: 10,
              border: `1px solid ${palette.border}`, marginBottom: 14,
              fontSize: 13, color: palette.textSec,
            }}>
              <strong>基于旧文:</strong> 《{item.article_title}》
            </div>
          )}

          <div style={{
            padding: 20, background: palette.card, borderRadius: 14,
            border: `1px solid ${palette.border}`, marginBottom: 14,
          }}>
            <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 10 }}>📝 正文文案</div>
            <div style={{
              fontSize: 15, lineHeight: 1.95, color: palette.text,
              whiteSpace: "pre-wrap", fontFamily: "'Noto Serif SC', serif",
            }}>{content.caption}</div>
          </div>

          {(content.tags || []).length > 0 && (
            <div style={{
              padding: 20, background: palette.card, borderRadius: 14,
              border: `1px solid ${palette.border}`, marginBottom: 14,
            }}>
              <div style={{ fontSize: 12, color: palette.textTri, marginBottom: 10 }}>🏷 话题标签</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {content.tags.map((t, i) => (
                  <span key={i} style={{
                    padding: "5px 12px", background: `${palette.blue}15`, borderRadius: 6,
                    fontSize: 13, color: palette.blue, fontWeight: 500,
                  }}>#{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 右侧:预览 + 下载 (v10 统一的翻页 UI) */}
        <div style={{ position: "sticky", top: 92 }}>
          {/* 固定 Tab */}
          <div style={{
            display: "flex", gap: 2, marginBottom: 10,
            background: palette.card, borderRadius: 10, padding: 4,
            border: `1px solid ${palette.border}`,
          }}>
            {[
              { key: "note", label: "📱 笔记预览" },
              { key: "cover", label: "🎨 封面" },
            ].map((t) => (
              <div key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  flex: 1, padding: "8px 14px", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", borderRadius: 6, textAlign: "center",
                  background: activeTab === t.key ? gradPrimary : "transparent",
                  color: activeTab === t.key ? "#fff" : palette.textSec,
                  fontFamily: "'Noto Sans SC'",
                }}>{t.label}</div>
            ))}
          </div>

          {/* 长文:正文页网格 */}
          {!isShort && articlePages.length > 0 && (
            <div style={{
              background: palette.card, borderRadius: 10, padding: "10px 12px",
              border: `1px solid ${palette.border}`, marginBottom: 10,
            }}>
              <div style={{ fontSize: 11, color: palette.textTri, marginBottom: 8, fontFamily: "'Noto Sans SC'" }}>
                📄 正文页 (共 {articlePages.length} 页) {/^page-/.test(activeTab) && ` · 当前第 ${parseInt(activeTab.slice(5)) + 1} 页`}
              </div>
              <div style={{
                display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(40px, 1fr))`,
                gap: 4, maxHeight: 120, overflowY: "auto",
              }}>
                {articlePages.map((_, i) => {
                  const key = `page-${i}`;
                  const active = activeTab === key;
                  return (
                    <div key={key} onClick={() => setActiveTab(key)} style={{
                      padding: "6px 0", fontSize: 12, fontWeight: 600,
                      textAlign: "center", cursor: "pointer", borderRadius: 6,
                      background: active ? palette.red : palette.cardAlt,
                      color: active ? "#fff" : palette.textSec,
                      border: `1px solid ${active ? palette.red : palette.border}`,
                      fontFamily: "'Noto Sans SC'",
                    }}>{i + 1}</div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ textAlign: "center", fontSize: 11, color: palette.textTri, marginBottom: 10 }}>
            {activeTab === "note" ? "📱 手机真机效果预览" : "导出尺寸: 1242 × 1660 px"}
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <Btn variant="secondary" size="sm" onClick={() => handleDownload(activeTab)}>
              💾 下载当前
            </Btn>
            {!isShort && (
              <Btn variant="primary" size="sm" onClick={downloadAll}>
                📦 批量下载全部
              </Btn>
            )}
          </div>

          {/* 预览区 */}
          <div style={{
            display: "flex", justifyContent: "center",
            background: palette.warm, borderRadius: 14, padding: 20,
          }}>
            {/* 笔记预览 */}
            <div style={{ display: activeTab === "note" ? "block" : "none" }}>
              <XHSNotePreview
                innerRef={noteRef}
                xhsTitle={content.xhs_title}
                caption={content.caption}
                tags={content.tags}
                hook={content.xhs_title}
                articleTitle={item.article_title || ""}
                isShort={isShort}
                summary={content.cover_summary || content.caption}
              />
            </div>
            {/* 封面 */}
            <div style={{ display: activeTab === "cover" ? "block" : "none" }}>
              {isShort ? (
                <ShortNewsCover
                  innerRef={coverRef}
                  title={content.xhs_title}
                  summary={content.cover_summary || content.caption}
                  tag="热点速递"
                />
              ) : (
                <XHSCoverLongForm
                  innerRef={coverRef}
                  hook={content.xhs_title}
                  xhsTitle={content.xhs_title}
                  articleTitle={item.article_title}
                  pubDate=""
                />
              )}
            </div>
            {/* 长文正文页 */}
            {!isShort && articlePages.map((pageBlocks, i) => (
              <div key={i} style={{ display: activeTab === `page-${i}` ? "block" : "none" }}>
                <XHSContentPage
                  innerRef={(el) => pageRefs.current[i] = el}
                  blocks={pageBlocks}
                  pageIndex={i}
                  totalPages={articlePages.length}
                  showHeader={i === 0}
                  articleTitle={item.article_title}
                  pubDate=""
                  authorLine={null}
                  isLast={i === articlePages.length - 1}
                />
              </div>
            ))}
          </div>

          {/* 底部翻页器 (仅对封面/正文页显示) */}
          {!isShort && /^(cover|page-)/.test(activeTab) && articlePages.length > 0 && (
            <div style={{
              marginTop: 14, display: "flex",
              alignItems: "center", justifyContent: "center", gap: 10,
              fontFamily: "'Noto Sans SC'",
            }}>
              <Btn variant="secondary" size="sm"
                onClick={() => {
                  if (activeTab === "cover") return;
                  const idx = parseInt(activeTab.slice(5));
                  if (idx === 0) setActiveTab("cover");
                  else setActiveTab(`page-${idx - 1}`);
                }}
                disabled={activeTab === "cover"}
              >← 上一页</Btn>
              <div style={{ fontSize: 13, color: palette.textSec, minWidth: 80, textAlign: "center" }}>
                {activeTab === "cover"
                  ? `封面 / ${articlePages.length + 1}`
                  : `${parseInt(activeTab.slice(5)) + 2} / ${articlePages.length + 1}`}
              </div>
              <Btn variant="secondary" size="sm"
                onClick={() => {
                  if (activeTab === "cover") setActiveTab("page-0");
                  else {
                    const idx = parseInt(activeTab.slice(5));
                    if (idx < articlePages.length - 1) setActiveTab(`page-${idx + 1}`);
                  }
                }}
                disabled={/^page-/.test(activeTab) && parseInt(activeTab.slice(5)) === articlePages.length - 1}
              >下一页 →</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ title, options, value, onChange }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: palette.textTri,
        letterSpacing: 1, marginBottom: 8, textTransform: "uppercase",
      }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {options.map((o) => (
          <div
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              padding: "8px 12px", borderRadius: 8, cursor: "pointer",
              fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center",
              background: value === o.key ? `${palette.red}10` : "transparent",
              color: value === o.key ? palette.red : palette.textSec,
              fontWeight: value === o.key ? 600 : 400,
              fontFamily: "'Noto Sans SC'",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { if (value !== o.key) e.currentTarget.style.background = palette.warm; }}
            onMouseLeave={(e) => { if (value !== o.key) e.currentTarget.style.background = "transparent"; }}
          >
            <span>{o.label}</span>
            {o.count !== undefined && (
              <span style={{ fontSize: 11, color: palette.textTri }}>{o.count}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 全局样式注入
// ============================================================
function GlobalStyles() {
  return (
    <style>{`
      ${FONT_IMPORT}
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; font-family: 'Noto Sans SC', -apple-system, sans-serif; background: ${palette.bg}; color: ${palette.text}; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: ${palette.borderMed}; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: ${palette.textTri}; }
      a { color: ${palette.red}; text-decoration: none; }
      a:hover { text-decoration: underline; }
      button { font-family: 'Noto Sans SC', sans-serif; }
    `}</style>
  );
}

// ============================================================
// 顶部 Header
// ============================================================
function TopHeader({ backend }) {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 100,
      background: "rgba(248,246,243,.88)", backdropFilter: "blur(20px)",
      borderBottom: `1px solid ${palette.border}`, padding: "0 32px",
    }}>
      <div style={{
        maxWidth: 1480, margin: "0 auto",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        height: 68,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: gradPrimary,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 22, fontWeight: 800,
            boxShadow: `0 4px 12px ${palette.red}40`,
          }}>📕</div>
          <div>
            <div style={{
              fontSize: 18, fontWeight: 700, color: palette.text,
              fontFamily: "'Noto Serif SC'",
            }}>小红书内容工作台</div>
            <div style={{ fontSize: 11, color: palette.textTri, marginTop: 1 }}>
              三联生活周刊 · AI驱动的内容运营
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {backend?.ok ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 20,
              background: `${palette.green}14`, fontSize: 12, color: palette.green,
              fontWeight: 500,
            }}>
              <StatusDot color={palette.green} size={7} />
              系统就绪
              {backend.ai_provider && <span style={{ color: palette.textSec }}> · {backend.ai_provider}</span>}
            </div>
          ) : (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 20,
              background: `${palette.orange}14`, fontSize: 12, color: palette.orange,
              fontWeight: 500,
            }}>
              <StatusDot color={palette.orange} size={7} />
              后端未连接
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ============================================================
// 左侧 Sidebar 导航
// ============================================================
const navItems = [
  { id: "dashboard", icon: "📊", label: "仪表盘" },
  { id: "hot", icon: "🔥", label: "实时热点" },
  { id: "articles", icon: "📚", label: "文章库" },
  { id: "match", icon: "✨", label: "AI 匹配推荐" },
  { id: "generate", icon: "✍️", label: "内容生成" },
  { id: "history", icon: "📋", label: "历史记录" },
];

function Sidebar({ activeRoute, onNavigate }) {
  return (
    <nav style={{
      width: 210, flexShrink: 0,
      position: "sticky", top: 92, alignSelf: "flex-start",
    }}>
      {navItems.map((item) => {
        const active = activeRoute === item.id;
        return (
          <div
            key={item.id}
            onClick={() => onNavigate(item.id)}
            style={{
              padding: "13px 18px", borderRadius: 12, marginBottom: 4,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
              background: active ? `linear-gradient(135deg, ${palette.red}12, ${palette.orange}10)` : "transparent",
              color: active ? palette.red : palette.textSec,
              fontWeight: active ? 600 : 500,
              fontSize: 14.5, transition: "all 0.2s",
              borderLeft: active ? `3px solid ${palette.red}` : "3px solid transparent",
              fontFamily: "'Noto Sans SC'",
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = palette.warm; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ fontSize: 19 }}>{item.icon}</span>
            {item.label}
          </div>
        );
      })}
    </nav>
  );
}

// ============================================================
// 主 App
// ============================================================
function AppMain() {
  const toast = useToast();

  // 数据状态
  const [backend, setBackend] = useState(null);
  const [articles, setArticles] = useState([]);
  const [weiboHot, setWeiboHot] = useState([]);
  const [genHistory, setGenHistory] = useState([]);
  const [matchHistory, setMatchHistory] = useState([]);  // v7: 匹配历史
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [loadingWeibo, setLoadingWeibo] = useState(false);

  // 路由
  const [route, setRoute] = useState("dashboard");

  // 【提升】匹配结果状态 - 在 App 层维护, 离开再回来依然在
  const [longRecs, setLongRecs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("xhs_long_recs") || "[]"); }
    catch { return []; }
  });
  const [shortRecs, setShortRecs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("xhs_short_recs") || "[]"); }
    catch { return []; }
  });
  const [lastMatchedAt, setLastMatchedAt] = useState(() => {
    const t = localStorage.getItem("xhs_last_matched_at");
    return t ? new Date(t) : null;
  });
  const [matchTab, setMatchTab] = useState("long");

  // v7: 历史记录详情查看
  const [viewingHistory, setViewingHistory] = useState(null);

  // localStorage 同步
  useEffect(() => {
    try { localStorage.setItem("xhs_long_recs", JSON.stringify(longRecs)); } catch {}
  }, [longRecs]);
  useEffect(() => {
    try { localStorage.setItem("xhs_short_recs", JSON.stringify(shortRecs)); } catch {}
  }, [shortRecs]);
  useEffect(() => {
    if (lastMatchedAt) localStorage.setItem("xhs_last_matched_at", lastMatchedAt.toISOString());
  }, [lastMatchedAt]);

  // 选中的对象
  const [viewingArticle, setViewingArticle] = useState(null);        // 文章详情页
  const [genArticle, setGenArticle] = useState(null);                // 生成页用的文章
  const [genHotTopic, setGenHotTopic] = useState(null);              // 生成页用的热点
  const [genShortTopic, setGenShortTopic] = useState(null);          // 短新闻生成用的热搜
  const [genMode, setGenMode] = useState("long");                    // long | short

  // 爬虫
  const [crawlTask, setCrawlTask] = useState(null);
  const [crawlProgress, setCrawlProgress] = useState(null);

  // 初始加载
  useEffect(() => {
    loadArticles();
    loadWeiboHot();
    loadGenHistory();
    loadMatchHistory();
  }, []);

  // Backend ping
  useEffect(() => {
    let alive = true;
    let timer;
    const run = async () => {
      const r = await pingBackend();
      if (!alive) return;
      setBackend(r);
      if (!r?.ok) timer = setTimeout(run, 5000);
    };
    run();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);

  // 爬虫进度轮询
  useEffect(() => {
    if (!crawlTask) return;
    let alive = true;
    const poll = async () => {
      const p = await getCrawlProgress(crawlTask);
      if (!alive) return;
      setCrawlProgress(p);
      if (p?.status === "done") {
        toast("✅ 爬虫任务完成,刷新数据中...", "success");
        setTimeout(() => {
          loadWeiboHot();
          setCrawlTask(null);
          setCrawlProgress(null);
        }, 1500);
        return;
      }
      if (p?.status === "error" || p?.status === "cancelled") {
        toast(`爬虫${p.status === "error" ? "失败" : "已取消"}: ${p.message || "未知"}`, "error");
        setCrawlTask(null);
        setCrawlProgress(null);
        return;
      }
      setTimeout(poll, 2000);
    };
    poll();
    return () => { alive = false; };
  }, [crawlTask, toast]);

  const loadArticles = async () => {
    setLoadingArticles(true);
    try {
      const data = await fetchArticlesAll();
      setArticles(data);
    } catch (e) {
      toast(`加载文章库失败: ${e.message}`, "error");
    } finally {
      setLoadingArticles(false);
    }
  };

  const loadWeiboHot = async () => {
    setLoadingWeibo(true);
    try {
      const data = await fetchLatestWeiboHot();
      setWeiboHot(data);
    } catch (e) {
      toast(`加载微博热搜失败: ${e.message}`, "error");
    } finally {
      setLoadingWeibo(false);
    }
  };

  const loadGenHistory = async () => {
    try {
      setGenHistory(await fetchGeneratedHistory());
    } catch (e) {
      console.warn("加载历史失败", e);
    }
  };

  const loadMatchHistory = async () => {
    try {
      setMatchHistory(await fetchMatchHistory());
    } catch (e) {
      console.warn("加载匹配历史失败", e);
    }
  };

  const handleStartCrawler = async (count) => {
    if (!backend?.ok) {
      toast("后端未启动", "error"); return;
    }
    try {
      const r = await startWeiboCrawler(count);
      setCrawlTask(r.task_id);
      toast(`🕷 爬虫已启动 (任务 ${r.task_id}),将爬取最多 ${count} 条`, "success");
    } catch (e) {
      toast(`启动爬虫失败: ${e.message}`, "error");
    }
  };

  // 从 AI 匹配跳转到生成-长文
  const handlePickLongForm = (article, hotTopic) => {
    setGenArticle(article);
    setGenHotTopic(hotTopic);
    setGenMode("long");
    setRoute("generate");
  };

  // 从 AI 匹配跳转到生成-短新闻
  const handlePickShortNews = (hotTopic) => {
    setGenShortTopic(hotTopic);
    setGenMode("short");
    setRoute("generate");
  };

  // 从文章详情页跳转到生成
  const handleArticleToGen = (article) => {
    setGenArticle(article);
    setGenHotTopic(null);
    setGenMode("long");
    setViewingArticle(null);
    setRoute("generate");
  };

  // 在内容生成页切换模式(当独立进入时)
  const renderGeneratePage = () => {
    // 子面板: 顶部可切换 长文/短新闻 模式
    return (
      <div>
        <div style={{
          display: "flex", gap: 2, marginBottom: 20, maxWidth: 340,
          background: palette.card, borderRadius: 10, padding: 4,
          border: `1px solid ${palette.border}`,
        }}>
          {[
            { key: "long", label: "📖 长文模式", color: palette.red },
            { key: "short", label: "⚡ 短新闻模式", color: palette.purple },
          ].map((m) => (
            <div
              key={m.key}
              onClick={() => setGenMode(m.key)}
              style={{
                flex: 1, padding: "8px 16px", fontSize: 13, fontWeight: 600,
                cursor: "pointer", borderRadius: 6, textAlign: "center",
                background: genMode === m.key ? gradPrimary : "transparent",
                color: genMode === m.key ? "#fff" : palette.textSec,
                transition: "all 0.15s", fontFamily: "'Noto Sans SC'",
              }}
            >{m.label}</div>
          ))}
        </div>

        {genMode === "long" ? (
          genArticle ? (
            <GenerateLongPage
              article={genArticle}
              hotTopic={genHotTopic}
              onBack={() => setRoute("match")}
              onSaved={loadGenHistory}
            />
          ) : (
            <EmptyState
              icon="✍️" title="还没选择要生成的文章"
              desc="去「AI 匹配推荐」让 AI 给出推荐,或去「文章库」直接挑一篇"
              action={
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <Btn variant="primary" onClick={() => setRoute("match")}>去 AI 匹配推荐 →</Btn>
                  <Btn variant="secondary" onClick={() => setRoute("articles")}>去文章库 →</Btn>
                </div>
              }
            />
          )
        ) : (
          genShortTopic ? (
            <GenerateShortPage
              hotTopic={genShortTopic}
              onBack={() => setRoute("match")}
              onSaved={loadGenHistory}
            />
          ) : (
            <EmptyState
              icon="⚡" title="还没选择要生成的热搜"
              desc="去「AI 匹配推荐」的短新闻 Tab 选一条"
              action={<Btn variant="primary" onClick={() => setRoute("match")}>去 AI 匹配推荐 →</Btn>}
            />
          )
        )}
      </div>
    );
  };

  // 当前页渲染
  const renderPage = () => {
    // 历史详情(子页)
    if (viewingHistory) {
      return (
        <HistoryDetailPage
          item={viewingHistory}
          onBack={() => setViewingHistory(null)}
        />
      );
    }
    // 文章详情页(子页, 不在 Sidebar 中)
    if (viewingArticle) {
      return (
        <ArticleDetailPage
          article={viewingArticle}
          onBack={() => setViewingArticle(null)}
          onPickForGenerate={handleArticleToGen}
        />
      );
    }

    switch (route) {
      case "dashboard":
        return (
          <DashboardPage
            articles={articles} weiboHot={weiboHot} genHistory={genHistory}
            backend={backend}
            onStartCrawler={handleStartCrawler}
            crawlTask={crawlTask} crawlProgress={crawlProgress}
          />
        );
      case "hot":
        return (
          <HotTopicsPage
            weiboHot={weiboHot} loading={loadingWeibo}
            onRefresh={loadWeiboHot}
          />
        );
      case "articles":
        return (
          <ArticlesPage
            articles={articles} loading={loadingArticles}
            onRefresh={loadArticles}
            onOpenArticle={(a) => setViewingArticle(a)}
          />
        );
      case "match":
        return (
          <MatchPage
            articles={articles} weiboHot={weiboHot}
            onPickLongForm={handlePickLongForm}
            onPickShortNews={handlePickShortNews}
            longRecs={longRecs} setLongRecs={setLongRecs}
            shortRecs={shortRecs} setShortRecs={setShortRecs}
            lastMatchedAt={lastMatchedAt} setLastMatchedAt={setLastMatchedAt}
            activeTab={matchTab} setActiveTab={setMatchTab}
            matchHistory={matchHistory} reloadMatchHistory={loadMatchHistory}
          />
        );
      case "generate":
        return renderGeneratePage();
      case "history":
        return (
          <HistoryPage
            genHistory={genHistory}
            onRefresh={loadGenHistory}
            onOpen={(h) => setViewingHistory(h)}
          />
        );
      default:
        return <div>页面不存在</div>;
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: palette.bg }}>
      <TopHeader backend={backend} />

      <div style={{
        maxWidth: 1480, margin: "0 auto", padding: "0 32px",
        display: "flex", gap: 28, marginTop: 28, paddingBottom: 60,
      }}>
        {!viewingArticle && !viewingHistory && <Sidebar activeRoute={route} onNavigate={setRoute} />}
        <main style={{ flex: 1, minWidth: 0, animation: "fadeIn 0.4s ease" }}>
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

// ============================================================
// 根组件 (Toast Provider 包裹)
// ============================================================
export default function App() {
  return (
    <ToastProvider>
      <GlobalStyles />
      <AppMain />
    </ToastProvider>
  );
}
