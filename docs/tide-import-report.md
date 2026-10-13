# 《潮汐独行》解析、汉化与可游玩验收

《潮汐独行》1.0.1 已接入项目，成为第三个可游玩模组。本次按用户提供的 PDF 完成来源提取、中文汉化稿、独立片段拆分和完整路线验收。项目展示译名暂用《潮汐独行》，属于适配译名；中文由 GPT-6 Luna 分批生成并完成专项对照检查，属于待进一步审校的项目汉化稿，不是官方译文。

## 交付位置

| 内容                                                   | 路径                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| 原件及 SHA-256 依据                                    | `scripts/Alone Against the Tide … .pdf`，原名保留；校验和见来源图      |
| 精简来源关系图                                         | `scripts/潮汐独行.dag.json`                                            |
| 243 个英文原书条目                                     | `scripts/alone-against-tide/fragments/001.json` 至 `243.json`          |
| 前言、版权、目录、角色表、作者履历、包装与来源审校信息 | `scripts/alone-against-tide/fragments/supplements.json`                |
| 提取的 67 份不重复图片资源                             | `scripts/alone-against-tide/assets/`                                   |
| 7 张图片补充页的 OCR 及置信度、词级坐标                | `scripts/alone-against-tide/ocr/`                                      |
| 两张预生成角色卡的部分可视核对字段                     | `scripts/alone-against-tide/ocr/visual-review.json`                    |
| 243 个独立中文条目                                     | `scripts/alone-against-tide/translations/zh-CN/001.json` 至 `243.json` |
| 41 份中文前言／附录／角色卡／图注内容                  | `scripts/alone-against-tide/translations/zh-CN/supplements/`           |
| 译文索引、来源哈希和审校说明                           | `scripts/alone-against-tide/translations/zh-CN/manifest.json`          |

原件是 90 页的 PDF，剧情正文有可用文本层。原书条目编号为 1–243，入口为 1。来源图包含 450 条明示跳转；50 个条目含 `THE END` 标记，其中部分是条件失败才结束，不能将它们直接当成 50 个独立可收集结局。

来源图为 `coc-story-graph@2`，允许回环，只有条目引用、跳转及来源审校信息，不嵌入 PDF、图片或完整正文。原文保持纸面指令、骰式、数值、括号中的回溯编号与所有包装内容。每个片段保存 PDF 页码及原始文本层中的字符跨度；supplements 保存编号标题的栏位／坐标、图片位置、逐页文本哈希和资源引用。

## PDF 提取与 OCR

正文使用 pypdf 提取文本，用 pdfplumber 的字体、文本矩阵基线与左右栏坐标确定阅读顺序，处理断行、跨栏、跨页续文。文本流与视觉栏序不同的 PDF 第 13、19、41 页已经按版面校正。特别是第 41 页右上方的闪避／枪伤规则属于条目 125 的续文，不能挂到 123；126 的下一页续文也归回 126。

所有 90 页的文本块在按来源跨度重组后，与原件的规范文本层逐字符一致；没有遗漏或重叠。此验证证明文本层覆盖，不等同于 PDF 二进制或所有图片都能无损转成文字。原 PDF 保持不变，67 份不重复的解码图片资源另存并核对 SHA-256，原图仍是角色表与插图的最终依据。

本地 Tesseract 对 PDF 第 79–84、89 页执行英文 OCR。第 89 页是插图，未识别出单词；其文字层与图像仍保留。角色卡的字体、框线和数值刻度产生较多低置信度识别，OCR 的文本、坐标和置信度全部保存。没有将不确定的 OCR 数值自动写成可执行角色模板。

已另行对照渲染原图检查第 79、81 页两个 Woods 角色的身份、八项属性、生命／理智／魔法、移动值及明确填写的技能值。幸运栏原本为空，仍为空；空白技能格不等于零；原书允许再分配 70 点技能，但本次没有替玩家分配。核对文件只记录检查过的字段，其余信息保留在原图及 OCR。

## 汉化与审校

三批 GPT-6 Luna 完成了全部 243 个编号条目，最终覆盖 1,611 个原文块，包含标题、自然段、规则指令和回溯编号。页眉与图注采用共享译文引用；前言、版权、作者名单／履历以及 OCR 补充资料也有中文版本。没有生成重复的整本 `reading.json`。

检查包括每个段落 ID 的覆盖／顺序、源片段 SHA-256、明确数字与骰式保存，并抽查了建卡、技能、理智、伤害与条件分支。栏序修正后，按原始来源跨度重新绑定译文；需要拆开或合并的 7 个条目交给 Luna 重新翻译，不将相邻段落直接拼凑成新剧情。中文数词的少量阿拉伯数字规范化不改变数值或规则。

原文中的装饰字体映射字串（如 `ASASKJKHM`）保留于包装／图注来源并注明不作剧情语句解释。源书语法重复、字体断词和图注歧义记录在译文说明中；不能确定的 OCR 内容不擅自补字。正文自然段与对白保留完整，列表按原规则分项；未逐句拆分。

## 可游玩包与验收

`stories/alone-against-tide/1.0.1/` 已成为第三个可游玩模组，剧本馆入口已开放。运行包采用 `coc-runtime-graph@1`：315 个规则节点、243 个去重双语正文片段，`story.json` 为 274,233 字节（约 268 KiB）。默认中文通过 `textRef: "default"` 复用，英文单独保存；没有 `reading.json` 或嵌入 PDF。辅助节点复用对应原书条目的片段。1.0.1 保证 173、191、215、219、235 节的过渡叙述先显示，再用唯一“下一节”按状态自动分支；条件死亡结局使用有原文依据的原因描述。1.0.0 发布包及其旧路线见证保持不变，旧存档继续绑定旧版本。

原书 243 节、1,611 个原文块及其中文对应段、41 份补充译文、67 项图片资源和原 PDF 都完整保留在来源目录中。运行包使用其中 242 个有入口的编号条目，加上规则辅助节点；未装入的第 187 节原文与译文都没有删除。

### 已执行机制

- 自建角色：八项属性，八种职业，九个职业点值（含信用评级），七项非职业兴趣技能；艺术、外语等专长按职业输入／固定。
- 两位伍兹博士：使用目视核对的属性、技能、年龄、性别、居住地、出生地、移动力和体格；额外 70 点技能加值由玩家分配。建卡结束掷 3D6 × 5 幸运，档案卡同步最终数值。
- 拍卖会最多三次不同交谈；六件拍品各有一次竞拍机会，失败不获得物品，成功自动扣信用评级。地下室每件文物只调查一次，并登记取得的物品。
- 自动保存班尤之约、咒语、金粉、石像、枪支以及被没收武器等状态。已知咒语只在原书提示时允许使用；持有石像与金粉决定仪式分支。
- 单次成功／失败战斗，普通／困难／极难检定，奖励／惩罚骰，锁匠孤注一掷，生命与理智损失。按本书简化规则不进入标准重伤流程；162 节支持疯狂下的四种射击结果、两枪判定及逃跑奖励／惩罚骰。
- 可选的幸运消耗：明确选择后按 1:1 扣除，保存原始骰点和调整结果；排除幸运、理智、大失败与已经孤注一掷的结果。重复请求不会再次扣点或掷骰。

职业定义核对 [Chaosium 官方职业／技能规则](https://cthulhuwiki.chaosium.com/investigators/step-three-occupation-and-skills.html)。162 节单次损失至少 5 点后的智力识别判定核对 [Chaosium 官方快速入门规则](https://www.chaosium.com/content/FreePDFs/CoC/CHA23131%20Call%20of%20Cthulhu%207th%20Edition%20Quick-Start%20Rules.pdf) 第 28 页；累计损失五分之一按本书计为暂时性疯狂。

### 完整路线证据

`tests/browser/fixtures/tide-endings.json` 保存三种角色各 50 个原书结局的 150 条从入口开始的合法见证，共 8,270 次命令，包含每次选择、分配输入、骰子范围／数值及实际到达节点。先执行 12,000 次探索，未出现无行动死路或超过步数上限的局，再补足稀有路线。所有见证通过实际认证 API 重放，验证重复请求、数据库关闭重启、剧情恢复、结局收藏与成就编号。

50 个原书结局由 39 个完整终章及 11 个条件死亡结果组成，名称只是项目适配编号。新增的永久性疯狂处理是通用健康退场，`collect: false`，不占原书结局收藏名额。现有新建角色的初始理智至少 40，任一路线最多损失 17 点理智，因此该通用边界不会从正常新局到达；它由单独健康边界测试验证，而非伪造完整路线。

桌面 1440 × 1000、手机 390 × 844 的真实浏览器完成三种角色仪式路线、恐惧昏厥、拍卖循环、幸运消耗和刷新后的骰点恢复；另验证开放的剧本馆入口、三种角色选项与伍兹博士无需填写 23–36 岁年龄。每个步骤检查无横向溢出。证据见 `tests/browser/tide.full.spec.ts`，截图位于 Playwright 的 `test-results/`。

原件哈希、90 页完整文本层重建、243 个编号／栏序、全部图片与 OCR 哈希、1,611 个译文段落的数字／骰式及 41 份补充译文均通过校验。项目类型检查、运行包校验、全仓 **274 项测试**及生产构建通过；桌面／手机共 **14 项浏览器用例**通过；现有向火／静躁独行另有 **20 项浏览器回归**通过。专项测试见 `tests/tide-source.test.ts`、`tests/tide-runtime.test.ts`；规则段落审校账目见 `scripts/alone-against-tide/review/runtime-1.0.1.json`。

### 原书疑点与适配边界

PDF 第 39 页（印刷第 38 页）第 119 节经页面图像核对，确实印为：游泳失败损失 1 HP，生还则前往 **18**。第 187 节虽然标示回溯来源为 119，但没有任何正向入口。本实现保留 119 → 18，未猜改为 187；187 留在原文及汉化来源包，运行图与章节收藏都不设无法到达的入口。稀有濒死见证因此可能合法经过这一原书回环，多次经过渡船／旅馆／林间路线；这不代表原书时间线没有矛盾。

前言给予伍兹博士 70 点额外技能，与 80 节“技能已分配”的叙述并存：按前言给予这项额外加值。职业技能和七项非职业兴趣约束采用原书引用的官方建卡规则，七项数量覆盖基础规则的四项。汉化是项目译文，仍保留所有译者审校注释，未宣称官方译文。

## 重建命令

离线提取需要 Python 的 `pypdf` 与 `pdfplumber`，OCR 需要本地 `tesseract` 和 `eng` 语言包。通用 CLI 优先使用当前 Python 的依赖，缺少时尝试 Codex 已配置的 bundled Python；没有可用依赖则报错，不猜测提取结果。此适配器只支持已经检查的这份 90 页 Tide 版式，不能自动套用到其他 PDF。

```sh
npm run story:workflow -- extract-pdf-tide "scripts/Alone Against the Tide Solitaire Adventure by The Lakeshore (Call of Cthulhu MPRG 23174) (Nicholas Johnson, Lynne Hardy, Mike Mason etc.) (z-library.sk, 1lib.sk, z-lib.sk).pdf" --output scripts/潮汐独行.dag.json
npm run story:workflow -- ocr-pdf-tide "scripts/Alone Against the Tide Solitaire Adventure by The Lakeshore (Call of Cthulhu MPRG 23174) (Nicholas Johnson, Lynne Hardy, Mike Mason etc.) (z-library.sk, 1lib.sk, z-lib.sk).pdf" --output scripts/alone-against-tide/ocr
npm run story:workflow -- verify-source "scripts/Alone Against the Tide Solitaire Adventure by The Lakeshore (Call of Cthulhu MPRG 23174) (Nicholas Johnson, Lynne Hardy, Mike Mason etc.) (z-library.sk, 1lib.sk, z-lib.sk).pdf" scripts/潮汐独行.dag.json
npx tsx tools/story/validate-source-dag.ts scripts/潮汐独行.dag.json
python3 tools/story/tide_translation.py check scripts/潮汐独行.dag.json scripts/alone-against-tide/translations/zh-CN
npx tsx --test tests/tide-source.test.ts tests/source-dag.test.ts
```

Luna 翻译阶段的指南、输入清单与重排说明保存在 `work/alone-against-tide/`。与最终译文逐字一致的工作副本已清理；重新翻译时先按指南生成工作片段。固化译文的入口为 `python3 tools/story/tide_translation.py freeze scripts/潮汐独行.dag.json work/alone-against-tide/zh-CN --output scripts/alone-against-tide/translations/zh-CN`。源片段发生变化后必须重新匹配／审校译文哈希，不允许仅替换哈希掩盖正文改变。

可执行包重建与路线验收：

```sh
npm run story:workflow -- compile-tide --output work/tide-preview/alone-against-tide/1.0.1
npm run story:workflow -- verify-runtime work/tide-preview
TIDE_ROOT=work/tide-preview npx tsx tools/story/find_tide_routes.ts
TIDE_ROOT=work/tide-preview npx tsx tools/story/target_tide_routes.ts
npm run story:workflow -- compile-tide --output stories/alone-against-tide/1.0.1
npm run story:validate
npm test
npm run build
npx playwright test tests/browser/tide.full.spec.ts --project=desktop --project=mobile
```

已发布版本只能等价重建；规则或正文变化须修改内容版本并重新进行所有验收。路线探测输出位于 `work/alone-against-tide/routes.json`；审校后才替换正式测试见证，不通过仅替换校验和掩盖规则变化。Chromium 首次使用需要 `npx playwright install chromium`；本次测试浏览器安装在临时目录，macOS 的 Mach 端口需要沙箱外启动权限。
