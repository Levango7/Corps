# A11Y 缺口枚举（D4 交付）：壳面 tint 全族实数 + danger 在册缺口登记（2026-11-12）

- 对象：`main @ 61b67da`（origin/main tip，本批工作树基；分支 `fix/a11y-d2p-d4`）
- 决策依据：`docs/decisions/OPEN-DECISIONS.md` 已关闭表 2026-11-12「#63 a11y 定档」行——按 D2′（accent-soft-fg 真值化＋矩阵纳入＋2 axe 结清＋danger 豁免登记）＋D4（bgAttrs 枚举壳面实数再修）执行；D2′ 约束「只动令牌真值+矩阵+豁免登记，不动组件结构」
- 立场：只记能给出**命令 + 输出/退出码**的结论。普查脚本（`a11y-census.mjs` / `a11y-register.mjs` / `a11y-fixvals.mjs` / `a11y-selfcheck.mjs`）按本仓审计文档惯例留在仓库外（`F:\tmp\`），文中给出命令与期望输出；入库的门禁是 `web/e2e/contrast-matrix.spec.ts` 的 GAP_REGISTER 与其第 5 个 test。

---

## 1. 结论

| #   | 判定                                                                       | 依据                                                                                                                                                                                                      | 状态                    |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | danger tint 族（`--danger` 文字压半透明 tint）已**逐点登记在册**，不是豁免 | 7 个登记键 / 32 个唯一 JSX 站点 / 两主题读数全部 <4.5；登记册落在 `web/e2e/contrast-matrix.spec.ts` 的 `GAP_REGISTER`，由第 5 个 test 在 CI 真浏览器重算复核（仍不达标＋值新鲜 Δ≤0.10＋sites≥1 三道断言） | 本批已落，待 CI         |
| 2   | 全族静态普查：**CONFIRMED 17 组合 / 106 站点**低于 AA（最差主题口径）      | `node F:\tmp\a11y-census.mjs`，扫描 817 文件 / 6922 处字面量 className / 306 处模板字面量 / 3287 处含语义文字类元素                                                                                       | 枚举完成（本文 §4）     |
| 3   | 其余 15 族 / 74 站点是修法批输入，首选修法有实数背书                       | fg 换同族 `*-fg` 真值令牌：danger/success/warn 三族在两主题 × 四底面的预取值**全过 4.5**（最低 5.99）；accent 族换 `--accent-soft-fg` 直接用矩阵已钉基线（light 5.23 / dark 6.60）                        | 待 owner 批修法批（§5） |
| 4   | 三类边界**禁入分母**，单列防误报                                           | STATEFUL 49 组合 / 933 处（hover 态）；PARENT? 7 令牌 / 423 处（父底推断非确认）；OPMOD 9 处（`/NN` 透明度修饰符静态不可判）                                                                              | §2                      |
| 5   | 组件零改动                                                                 | 本批 diff = spec 登记册 + 本文档；D2′ 前三件（accent-soft-fg 真值化、矩阵纳入、axe 余量 27→2→0 清零）已在 main（#301 等），axe 基线 `tests/a11y-axe-baseline.json` 现 keys=0                              | 符合 D2′ 约束           |

## 2. 口径与分母（三档，绝不混报）

| 档        | 定义                                                            | 结果                                                                                            | 进分母？         |
| --------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------- |
| CONFIRMED | 同元素静态 fg + 静态 bg（字面量或模板字面量 className）→ 实数   | 17 组合 / 106 站点                                                                              | 是               |
| STATEFUL  | 组合只出现在 `hover:`/`dark:`/`group-hover:` 等状态前缀类里     | 49 组合 / 933 处                                                                                | 否（静态不出现） |
| PARENT?   | 有静态 fg、同元素无 bg → 父底推断（两面各算一次，都 <4.5 才列） | 7 令牌 / 423 处                                                                                 | 否（推断非确认） |
| OPMOD     | bg/fg 带 `/NN` 透明度修饰符                                     | 9 处（列前 5：`DocumentVersionHistory.tsx:423,575,636,765`、`files/FileVersionRestore.tsx:60`） | 否（静态不可判） |

**口径差（如实标注）**：census 对半透明 bg 一律硬编码叠 `--surface` 合成（其 `bgValue` 的兜底），所以 §4 族级表里 danger 族读数＝「压 surface 面」的读数；**站点级真实底面**由登记册的静态祖先链分析定（surface 26 / shell-content 1 / shell-sidebar 1），两口径在 surface 面上数值一致（light 12% 都是 4.06）可互证。站点级运行时确认留给修法批的 bgAttrs 通道（§6）。

**盲区**：`className={'...'}` 对象式不扫；模板字面量 `${}` 插值里的类按字面文本扫（条件分支类会被计入，属**高估而非低估**）；fg 别名表（`--prio-*-fg` 等 8 个）与 `globals.css` 的 `*-fg` 真值（design-tokens.css 里没有）为手工录入。

## 3. danger 族登记册（本批已落，与 GAP_REGISTER 逐键同数）

| 键（主题\|tint\|底面）               | 登记值 | sites | 屏幕色（fg→合成底）                  |
| ------------------------------------ | ------ | ----- | ------------------------------------ |
| light\|danger-soft-12\|surface       | 4.06   | 26    | fg rgb(211,50,64) → rgb(249,230,229) |
| light\|danger-soft-12\|shell-content | 3.37   | 1     | fg rgb(211,50,64) → rgb(224,211,217) |
| light\|danger-soft-12\|shell-sidebar | 3.75   | 1     | fg rgb(211,50,64) → rgb(236,222,226) |
| light\|danger-tint-10\|shell-content | 3.48   | 4     | fg rgb(211,50,64) → rgb(225,215,221) |
| dark\|danger-soft-12\|shell-content  | 3.90   | 1     | fg rgb(242,91,103) → rgb(60,47,57)   |
| dark\|danger-soft-12\|shell-sidebar  | 4.19   | 1     | fg rgb(242,91,103) → rgb(55,42,52)   |
| dark\|danger-tint-10\|shell-content  | 4.00   | 4     | fg rgb(242,91,103) → rgb(56,46,56)   |

sites 列合计 38 读数 = 32 唯一 JSX 站点（dark 读数与 light 同站点：MilestoneFilter:159、KnowledgeBase:468、board/announcements 四处）。取数命令 `node F:\tmp\a11y-register.mjs`，输出与上表逐值同；数学与 CI 真浏览器探针 38/38 基线同口径（19 配对 × 2 主题）。

**为什么是登记册而不是 AA_EXEMPT**：AA_EXEMPT 是豁免（放宽底线让不达标合法活着，现已清空）；登记册是「矩阵 structurally 测不了（半透明底的屏幕色取决于叠在哪个面上，第 4 个 test 钉死矩阵配对 alpha 必须为 1）＋静态逐点确认过」的在册缺口，放行为零、靠第 5 个 test 双向棘轮：① 仍不达标（重算 ≥4.5 = 已修好，删除条目毕业）② 登记值新鲜（CI 重算偏差 >0.10 = 令牌动过没重取数）③ 结构守卫（sites≥1 且 reason/fix 非空，0 消费者不许占册）。**未登记但已核实的边角**（防重走）：dark\|12%\|surface=4.61、dark\|10%\|surface=4.72 今天已达标；light\|10%\|surface=4.19 数学不达标但静态零站点（dead-key 禁令）；MeetingRoom.tsx:569 录制徽标是 12% tint 压在**视频像素**上，静态注册不出稳定值 → 修法批 bgAttrs 运行时取证。

## 4. 全族枚举表（CONFIRMED 17 族 / 106 站点，按最差主题值升序）

族级读数口径 = census（半透明叠 --surface 合成，§2 已声明）；站点清单为静态确认的出现点。

| #   | 组合（fg/bg）             | light | dark  | sites | 处置                                                                        |
| --- | ------------------------- | ----- | ----- | ----- | --------------------------------------------------------------------------- |
| 1   | --accent-fg/--accent-soft | 1.15  | 15.66 | 6     | A：fg 换 --accent-soft-fg（矩阵基线 5.23/6.60）                             |
| 2   | --success-fg/--success    | 2.42  | 1.40  | 2     | 见 §5 注（solid 底，无现成 swap）                                           |
| 3   | --danger-fg/--danger      | 2.05  | 1.71  | 7     | 同上                                                                        |
| 4   | --accent-fg/--warn        | 2.99  | 2.12  | 1     | A 同构延伸，修法批探针定                                                    |
| 5   | --accent-fg/--success     | 3.42  | 2.13  | 3     | 同上                                                                        |
| 6   | --on-accent/--success     | 3.42  | 2.13  | 1     | 同上                                                                        |
| 7   | --warn/--warn-soft        | 2.58  | 6.31  | 4     | A：fg 换 --warn-fg（7.82/9.27 over surface）                                |
| 8   | --success/--success-soft  | 2.96  | 6.61  | 4     | A：fg 换 --success-fg（7.14/9.22 over surface）                             |
| 9   | --success/--surface-2     | 3.10  | 7.72  | 1     | A 同构（站点级复核）                                                        |
| 10  | --accent-fg/--danger      | 4.88  | 3.25  | 13    | A：fg 换 --danger-fg（8.34/7.88 over surface）                              |
| 11  | --on-accent/--danger      | 4.88  | 3.25  | 2     | 同上                                                                        |
| 12  | --accent/--accent-soft    | 4.33  | 3.47  | 25    | A：fg 换 --accent-soft-fg（5.23/6.60）                                      |
| 13  | --accent/--surface-2      | 4.52  | 3.64  | 3     | A：fg 换 --accent-on-surface（矩阵第 9 对已钉基线；surface-2 面修法批实测） |
| 14  | --surface/--accent        | 4.93  | 3.85  | 1     | A：fg 换 --on-accent（矩阵 on-accent/accent 已钉）                          |
| 15  | --danger/--danger-soft    | 4.06  | 4.61  | 28    | **已登记**（§3，light 面入册）                                              |
| 16  | --danger/MIX(10% inline)  | 4.19  | 4.72  | 4     | **已登记**（§3，壳内容层 3.48/4.00）                                        |
| 17  | --eyebrow-fg/--eyebrow-bg | 4.38  | 4.62  | 1     | 微调 eyebrow-fg 一档（令牌批）                                              |

**逐站点附录**（census 全量输出，`F:\tmp\a11y-census.json` 同源）：

- 1 `--accent-fg/--accent-soft`（6）：components/ai/MeetingAiPanel.tsx:400、components/ai/MultiAgentPanel.tsx:707,815,440、components/ai/WorkflowOrchestratorPanel.tsx:409、components/template/TemplateEditor.tsx:263
- 2 `--success-fg/--success`（2）：components/remote-control/RemoteControlDialog.tsx:267、components/remote-control/RemoteControlPanel.tsx:423
- 3 `--danger-fg/--danger`（7）：components/contact/ContactDetail.tsx:223、components/DocumentEditor.tsx:991、components/notifications/NotificationBadge.tsx:181、components/remote-control/RemoteControlPanel.tsx:436,450、components/remote-control/RemoteViewer.tsx:306、components/timetrack/TimeTracker.tsx:289
- 4 `--accent-fg/--warn`（1）：components/DocumentVersionHistory.tsx:803
- 5 `--accent-fg/--success`（3）：components/ai/MeetingDecisions.tsx:173、components/ai/VoiceCommandBar.tsx:367、components/im/IncomingCallNotification.tsx:118
- 6 `--on-accent/--success`（1）：components/ai/MeetingFlowPanel.tsx:635
- 7 `--warn/--warn-soft`（4）：components/files/TextPreview.tsx:116、components/sync/OfflineIndicator.tsx:105、components/sync/SyncStatus.tsx:156、components/todo/TodoCenter.tsx:372
- 8 `--success/--success-soft`（4）：components/ai/FeedbackButtons.tsx:166、components/sync/OfflineIndicator.tsx:118、components/timetrack/TimeEntryList.tsx:142、components/todo/TodoCenter.tsx:373
- 9 `--success/--surface-2`（1）：app/[locale]/w/[wid]/decisions/page.tsx:419
- 10 `--accent-fg/--danger`（13）：app/[locale]/w/[wid]/announcements/page.tsx:168、components/ai/VoiceCommandBar.tsx:304、components/BatchToolbar.tsx:284、components/im/ConversationSettings.tsx:728,548、components/im/MessageItem.tsx:700、components/members/TransferOwnership.tsx:71、components/RecycleBin.tsx:668、components/settings/SettingsDangerZone.tsx:138,266、components/SidebarNavClient.tsx:151,184、components/task/ConfirmDialog.tsx:142
- 11 `--on-accent/--danger`（2）：components/im/ConversationItemClient.tsx:96、components/shell/IMBadge.tsx:61
- 12 `--accent/--accent-soft`（25）：app/[locale]/w/[wid]/announcements/page.tsx:576、app/[locale]/w/[wid]/billing/page.tsx:517、app/[locale]/w/[wid]/board/page.tsx:490、components/ai/SemanticSearchPanel.tsx:333,512、components/CommandPalette.tsx:87、components/dashboard/WidgetCard.tsx:177、components/database/FilterPanel.tsx:263,274、components/DocumentVersionHistory.tsx:506、components/im/IMClient.tsx:231、components/im/MessageInput.tsx:662、components/im/MessageItem.tsx:226、components/im/MessageSearch.tsx:107、components/meetings/MeetingLobby.tsx:70、components/SidebarNavClient.tsx:141,174、components/TaskFilterBar.tsx:161、components/timetrack/TimeEntryList.tsx:147,292、components/timetrack/TimeTracker.tsx:180,228、components/UserMenu.tsx:197,225、components/wiki/WikiSidebar.tsx:53
- 13 `--accent/--surface-2`（3）：components/DocumentEditor.tsx:518,664,856
- 14 `--surface/--accent`（1）：components/ai/KnowledgeExtractPanel.tsx:143
- 15 `--danger/--danger-soft`（28）：components/ai/AiPushFeed.tsx:212、components/ai/AiPushSettings.tsx:212、components/ai/AnnouncementDraftPanel.tsx:189、components/ai/DailyReportView.tsx:201、components/ai/FeedbackButtons.tsx:183、components/ai/MailAssistantPanel.tsx:406、components/ai/PersonalizationPanel.tsx:272、components/ai/VoiceCommandBar.tsx:320、components/ai/VoiceSettings.tsx:152、components/announcement/AnnouncementEditor.tsx:360、components/doc/PermissionManager.tsx:183、components/doc/ShareDialog.tsx:177、components/DocumentComments.tsx:366、components/documents/DocumentPermissionPanel.tsx:316、components/DocumentVersionHistory.tsx:358、components/im/ConversationCreate.tsx:308、components/im/IMClient.tsx:264、components/im/IncomingCallNotification.tsx:108、components/im/MessageInput.tsx:571、components/KnowledgeBase.tsx:468、components/meetings/MeetingLobby.tsx:86、components/meetings/MeetingRoom.tsx:569、components/members/MemberList.tsx:216,338、components/MilestoneFilter.tsx:159、components/notifications/NotificationSettings.tsx:170、components/remote-control/RemoteControlDialog.tsx:246、components/remote-control/RemoteControlPanel.tsx:252
- 16 `--danger/MIX 10% inline`（4）：app/[locale]/w/[wid]/announcements/page.tsx:486,497、app/[locale]/w/[wid]/board/page.tsx:417,427
- 17 `--eyebrow-fg/--eyebrow-bg`（1）：app/[locale]/pricing/page.tsx:264

## 5. 修法选项（带实数）

- **A（首选）fg 换同族真值令牌**：`-soft` 底配 `-fg` 文字是既有 idiom（SettingsDangerZone 已在用）。修法目标值预取（`node F:\tmp\a11y-fixvals.mjs`，source-over 合成，两主题 × 四底面）：

| fg 令牌                       | 主题  | over surface | over bg | over shell-content | over shell-sidebar |
| ----------------------------- | ----- | ------------ | ------- | ------------------ | ------------------ |
| --danger-fg(#7f1d1d/#fca5a5)  | light | 8.34         | 7.91    | 6.91               | 7.69               |
| --danger-fg                   | dark  | 7.88         | 8.70    | 6.67               | 7.17               |
| --success-fg(#055a40/#6ee7b7) | light | 7.14         | 6.81    | 5.99               | 6.63               |
| --success-fg                  | dark  | 9.22         | 10.26   | 7.69               | 8.26               |
| --warn-fg(#78350f/#fcd34d)    | light | 7.82         | 7.46    | 6.56               | 7.27               |
| --warn-fg                     | dark  | 9.27         | 10.35   | 7.77               | 8.36               |

全组合 ≥5.99，过 AA。accent 族的目标值不用预取——矩阵已钉（accent-soft-fg/accent-soft 基线 light 5.23 / dark 6.60）。

- **B tint 不透明化**：即原 D2，前提（「tint 不透明化是收益来源」）已被实测推翻，11-12 裁不复选。
- **C 逐站点独立不透明底**：视觉变化逐站点发生，仅用于 A 不适用处（如族 2/3 的 solid 底白字场景、MeetingRoom 录制徽标的视频像素面）。

族 2/3（`--success-fg/--success`、`--danger-fg/--danger`，共 9 站点）是「真值 fg 压同族 solid 色」的反语义组合：A 的直接形态是把底换成对应 `-soft`（fixvals 已证过 AA）；若设计意图就是 solid 底，则白字（--on-accent）方案需探针实测后定，修法批定。

## 6. bgAttrs 运行时取证通道（修法批用，本批已具备）

`web/e2e/a11y-core.spec.ts:127-141` 给每条 axe 现场数据补 `bgAttrs`（完整属性 + 该层 computed 底色），**不参与红绿、纯取证**（刻意不冒充门禁）。修法批用它：① 逐站点复核 §4 站点级底面（静态祖先链的运行时对照）② 给 PARENT? 423 处推断定性（达标销项 / 不达标入 CONFIRMED 分母）③ 给 MeetingRoom.tsx:569 视频像素面与族 2/3 solid 底场景取稳定读数。

## 7. 验收命令（可复现）

本地（纯 node，本机无 node_modules 亦可跑）：

1. `node F:\tmp\a11y-selfcheck.mjs` → 期望「自证全部通过」（键集耦合 6 断言＋登记册结构 3 断言＋7 键数值复算 Δ≤0.05＋方向性自证 1 条；正则与 `web/tests/unit/contrast-kernel.test.ts` 逐字同源）
2. `node F:\tmp\a11y-register.mjs` → 期望输出与 §3 表逐值同
3. `node F:\tmp\a11y-census.mjs` → 期望末尾「扫描文件 817，含语义文字类的元素 3287 处」且 CONFIRMED 17 族 / 106 站点

CI（真判定，本批 PR 触发）：

4. `pnpm test:unit`（web/）→ `tests/unit/contrast-kernel.test.ts` 键集耦合全绿（登记册块不入耦合正则，selfcheck 已证）
5. `pnpm test:e2e contrast-matrix.spec.ts` → 5 个 test 全绿，含第 5 个「在册缺口仍不达标且登记数未漂移」在 CI 真浏览器重算 7 键；产物 `contrast-gap-actual`
6. axe 基线不新增（`tests/a11y-axe-baseline.json` keys 保持 0）；Lint job 的 `eslint --max-warnings 0` / `tsc --noEmit` / `prettier --check .` 全绿

## 8. 修法批的出口判据（可测分母）

1. 重跑 census：CONFIRMED 17 族归零，或剩余族全部转入 GAP_REGISTER（sites≥1＋CI 重算值＋reason/fix 齐备）；
2. contrast-matrix 5 test 全绿、AA_EXEMPT 保持空、axe keys 保持 0；
3. PARENT? 423 处经 bgAttrs 运行时定性：达标销项、不达标入分母；
4. STATEFUL 933 处维持禁入静态分母（hover 态由设计令牌批另案处理，不在本批口径）。

## 9. 核对记录（本批的自伤与防假绿）

- census 初版对 inline 10% tint 按 `--surface` 合成出 4.19/4.72，险些当登记值；核对出 `bgValue` 的硬编码兜底后，站点级底面改用静态祖先链分析（register.mjs），两口径在 surface 面互证一致（4.06）才落册。
- `F:\tmp\a11y-usage.mjs` 首跑 ENOENT（脚本写死错路径 `F:\tmp\app`），修正扫描根后重跑才出全量；空输出不当阴性证据。
- STATEFUL 合计手加得 916，awk 复核为 49 组合 / 933 处，以 awk 为准。
- spec 手改后第 505 行 111 字符超 printWidth，`prettier --write` 规范化（diff 插入行 163→174，纯格式化，无语义变）；prettier/eslint/tsc 以 CI 为准（本机无 node_modules）。
- selfcheck 的耦合断言从 `contrast-kernel.test.ts` **逐字复制**正则（抄实现＝用另一套算式验这套算式，串改了测试还绿）。
