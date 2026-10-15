# 冰霜／恐惧独行接入交接（2026-10-14）

工作目录：`/Users/ftan/personal/CallOfCthulhu`。本文件记录交接时的实际状态；用户要求总结并转交其他模型，因此此处停止继续实施。所有子代理已停止或中断，最后的物品集成尚未完成交付。

## 目标与授权

完成《冰霜独行》和《恐惧独行》的中文、离线片段运行包，使玩家无需KP即可从正式入口完成游玩。通过来源、规则、角色／结局路线、认证API、持久化、桌面／手机验收之后，才复制到正式目录并开放本地入口。

用户已明确授权：**后续需要网页适配时直接采用推荐方案，不再逐项询问**。仍须核对原文和合法触发，采用最小改动，保留原文，并记录来源差异、授权日期、版本与测试。授权不包括外部部署、购买或自动导入其他候选。

先读根 `AGENTS.md`、`docs/story-workflow.md`、`docs/pdf-story-workflow.md`、`docs/templates/story-import-report.md`。核心规范：原件与SHA保留；原文、译文与规则分离；新包使用 `coc-runtime-graph@1` 的 `story.json`＋`fragments/*.json`；不维护重复reading.json；原书允许回环；不现场解析PDF；纸面登记自动化，真实决策保留；来源图继续保持 `runtimePlayable:false`。

工作区有大量未提交改动，包含另一聊天的角色／档案／界面修改。不要reset、清理或覆盖无关文件。此前已按用户要求删除《暗黑独行》，不要恢复。向火、静躁、潮汐是现有已开放剧本；潮汐1.0.1历史验收有3角色×50结局共150条API见证，必须保留兼容性。

## 交接时现场复查

- `npm run typecheck`：通过，日志 `work/handoff-typecheck-2026-10-14.log`。
- `git diff --check`：通过。
- 11份恐惧专项测试合跑：**268项，263通过，5失败**，日志 `work/handoff-focused-tests-2026-10-14.log`。这不是全项目测试。
- `stories/` 内尚无Frost/Fear正式包；`apps/web/src/main.tsx` 的 `AVAILABLE_STORY_IDS` 尚只开放向火、静躁、潮汐。
- 旧679/679全项目测试及构建通过是历史证据，不能说当前修改后的版本全部通过。

复现本次268项：

```sh
npx tsx --test \
  tests/fear-item-source-public.test.ts tests/fear-item-source-rules.test.ts \
  tests/fear-source-acquisition.test.ts tests/fear-source-acquisition-runtime.test.ts \
  tests/fear-runtime.test.ts tests/fear-table-runtime-rules.test.ts \
  tests/fear-table-rules.test.ts tests/fear-table-source-integration.test.ts \
  tests/fear-table-consumer-source.test.ts tests/fear-family-public-coverage.test.ts \
  tests/fear-special-creature-source.test.ts
```

### 当前5项失败

| 文件／测试 | 已知现场情况／下一步 |
|---|---|
| `fear-family-public-coverage.test.ts`：Alien Hunter Stealth | 仍有旧“几率6后额外掷骰”的fixture／注释；按来源核对实际骰序，不要削弱成功潜行断言。 |
| `fear-item-source-public.test.ts`：Doll饮酒 | 选择饮酒后实际已经执行Fear并创建combat，测试要求继续保持战前pending；核定正确续接语义、是否重复准备及初始Fear时序，再修规则或断言。 |
| 同文件：Cat Food保留战中选择 | 源测试期望继续进入战斗后仍可选cat-food逃离，但公开选项不出现。核对是否停在另一个pending，以及原有合法战中诱饵行为是否被新战前流程误删。 |
| `fear-runtime.test.ts`：Hell Hound战后吠叫 | 新增战前物品选择未处理，直接攻击会报“Resolve the pending Fear choice first”；先按公开操作解决pending，再检查吠叫规则。 |
| `fear-table-rules.test.ts`：werewolf | 已删除狼群无来源的逃跑−1，但旧断言仍要求pack.escapeModifier=-1；单只狼人仍为−1，狼群不继承该修正。 |

这些是现场观察，不等同于5项均为实现错误；须区分陈旧fixture和真实规则缺陷。

## 冰霜独行：候选已完成，最终运行时需重新验收

- 原件SHA：`6a35eba46eb8878fa3c0edcd265854ab539d3910bcd6ba91e03158f4aa121a9b`。
- 122页、654节、1,175条来源边、107个图像资源、11页OCR；本轮来源验证654节及784个资源哈希通过，见 `work/冰霜-source-current-verification.json`。
- 当前候选：`work/alone-against-frost/preview/alone-against-frost/1.0.5/`，1,158节点、654运行片段。
- 两种角色呈现×39个收藏结局＝78个合法组合。历史严格路线78/78、认证API78/78、桌面／手机12/12完成。
- 证据：`verified-final-1.0.5.json`、`final-api-1.0.5.json`、`final-browser-1.0.5-report.json`、`final-browser-1.0.5-screenshots/`，均在 `work/alone-against-frost/`。
- 这些验收绑定旧运行时指纹 `388397b031ac732ab5b58c11e2f1edde74cc3aae714a7cbf8361b244d02022e9`。之后Fear／contracts修改改变了共享指纹，必须重新执行，不能直接改报告哈希。
- 角色卡信用评级已恢复印刷64；主角Hatchet基础15明确标注网页适配；Charlie印刷Axe50映射Hatchet50；13处短柄斧武器使用独立技能。§259／285误译、自然段、脚注显示及溺水／烟雾结局正文已修。
- 来源／角色专项28/28在本轮复验通过，日志 `work/frost-source-authorization-recheck.log`。
- 详细报告 `docs/frost-import-report.md`；下半部旧候选记录已标历史，不要照抄为当前状态。

Frost生成入口是 `tools/story/build_frost.py`；默认compile读取 `scripts/alone-against-frost/review/runtime-program-001-654.json`，修改builder规则后须先执行 `python3 tools/story/build_frost.py review` 更新程序。已有1.0.5不得覆盖成不同内容；规则／正文再改须新版本。

审校ledger `scripts/alone-against-frost/review/rules.json` 曾被早期输出误覆盖，已从会话日志恢复并留下 `ledgerRecovery`、`work/alone-against-frost/ledger-recovery/` 和防覆盖检查。不要把这份人工ledger当编译临时输出路径。

## 恐惧独行：来源完整，1.0.1主引擎修改尚待收尾

- 原件SHA：`6737a687a79c49ef36b0e13d98fa0536b5ab8724eb127312522126b46570a572`。
- 106页已逐页视觉审阅；133来源片段＝42编号事件＋91章节；524中文段落、45图像资源／257出现位置、12页OCR、191哈希资源。来源复验见 `work/恐惧-source-current-verification.json`。
- OCR存在封面漏字、图像伪字等记录，不能宣称无损转录；原PDF、图像和补充材料保留。
- 本书采用 *Four Against Darkness* 衍生独立D6规则，`aaf-solo@1`，不是CoC百分骰。
- 当前定义：`work/alone-against-fear/reviewed-definition.json`；模板：`reviewed-story.json`；95敌人档案、56表、391来源结果。模板sceneRefs的一些旧占位由builder补成真实辅助场景，不要直接把模板当最终运行包。
- 当前工作目标版本 **1.0.1**；尚未生成并认证这一版本的最终片段包，`runtimeReady:false`。
- 历史1.0.0包：`work/alone-against-fear/preview-molotov-runtime/alone-against-fear/1.0.0/`。旧证据有3终局、6任务API与18桌面／手机路线；保存在 `final-terminal-*`、`final-mission-*`、`final-browser-*`。旧截图已另存 `historical-browser-1.0.0-screenshots/`，防止test-results覆盖。旧证据不能套用1.0.1。

### 已经实施的主要修正

1. 普通吸血鬼3/6逼退与Faith／Exorcism／Garlic动作区分；战后占据状态／逃跑后搜索限制；嚎叫者胜或逃后2/6遭遇；Skeleton燃烧瓶免疫与徒手反伤；读过秘术指南后骨粉；玩偶首次Fear不重复；Ghost Librarian／Mirina不额外奖XP；Demon Cat按原文Animal，不由名字推断圣水弱点。
2. 银项链、戒指、银十字架、熔炼工具→银弹／银刀；分枪种银弹池、步枪混合射击、M4同型枪实例与弹药；Holy Bullets为独立手枪弹池，普通弹为0仍能使用。见 `silver-source-review.json`、`fear-silver-rules.test.ts`。
3. 五金店逐件概率搜索，单次2/6遭遇在首次拾取触发；CLOWNFACE与小丑判定；诊所／礼拜／农场僵尸群的选择与奖励；狼人单只的两次上限／银武器／逃跑修正不扩到狼群。
4. **核心骰子纠正**：原文 `section-rolling-sixes-explosions:p1` 限定Attack die掷6爆骰。现在普通检定、Defense、几率、数量都是普通D6；攻击保留爆骰。大量旧测试／见证的骰序因此过期。
5. Food→Salt（1点＝1剂，直接盐表结果是6剂）；每次礼拜访问可拿一个重量可忽略宗教标志；Random Objects45/61进入真实2D6书表，61重掷2/12并持久续接，打印稿只是一本文字载体，不多送一件物品。7项helper＋公开流程通过。
6. 物品模块已写并正在接主循环：食物、衣物、一次性检定加值、酒／咖啡、护甲、Diary XP、书籍学习、喷火、手电筒、武器拾取等。**中断发生在这一阶段，不能标全部完成。**
7. 当前源码已见普通负SAN重新实减、resource XP进入Diary gross-award函数、Kitchen Knife同时满足Pentagram仪式匕首条件；这些不能继续照旧报告说“完全未实现”，但仍需本次完整验证。
8. 当前定义已经移除Giant Vampire Bat无来源的vampire标签，并补Cultists human、Night Shadow shadow、Mummy mummy。其他犬类／儿童标签是最后交付给worker的任务，需按现场定义核查，不能仅看旧报告。

### 中断时优先待核对的规则

- 收尾 `fear-item-source-rules.ts` 在 `fear.ts` 中的每个实际消费者，参考18项／59段落的 `current-item-implementation-map.json`，不要把纯helper测试当中央集成或整本认证。
- 战前准备必须先于初始Fear、突袭和先手攻击。Possessed Doll的Fear在table operations中位于start-combat之前，因此只拦start-combat不够。当前已有 `fear-item-before-encounter`／`fear-item-check` pending，需检查一次续接、不重掷已选表、不泄露未来分支、饮酒／食物使用时序与混合组。
- SAN负值回归已经修过；但**所有事件／遭遇SAN损失是否都能按原文选择Mental Scar**尚需核查。当前 `applyEncounterSanityLoss`仍直接扣SAN；不要遗漏普通resource SAN，也不要把明确支付／献祭当可以防具抵消的伤害。
- 防具破坏生命周期：耐久0消耗当前件、移除穿戴、容量正确；之后合法拿到新件能使用；同件脱穿不能刷耐久。最后一条提醒在中断前发出，尚未收到实现／测试确认。
- Coffee一包6次，按实际成功入包注册，旧存档可惰性初始化；不要变成6个物品槽。Flashlight是实际weapon所有权，夜影光伤和战后1/6电池必须对canonical敌人测试。
- Diary按真正获得XP累计，不按行动净变化；额外XP不递归计入；普通战斗XP被来源奖励撤回时，累计计数也须正确撤回。
- Dog Food／Dog Toy、Toy依赖来源明确的canine／child标签；僵尸狗、狂犬、地狱犬及5类明确儿童此前缺标签，核查最终修复及真实catalog动作，不仅合成tag测试。
- Stuffed Bird来源写鸟形恶魔，但未找到原书具体鸟形敌人；保留规则并如实记不可触发范围，不补造敌人。**Beasts#1实际是Giant Albino Alligator，不是猫群**，曾有误记已纠正，不能给它cat-like标签。
- 继续检查既有合法战中诱饵、使魔、交易、技能学习和sourceweapon acquisition，没有被新pending机制误禁。

### 重要代码、测试与审校文件

- `packages/engine/fear.ts`：中央流程，约五千行，当前集成中。
- `packages/engine/fear-item-source-rules.ts`：物品helper与状态／副作用接口。
- `packages/engine/fear-source-acquisition.ts`：三个来源获取流程。
- `packages/engine/fear-table-rules.ts`、`fear-family-rules.ts`、`fear-general-rules.ts`：现有规则模块。
- `packages/contracts/fear.ts`及schema：银弹、bookSources、获取／续接状态等契约。
- `tests/fear-item-source-public.test.ts`：最后尚未全通过的公开物品测试。
- `tests/fear-table-consumer-source.test.ts`：armory、Hangman、library、Rosen四项公开机制测试已通过。
- `work/alone-against-fear/current-source-reconciliation.json`：当前汇总，仍false。
- `current-source-audit-tables.json`、`current-table-effect-consumer-map.json`：56表／391结果、19effect消费者追踪；后者是静态追踪，不是所有分支认证。
- `current-source-audit-items-skills.json`、`current-item-implementation-map.json`：18项物品机制来源清单。
- `current-enemy-hook-reachability.json`：95档案来源／实际引用／标签消费者／synthetic测试边界，固定审计快照。部分问题后续已修，必须对照现场，不修改旧快照哈希冒充复验。
- `source-acquisition-review.json`、`silver-source-review.json`、`current-source-audit-beasts-undead.json`、`current-source-audit-special-creatures.json`。
- `docs/fear-import-report.md`中“表格尚待接入”部分已经滞后于最近实现，最终应按实际证据重写。

## 建议接续顺序

1. 先阅读交接文件和规范，保留脏工作区；处理268项里的5失败，并核对上述未确认物品／SAN／护甲规则。可并行使用用户授权的GPT-6 Luna，但中央 `fear.ts` 与canonical definition必须同一时间只有一个写入者；其他人写独立tests／只读审计。
2. 收齐专项测试、来源审校差异，所有引擎／contracts停止修改后冻结运行时。指纹由 `tools/story/runtime-fingerprint.ts` 对engine/rules/contracts所有TS生成。不要先认证，后继续改代码。
3. 复制Fear模板设置版本1.0.1到新工作文件；`compile-fear`先输出审校JSON，再`pack`生成work中的片段候选。不要覆盖历史1.0.0。

```sh
npm run story:workflow -- compile-fear \
  --definition work/alone-against-fear/reviewed-definition.json \
  --template work/alone-against-fear/reviewed-story-1.0.1.json \
  --output work/alone-against-fear/reviewed-runtime-1.0.1.json
npm run story:workflow -- pack work/alone-against-fear/reviewed-runtime-1.0.1.json \
  --output work/alone-against-fear/preview-final/alone-against-fear/1.0.1
npm run story:workflow -- verify-runtime work/alone-against-fear/preview-final
```

上面两个1.0.1输入／输出文件尚未创建，命令是接续计划；先准备模板，不要认为已执行。

4. 重新生成／严格执行Fear三终局（won/dead/insane）、六任务完整见证及M4同枪实例源路线。工具：`target_fear_routes.ts`（FEAR_CANDIDATE／FEAR_ROUTES）、`target_fear_missions.ts`（FEAR_MISSION_PACKAGE／FEAR_MISSION_ROUTES）、`reconstruct_fear_insanity.ts`（FEAR_CANDIDATE＋旧itinerary输入）、`target_fear_m4_instances.ts`（当前仍硬编码历史1.0.0，必须修输入路径）。新pending必须通过真实公开动作解决，不能注入进度／跳关。
5. 更新 `tests/fear-mission-witness.test.ts`、`tests/fear-m4-firearm-instances.test.ts`的旧包路径及实际重新生成的报告；它们严格检查运行时指纹，当前全量测试会因旧见证过期而失败。
6. 对Frost1.0.5重新严格执行已有78条输入路线；不需要重找已知完整路线。已有见证显式presetId，不要再使用STORY_ALL_PRESETS把性别限定路线强套另一性别。

通用严格工具（路径为接续者确定的新报告）：

```sh
STORY_CANDIDATE=<候选包目录> STORY_ROUTES=<新的严格报告.json> \
  npx tsx tools/story/verify_story_witnesses.ts <已知路线输入.json>
STORY_CANDIDATE=<候选包目录> STORY_ROUTES=<已复验见证.json> \
  STORY_API_REPORT=<新的API报告.json> npx tsx tools/story/replay_story_routes.ts
```

六任务API另加 `STORY_ROUTE_GOAL=mission`。探索时可用STORY_SKIP_INVALID找路线，但最终认证禁止带它；所有合法组合需完整见证，拒绝／缺项不能算通过。

7. 认证API检查每条角色归属、重复请求不重掷、history读取不变更、途中DB关闭／重启后恢复、终局。Frost78组合；Fear3终局＋6任务，任务完成仍active且可开始下一任务。
8. 桌面／手机完整代表路线：`tests/browser/story.routes.spec.ts`，环境 `STORY_CANDIDATE`／`STORY_ROUTE_WITNESSES`。历史Frost6路线×2＝12，Fear9路线×2＝18。使用各自新版本、当前指纹；浏览器固定15175端口，串行运行，运行后及时把截图从test-results复制保存并实际目视检查。
9. 全项目 `npm test`、typecheck、build、story/source/runtime校验、diff-check；保留现有三书回归。如果新修规则改变见证，再冻结并重新生成，不更新旧报告哈希绕过。
10. 所有验收通过后，字节一致复制到 `stories/alone-against-frost/1.0.5/` 和 `stories/alone-against-fear/1.0.1/`，再给 `AVAILABLE_STORY_IDS`加入两个ID。通过实际剧本馆入口创建新局并验证载入最新版本；更新最终报告与验收stamp。当前没有授权外部部署，也无需自动commit。

浏览器配置支持 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。已有Chrome路径：`/tmp/coc-tide-browsers/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`，先检查是否仍存在。

交付完成标准：两书都在本地剧本馆可进入，所有来源及适配有据，当前版本角色／终局矩阵及Fear六任务认证完整，存档／幂等／重启和桌面／手机通过，报告与发布内容一致。
