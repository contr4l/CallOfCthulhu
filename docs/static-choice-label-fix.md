# 《静躁独行》1.2.1 选项文案修复验收

日期：2026-10-15。来源 TXT SHA-256：`aca78d336a9c6ad293f28fc29d0cfc77126688b5526176230b9ac943b0f13598`。运行图 SHA-256：`39ccc71eec9472d3e75e751aa0f2fc19de9952e8351a8280a50ef01b91018a14`。

## 原因与修复范围

旧编译器先用带编号的表达式识别跳转目标，提取文案时却按第一个“转到／回到”切分，因此把“要回到小屋……”截成“要”。后续版本沿用旧版规则程序，继承了残缺标签；这不是按钮宽度或 CSS 截断问题。第 138 节的深入森林选项本身完整，受影响的是同场景返回小屋的选项。

`static_choice_labels.py` 现在直接使用已匹配的带编号跳转边界，保留动作中的普通动词。“要／或者／如果”等孤立连接词拒绝自动编译，只有经过来源核对的适配才接受。第 69 节原始草稿也有“或者，回到66”，正式包早已用手工规则覆盖为“放下匕首，返回”；编译阶段复用这一既有标签，保证全量 377 节点编译能通过，不增加第六处发布包差异。

| 原书条目 | 选项 ID | 原标签 | 1.2.1 标签 | 目标 |
| --- | --- | --- | --- | --- |
| 62 | to-57 | 或者 | 返回棚屋 | 57 |
| 65 | to-57 | 或者 | 返回棚屋 | 57 |
| 138 | to-120 | 要 | 要回到小屋去锁好门 | 120 |
| 177 | to-182 | 要 | 要回到小屋里锁好门 | 182 |
| 240 | to-294 | 要 | 要回到小屋去 | 294 |

62、65 原文只有“或者，回到57”，动作名根据第 57 节的棚屋场景补足，属于网页文案适配，依据用户 2026-10-14 的后续推荐适配授权执行。177 的唯一行动仍按通用规则显示“下一节”。

## 等价性与兼容性

新包保留 377 个规则节点、372 个正文片段；逐项比较证明仅五个选项标签、版本号及审校说明变化。全部正文、语言内容、角色、选项 ID、目标、条件、次数限制、骰点与状态程序一致。原始 TXT、来源图及来源片段不改写；1.0.0／1.1.0／1.2.0 包不改写。

先在 `work/alone-against-static/choice-label-preview/alone-against-static/1.2.1` 验收，再生成正式 `stories/alone-against-static/1.2.1`；373 个文件逐文件 SHA-256 相同。新局自动选择 1.2.1；旧局继续绑定原版本，仍会显示原版本的标签，不迁移进度或重掷骰点。运行中的服务须重启后加载新包。

## 执行证据

- 3 个专项测试通过：完整编译及文案边界和未审校文案拒绝、五处精确差异及正文／规则等价、29 条既有合法路线按原骰点回放。
- 两种固定角色各 14 个结局，共 28 条完整认证 API 路线通过，检查每步合法选项和原骰点、重复命令幂等、SQLite 关闭重开后续玩、结局收藏与成就解锁。完整输入和新包哈希保存在 [1.2.1 API 见证](../tests/fixtures/static-choice-labels-api-1.2.1.json)；引擎指纹 `f22cf0d3690aac9fc7910086170e3f65b351e9dddb10b243a806a1f3863509fd`。
- 每个结局的代表路线分别用桌面／手机真实按钮完成，28 个浏览器用例通过；检查骰子窗口刷新、终局刷新及无横向溢出，实际经过 62、65、138、240 并断言完整标签。177 不在本次完整见证路线中，其唯一“下一节”投影另由专项测试检查，不声称浏览器覆盖了该节。
- 第 138 节截图：[桌面](assets/static-choice-labels-1.2.1/desktop-138.png)、[手机](assets/static-choice-labels-1.2.1/mobile-138.png)。手机为 Chromium 390×844 触屏模拟。
- 浏览器首次新增断言未包含现有数字序号，导致定位失败；修正测试选择器后全套 28 项重跑通过，未修改生产 UI 来绕过断言。
- 最终正式目录稳定后的全量 `npm test`：779 项通过、0 失败；正式包专项 37 项、最终编译专项 3 项通过。`npm run typecheck`、`npm run build`、全部版本 `npm run story:validate` 与 `git diff --check` 通过。
- 首轮全量测试恰逢本地生成正式目录，一条《潮汐独行》API 路线读取到尚未写完 manifest 的目录，出现 ENOENT（同时使父测试失败）。正式目录写入结束后停止内容变更，重新执行全量 779 项，全部通过。
- 来源验证通过：372 条目、680 条来源边，完整重组与原件相同；候选运行包的结构、资源与片段校验通过。

## 复验

```sh
python3 tools/story/build_static.py --output work/alone-against-static/choice-label-preview/alone-against-static/1.2.1
python3 tools/story/workflow.py verify-runtime work/alone-against-static/choice-label-preview
python3 tools/story/workflow.py verify-source scripts/静躁独行.txt scripts/静躁独行.dag.json
STATIC_CHOICE_CANDIDATE=work/alone-against-static/choice-label-preview/alone-against-static/1.2.1 npx tsx --test tests/static-choice-labels.test.ts
STATIC_STORY_ROOT=work/alone-against-static/choice-label-preview STATIC_API_REPORT=work/alone-against-static/choice-label-api-1.2.1.json npx tsx --test tests/static-endings.test.ts
STATIC_STORY_ROOT=work/alone-against-static/choice-label-preview npx playwright test tests/browser/static.endings.spec.ts --project=desktop --project=mobile --workers=4
```

认证 API 测试显式授予测试账号的剧本权益，浏览器测试使用较高的测试限流以快速回放；生产权益和请求限流不变。API 报告仅在 28 条路线全部成功后写出，不能只更换旧见证的哈希当作新验收。正式包也可以不传候选环境变量直接执行这些测试。
