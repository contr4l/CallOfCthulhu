# 结局等级与奖励审校（含剧透）

五部作品统一使用青铜级1点、白银级2点、黄金级3点。这是网页成就等级，不是原书官方结局名、难度或道德评价。《向火》《静躁》的奖励数值逐项保留；后三部按已发布结局正文、来源编号和真实终局状态审校。剧情、角色、骰点、跳转及运行包不变。

## 分档依据

- 潮汐：第116节暂时制止灾难但遗物仍可能流转，以及184／190／206／220的逃生或获救，为白银；第227节与班尤制止事件并由其带走遗物、第239节摧毁偶像阻止重演，为黄金。其余43种死亡／献祭结果为青铜。
- 冰霜：第33节保住学术生涯、第272节得到后续远征支持但未能证实发现、第549节恢复自我并重新生活，为白银；第183节发现大金矿并获得终身研究资金这一特殊成果，为黄金。其余失去自我、死亡、远征被迫终止及彻底事业失败的35种结果为青铜。第183节仍保留矿工悲剧和矿场关闭的原文，不把网页黄金评级解释为完美结局。
- 恐惧：死亡为青铜；理智归零的疯狂退场为白银；完成战役的胜利为黄金。疯狂仍是原书失败结果，白银只表示这一非死亡终局的网页成就档位，不能继续使用失常角色。

各档结局ID如下，结局只按同一作品的ID匹配；绝不凭标题关键词或当前生命值临时猜测。

| 剧本及运行版本 | 青铜 | 白银 | 黄金 |
| --- | ---: | ---: | ---: |
| 向火独行 1.1.0 | 10 | 3 | 3 |
| 静躁独行 1.2.0 | 9 | 2 | 3 |
| 潮汐独行 1.0.1 | 43 | 5 | 2 |
| 冰霜独行 1.0.5 | 35 | 3 | 1 |
| 恐惧独行 1.0.2 | 1 | 1 | 1 |

### 向火独行

- 青铜：`77`、`80`、`92`、`123`、`171`、`193`、`196`、`220`、`243`、`fire-death`
- 白银：`185-end`、`223-end`、`247-end`
- 黄金：`231`、`255`、`270`

### 静躁独行

- 青铜：`150`、`171`、`278`、`284`、`316`、`318`、`324`、`334`、`354`
- 白银：`365`、`367`
- 黄金：`134`、`356`、`359`

### 潮汐独行

- 青铜：`69`、`82`、`84`、`95`、`113`、`117`、`137`、`150`、`152`、`176`、`180`、`182`、`192`、`193`、`197`、`198`、`199`、`208`、`209`、`213`、`217`、`221`、`225`、`226`、`231`、`232`、`233`、`234`、`236`、`241`、`242`、`243`、`51-death`、`68-death`、`119-death`、`121-death`、`125-death`、`132-death`、`140-death`、`141-death`、`145-death`、`169-death`、`142-death`
- 白银：`116`、`184`、`190`、`206`、`220`
- 黄金：`227`、`239`

### 冰霜独行

- 青铜：`68`、`169`、`214`、`258`、`259`、`268`、`318`、`342`、`345`、`417`、`432`、`441`、`454`、`538`、`548`、`frost-105-temporary`、`frost-105-permanent`、`frost-186-loss`、`frost-191-end`、`frost-221-injury`、`frost-285-fail`、`frost-307-expedition-end`、`frost-321-damage`、`frost-337-loss`、`frost-340-end`、`frost-363-stampede`、`frost-368-end`、`frost-12-drowning-ending`、`frost-189-drowning-ending`、`frost-385-drowning-ending`、`frost-407-smoke-ending`、`frost-412-drowning-ending`、`frost-512-drowning-ending`、`frost-514-drowning-ending`、`frost-536-drowning-ending`
- 白银：`33`、`272`、`549`
- 黄金：`183`

### 恐惧独行

- 青铜：`fear-ending-dead`
- 白银：`fear-ending-insane`
- 黄金：`fear-ending-won`

## 来源与兼容

后三部审校直接核对发布片段中的中文正文，以及 `scripts/alone-against-frost/fragments/` 的原书编号片段（含105／191等辅助终局的条件说明）。来源原件和片段保持不变；正面结果对应以下来源文件哈希：

- `scripts/alone-against-tide/fragments/116.json`：`e6c7a6e4d83560c2deb3a377b014a3f04dc0488af8946f7e22a11453a5fc8ac5`
- `scripts/alone-against-tide/fragments/184.json`：`506004c158f7ce2f840081bb6ce1f9181601684a832d328eaa963b0840c1491d`
- `scripts/alone-against-tide/fragments/190.json`：`abdb29e01a6a399dbbef5fadf525b4002f0ff568a129bd3701aca723bcf77e49`
- `scripts/alone-against-tide/fragments/206.json`：`9d97eab7c9e59956dda07aa16fb58a953e4c40e8ae72657888bff8b6d5549698`
- `scripts/alone-against-tide/fragments/220.json`：`84a71e52e0daf48abe57c65541bd439429a2fb4dafe8b1e9036d71b4ff91d8c6`
- `scripts/alone-against-tide/fragments/227.json`：`10ec73acf1b0b372633bdd911cc408c7aa7f4857bb4b8f015b4b48d6fccf3314`
- `scripts/alone-against-tide/fragments/239.json`：`9cc260d5c7784aa77c1040b392ac2aa0f66ab6a5b6d15c12ac4498a3551305b9`
- `scripts/alone-against-frost/fragments/033.json`：`ccd7e541e29848cfcebd46435a5218cdce1de0a92f068bb33c6cafd73bf6867a`
- `scripts/alone-against-frost/fragments/183.json`：`bf4e60f629a1b46f8f262f63995dca71eb2f17b323f253bab45b3466f30d66f4`
- `scripts/alone-against-frost/fragments/272.json`：`648f57e47bae8f598aa917f56215ffc11966205fba34f1a0674a318c55a69303`
- `scripts/alone-against-frost/fragments/549.json`：`c68609d674e362c01a41e7ffef2560f67b0abdfd1f32afb5e5d58318a35ca0c1`

2026-10-15用户同意旧领取记录补领差额。`claimedPoints` 表示累计已领取金额；当前标准奖励通过 `rewardPoints` 表示，`claimablePoints = max(0, rewardPoints - claimedPoints)`。只有用户点击“领取差额”时，服务端事务才把领取累计额更新到新标准、将差额加进钱包；保留首次领取时间。重复或并发请求不能重复补发，读取页面不自动加点。未领取的旧结局直接按新标准领取。

排行榜累计成就点按当前已收集结局的标准奖励汇总，包含尚未领取的差额；补领和消费都不改变这个累计值。未解锁成就不下发等级或奖励字段，使用中性边框；已解锁成就、结局概览和结局回忆使用铜／银／金边框及文字标签，章节条目不添加等级。无法匹配来源内容版本的历史不归入结局收集。

## 验收

运行时指纹：`f22cf0d3690aac9fc7910086170e3f65b351e9dddb10b243a806a1f3863509fd`。共享契约／奖励配置变化后，重新执行任务、同型枪与全部角色／结局见证；不会只改旧报告哈希。新证据使用 `tier-*.json`，历史资料保留。

本轮验收：全项目776项测试、类型检查及构建通过；分档／差额、商店、排行榜桌面与手机浏览器8/8通过，已检查两种尺寸的分档截图。恐惧三终局＋六任务与冰霜78条角色／结局认证API共87条全部覆盖。新离线包共894项，原886项字节均保留，新增8项实际执行的 `tier-*.json` 见证／API报告；无原工作资料的隔离副本恢复894项，并通过21项来源／见证／奖励／商店／排行榜回归。未修改剧本包或部署。
