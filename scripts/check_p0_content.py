#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""P0 内容规约门禁（棘轮）：emoji 图标 / 紫粉渐变 / 硬编码色 / 禁用缓动 / AI 模板文案
/ 硬编码用户可见文案。

背景（2026-10 全量审计实测）：团队 P0 内容规则此前只活在文档与人的记忆里，
机械覆盖有四层洞：
  P0-1 emoji 作图标：e2e/ui-style.spec.ts 只渲染扫 signup / login / dashboard 三个页面，
    定价页（公开营销页）曾用 9 个 ✅ 作功能图标，CI 全程绿灯（现已修，本门禁防复发）；
  P0-2 紫粉渐变：零覆盖；
  P0-4 硬编码色：200+ 个文件带硬编码色值，CI 一道不管；
  P0-5 禁用缓动：design/design-tokens.css 逐字写着被禁的
    cubic-bezier(0.68, -0.55, 0.265, 1.55)，并随 next build 进入产物 CSS；
  AI 模板文案（Lorem ipsum / Welcome to Our App / Sign up today）：零覆盖；
  P0-6 硬编码用户可见文案（2026-10-17 补，最后一块零覆盖）：这是一个 zh/en 双语应用
    （词条在 web/messages/{zh,en}.json），写死在组件里的中文在英文 locale 下照样显示
    中文。实测 web/ 生产代码 10 个文件 99 处，其中 web/app/[locale]/w/[wid]/ai-tools/
    page.tsx 的 7 个 Tab 标签写死在 `fallbackZh` 里、而同一文件其它文案走的是
    useTranslations("ai.aiTools")——典型"一半翻了一半没翻"。这类缺陷此前**零**机械覆盖。
本脚本把其中**可机械判定**的部分变成 CI 门禁；判不了的（如"渐变好不好看"）
刻意不做——天天误叫的门禁只会被 --no-verify 掉，等于没建。

判据（红因集合；全部是"新增/变多"语义——棘轮，不是一刀切禁止）：
    NEW_P0_1 / NEW_P0_2 / NEW_P0_4 / NEW_P0_5 / NEW_AI_COPY / NEW_P0_6
        基线外首见的 (文件, 规则) -> 新违反
    REGRESSION_P0_1 / ... / REGRESSION_AI_COPY / REGRESSION_P0_6
        已登记文件的违反处数变多 -> 只许减少
非红提示（只打印，不判失败）：基线里已归零或减少的条目，建议删行收紧。
刻意不把"归零未删行"做成硬失败：web/ 有并行会话在改，把别人修好的违规变成
CI 红灯，只会训练大家 --no-verify。收紧靠人周期性跑 --emit 复核。

口径（关键，别改）：
  * 扫描范围：web/**/*.ts、web/**/*.tsx（全规则）；CSS 另出一组——
    design/design-tokens.css 与 web/app/globals.css 只跑 **P0-2 + P0-5**。
    为什么不把 CSS 纳入 P0-1/P0-3/P0-4（实测数据，不是拍脑袋）：
      - P0-4 若扫全部 CSS = 4 个文件 278 处，其中 122 处是 **Token 的定义本身**
        （design-tokens.css 49 + 其 app 副本 49 + globals.css 24），156 处是
        web/test-results/ 下 Playwright 录制的产物。给"定义层"报错等于让门禁
        对着字典骂错别字，必死。Token 源文件**保留** P0-2/P0-5 是因为
        「名义 clean 的 token 源文件里藏着被禁内容」正是本项目踩过的坑
        （cubic-bezier(0.68,-0.55,0.265,1.55) 就写在 design-tokens.css 里，
        随 next build 进产物 CSS，而链接近它的消费者是死类，人眼评审看不见）。
      - web/app/design-tokens.css 是 design/design-tokens.css 的逐字节同步副本
        （由 check_design_tokens_sync.py 钉死），修源头即修副本，不重复扫——
        否则同一个错误要修两遍、报两遍。
  * **注释先剥后扫**：// 与 /* */（含跨行块注释）整体剔除后再匹配，字符串字面量保留。
    否则文档注释里的规则示例（"P0-1：禁 ✅ 作图标"）、issue 引用（#135）、
    token 说明（浅 #4263EB / 深 #4973D1）会天天误叫。
    2026-10-17 起顺带认识**正则字面量**（前一个有效字符是标识符/数字/右括号时那道 `/`
    只能是除法，否则一路扫到配对的 `/`，中间的字符串引号不算字符串）。不加这条，
    `.replace(/`([^`]+)`/g, "$1")` 会把状态机带跑偏，后面整段 // 注释一行都剥不掉
    （实测 web/lib/format.ts 8 行、decisions/page.tsx 15 行），对 P0-6 直接变成假阳性。
    已知边界：极个别写法（如正则里含 `//`）仍可能漏报一行，宁偏漏报一侧。
  * P0-1 同时吃 **转义写法**（"\u2715" / "\u{1F600}"）。理由：不解码就等于给违反留一道
    「写字面字符违规、写转义合法」的后门——实测 web/components/workflow/
    WorkflowExecutionList.tsx:130 的 `{"\u2715"}`（✕ 关闭图标）正是这么藏过去的。
    已知边界：正则字面量里出现同类转义会被算进来（同上面的注释边界，宁偏严格一侧）。
  * P0-4 白名单：#fff / #ffffff / #000 / #000000（大小写不敏感）。
    Tailwind 任意值类名（bg-[#abc]、text-[var(--x,#fff)] 里的 #fff）按同一口径——
    前者算硬编码要报，后者命中白名单不报。
  * P0-4 还要求 hex 前面**不能紧跟 [0-9A-Za-z_-]**。这条站位是实测换来的：
    测试用例名里的 `TC-RLS-#119`、密码样本 `"Share#2026"` 都被旧口径判成硬编码色，
    靠"`#` 后跟 3-8 位十六进制"这一条根本区分不出来。加了左界后这两类自然消失，
    不需要为它们开路径豁免。
  * **没有路径豁免，只有目录剪枝（node_modules/.next 等）**——P0-6 的 tests/e2e 是
    唯一例外，且带实测数字与负向断言，详见 P0_6_SKIP_PREFIX 处注释。除此之外是
    有意的结果：先按"零证据不上豁免"的口径把上一版的 4 条路径豁免逐个压测（见
    --self-test 与 commit message），三条已经被上面两条口径修正消解为假阳性
    （假阳性要修检测器，不是给检测器戴眼罩）；余下一条（emoji 路径豁免）在当前仓库的
    生产代码、web/tests/、web/e2e/ 里均**零命中**——即没有任何现有样本需要它掩护。
    将来真出现需要承载 emoji 的场景（UGC 夹具、负向断言），在这里加并写明理由即可，
    但请连同一条 self-test 用例一起加：没有用例的豁免会在下一次口径修正里被悄悄删掉。
  * P0-5 同时接住 framer-motion 的 BezierDefinition 数组（ease: [x1,y1,x2,y2]）——
    JS 侧不接住，P0-5 在 TS 里就仍然是零覆盖，而那正是本次要补的洞
    （motion-tokens.ts / WidgetCard / Toast 用的都是数组形式）。
  * 计数口径：每个匹配记一处（一行 3 个 hex = 3 处；P0-6 是每段连续中文一处）。
    修掉一处 = 计数减一，放行；新增一处 = 计数加一，红。
  * P0-6 是唯一**整文件级**匹配的规则（其余逐行）：`<h2>\n  页面未找到\n</h2>` 这种
    独占一行的 JSX 文本节点是 app/not-found.tsx 的实际写法，`>` 与 `<` 凑不到一行里。
    它还有自己的第二个视图（把引号串正文抹平），理由见 strip_comments 的 mask_strings。
  * 基线粒度是「文件 + 规则 + 处数」而不是「文件:行号」：web/ 有并行会话在改，
    行号会漂，任何往上插一行都会让一批登记项错位成"新增"——那正是天天误叫的死法。
    处数口径让行号漂移无害：只有真的增删了违规内容才会改变计数。
    报错时仍然打印每条命中所在的**当前行号与原文**（便于定位），但行号不进判据。

用法：
    python scripts/check_p0_content.py                 # 检查（CI）
    python scripts/check_p0_content.py --emit          # 人工核对后刷新基线
    python scripts/check_p0_content.py --self-test     # 注入式自检
    python scripts/check_p0_content.py --root <path>   # 指定仓库根（红线注入证明用）

--emit 的基线保留规则（改这里前先读）：
    基线文件按「分组标题 -> 手写说明 -> 条目」组织，--emit **只重写条目与统计行**，
    每组下面的手写说明原样保留（见 _split_baseline_notes）。那些说明是这份文件
    唯一可审计的部分——"哪一条为什么算合理硬约束、哪一次收紧消掉了什么"，
    抹掉它们等于把基线变成一份没人敢问来源的额度表。清零的规则只要还留着说明，
    该组就连同"0 个文件 / 0 处"一起保留，作为给后来人的历史记录。
"""
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE_REL = "scripts/p0-content-baseline.txt"

RULES = ("P0-1", "P0-2", "P0-4", "P0-5", "AI-COPY", "P0-6")
RULE_DESC = {
    "P0-1": "emoji 作功能图标",
    "P0-2": "紫粉渐变（indigo 系与 pink 系同现于同一个渐变）",
    "P0-4": "硬编码色值（#rgb/#rgba/#rrggbb/#rrggbbaa 字面量）",
    "P0-5": "禁用缓动（cubic-bezier(0.68,-0.55,0.265,1.55) 或第二控制点 y>1 过冲）",
    "AI-COPY": "AI 模板文案（Lorem ipsum / Welcome to Our App / Sign up today）",
    "P0-6": "硬编码用户可见文案（未走 i18n 的中文字符串）",
}

# 扫描时剪掉的目录：依赖、构建产物、覆盖率报告、用户上传（UGC）、测试残留
SKIP_DIRS = {
    "node_modules", ".next", "coverage", "test-results", "playwright-report",
    "dist", "build", "uploads", "__pycache__", ".git",
}

# P0-2 / P0-5 额外扫描的 CSS（其余规则不扫 CSS，理由见模块 docstring 的实测数据）
EXTRA_CSS_RELS = ("design/design-tokens.css", "web/app/globals.css")
CSS_RULES = ("P0-2", "P0-5")

# ─── 检测正则 ───

# emoji：Extended_Pictographic 的工程近似。刻意**不**收：
#   - U+2190-2193 等普通箭头（TS 注释里 "→" 是文档流，不是图标；收了会全仓误报）
#   - U+2300-23FF 技术符号区（⌘ ⏱ 等多为正常符号）
#   - ©(U+00A9) ®(U+00AE) ™(U+2122)：版权/商标声明的正字符号，不是功能图标
#     （页脚 "© 2026 corps" 是合法文案；e2e 的 Extended_Pictographic 全扫只覆盖
#      三个无版权条的页面所以不会误伤，但静态全文件扫描会）
#   - 冷门 Extended_Pictographic 码点（㊗ ㊙ 〰 〽 等）：漏报代价 < 误报代价
# FE0F / 肤色修饰只作 cluster 后缀，不单独成命中（否则 "⚠️" 一处记成两处）。
# 这两个常量同时被下面的转义解码复用，别在别处复制一份同样的区间。
EMOJI_CP_RANGES = (
    (0x1F000, 0x1FAFF), (0x2600, 0x27BF), (0x2B00, 0x2BFF), (0x2194, 0x2199),
)
EMOJI_CP_SINGLETONS = frozenset((0x203C, 0x2049, 0x2139, 0x21A9, 0x21AA))
EMOJI_CLUSTER_RE = re.compile(
    "(?:[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u203C\u2049\u2139"
    "\u2194-\u2199\u21A9\u21AA])"
    "(?:[\uFE0F\U0001F3FB-\U0001F3FF])*"
)


def _is_emoji_cp(cp):
    if cp in EMOJI_CP_SINGLETONS:
        return True
    return any(lo <= cp <= hi for lo, hi in EMOJI_CP_RANGES)


# JS/TS 字符串里的转义写法："\u2715"（✕）、"\u{1F600}"（😀）。
# 不收这个就等于给违反留一道"写字面字符违规、写转义合法"的后门。
JS_UNICODE_ESCAPE_RE = re.compile(r"\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})")

# 渐变触发器：CSS 函数形式 + Tailwind 渐变工具类（bg-gradient-to-* 就是 linear-gradient
# 的封装，只认函数形式会让 P0-2 在最常用的 Tailwind 写法上零覆盖）
GRADIENT_RE = re.compile(
    r"linear-gradient|radial-gradient|conic-gradient|bg-gradient-to-", re.I)
INDIGO_RE = re.compile(r"#6366f1|#4f46e5|#7c3aed|#a855f7|\bindigo\b", re.I)
PINK_RE = re.compile(r"#ec4899|#f472b6|\bpink\b", re.I)

# 左界 (?<![0-9A-Za-z_-])：杀掉两类实测假阳性——测试名里的 TC-RLS-#119、
# 密码样本 "Share#2026"。没有它，这两处会被判成硬编码色，进而逼出一个
# "给 web/tests/ 开路径豁免"的错误决定；假阳性要修检测器，不是给检测器戴眼罩。
HEX_RE = re.compile(
    r"(?<![0-9A-Za-z_-])#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b", re.I)
HEX_WHITELIST = {"#fff", "#ffffff", "#000", "#000000"}

_NUM = r"-?(?:\d+\.?\d*|\.\d+)"
# cubic-bezier(x1, y1, x2, y2)：CSS 函数形式，允许任意空白变体
CB_RE = re.compile(
    r"cubic-bezier\(\s*(%s)\s*,\s*(%s)\s*,\s*(%s)\s*,\s*(%s)\s*\)" % ((_NUM,) * 4),
    re.I,
)
# framer-motion BezierDefinition 数组：ease: [x1, y1, x2, y2]
EASE_ARRAY_RE = re.compile(
    r"\bease\s*:\s*\[\s*(%s)\s*,\s*(%s)\s*,\s*(%s)\s*,\s*(%s)\s*\]" % ((_NUM,) * 4)
)
BANNED_CURVE = (0.68, -0.55, 0.265, 1.55)

COPY_RE = re.compile(
    r"lorem\s+ipsum|welcome\s+to\s+our\s+app|sign\s+up\s+today", re.I)

# ─── P0-6：硬编码用户可见文案 ───
# 这是一个 zh/en 双语应用（词条在 web/messages/{zh,en}.json）。写死在组件里的中文，
# 切到 en 照样显示中文——是**用户可见**的 i18n 缺陷，2026-10 实测 web/ 生产代码里
# 有 10 个文件 99 处（其中 web/lib/email.ts 一个文件 49 处）。
# 难点不在"找中文"（全仓含中文的行 2 万+，绝大多数是中文注释），而在**只认渲染给用户的位置**：
#   1. JSX/HTML 文本节点：`>中文<`（跨行感知——not-found.tsx 里 "页面未找到" 独占一行，
#      行内正则找不到它，这也是首版原型把整个 404 页面漏掉的原因）
#   2. 邮件/推送 HTML 模板正文：`>中文</`（同一条正则的子集，单独列出只为口径可读）
#   3. 用户可见属性的字符串字面量值：placeholder / aria-label / title / alt / label / description
#   4. 键名以 `Zh` 结尾的中文兜底值：`fallbackZh: "语义搜索"`
#      ——ai-tools/page.tsx 的 7 个 Tab 标签全写在这个键里，同文件其它文案走的是
#        useTranslations("ai.aiTools")，典型"一半翻了一半没翻"。实测全仓 `Zh` 结尾的键
#        共 8 个、全部集中在这一个文件，零假阳性，所以这条口径收录；反之 `name: "中文"`
#        这类泛化键**有** 49 处且混着 AI 工具定义的参数描述，不收录——理由见 4 倍误报代价。
# 四条口径之间**同一处要去重**：`<span>暂无 AI 洞察</span>` 同时满足 1 与 2，只记一处。
# 否则同一份债在基线里被记两遍，修一处计数只掉一半，棘轮就转不动了。
CJK = "一-鿿"          # CJK 统一表意文字基本区；刻意不含全角标点（标点不构成"文案"）
CJK_RUN_RE = re.compile("[%s]+" % CJK)
# JSX 表达式容器 `{...}`：`<span>{t('total')} 数据截止昨天</span>` 是最常见的"一半表达式
# 一半写死文案"形态，而下面的文本节点口径必须排除 `{`/`}`——两种情况撞在一起就漏报。
# 解法是匹配前先把**不含中文的** {...} 组打平成等长点号（中文组原样保留，否则
# `fallbackZh: '语义搜索'` 这种会被连带抹掉）。实测代价：全仓 99 处 -> 126 处，
# 多出来的 27 处全是真阳（email.ts 的 `${name} 邀请你加入`、CalendarWeek 的
# `{y} 年 {m} 月`、ai-tools 的错态文案），只新增 1 个文件（CalendarWeek.tsx）。
# 反过来，若整体放宽到「正文里随便出现花括号」（最先试过的写法）会变成 591 处 / 39 文件，
# 其中 AI prompt 正文、zod 校验消息、服务端 console 报错全部被捞进来——那才是假阳性洪水。
_EXPR_GROUP_RE = re.compile(r"\{[^{}\n]{0,300}\}")
# re.S：允许跨行——`<h2>\n  页面未找到\n</h2>` 这种独占一行的文本节点才是 404 页面的形态，
# 逐行扫描会把它整片漏掉。这就是 P0-6 不能用"逐行"口径的原因，其余规则仍然逐行。
JSX_TEXT_RE = re.compile(">([^<>{}]*[%s][^<>{}]*)<" % CJK, re.S)
HTML_TEXT_RE = re.compile(">([^<>{}]*[%s][^<>{}]*)</" % CJK, re.S)
VISIBLE_ATTRS = ("placeholder", "aria-label", "title", "alt", "label", "description")
VISIBLE_ATTR_RE = re.compile(
    r"\b(?:%s)\s*=\s*([\"'`])([^\"'`]*[%s][^\"'`]*)\1" % ("|".join(VISIBLE_ATTRS), CJK))
ZH_KEY_RE = re.compile(r"\b[\w$]*Zh\s*:\s*([\"'`])([^\"'`]*[%s][^\"'`]*)\1" % CJK)

# P0-6 不扫描的范围。本脚本向来对路径豁免零容忍（见下面「没有路径豁免」段），
# 这里只开一条，且带实测证据 + self-test 负向断言：
P0_6_SKIP_PREFIX = ("web/tests/", "web/e2e/")
#   为什么 web/tests/ 与 web/e2e/ 必须跳：那里面的中文是**夹具与断言**
#   （`render(<div>第一项</div>)`、`aria-label="命令面板"` 当选择器），不进产物 DOM。
#   计入的话，"给某个组件把中文改成 t()" 会让组件文件 -1、测试文件 +1，门禁照样红，
#   逼人把两处一起改——而这不是缺陷，是修复的正常表现。实测纳入会多出 5 个文件 23 处，
#   其中 markdown.test.tsx 的 2 处是纯假阳性（测试描述 `"渲染为 <ul> 含多个 <li>"`
#   里的 `<ul>` 与 `<` 被当成了一对标签）。
#   为什么 web/messages/*.json **不需要**豁免：collect() 只走 .ts/.tsx 后缀，json 天然
#   不在扫描范围。写在这里是因为它最容易被误当成"该加豁免"的地方。
#   为什么 web/lib/ai/**/prompts/** **也没有**豁免（核实结论）：那里的中文确实是
#   prompt——web/lib/ai/prompts/mail-assistant.ts 逐字写着"你是专业商务邮件起草助手…
#   输出 Markdown 格式邮件"，喂给模型而不是渲染给用户。实测这四条口径在 prompts/
#   下**零命中**，所以按"零证据不上豁免"的既定口径不加。哪天某个 prompt 文件开始产出
#   用户可见文案，它自己就会红，不需要预留后门。

# ─── 没有路径豁免 ───
# 上一版曾有 EXEMPT_P0_1（im/ chat/ tests/ e2e/）与 EXEMPT_P0_4、EXEMPT_AI_COPY
# （tests/ e2e/）。逐个压测后全部删掉，过程与理由：
#   EXEMPT_P0_4 掩盖的 4 处其实是假阳性——测试名 TC-RLS-#119、密码样本 "Share#2026"。
#     真修法是给 HEX_RE 加左界 (?<![0-9A-Za-z_-])（已加），不是给门禁戴眼罩。
#   EXEMPT_AI_COPY 在 web/tests/ 与 web/e2e/ 里零命中——没有任何负向断言用到那三句模板文案。
#   EXEMPT_P0_1 四条同样零命中：emoji 在 im/ chat/ 的组件源码里一次都没出现（UGC emoji
#     是**数据**，从库里来，不需要在源码里写字面量），在 tests/ e2e/ 里出现的全是注释
#     （rbac.test.ts 的权限表、im-upgrade.spec.ts 说明），注释本来就被剥掉。
# 零证据的豁免是负债：它让门禁在那一目录中立 readings 失效，而收益是零。要恢复请补
# 证据（哪一行、为什么必须）+ 一条 self-test 用例，别只把前缀加回来。
#
# P0-6 是唯一的例外（见上面 P0_6_SKIP_PREFIX），原因很简单也很实际：tests/e2e 里的中文
# 是夹具与断言，把"修好了组件"判成"测试文件新增违反"会让棘轮反向卡住修的人。它带
# 实测数字和负向断言，符合"补证据才上豁免"的同一条规矩。

RULE_FIX = {
    "P0-1": "换成 lucide-react 描边图标（如 <X className=\"size-4\" />，见 "
            "design/design-tokens.css 的「图标：Lucide」规约）；"
            "不要把符号字符写进 JSX/字符串，也不要用 \\uXXXX 转义绕过",
    "P0-2": "跨色相紫→粉渐变更换成同一色相的深浅过渡（from-accent 同族 token）或直接纯色；"
            "design/design-tokens.css 里**没有**渐变 token，临时拼出来的 gradient 一律不收",
    "P0-4": "换成 design token（var(--accent) / var(--success) / var(--border-soft) 等，"
            "清单见 design/design-tokens.css）；仅邮件 HTML、导出 HTML、PWA manifest "
            "这类**不接受 var() 的硬约束场景**才允许字面量值，并在此登记理由",
    "P0-5": "换成 var(--ease-standard) / var(--ease-out)"
            "（design/design-tokens.css 第 205-206 行）；"
            "framer-motion 侧写成 ease: [0.2, 0, 0, 1]",
    "AI-COPY": "换成真实业务文案，并走 i18n（web/messages/<locale>.json）；"
               "Lorem ipsum / Welcome to Our App / Sign up today 是占位稿，不许进产物",
    "P0-6": (
        "这是 zh/en 双语应用，写死的中文在英文 locale 下照样显示中文。"
        "客户端组件改用 useTranslations('<ns>')，服务端改用 await "
        "getTranslations('<ns>')，把字符串换成 t('<key>')，并把 key 同时加进 "
        "web/messages/zh.json 与 web/messages/en.json（两份都要加，只加中文那份，"
        "英文站会直接翻车露出原始 key）。两类已论证的硬约束属于待登记的工作量、"
        "不在本条修法范围内：邮件/推送 HTML 模板要整套改成按收件人 locale 渲染"
        "（web/lib/email.ts、push-email.ts、offline-push.ts）；"
        "app/not-found.tsx 位于 [locale] 段之外、NextIntlClientProvider 不可用。"
    ),
}

DEFAULT_HEADER = """\
# P0 内容规约基线（棘轮）—— 现存违反全部登记，只许收缩、不许新增
#
# 由 `python scripts/check_p0_content.py --emit` 生成/刷新，**提交前必须人工核对 diff**。
# 每行格式：<相对仓库根的路径> <规则> <违反处数>
#
# 判据（红因集合）：
#   NEW_<RULE>        基线外首见的 (文件, 规则)     -> CI 红：新违反，真修或显式登记
#   REGRESSION_<RULE> 已登记文件的违反处数变多      -> CI 红：只许减少
#   （归零/减少的条目只打印提示、不判红——理由见脚本 docstring「为什么不强制删行」）
#
# 为什么是棘轮不是一刀切：上线时全仓已存在真实违反（邮件/导出 HTML 不接受 var()、
# 协作光标色、PWA 清单色、seed 脚本日志 emoji 等）。一道上线就全红的门禁只会被
# --no-verify 掉。这里把现存违反全部登记，门禁只判「新增/变多」。
#
# 为什么是「文件 + 规则 + 处数」而不是「文件:行号」：web/ 有并行会话在改，行号会漂，
# 任何往上/往下插一行都会让一批登记项错位成「新增」——那正是天天误叫的死法。
#
# 登记 ≠ 认可：每一条都是待还的技术债。修掉后跑 --emit 收紧，不要留着过年。
"""


# 「/ 后面还可能引出一整段正则字面量」的判别依据：前一个有效字符是标识符/数字/
# 右括号就只能是除法（`(a+b)/2`、`path/nav`），其余位置才允许开正则。
_REGEX_PREV_DENY_RE = re.compile(r"[0-9A-Za-z_$)\]]$")


def strip_comments(lines, mask_strings=False):
    """剥掉 // 与 /* */ 注释（含跨行块注释），保留字符串字面量。

    返回与输入**等行等长**的代码文本（注释字符替换为空格）——报错和基线都要行号，
    行数对不上比注释没剥干净更糟。跨行块注释与跨行模板字符串用状态机跟踪。

    mask_strings=True 时，额外把**引号串**（"..." 与 '...'）的正文替换成空格。
    只有 P0-6 的「文本节点」口径需要它：真正的 JSX 文本节点不可能位于引号串内部，
    而 `it("渲染为 <ul> 含多个 <li>")` 这种测试描述里的 `>` 与 `<` 会被当成一对标签，
    造出凭空的命中。模板字符串（反引号）**一律不抹**——邮件与推送的 HTML 正文就写在
    反引号里，抹掉等于把 P0-6 最大的一块命中（email.ts 49 处）整片豁免。

    2026-10 修的一个真实缺陷：旧实现只看引号、不认正则字面量。遇到
    `.replace(/(x)/g, "$1")` 这种正则里带引号（或反引号）的写法，状态机把那个引号当成
    字符串开头并从此错位，结果**后续整段的 // 注释一行都剥不掉**——实测 web/lib/format.ts
    有 8 行、decisions/page.tsx 有 15 行中文注释被当成代码保留。对 P0-1~P0-5 无感，
    是因为那些注释里恰好没写过 emoji/hex；对 P0-6 就是硬伤：残留注释里的中文配上前一行
    遗留的 `>` 直接成为假阳性（实测 +16 处）。修法是补上正则字面量识别；该修正在全仓
    对既有 5 条规则**零计数变化**（71 处前后一致），不会带动任何人的基线。
    """
    out = []
    in_block = False
    in_str = None
    last_sig = ""      # 最近一个"有意义"的代码字符，用于区分除法与正则开头
    for line in lines:
        chars = []      # 代码视图：注释抹成空格，字符串正文保留
        masked = []     # mask 视图：注释与引号串正文都抹成空格（仅 P0-6 文本节点用）

        def put(s, hide=False):
            nonlocal last_sig
            chars.append(s)
            masked.append(" " * len(s) if (hide and mask_strings) else s)
            if not hide and s.strip():
                last_sig = s.strip()[-1]

        i, n = 0, len(line)
        while i < n:
            ch = line[i]
            nxt = line[i + 1] if i + 1 < n else ""
            if in_block:
                if ch == "*" and nxt == "/":
                    in_block = False
                    put("  ")
                    i += 2
                else:
                    put(" ")
                    i += 1
                continue
            if in_str == "`":                      # 模板字符串：正文必须原样保留
                put(ch)
                if ch == "\\" and nxt:
                    put(nxt)
                    i += 2
                    continue
                if ch == "`":
                    in_str = None
                i += 1
                continue
            if in_str is not None:                 # 引号串：正文可按需抹平
                put(ch, hide=True)
                if ch == "\\" and nxt:
                    put(nxt, hide=True)
                    i += 2
                    continue
                if ch == in_str:
                    in_str = None
                i += 1
                continue
            if ch == "`":
                in_str = "`"
                put(ch)
                i += 1
                continue
            if ch in "\"'":
                in_str = ch
                put(ch)
                i += 1
                continue
            if ch == "/" and nxt == "/":
                put(" " * (n - i))                 # 行注释：剩余整行抹掉
                break
            if ch == "/" and nxt == "*":
                in_block = True
                put("  ")
                i += 2
                continue
            if ch == "/":
                # 可能是正则字面量：前一个有效字符若是标识符/数字/右括号就只能是除法
                # （(a+b)/2、path/nav）。不认正则的代价见上面 docstring。
                if not last_sig or _REGEX_PREV_DENY_RE.search(last_sig) is None:
                    j, in_class, closed = i + 1, False, False
                    while j < n:
                        c = line[j]
                        if c == "\\":
                            j += 2
                            continue
                        if in_class:
                            if c == "]":
                                in_class = False
                        elif c == "[":
                            in_class = True
                        elif c == "/":
                            closed = True
                            j += 1
                            break
                        j += 1
                    if closed:
                        put(line[i:j])
                        i = j
                        continue
            put(ch)
            i += 1
        out.append("".join(masked if mask_strings else chars))
    return out

def _p0_1_hits(line):
    """一行里 P0-1 的原文列表：字面 emoji + 转义写法的 emoji。"""
    hits = list(EMOJI_CLUSTER_RE.findall(line))
    for m in JS_UNICODE_ESCAPE_RE.finditer(line):
        raw = m.group(1) or m.group(2)
        try:
            cp = int(raw, 16)
        except ValueError:
            continue
        if _is_emoji_cp(cp):
            hits.append(m.group(0))  # 原文保留转义写法，便于按此串搜索
    return hits


def _p0_5_hits(line):
    """一行里 P0-5 违反的原文列表：禁用曲线原值（任意空白变体）或第二控制点 y>1。"""
    hits = []
    for m in list(CB_RE.finditer(line)) + list(EASE_ARRAY_RE.finditer(line)):
        try:
            vals = tuple(round(float(a), 6) for a in m.groups())
        except ValueError:
            continue
        if vals == BANNED_CURVE or vals[3] > 1:
            hits.append(m.group(0))
    return hits


def _hex_hits(line):
    return [m.group(0) for m in HEX_RE.finditer(line)
            if m.group(0).lower() not in HEX_WHITELIST]


def _p0_2_hits(line):
    if not (INDIGO_RE.search(line) and PINK_RE.search(line)):
        return []
    return [m.group(0) for m in GRADIENT_RE.finditer(line)]


def _collapse_expr(text):
    """把不含中文的 {...} 组替换成等长点号（保留行结构，偏移量不变）。

    只打平**不含中文**的组，是为了让 `fallbackZh: '语义搜索'` 这类带中文的对象字面量
    保持原样——它们在对象视图里由 ZH_KEY_RE 接着认领。
    由内向外反复替换以处理嵌套：`{a ? {b: 1} : null}` 先塌内层。
    """
    prev = None
    while prev != text:
        prev = text
        text = _EXPR_GROUP_RE.sub(
            lambda mm: mm.group(0) if CJK_RUN_RE.search(mm.group(0))
            else "." * len(mm.group(0)), text)
    return text


def _p0_6_hits(lines):
    """整文件级 [(行号, 原文)]——P0-6 唯一不是逐行的规则。

    为什么整文件：`<h2>\\n  页面未找到\\n</h2>` 这种独占一行的文本节点是 app/not-found.tsx
    的实际写法，逐行扫描看不到 `>中文<` 这对符号凑不到一行里。
    为什么两种视图：文本节点在 mask 视图里找（引号串里的 `<ul> 含多个 <li>` 不是文本节点），
    可见属性与 Zh 键在代码视图里找（属性值本身就在引号串里，抹了就永远找不到）。
    同一处去重：一个 `<span>暂无活动</span>` 同时满足文本节点与 HTML 正文两条口径，
    按**正文里每一段连续中文**的绝对偏移去重，同一段只记一处（否则同一份债记两遍，
    修一处计数只掉一半，棘轮就转不动了）。计数粒度沿用「一处 = 一段连续中文」，
    与 P0-4「一行 3 个 hex = 3 处」同口径。
    """
    code = _collapse_expr("\n".join(strip_comments(lines)))
    # 快筛：绝大多数 TS/TSX 文件剥完注释后一个中文都没有，不必再造第二份视图。
    # 没有这行的代价是全仓跑一遍多花约 7 秒（P0-6 是唯一要 strip 两遍的规则）。
    if not CJK_RUN_RE.search(code):
        return []
    masked = _collapse_expr("\n".join(strip_comments(lines, mask_strings=True)))
    hits = []
    seen = set()
    for text, rules_res in ((masked, (JSX_TEXT_RE, HTML_TEXT_RE)),
                            (code, (VISIBLE_ATTR_RE, ZH_KEY_RE))):
        for res in rules_res:
            for m in res.finditer(text):
                base = m.start(m.lastindex)
                body = m.group(m.lastindex)
                for run in CJK_RUN_RE.finditer(body):
                    s, e = base + run.start(), base + run.end()
                    if (s, e) in seen:
                        continue
                    seen.add((s, e))
                    # 报错要能照着改，光给"暂无"两个字不够：带前后各 24 字的上下文，
                    # 足够让人认出 `<p>本期共有 3 项任务到期…</p>` 是哪一个。
                    ctx = body[max(0, run.start() - 24):run.end() + 24]
                    hits.append((text.count("\n", 0, s) + 1, ctx.strip()))
    hits.sort()
    return hits
    hits.sort()
    return hits


def _p0_6_skipped(rel):
    """路径是否落在 P0-6 的豁免范围（只有 tests/e2e，理由见 P0_6_SKIP_PREFIX 注释）。"""
    return rel.startswith(P0_6_SKIP_PREFIX)


def _scan_file(rel, path, rules=RULES):
    """单文件的 [(rel, 行号, 规则, 原文)]；同一行多条违反记多项。"""
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return []
    out = []
    # 原文超过 60 字符的那一行多半是整条 className 串，截断到命中附近，别淹没结论
    def snip(s):
        s = s.strip()
        return s if len(s) <= 80 else s[:77] + "..."

    lines = text.splitlines()
    # P0-6 单独在文件级跑：它要跨行匹配文本节点，且有自己的独立视图。
    # P0-6 不扫 CSS 分支传入的规则集（CSS_RULES），写法上天然满足。
    if "P0-6" in rules and not _p0_6_skipped(rel):
        for lineno, body in _p0_6_hits(lines):
            out.append((rel, lineno, "P0-6", snip(body)))
    for lineno, line in enumerate(strip_comments(lines), 1):
        if "P0-1" in rules:
            for s in _p0_1_hits(line):
                out.append((rel, lineno, "P0-1", snip(s)))
        if "P0-2" in rules:
            for s in _p0_2_hits(line):
                out.append((rel, lineno, "P0-2", snip(line)))
        if "P0-4" in rules:
            for s in _hex_hits(line):
                out.append((rel, lineno, "P0-4", snip(s)))
        if "P0-5" in rules:
            for s in _p0_5_hits(line):
                out.append((rel, lineno, "P0-5", snip(s)))
        if "AI-COPY" in rules:
            for s in COPY_RE.findall(line):
                out.append((rel, lineno, "AI-COPY", snip(s)))
    return out


def collect(root):
    """全仓命中列表 [(rel, 行号, 规则, 原文)]，不去重（处数即计数）。"""
    hits = []
    web = root / "web"
    if web.is_dir():
        for dirpath, dirnames, filenames in os.walk(web):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            for fn in sorted(filenames):
                if not fn.endswith((".ts", ".tsx")):
                    continue
                p = Path(dirpath) / fn
                rel = p.relative_to(root).as_posix()
                hits.extend(_scan_file(rel, p))
    for rel in EXTRA_CSS_RELS:
        p = root / rel
        if p.is_file():
            hits.extend(_scan_file(rel, p, rules=CSS_RULES))
    return hits


def scan(root):
    """返回 {(rel, rule): 处数}，只含 >0 的组合。"""
    counts = {}
    for rel, _lineno, rule, _raw in collect(root):
        key = (rel, rule)
        counts[key] = counts.get(key, 0) + 1
    return counts


def details(root):
    """返回 {(rel, rule): [(行号, 原文)]}，只给报错时定位用，不进判据。"""
    out = {}
    for rel, lineno, rule, raw in collect(root):
        out.setdefault((rel, rule), []).append((lineno, raw))
    return out


def check(current, baseline):
    """返回 [(红因码, (rel, rule))]，空列表代表闭合。

    返回 (文件, 规则) 组合而不是成品字符串：报错侧要拿这个 key 去 details() 翻
    行号与原文，自检侧只取红因码做集合相等断言。两边共用同一份判据，避免
    "自检过的逻辑"和"CI 跑的逻辑"分叉。
    """
    out = []
    for key in sorted(baseline):
        rel, rule = key
        cnt = baseline[key]
        now = current.get(key, 0)
        if now > cnt:
            out.append((
                "REGRESSION_" + rule.replace("-", "_"),
                key,
            ))
    for key in sorted(current):
        if key not in baseline:
            rel, rule = key
            out.append((
                "NEW_" + rule.replace("-", "_"),
                key,
            ))
    return out


def stale_entries(current, baseline):
    """基线里已归零或减少的条目（非红提示，供 --emit 收紧时删行）。"""
    out = []
    for (rel, rule), cnt in sorted(baseline.items()):
        now = current.get((rel, rule), 0)
        if now < cnt:
            out.append((rel, rule, cnt, now))
    return out


def load_baseline(path):
    """读基线，返回 {(rel, rule): 处数}；# 注释与空行跳过。"""
    out = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 3:
            raise SystemExit(
                "基线行格式应为 '<路径> <规则> <处数>'，实际: %r" % raw)
        rel, rule, cnt = parts
        if rule not in RULES:
            raise SystemExit(
                "基线行规则名非法（应为 %s 之一）: %r" % ("/".join(RULES), raw))
        out[(rel, rule)] = int(cnt)
    return out


def _split_baseline_notes(path):
    """把既有基线拆成 (表头, {规则: [该规则分组下的手写说明行]})。

    存在的理由：`--emit` 每跑一次就会重写整个文件，而分组标题与条目之间的
    手写说明（谁在什么时候、因为哪条 PR 收紧了什么、为什么某处是合理硬约束）
    是这份文件唯一可审计的部分——test-integrity 规范里"改基线必须解释得清"
    指的就是它们。不保留的话，下一次 --emit 会把全部审计痕迹静默抹掉，
    于是"基线为什么长这样"重新变成没人知道的事。
    """
    header, notes, rule = [], {}, None
    for l in path.read_text(encoding="utf-8").splitlines():
        if l.startswith("# ── "):
            m = re.match(r"# ── ([A-Z0-9-]+) ", l)
            if m and m.group(1) in RULES:
                rule = m.group(1)
                continue
            # 看着像分组标题、其实不是（如 "# ── 2026-10-13 某次收紧 ──"）。
            # 落到下面当普通注释处理，位置原样保留；否则一跑 --emit 就被静默吞掉，
            # 而它是这份文件里少数几条"什么时候发生过什么"的时间戳。
        if l.startswith("#"):
            if rule is None:
                header.append(l.rstrip())
            else:
                notes.setdefault(rule, []).append(l.rstrip())
    return header, notes


def emit_baseline(root, path):
    if not (root / "web").is_dir():
        print("--root 下没有 web/ 目录：%s（拒绝把基线写成空——那会悄悄拆掉门禁）" % root)
        return 1
    counts = scan(root)
    header, notes = ([], {})
    if path.exists():
        header, notes = _split_baseline_notes(path)
    if not header:
        header = DEFAULT_HEADER.splitlines()
    body = []
    total = 0
    for rule in RULES:
        entries = sorted((rel, n) for (rel, r), n in counts.items() if r == rule)
        # 该规则既有条目、又有历史说明，就继续出这一组：清零的规则靠说明行留痕
        # （"本类现在全仓为零"这句话本身就是要给后来人看的），条目全没了也不消失。
        if not entries and rule not in notes:
            continue
        subtotal = sum(n for _, n in entries)
        body.append("# ── %s %s（%d 个文件 / %d 处）──"
                    % (rule, RULE_DESC[rule], len(entries), subtotal))
        body.extend(notes.get(rule, []))
        total += subtotal
        for rel, n in entries:
            body.append("%s %s %d" % (rel, rule, n))
    # newline="\n" 是必须的，不是洁癖：Windows 上默认文本模式会把 \n 转成 \r\n，
    # 于是同事在 Windows 跑一次 --emit 就把整个基线改成 CRLF（79 行全变），
    # 真实改动被埋在全文件 diff 里看不见——正是本仓 design-tokens.css 被 autocrlf
    # 转成 CRLF、next build 报 CssSyntaxError 的同一类事故。仓库存的是 LF。
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(header + body) + "\n")
    print("已重写基线：%d 个 (文件,规则) 组合 / %d 处违反（表头 %d 行，保留手写说明 %d 组）"
          % (len(counts), total, len(header), len(notes)))
    print("请人工核对上面的 diff 后再提交——基线即额度，登记=承认这笔技术债。")
    return 0


def _lst(items):
    return ", ".join(items)


def self_test():
    """注入式自检。

    沿用本仓库既有约定：**断言红因集合相等**（assert set(got) == set(want)），
    不是"变红了"，也不是"包含某个红因"——后者会让一条变异顶着另一条的原因
    冒充通过（教训见 check_zero_coverage_ratchet.py 与 db-retry 的等价变异体事件）。

    每条用例一个全新临时根，走 scan() -> check() 全链路：注释剥离、转义解码、
    左界/白名单这些边界都长在 scan 里，只测 check() 会漏掉它们。
    本脚本不设路径豁免（理由见模块 docstring），因此没有"豁免生效"类用例；
    相应地补了"过去靠豁免压住的样本现在被测检测器排除"的用例——
    检测器改回去（把左界丢掉）时这些用例必须变红——这正是它们存在的意义。
    """
    clean_tsx = "export default function Page() { return <main>ok</main>; }\n"
    # 真样本：web/lib/format.ts 的 Markdown 纯文本清洗链（原文机抄，含中文 // 注释）。
    # 用 r-string 保留原文的反斜杠，不手抄转义版——手抄错一个就复现不出那个错位。
    _fmt_chain = (
        "export function f(text: string) {\n"
        "  return text\n"
        r"""    .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, "$2")""" + "\n"
        "    // 去除行内代码反引号\n"
        r"""    .replace(/`([^`]+)`/g, "$1")""" + "\n"
        "    // 去除图片\n"
        r"""    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")""" + "\n"
        "    // 去除引用块 >\n"
        r"""    .replace(/^\s*>\s?/gm, "")""" + "\n"
        "    // 去除水平分隔线\n"
        r"""    .replace(/^---+\s*$/gm, "")""" + "\n"
        "    // 去除 HTML 标签\n"
        r"""    .replace(/<[^>]+>/g, "")""" + "\n"
        "    // 折叠多余空白\n"
        r"""    .replace(/\n{2,}/g, "\n")""" + "\n"
        "    .trim();\n"
        "}\n"
    )

    clean_css = ":root { --x: 1px; }\n"

    cases = [
        # ── 基线情形 ──
        ("干净文件 -> CLEAN",
         {"web/app/clean.tsx": clean_tsx, "web/app/globals.css": clean_css},
         {}, set()),
        ("基线内违反不红（棘轮放行现存）",
         {"web/app/x.tsx": clean_tsx + 'export const C = "#abc123";\n'},
         {("web/app/x.tsx", "P0-4"): 1}, set()),
        ("处数变多 -> REGRESSION_P0_4",
         {"web/app/x.tsx": clean_tsx + 'export const C = ["#abc123", "#def456"];\n'},
         {("web/app/x.tsx", "P0-4"): 1}, {"REGRESSION_P0_4"}),
        ("处数变少不红（收紧由提示承担，不判红）",
         {"web/app/x.tsx": clean_tsx + 'export const C = "#abc123";\n'},
         {("web/app/x.tsx", "P0-4"): 3}, set()),
        # ── P0-1 emoji ──
        ("注入 emoji -> NEW_P0_1",
         {"web/app/badge.tsx": clean_tsx + 'export const B = "已完成 ✅";\n'},
         {}, {"NEW_P0_1"}),
        ("转义写法 \\u2715 也红（不许靠转义绕开门禁）",
         {"web/app/close.tsx": clean_tsx + 'export const C = <span>{"\\u2715"}</span>;\n'},
         {}, {"NEW_P0_1"}),
        ("转义写法 \\u{1F600} 也红",
         {"web/app/grin.tsx": clean_tsx + 'export const C = "\\u{1F600}";\n'},
         {}, {"NEW_P0_1"}),
        ("非符号区的普通转义不误伤（\\u00e9 = é）",
         {"web/app/accent.tsx": clean_tsx + 'export const C = "caf\\u00e9";\n'},
         {}, set()),
        # 下面两条是「上一版靠豁免压住、这一版靠检测器排除」的样本：
        # 它们至今仍在仓库里，改坏左界就会立刻复现。
        ("测试名里的 TC-RLS-#119 不是硬编码色（左界 '-' 挡掉）",
         {"web/tests/integration/rls.test.ts":
          'it("members：跨租户 0 行（TC-RLS-#119 策略缺口回归）", () => {});\n'},
         {}, set()),
        ("JSX 里的 im/ chat/ 也不豁免 emoji（UGC emoji 是数据，源码里不该写）",
         {"web/components/im/MessageItem.tsx": 'export const T = "👍 用户消息";\n'},
         {}, {"NEW_P0_1"}),
        ("chat 消息渲染组件同样不豁免",
         {"web/components/chat/MessageBubble.tsx": 'export const T = "😀";\n'},
         {}, {"NEW_P0_1"}),
        ("web/tests/ 与 web/e2e/ 不再豁免 emoji（零证据不上豁免）",
         {"web/e2e/ui.spec.ts": 'export const T = "✅";\n'},
         {}, {"NEW_P0_1"}),
        ("密码样本 \"Share#2026\" 不是硬编码色（左界字母挡掉）",
         {"web/tests/unit/share.test.ts":
          'const hashed = await hash("Share#2026");\n'},
         {}, set()),
        ("普通箭头 → 不是 emoji（不收 U+2190-2193）",
         {"web/app/arrow.tsx": clean_tsx + "// a → b ↔ c\n"},
         {}, set()),
        # ── P0-2 紫粉渐变 ──
        ("紫粉渐变（CSS 函数 + 字面 hex，P0-2 与 P0-4 并发）",
         {"web/app/hero.tsx": 'export const S = { backgroundImage: '
          '"linear-gradient(90deg, #6366F1, #EC4899)" };\n'},
         {}, {"NEW_P0_2", "NEW_P0_4"}),
        ("紫粉渐变（颜色名形式，隔离 P0-2：不含 hex 故不踩 P0-4）",
         {"web/app/hero1.tsx": 'export const S = { backgroundImage: '
          '"linear-gradient(90deg, indigo, pink)" };\n'},
         {}, {"NEW_P0_2"}),
        ("紫粉渐变（Tailwind 任意值）-> NEW_P0_2",
         {"web/app/hero2.tsx": 'export const C = '
          '"bg-[linear-gradient(to_right,#4F46E5,#F472B6)]";\n'},
         {}, {"NEW_P0_2", "NEW_P0_4"}),
        ("Tailwind 渐变工具类 indigo->pink -> NEW_P0_2",
         {"web/app/hero3.tsx": 'export const C = '
          '"bg-gradient-to-r from-indigo-500 to-pink-500";\n'},
         {}, {"NEW_P0_2"}),
        ("单色渐变（indigo->emerald）不红",
         {"web/app/hero4.tsx": 'export const C = '
          '"bg-gradient-to-r from-indigo-500 to-emerald-400";\n'},
         {}, set()),
        # ── P0-4 硬编码色 ──
        ("硬编码 #abc123 -> NEW_P0_4",
         {"web/app/x.tsx": clean_tsx + 'export const C = "#abc123";\n'},
         {}, {"NEW_P0_4"}),
        ("Tailwind 任意值 hex -> NEW_P0_4",
         {"web/app/x2.tsx": 'export const C = "bg-[#abc] text-[#123456]";\n'},
         {}, {"NEW_P0_4"}),
        ("白名单 #fff/#000/#ffffff/#000000 不红",
         {"web/app/w.tsx": 'export const C = ["#fff", "#000", "#ffffff", "#000000"];\n'},
         {}, set()),
        ("大写 hex 不进白名单 -> NEW_P0_4",
         {"web/app/w2.tsx": 'export const C = "#ABC";\n'},
         {}, {"NEW_P0_4"}),
        ("issue 引用 #135 在注释里不红（先剥注释）",
         {"web/app/c.tsx": clean_tsx + "// 复现 #135：旧实现 color: #abc\n"},
         {}, set()),
        ("多行块注释里的 hex/emoji/渐变不红",
         {"web/app/c2.tsx": clean_tsx
          + "/* 多行块注释：\n"
          + " * P0-1：禁 ✅ 作图标；\n"
          + " * token 浅 #4263EB / 深 #4973D1；\n"
          + " * 反例 linear-gradient(#6366F1, #EC4899)；issue #135\n"
          + " */\n"},
         {}, set()),
        ("行内尾注释剥掉、字符串字面量保留",
         {"web/app/m.tsx": 'export const C = "#abc123"; // 说明：#fff 是白名单\n'},
         {}, {"NEW_P0_4"}),
        ("模板字符串里的 hex 照扫（字符串不是注释）",
         {"web/app/t.tsx": "export const H = `<body style=\"color:#334155\">`;\n"},
         {}, {"NEW_P0_4"}),
        ("tests/e2e 不豁免 hex（原本靠豁免压住的都是假阳性，已由左界消解）",
         {"web/tests/unit/t.test.ts": 'export const F = "#abc123";\n',
          "web/e2e/e.spec.ts": 'export const F = "#def456";\n'},
         {}, {"NEW_P0_4"}),
        ("tests/e2e 不豁免 P0-5（写进测试的禁用曲线照样要被扫出来）",
         {"web/tests/unit/e.test.ts":
          'export const t = { ease: [0.68, -0.55, 0.265, 1.55] };\n'},
         {}, {"NEW_P0_5"}),
        # ── P0-5 禁用缓动 ──
        ("禁用 cubic-bezier 原值 -> NEW_P0_5",
         {"web/app/globals.css": clean_css
          + ".b { transition: transform 150ms cubic-bezier(0.68, -0.55, 0.265, 1.55); }\n"},
         {}, {"NEW_P0_5"}),
        ("禁用曲线空白变体同样红",
         {"web/app/globals.css": clean_css
          + ".b { transition-timing-function: cubic-bezier( 0.68 , -0.55 , 0.265 , 1.55 ); }\n"},
         {}, {"NEW_P0_5"}),
        ("过冲 y2>1 -> NEW_P0_5",
         {"web/app/globals.css": clean_css
          + ".b { animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1.55); }\n"},
         {}, {"NEW_P0_5"}),
        ("y1>1 但 y2<=1 不红（口径边界：只钉禁用条与第二控制点过冲）",
         {"web/app/globals.css": clean_css
          + ".b { transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }\n"},
         {}, set()),
        ("design-tokens.css 里的禁用曲线也扫",
         {"design/design-tokens.css": ":root { --ease-bounce: cubic-bezier(0.68,-0.55,0.265,1.55); }\n"},
         {}, {"NEW_P0_5"}),
        ("framer-motion ease 数组 y2>1 -> NEW_P0_5",
         {"web/app/mo.tsx": 'export const t = { duration: 0.3, ease: [0.68, -0.55, 0.265, 1.55] };\n'},
         {}, {"NEW_P0_5"}),
        ("framer-motion ease 数组正常值不红",
         {"web/app/mo2.tsx": 'export const t = { duration: 0.3, ease: [0.2, 0, 0, 1] };\n'},
         {}, set()),
        ("P0-5 只扫指定 CSS：其他 CSS 不在范围（口径边界）",
         {"web/app/other.css": ".b { transition-timing-function: cubic-bezier(0.68, -0.55, 0.265, 1.55); }\n"},
         {}, set()),
        # ── AI 模板文案 ──
        ("Lorem ipsum -> NEW_AI_COPY",
         {"web/app/l.tsx": 'export const T = "Lorem ipsum dolor sit amet";\n'},
         {}, {"NEW_AI_COPY"}),
        ("模板文案大小写不敏感（welcome to our app）",
         {"web/app/l2.tsx": 'export const T = <h1>welcome to our app</h1>;\n'},
         {}, {"NEW_AI_COPY"}),
        ("Sign up today -> NEW_AI_COPY",
         {"web/app/l3.tsx": 'export const T = "Sign up today!";\n'},
         {}, {"NEW_AI_COPY"}),
        ("tests/e2e 不豁免模板文案（零证据不上豁免；真要写负向断言请正面登记）",
         {"web/tests/unit/t2.test.ts": 'export const F = "Lorem ipsum";\n'},
         {}, {"NEW_AI_COPY"}),
        ("i18n 正常写法不红（文案全在 {} 表达式里）",
         {"web/app/ok.tsx": clean_tsx
          + "export function A() { const t = useTranslations('x');\n"
          + "  return <h1>{t('title')}</h1>; }\n"},
         {}, set()),
        # ── P0-6 硬编码用户可见文案 ──
        # 这一组最贵的不是正向用例：是"中文注释绝不许红"。本仓含中文的行 2 万+、
        # 绝大多数是中文注释；只要注释剥离有一处失守，这道门禁立刻变成全仓假阳性，
        # 然后被人 --no-verify 掉——等于没建。
        ("JSX 文本节点里的中文 -> NEW_P0_6",
         {"web/app/x.tsx": clean_tsx
          + "export function A() { return <span>暂无活动</span>; }\n"},
         {}, {"NEW_P0_6"}),
        ("JSX 文本节点独占一行（not-found.tsx 的真实形态）-> NEW_P0_6",
         {"web/app/nf.tsx": clean_tsx
          + "export function N() {\n  return (\n    <h2>\n      页面未找到\n    </h2>\n  );\n}\n"},
         {}, {"NEW_P0_6"}),
        ("可见属性 aria-label=\"中文\" -> NEW_P0_6",
         {"web/app/x2.tsx": clean_tsx
          + "export function A() { return <input aria-label=\"搜索任务\" />; }\n"},
         {}, {"NEW_P0_6"}),
        ("placeholder / title / alt / label / description 同样算可见属性",
         {"web/app/x3.tsx": clean_tsx
          + "export function A() {\n"
          + "  return <input placeholder=\"输入任务标题\"\n"
          + "    title=\"任务列表\" alt=\"封面图\" label=\"负责人\" description=\"按成员过滤\" />;\n}"},
         {}, {"NEW_P0_6"}),
        ("邮件/推送 HTML 模板正文 >中文</ -> NEW_P0_6",
         {"web/lib/mail.ts":
          "export const T = `<tr><td>corps · 面向中小团队的轻量协作工具</td></tr>`;\n"},
         {}, {"NEW_P0_6"}),
        ("键名以 Zh 结尾的中文兜底值（ai-tools Tab 标签的实际写法）-> NEW_P0_6",
         {"web/app/tools.tsx": clean_tsx
          + "const TABS = [{ id: 'a', fallbackZh: '语义搜索', fallbackEn: 'Search' }];\n"},
         {}, {"NEW_P0_6"}),
        ("键名不带 Zh 的泛化 key 不收（口径边界：author name / 工具描述之类 4 倍误报）",
         {"web/app/tools2.tsx": clean_tsx
          + "const T = { name: '张三', display: '待办列表' };\n"},
         {}, set()),
        # 去重必须用**计数字段**断言，不能用红因码：`<li>活动加载失败</li>` 同时满足
        # 文本节点与 HTML 正文两条口径，记成 2 处时仍然是同一个 NEW_P0_6，
        # 只看红因码会误认为通过——真重复会让"修一处计数只掉一半"，棘轮当场卡死。
        ("同一节 JSX 同时满足文本节点与 HTML 正文口径只算一处（去重）",
         {"web/app/dup.tsx": clean_tsx
          + "export function A() { return <li>活动加载失败</li>; }\n"},
         {("web/app/dup.tsx", "P0-6"): 1}, set()),
        ("**中文注释不红**（第 0 号负向断言：证明注释真的剥掉了）",
         {"web/app/c.tsx": clean_tsx
          + "// 这里是加载中>态：中文注释不该被当成文本节点\n"
          + "const x = 1; // 行尾注释：<div>缓存未命中</div> 时走 fallback\n"
          + "const y = 2; /** 文档注释：<GrantRow>成员权限</GrantRow> 漏打字 */\n"},
         {}, set()),
        ("中文块注释（整段含 `>` 与 `<` 的例子）不红",
         {"web/app/c2.tsx": clean_tsx
          + "/* 用法：\n"
          + " * <GrantRow>成员权限</GrantRow> 负责成员、工作组已有的叠加权限\n"
          + " * 只处理 1 个角色包：>权限就是 memb…</GrantRow>\n */\n"},
         {}, set()),
        # 下面这条是 2026-10-17 实测踩到的真缺陷：旧版 strip_comments 不认正则字面量，
        # 遇到 `.replace(/`([^`]+)`/g, "$1")` 就把正则里的反引号当成模板字符串开头，
        # 从此错位，**后续整段 // 注释一行都剥不掉**（实测 web/lib/format.ts 8 行、
        # decisions/page.tsx 15 行中文注释被当成代码），注释里的中文再配上前一行遗留的
        # `>` 直接成了 P0-6 假阳性（+16 处）。样本是 web/lib/format.ts 原文机抄
        # （_fmt_chain），不手抄转义版——手抄错一个反斜杠就复现不出这个链式错位。
        ("正则字面量里的反引号不许把注释剥离带跑偏（2026-10 实测样本）",
         {"web/lib/fmt.ts": _fmt_chain},
         {}, set()),
        ("引号串里的 `<ul> 含多个 <li>` 不是文本节点（mask 视图生效）",
         {"web/app/m.tsx": clean_tsx
          + "it(\"无序列表（- 前缀）渲染为 <ul> 含多个 <li>\", () => {});\n"},
         {}, set()),
        ("模板字符串里的 `<div>中文</div>` 照红（邮件模板不能被误当成引号串豁免）",
         {"web/lib/mail2.ts": "export const T = `<div>`;\n"
          + "export const U = `<p>你好</p>`;\n"},
         {}, {"NEW_P0_6"}),
        ("同一文件既有基线内又有新增 -> 只红新增",
         {"web/app/x.tsx": clean_tsx
          + "export const A = <span>暂无活动</span>;\n"
          + "export const B = <span>加载失败</span>;\n"},
         {("web/app/x.tsx", "P0-6"): 1}, {"REGRESSION_P0_6"}),
        ("P0-6 处数变少不红（收紧由提示承担）",
         {"web/app/x.tsx": clean_tsx + "export const A = <span>暂无活动</span>;\n"},
         {("web/app/x.tsx", "P0-6"): 3}, set()),
        ("web/tests/ 与 web/e2e/ 豁免（夹具与断言不进产物 DOM，见 P0_6_SKIP_PREFIX）",
         {"web/tests/unit/a.test.tsx": "render(<div>第一项</div>);\n",
          "web/e2e/a.spec.ts": "await page.getByLabel('命令面板');\n"},
         {}, set()),
        ("web/messages/zh.json 天然不扫（collect 只走 .ts/.tsx，不需要额外豁免）",
         {"web/messages/zh.json": "{\"title\": \"任务标题\"}\n"},
         {}, set()),
        ("同一节既有 P0-6 又有别的规则 -> 两个红因都在",
         {"web/app/mix.tsx": 'export const X = ["#abc123", <span>暂无活动</span>];\n'},
         {}, {"NEW_P0_4", "NEW_P0_6"}),
        # ── 组合 ──
        ("多规则并发（emoji + hex + 文案）",
         {"web/app/multi.tsx": 'export const X = ["#abc123", "✅ Welcome to Our App"];\n'},
         {}, {"NEW_P0_1", "NEW_P0_4", "NEW_AI_COPY"}),
        ("同一文件既有基线内又有新增违反 -> 只红新增",
         {"web/app/x.tsx": clean_tsx + 'export const C = ["#abc123", "🎉"];\n'},
         {("web/app/x.tsx", "P0-4"): 1}, {"NEW_P0_1"}),
    ]

    bad = 0
    for label, files, baseline, want in cases:
        tmp = Path(tempfile.mkdtemp())
        try:
            for rel, content in files.items():
                p = tmp / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(content, encoding="utf-8")
            codes = set(c for c, _ in check(scan(tmp), baseline))
            ok = codes == want
            bad += 0 if ok else 1
            note = "" if ok else "   <-- 实际红因 " + _lst(sorted(codes))
            print("  [" + ("OK " if ok else "BAD") + "] " + label + ": 期望 "
                  + (_lst(sorted(want)) if want else "通过") + note)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # 基线解析：表头/分组注释/空行跳过；非法规则名必须炸
    tmp = Path(tempfile.mkdtemp())
    try:
        p = tmp / "b.txt"
        p.write_text(
            "# 表头注释\n\n# ── P0-4 ──\nweb/a.tsx P0-4 2\n"
            "\ndesign/design-tokens.css P0-5 1\n", encoding="utf-8")
        got = load_baseline(p)
        want = {("web/a.tsx", "P0-4"): 2, ("design/design-tokens.css", "P0-5"): 1}
        ok = got == want
        bad += 0 if ok else 1
        print("  [" + ("OK " if ok else "BAD") + "] 基线解析（注释/空行/分组头跳过）: 期望 "
              + repr(want) + ("" if ok else "   <-- 实际 " + repr(got)))
        p.write_text("web/a.tsx P0-9 1\n", encoding="utf-8")
        try:
            load_baseline(p)
            ok = False
        except SystemExit:
            ok = True
        bad += 0 if ok else 1
        print("  [" + ("OK " if ok else "BAD") + "] 基线非法规则名必须报错退出")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # --emit 必须保留分组下的手写说明（审计痕迹），且不得把分组标题吃进表头后重复输出。
    # 不测这条，下一个人一跑 --emit 就把"为什么基线长这样"全抹掉，而基线本身看着
    # 毫无变化——正是 test-integrity 规范里最危险的那类静默改动。
    tmp = Path(tempfile.mkdtemp())
    try:
        (tmp / "web" / "app").mkdir(parents=True)
        (tmp / BASELINE_REL.rsplit("/", 1)[0]).mkdir(parents=True, exist_ok=True)
        (tmp / "web" / "app" / "a.tsx").write_text(
            'export const C = ["#abc123", "#def456"];\n', encoding="utf-8")
        bp = tmp / BASELINE_REL
        bp.write_text(
            "# 表头一\n# 表头二\n"
            "# ── 2026-10-13 某次收紧（非规则分组，是时间戳分隔行）──\n"
            "# ── P0-4 硬编码色值（#rgb）（1 个文件 / 1 处）──\n"
            "# 手写说明：这个 hex 是邮件客户端不认 var() 的硬约束。\n"
            "# 2026-10-12 由 PR #76 收紧，别删。\n"
            "web/app/a.tsx P0-4 1\n"
            "# ── P0-5 禁用缓动（0 个文件 / 0 处）──\n"
            "# 2026-10-12 清零（PR #75）：token 已删，任何新增直接判 NEW_P0_5。\n",
            encoding="utf-8")
        import contextlib
        import io as _io
        buf = _io.StringIO()
        with contextlib.redirect_stdout(buf):  # 自检输出别被 emit 的提示打散
            rc = emit_baseline(tmp, bp)
        text = bp.read_text(encoding="utf-8")
        ok = rc == 0
        bad += 0 if ok else 1
        print("  [" + ("OK " if ok else "BAD") + "] emit 成功退出")
        checks = [
            ("手写说明保留",
             "手写说明：这个 hex 是邮件客户端不认 var() 的硬约束。" in text),
            ("清零规则的历史说明也保留",
             "2026-10-12 清零（PR #75）" in text),
            ("非规则的时间戳分隔行不被吞掉",
             "2026-10-13 某次收紧（非规则分组，是时间戳分隔行）" in text),
            # Windows 默认文本模式会把 \n 写成 \r\n，导致整个基线被改成 CRLF、
            # 真实改动埋在全文件 diff 里（design-tokens.css 曾被 autocrlf 这样坑过一次）。
            ("写出的基线必须是 LF（Windows 上不许转 CRLF）",
             b"\r\n" not in bp.read_bytes()),
            ("表头未被重复",
             text.count("# 表头一") == 1 and text.count("# 表头二") == 1),
            ("分组标题不重复",
             text.count("# ── P0-4 ") == 1),
            ("条数按实测刷新",
             "web/app/a.tsx P0-4 2" in text),
        ]
        for label, cond in checks:
            bad += 0 if cond else 1
            print("  [" + ("OK " if cond else "BAD") + "] emit 保留审计痕迹: " + label)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("自检结果: " + ("全部符合预期" if bad == 0 else "%d 项失效" % bad))
    return 0 if bad == 0 else 1


def main():
    argv = sys.argv[1:]
    if "--self-test" in argv:
        print("== 注入式自检（临时目录当真仓库根，scan -> check 全链路）==")
        return self_test()

    root = ROOT
    if "--root" in argv:
        i = argv.index("--root")
        if i + 1 >= len(argv):
            print("--root 需要一个路径参数")
            return 1
        root = Path(argv[i + 1]).resolve()

    baseline_p = root / BASELINE_REL

    if "--emit" in argv:
        return emit_baseline(root, baseline_p)

    if not baseline_p.exists():
        print("基线文件不存在：%s（先跑 --emit 生成，人工核对后提交）" % BASELINE_REL)
        return 1

    baseline = load_baseline(baseline_p)
    current = scan(root)
    where = details(root)

    n_files = len({rel for rel, _ in current})
    print("扫描范围：web/**/*.ts(x)（%d 个规则）+ %s（%s）；实测违反 %d 处，涉及 %d 个文件"
          % (len(RULES), "、".join(EXTRA_CSS_RELS), "/".join(CSS_RULES),
             sum(current.values()), n_files))
    print("基线：%d 个 (文件,规则) 组合，合计 %d 处"
          % (len(baseline), sum(baseline.values())))

    stale = stale_entries(current, baseline)
    if stale:
        print("")
        print("提示（不判红）：以下基线条目已归零或减少，收紧时请把对应行删掉：")
        for rel, rule, cnt, now in stale:
            print("  - %s %s %d -> %d" % (rel, rule, cnt, now))

    failures = check(current, baseline)
    if failures:
        # 报错必须能照着修，所以每个红因都把**当前**命中位置逐条摊开：
        # "多了几处"不能指导动手，真正要解决的是哪一行、原文是啥、换成什么。
        print("")
        print("FAIL: 出现基线外新增/变多的 P0 内容违反")
        for code, key in failures:
            rel, rule = key
            print("")
            print("  [" + code + "] %s —— %s：基线 %d 处 / 现在 %d 处"
                  % (rel, rule, baseline.get(key, 0), current.get(key, 0)))
            for lineno, raw in where.get(key, []):
                print("        %s:%d  %s" % (rel, lineno, raw))
            print("        修法：%s" % RULE_FIX[rule])
        print("")
        print("处理方式（二选一，禁止 --no-verify）：")
        print("  1. 真修——按上面的修法改；")
        print("  2. 确属合理硬约束（邮件/导出 HTML 不接受 var() 等），")
        print("     人工核对后 python scripts/check_p0_content.py --emit 刷新基线，")
        print("     并在提交说明里写清为什么。")
        return 1

    print("PASS: 无新增/变多的 P0 内容违反（现存 %d 处全部在基线内）。"
          % sum(current.values()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
