# 余烬档案

把 KP-less 剧本转为网页独行冒险。React/Vite 前端负责演出，Fastify 后端负责认证、剧本与判定，SQLite 保存每局独立状态。

## 本地启动

需要 Node.js 22.16+（当前在 Node.js 25.9 验证），以及 npm。

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:5175。API 默认监听 127.0.0.1:3001，Vite 代理 `/api`。创建账号后选择剧本、命名调查员并开局。SQLite 默认存放在 `data/game.sqlite`，退出进程后保留。

现已接入《静躁独行》（372 个原书剧情条目，Alex / Charlie 两名角色）和《Alone Against the Flames》（270 个原书条目，剧情引导建卡）。引擎支持循环探索、记录表、属性与技能分配、孤注一掷、对抗检定、战斗、疯狂与重伤中断、魔法投入及技能成长标记。转换说明和原文勘误见 [单人模组实现](docs/solo-modules.md)。

另有两个原创短篇：**黑潮来信**（13 个节点、3 个结局）和 **第零号站台**（8 个节点、3 个结局）。支持预设角色、自定义技能分配、服务器生成幸运值、D100 检定、条件选项、物品与理智/生命变化、自动保存、继续、回忆、剧情回放、静音与简化动画。

每次行动由后端确认后提交。刷新、重复提交和多设备竞争不会回档或重掷。回放仅阅读已经保存的经历，不重新执行规则。

## 构建与验证

```bash
npm run build
npm start
npm run test
npm run story:validate
npm run chars:validate
npx playwright install chromium --only-shell
npm run test:e2e
```

`npm start` 提供构建后的网页和 API，地址为 http://127.0.0.1:3001。构建和启动命令在仓库根目录执行。环境变量：`PORT`、`HOST`、`DATABASE_PATH`、`APP_ORIGINS`（逗号分隔）、`NODE_ENV`。HTTPS 部署时设置 `NODE_ENV=production` 以启用 Secure Cookie，并为公共入口配置 `APP_ORIGINS`。

浏览器测试使用单独的临时数据库，覆盖桌面与手机，测试账号不写入实际游戏数据库。

## 官方角色模板

调查员页面支持基于官方模板创建角色，开局时可选择“已有调查员”。《静躁独行》的 Alex 和 Charlie 模板与官方原始 PDF 位于 `chars/alone-against-static`；《Alone Against the Flames》采用书中引导建卡，官方提供空白卡，没有固定预设人物。调查结果与字段说明见 [角色模板说明](chars/README.md)。

模板数值由后端读取，玩家可以命名角色，玩家点击“掷幸运骰”后，服务器生成并保存 3D6 点数，网页播放三颗骰子的动画并展示 3D6×5 的幸运值。未完成掷骰不能确认普通角色。《Flames》在剧情条目 134 中掷幸运，开局只需填写姓名。掷骰请求和确认建卡均可安全重试，不会重新掷骰或重复建卡。

“调查员”页面附带独立骰盘，支持 1–1,000,000,000 面骰、每次 1–100 颗，逐颗展示点数及总和。自由掷骰不能替代建卡的幸运骰。

复用已有角色开局时保留幸运；每局复制角色状态，生命与理智变化不会修改存档角色或其他局。《静躁独行》限定使用该模组的角色模板；《Flames》从空白卡开始。

## 新剧本与导入

可发布剧本位于 `stories/<id>/<version>/story.json`。其中 `presets` 是预设角色，`nodes` 是结构化剧情图。节点支持阅读、选择、检定和结局，条件与效果使用受控字段。发布时保存新版本，不原地修改已有版本。原始材料不在网页静态目录里。

```bash
npm run story:import -- scripts/静躁独行.txt --output /tmp/coc-txt-draft.json
npm run story:import -- "scripts/CHA23145 - Alone Against the Flames.epub" --output /tmp/coc-epub-draft.json
```

当前两个正式模组可执行 `python3 tools/story/compile_solo.py` 从仓库源文件重新编译，再运行 `npm run story:validate`。

通用导入器只生成作者草稿。TXT 会提取编号段落与候选跳转；EPUB 首期提取 HTML 文本片段，尚未按书中段落拆分，也未实现完整阅读顺序。需要人工整理节点、检定、条件和效果，经校验后才能发布。

## 模块

- `apps/web/src`：网页入口、游玩、角色、回忆/回放、声音控制。
- `apps/api/src`：认证、目录、进度、历史、数据库迁移。
- `packages/contracts`：公开 API 类型与内容类型。
- `packages/engine`：剧情状态转换与可见视图投影。
- `packages/rules`：版本化规则子集、随机源与检定。
- `stories`：服务端读取的版本化内容。
- `chars`：官方角色模板、来源 PDF 与校验清单。
- `tools/story`：导入与发布前校验。

设计背景见 [整体架构](docs/architecture.md)。媒体来源见 [资源清单](docs/assets-sources.json)：本地开发版使用参考站公开卡背、背景音乐和三种检定音效，原始资源保留来源与 SHA-256；场景 SVG 为本项目原创。未使用或保存参考站认证信息。

## 当前边界

`coc7-solo@2` 实现当前两部单人模组所需的规则；不是完整的 CoC 通用规则书实现。通用幸运消耗和任意职业建卡仍未提供。旧示例继续使用 `coc7-subset@1`，保留原有存档兼容性。角色档案保存开局模板，局内变化在各自游戏中展示。

备份需同时保留 SQLite 一致性备份、旧剧本版本和引用媒体；不能仅复制运行中 WAL 模式的主数据库文件。
