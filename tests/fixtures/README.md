# 测试剧本

`stories/rules-fixture` 和 `stories/collection-fixture` 只保存检定、条件、状态变更、收藏和多结局测试所需的数据。正文及回忆均为测试占位文字，不是正式模组。

单元测试通过 `tests/helpers/story-fixtures.ts` 显式加载临时目录；Playwright 将这个临时目录传给测试服务器的 `STORY_ROOT`。正常启动不设置该变量，始终只加载项目根目录下的 `stories/`，部署时不包含本测试目录。
