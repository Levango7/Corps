// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { ESLint, type Linter } from "eslint";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * 无障碍（a11y）静态门禁 —— JSX 语义层
 * ============================================================================
 * 为什么需要它：本仓库此前**没有任何自动化 a11y 门禁**。唯一的近邻是
 * e2e/contrast-matrix.spec.ts（对比度矩阵），但它只比对 design-tokens.css 里的
 * CSS 变量配对，**完全不看真实 DOM** —— 一个 <button> 里只有图标、没有任何
 * 可读名称，对比度矩阵一片绿，屏幕阅读器里却是个"无名按钮"。
 *
 * 这条门禁瞄准的正是"渲染在页面上、但辅助技术读不出来"的那一类缺陷。它不替代
 * 浏览器级扫描，而是补上**成本最低、覆盖面最广**的一层静态检查。
 *
 * 为什么用 eslint-plugin-jsx-a11y 而不是 axe-core：
 *   - axe 需要在真实浏览器/真实 DOM 上跑，本仓库要跑起来它得先拉起 Postgres +
 *     dev server 一整套环境；本地不可复现，只能靠 CI 反馈，门禁本身无法自证。
 *   - jsx-a11y 是纯静态分析，秒级、确定性、无外部依赖 —— 门禁的"可执行性"
 *     优先于"覆盖面"，一条跑不起来的严格门禁等于没有门禁。
 *   - 与仓库既有约定一致：check_p0_content.py / check_burndown.py /
 *     i18n-usage.test.ts 都是「独立守卫 + 基线棘轮」的形态。
 *
 * 基线口径（与 tests/i18n-usage-baseline.txt 同构）：
 *   现存违规先进基线，门禁只挡**新增**；修掉一个就应从基线删一行；
 *   基线里已不存在的条目同样让测试失败（防"豁免腐烂"）。
 *   计数按 (文件, 规则) 精确比对 —— 同一文件同一规则再多一条也算新增，
 *   否则"在已知违规文件里悄悄加一条"会完全静默。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../..");
const BASELINE_PATH = join(HERE, "../a11y-baseline.txt");

/** 扫描范围：与 i18n 门禁一致，只扫应用源码，不含测试与脚本 */
const SCAN_DIRS = ["app", "components", "lib"];

/**
 * 启用的规则集 —— **以插件 recommended 为底，只标注差异**。
 *
 * 刻意不手抄一份规则清单：手抄会随插件升级静默漂移（新增的推荐规则永远不会生效，
 * 而被移除的规则会变成无效配置）。这里只写"与推荐集的差"。
 *
 * 三条差异，每条都有实测依据（2026-10-14 对 800 个 ts/tsx 全量扫描的真实数据）：
 *
 *   - no-autofocus → off。实测 23 例。本项目的弹窗/搜索框大量使用 autoFocus，
 *     属有意设计（打开即聚焦输入框，是把键盘用户送进对话框的常规做法，Radix 等同款）。
 *     判定为可接受，不阻断 —— 它属于"风格偏好"而非"用不了"。
 *   - media-has-caption → off。实测 4 例。本项目暂无自托管音视频字幕需求，
 *     属"尚未涉及"而非"已违规"；将来真有音视频上线时再打开这条才是对的时机。
 *   - control-has-associated-label → error（**不在 recommended 里，显式加回**）。
 *     这是覆盖"图标按钮/无名字段"的主力规则，正是 aria 语义层最该守的一条，
 *     不启用等于放掉了本门禁最核心的那一半。加回后实测新增若干真实缺陷。
 *
 * 棘轮纪律：规则集只增不减。任何一条被 off 的规则，都必须在上面写清理由与实测计数。
 *
 * 判定笔记（都是实测出来的，别靠直觉改）：
 *   1. control-has-associated-label **看不见 <label htmlFor>**：它的实现
 *      （util/mayHaveAccessibleLabel）只看控件自身子树与 aria-* 属性，从不回溯祖先。
 *      所以 `<label htmlFor="x">名称</label><input id="x" />` 这种**完全合格**的写法
 *      照样判红；而 `<select>` / `<button>` 因为有子节点文本反而不红。
 *      结论：修它就得在控件上补 aria-label。与上方 label 用同一个 t() key，不会漂移。
 *   2. <dialog> 不被视为交互元素：点 ::backdrop 时浏览器把事件派发到 dialog 元素
 *      本身，"点遮罩关闭"只能挂在它身上，于是必被 click-events-have-key-events +
 *      no-noninteractive-element-interactions 判红。加 onKeyDown 只能消掉前者。
 *      本仓库统一改用「遮罩层 role=presentation + 内容层 role=dialog aria-modal」，
 *      语义不丢（Esc 与关闭按钮照旧），规则也不再误报。
 */
const A11Y_RULES: Linter.RulesRecord = {
  ...jsxA11y.flatConfigs.recommended.rules,
  "jsx-a11y/no-autofocus": "off",
  "jsx-a11y/media-has-caption": "off",
  "jsx-a11y/control-has-associated-label": "error",
};

/** 基线条目：文件（相对 web/ 的 posix 路径）+ 规则 + 计数 */
type Entry = { file: string; rule: string; count: number };

/** 把绝对路径压成基线与报告里统一使用的相对 posix 路径 */
function toKey(absPath: string): string {
  return relative(WEB, absPath).split(sep).join("/");
}

/** 跑一遍扫描，返回 (文件, 规则) → 计数 */
async function scan(): Promise<{ counts: Map<string, number>; scannedFiles: number }> {
  const eslint = new ESLint({
    cwd: WEB,
    // 复用仓库 eslint.config.mjs（TS 解析器等已配好），只在末尾追加 jsx-a11y 层。
    // 用 overrideConfig 而不是另起一份配置，是为了避免两处 parser/规则漂移。
    overrideConfig: [
      {
        files: ["**/*.{ts,tsx}"],
        plugins: { "jsx-a11y": jsxA11y },
        rules: A11Y_RULES,
      },
    ],
  });

  const results = await eslint.lintFiles(SCAN_DIRS);
  const counts = new Map<string, number>();
  for (const r of results) {
    const file = toKey(r.filePath);
    for (const m of r.messages) {
      if (!m.ruleId || !m.ruleId.startsWith("jsx-a11y/")) continue;
      const key = `${file}|${m.ruleId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return { counts, scannedFiles: results.length };
}

/** 读取基线：`<file> <rule> <count>`，`#` 起头为注释 */
function loadBaseline(): Entry[] {
  if (!existsSync(BASELINE_PATH)) return [];
  return readFileSync(BASELINE_PATH, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const parts = l.split(/\s+/);
      return { file: parts[0], rule: parts[1], count: Number(parts[2] ?? 0) };
    });
}

/** 把计数表折叠成便于断言与阅读的列表 */
function toEntries(counts: Map<string, number>): Entry[] {
  return [...counts.entries()]
    .map(([key, count]) => {
      const [file, rule] = key.split("|");
      return { file, rule, count };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
}

describe("a11y 门禁：JSX 语义层（jsx-a11y）", () => {
  let current: Entry[] = [];
  let scannedFiles = 0;

  beforeAll(async () => {
    const res = await scan();
    current = toEntries(res.counts);
    scannedFiles = res.scannedFiles;
    // 全量 lint 冷启动成本高，单独放宽预算（vitest.config.ts 的全局值按单测场景定）
  }, 180_000);

  it("扫描覆盖面没有塌掉（防解析式失效）", () => {
    // 活性断言直接数**扫到的源文件数**。
    // 反例（本仓库踩过）：写成 `expect(baseline.length).toBeGreaterThan(0)`
    // 是借"还有债"间接证明扫描器活着 —— 债务还清后这个正确状态反而永远不成立。
    // app + components + lib 约 700+ 个 ts/tsx，阈值取 400 留足余量。
    expect(scannedFiles).toBeGreaterThan(400);
  });

  it("不引入基线之外的新违规（含同文件同规则的新增计数）", () => {
    const baseline = loadBaseline();
    const baseMap = new Map(baseline.map((e) => [`${e.file}|${e.rule}`, e.count]));
    const grown: string[] = [];
    for (const e of current) {
      const prev = baseMap.get(`${e.file}|${e.rule}`);
      if (prev === undefined) grown.push(`${e.file}  ${e.rule}  ×${e.count}（新出现）`);
      else if (e.count > prev) grown.push(`${e.file}  ${e.rule}  ×${e.count}（基线 ${prev}）`);
    }
    expect(
      grown,
      "新增的无障碍违规 —— 请修掉，或在确认属可接受设计后补进 tests/a11y-baseline.txt：\n  " +
        grown.join("\n  "),
    ).toEqual([]);
  });

  it("基线不放行已修复的条目（防豁免腐烂）", () => {
    const baseline = loadBaseline();
    const curMap = new Map(current.map((e) => [`${e.file}|${e.rule}`, e.count]));
    const stale: string[] = [];
    for (const e of baseline) {
      const now = curMap.get(`${e.file}|${e.rule}`);
      if (now === undefined) stale.push(`${e.file}  ${e.rule}（已全部修复）`);
      else if (now < e.count) stale.push(`${e.file}  ${e.rule}  ×${now}（基线 ${e.count}）`);
    }
    expect(
      stale,
      "以下 a11y 违规已减少或消除，请同步收缩 tests/a11y-baseline.txt：\n  " + stale.join("\n  "),
    ).toEqual([]);
  });

  it("检测器自检：注入已知违规必须精确被抓到（红因集合相等）", async () => {
    // 借 lintText 就地构造已知缺陷，验证"规则确实在生效"。
    // 断言的是**红因集合精确相等** —— 多一条少一条都算失败，
    // 防的是检测器退化成"永远 PASS"的假门禁（本仓库 check_* 脚本同款约定）。
    //
    // ⚠️ 下面每组的 expected 都是**实测值**，不是我按规则名推测的。
    // 首次编写时第二组我写成了 control-has-associated-label，自检立刻判红 ——
    // 实测发现 <label>状态</label> + <select> 这种"浮动 label"是
    // label-has-associated-control 抓的，不是 control-has-associated-label。
    // 这正是自检存在的意义：期望值必须来自实测，不能来自直觉。
    const eslint = new ESLint({
      cwd: WEB,
      overrideConfig: [
        { files: ["**/*.{ts,tsx}"], plugins: { "jsx-a11y": jsxA11y }, rules: A11Y_RULES },
      ],
    });
    const fixtures: Array<{ name: string; code: string; expected: string[] }> = [
      {
        name: "图标按钮无可读名称",
        code: `export default function F(){ return (
          <div><button onClick={() => {}}><svg /></button></div>
        ); }`,
        expected: ["jsx-a11y/control-has-associated-label"],
      },
      {
        name: "div 挂 onClick 但键盘不可达",
        code: `export default function F(){ return (
          <div onClick={() => {}}>点我</div>
        ); }`,
        expected: [
          "jsx-a11y/click-events-have-key-events",
          "jsx-a11y/no-static-element-interactions",
        ],
      },
      {
        name: "可点击 li 但键盘不可达",
        code: `export default function F(){ return (
          <ul><li onClick={() => {}}>a</li></ul>
        ); }`,
        expected: [
          "jsx-a11y/click-events-have-key-events",
          "jsx-a11y/no-noninteractive-element-interactions",
        ],
      },
      {
        name: "浮动 label：与控件是兄弟节点、无 htmlFor",
        code: `export default function F(){ return (
          <div><label>状态</label><select><option>a</option></select></div>
        ); }`,
        expected: ["jsx-a11y/label-has-associated-control"],
      },
      {
        name: "裸 input 无任何可访问名称",
        code: `export default function F(){ return (
          <div><input type="text" /></div>
        ); }`,
        expected: ["jsx-a11y/control-has-associated-label"],
      },
      {
        name: "图片缺 alt",
        code: `export default function F(){ return (
          <div><img src="/x.png" /></div>
        ); }`,
        expected: ["jsx-a11y/alt-text"],
      },
      {
        name: "aria 属性拼错（aria-labl）",
        code: `export default function F(){ return (
          <div><span aria-labl="x">a</span></div>
        ); }`,
        expected: ["jsx-a11y/aria-props"],
      },
      {
        name: "role 缺必需 aria 属性（checkbox 无 aria-checked）",
        code: `export default function F(){ return (
          <div><span role="checkbox">b</span></div>
        ); }`,
        expected: ["jsx-a11y/role-has-required-aria-props"],
      },
      {
        // 反向用例：正确写法必须**零红**。它挡的是另一种失效 ——
        // 检测器"见谁都报"，那样基线会吃掉一切、门禁同样形同虚设。
        name: "正确写法（应零违规）",
        code: `export default function F(){ return (
          <div>
            <label htmlFor="s">状态</label>
            <select id="s"><option>a</option></select>
            <button aria-label="删除"><svg /></button>
            <button type="button">保存</button>
            <img src="/x.png" alt="示例图片" />
            <div role="button" tabIndex={0} onClick={() => {}} onKeyDown={() => {}}>可点</div>
          </div>
        ); }`,
        expected: [],
      },
    ];

    const failures: string[] = [];
    for (const fx of fixtures) {
      const res = await eslint.lintText(fx.code, {
        filePath: join(WEB, "components", "__a11y_selftest__.tsx"),
      });
      const got = [
        ...new Set(
          res
            .flatMap((r) => r.messages)
            .filter((m) => m.ruleId && m.ruleId.startsWith("jsx-a11y/"))
            .map((m) => m.ruleId as string),
        ),
      ].sort();
      const want = [...fx.expected].sort();
      if (got.join(",") !== want.join(",")) {
        failures.push(
          `用例「${fx.name}」红因集合不符\n    期望: ${want.join(", ") || "(无)"}\n    实际: ${got.join(", ") || "(无)"}`,
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 60_000);
});
