# 《恐惧独行》来源导入与运行审校报告

## 当前状态

**2026-10-15：当前正式版本为1.0.2。** 已修复喷火战后结算、防具备用库存、发布候选文案及测试资料缺失，重新完成当前运行时下的三终局、六任务、认证API和18条桌面／手机流程；772项测试及无原工作资料的隔离副本测试通过。验收记录见[收尾报告](solo-closeout-2026-10-15.md)与 `scripts/alone-against-fear/review/runtime-1.0.2.json`。下文1.0.1发布和候选文案说明保留为历史记录。

《恐惧独行》1.0.1 已于2026-10-14完成全部验收并复制到 `stories/alone-against-fear/1.0.1/`，本地剧本馆入口（`AVAILABLE_STORY_IDS`）已开放。完整验收记录见下方“最终验收（2026-10-14）”。包内 `description` 仍是候选阶段文案（写着 `runtimeReady为false`）；它与通过验收的候选字节一致，任何改动都会改变 manifest SHA 并要求整套重新验收，因此保留原样，留待下一次内容版本更新。

原件完整性和分段／译文账本当前复验通过：106页 PDF、133个来源片段、42个编号事件、91个补充章节、524个中文译文段落、191个哈希资源；逐页视觉审阅覆盖106/106页。机器记录见 [`恐惧来源当前验证`](../work/恐惧-source-current-verification.json)。OCR保真声明仍为 `false`，封面标题／署名漏识别、图像伪文字和第98页未完整进入OCR账本等限制继续保留。

当前表格审计是 [`current-source-audit-tables.json`](../work/alone-against-fear/current-source-audit-tables.json)：56张定义表、391个来源结果。旧 [`table-rule-inventory.json`](../work/alone-against-fear/table-rule-inventory.json) 只列55表／385项，是历史来源定位索引；它漏掉了 Rewards，不再作为当前审计计数。表审计仍列有实际待接入项，包括五金店遭遇时点、CLOWNFACE 避战、狼人单独／群体规则边界，以及诊所、礼拜场所、农场围攻奖励。

来源侧近期复核还包括：Beasts／Undead 当前审计记录12/12定向来源测试通过、无已确认定义／运行时不匹配；14个特殊生物均有来源绑定，其中9个有直接行为测试。两份审计都明确限定其覆盖范围，不等同于逐个完整 API／浏览器路线验收。完整账本见 [`current-source-reconciliation.json`](../work/alone-against-fear/current-source-reconciliation.json)、[`current-source-audit-beasts-undead.json`](../work/alone-against-fear/current-source-audit-beasts-undead.json) 和 [`current-source-audit-special-creatures.json`](../work/alone-against-fear/current-source-audit-special-creatures.json)。

## 原件与转换依据

| 项目 | 当前记录 |
|---|---|
| 书名／作者 | *Alone Against Fear*，Andrea Sfiligoi |
| 原件 | `scripts/Alone Against Fear (Andrea Sfiligoi) (z-library.sk, 1lib.sk, z-lib.sk).pdf`，106页 |
| PDF SHA-256 | `6737a687a79c49ef36b0e13d98fa0536b5ab8724eb127312522126b46570a572` |
| 来源图 | `scripts/恐惧独行.dag.json`，包含42个编号事件及独立章节来源 |
| 规则标识 | `aaf-solo@1`。原书明确以 *Four Against Darkness* 规则为基础，因此使用D6和来源自己的资源／战斗规则，不套用CoC百分骰检定。 |
| 来源／译文 | 133个原文片段和524个中文段落，按原段落ID与片段SHA绑定 |

PDF图像及逐页视觉审计记录保存在 `work/alone-against-fear/`。OCR与视觉审计报告明确记录了遗漏和伪文字；扫描／图像内容不能据此宣称已无损转录。

## 已接入的三条获取规则

[`fear-source-acquisition.ts`](../packages/engine/fear-source-acquisition.ts) 的 helper 已由 `fear.ts` 调用，并通过来源绑定测试和公开动作流程测试：

- 随机物品表16直接提供6剂盐；找到食物时可把选定的每1点食物改为1剂盐。helper先提供0至找到点数的选择，再把其余食物交给通常容量规则。
- 每次到访礼拜场所都提供单独的“拿取／不拿”宗教标志选择，不覆盖尚未解决的遭遇或其他选择。
- 随机物品45掷一次随机书籍表，2和12都有效；61视为同一本书的打印稿来源，2或12时自动继续重掷。拒绝的点数会生成待继续信号，不会把未掷出的书名泄露给玩家，也不额外赠送第二件打印稿物品。

具体段落、原件哈希、译文绑定和集成状态见 [`source-acquisition-review.json`](../work/alone-against-fear/source-acquisition-review.json)。`fear-source-acquisition.test.ts` 与 `fear-source-acquisition-runtime.test.ts` 合计7项通过；公开流程覆盖转换、实际重访、书籍表抽取和连续2/12重掷。该范围测试不替代整本完整路线及 API／浏览器验收。

盐剂量按来源分别处理：表格结果16是6剂；食物转换规则是每1点食物换1剂。两者没有相互乘算。

Holy Bullets 的来源修正也有独立证据：原书随机魔法物品表第4段给出2D6发、仅手枪使用；运行测试以普通手枪弹为0验证圣弹自身支付该次射击，并覆盖对恶魔的2点伤害和逼退骰。来源审计见 [`silver-source-review.json`](../work/alone-against-fear/silver-source-review.json)。

## 历史验收

1.0.0 曾有三结局、六任务及 API／桌面／手机见证，但这些结果绑定旧包和旧运行时指纹。它们仅作为历史证据保留，不能证明当前 1.0.1 候选通过。

## 最终验收（2026-10-14，1.0.1）

引擎最后一项规则改动是把来源“精神疤痕”规则接入中央调度：`resolveEncounterSanityLoss` 对不超过2点的非战斗理智损失排入 `injury-prevention` pending，由真实公开动作二选一（“承受损失”／“以永久伤残避免损失”）结算；`runOperations` 在 pending 或战斗期间顺延，使 `roll-check-count` 批次中每次失败检定各自成为一次独立选择（雾中脸、女巫图书馆守卫每回合2点均符合此语义）。书店遭遇结束后新增来源3/6跟进检定（`finishFearBookstoreEncounter`），≤3触发书店内遭遇。改动后全项目测试随之更新并全绿。

所有引擎／contracts修改停止后冻结运行时指纹 `8c0130293ebb400a8f4de157f93206a88861522168e34038f9f376ac2888ebb2`；本节所有见证都绑定该指纹与 1.0.1 manifest SHA-256 `fac4643353e7a5a901ad4cf8adbc5d5559636c3efbdee436f622d0cdee746957`。候选由 `compile-fear`＋`pack` 生成于 `work/alone-against-fear/preview-final/alone-against-fear/1.0.1`，`verify-runtime` 通过（70节点、1角色）。新增 pending 一律通过真实公开动作解决，无状态或进度注入。

- 三终局：胜利25步（`final-victory-route-1.0.1.json`）、疯狂17步（`final-insanity-constructed-1.0.1.json`）、死亡16步（`dead-route-search-1.0.1.json`）；严格复验合并见 `final-terminal-witnesses-1.0.1.json`，逐动作公开可用、逐骰记录一致。
- 六任务：`final-mission-witnesses-1.0.1.json` 覆盖任务1–6、零失败；任务完成仍active且可开始下一任务。
- M4同枪实例：`m4-firearm-instance-witness.json`（2支手枪、24发弹药、2 XP）与 `m4-firearm-instance-threshold-witness.json`（7发、1 XP）按1.0.1重生成，`target_fear_m4_instances.ts` 输入路径已参数化。
- API认证：`final-terminal-api-report-1.0.1.json`、`final-mission-api-report-1.0.1.json` 覆盖角色归属、重复请求不重掷、history读取不变更、途中DB重启后恢复、终局与任务留存。
- 桌面／手机：`final-browser-witnesses-1.0.1.json` 共9条路线（3终局＋6任务）×desktop/mobile 18项全部通过，逐测试截图存于 `final-browser-1.0.1-screenshots/` 并已目视检查。
- 全项目 `npm test`、typecheck、build、`verify-runtime`、stories树校验通过；`tests/fear-mission-witness.test.ts`、`tests/fear-m4-firearm-instances.test.ts` 已指向1.0.1包与重生成报告。

验收通过后候选字节一致复制到 `stories/alone-against-fear/1.0.1/`，`AVAILABLE_STORY_IDS` 加入 `alone-against-fear`；通过实际剧本馆入口（`/api/stories`＋`POST /api/runs`，guided预设）创建新局，载入版本确认为1.0.1。结局成就编号已登记于 `apps/api/src/modules/ending-numbers.ts`。本轮无新增网页适配差异：精神疤痕与书店跟进检定均为来源规则本身，非适配。未执行外部部署；提交按用户指示另行处理。
