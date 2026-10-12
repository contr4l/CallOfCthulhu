# Radxa 自动部署

工作流：`.github/workflows/ci-cd.yml`。部署入口：`tools/deploy.sh`。

PR 运行构建、单元测试、剧本与角色资源校验，以及已开放功能的桌面和手机浏览器检查。`main` 推送通过这些检查后自动部署；Actions 中也可手动运行，在 `main` 上选择是否部署。部署 job 只接收本仓库的 `main`，PR 不进入 Radxa Runner。

## 配置 GitHub Actions

Radxa 位于内网，部署 job 使用该机器上的自托管 Runner。无需将 SSH 端口映射到公网。

1. 在仓库 **Settings → Actions → Runners → New self-hosted runner** 选择 Linux / ARM64，按页面生成的命令安装，并使用 `radxa` 用户运行。
2. 注册 Runner 时加入自定义标签 `coc-deploy`。保留默认的 `self-hosted`、`Linux`、`ARM64` 标签。使用当前 Runner 版本，满足 checkout / setup-node 使用的 Node 24 Actions 运行时要求。
3. 创建 GitHub Environment **radxa**。可在该环境限制部署分支为 `main`。
4. 可选 Environment variables：`COC_DEPLOY_ROOT`（默认 `$HOME/coc`）；`COC_NODE_BIN`（Node 的绝对路径）。脚本优先复用此前安装的 `$HOME/coc/runtime/node-v22.16.0-linux-*/bin/node`，也支持 PATH 中的 Node 22.16+。
5. Runner 工作目录独立于应用目录，例如 `$HOME/actions-runner`；不要把 GitHub checkout 的 workspace 设置成 `$HOME/coc/CallOfCthulhu`。将 Runner 自身配置为后台服务；如果使用 GitHub 提供的 `svc.sh`，这一步需要管理员权限。

Runner 使用 `radxa` 身份访问已有的用户 systemd manager。工作流中的 UID 1000 对应当前 Radxa 用户；换用户时修改 `XDG_RUNTIME_DIR`、`DBUS_SESSION_BUS_ADDRESS`，手动脚本则自动读取当前 UID。

## 手动部署

在 Radxa 的代码目录执行；先自行更新该目录到希望发布的代码版本，脚本不执行 `git pull`，也不清理工作区改动：

```bash
cd ~/coc/CallOfCthulhu
bash tools/deploy.sh --dry-run
bash tools/deploy.sh
```

默认监听 `0.0.0.0:10086`，使用 `coc-game.service`。查看运行状态或日志：

```bash
systemctl --user status coc-game.service
journalctl --user -u coc-game.service -f
```

`loginctl show-user "$USER" -p Linger` 应为 `yes`。当前 Radxa 已开启；新机器可执行 `loginctl enable-linger "$USER"`，是否需要管理员授权取决于系统策略。

## 配置与数据

保留服务器现有的 `$HOME/coc/coc-game.env`。不要提交该文件。它采用单行 systemd EnvironmentFile 格式，例如：

```ini
HOST="0.0.0.0"
PORT="10086"
DATABASE_PATH="/home/radxa/coc/CallOfCthulhu/data/game.sqlite"
```

邀请码使用 `REGISTRATION_INVITE_CODE`，可加入该私有文件。`APP_ORIGINS`、`NODE_ENV` 也在此配置。当前入口为 HTTP，`NODE_ENV=production` 会启用 HTTPS Secure Cookie；在接入 HTTPS 前保留现有设置。

首次运行若配置不存在，脚本优先沿用 `$DEPLOY_ROOT/CallOfCthulhu/data/game.sqlite`；若不存在则使用 `$DEPLOY_ROOT/shared/game.sqlite`。可通过 `DEPLOY_PORT`、`DATABASE_PATH` 以及 `REGISTRATION_INVITE_CODE` 等环境变量生成首次配置。已有配置不会被覆盖；之后请修改配置文件本身。

脚本需要 Linux、Bash、Node.js 22.16+、npm、Python 3（含 sqlite3）、rsync、curl、flock，以及可用的用户 systemd manager。`DEPLOY_ROOT`、`ENV_FILE`、`NODE_BIN` 路径不可含空白。完整参数可用 `bash tools/deploy.sh --help` 查看。

## 发布流程与回滚

每次发布创建独立的 `$DEPLOY_ROOT/releases/<revision>-<time>-<pid>`，在该目录重新安装依赖、构建并执行校验，兼容 ARM64 原生依赖。不会携带 Git 凭据、原 checkout 的依赖、数据库或 `.env`。

切换前使用临时数据库试启动，检查 `/api/health` 与首页；通过后用 SQLite backup API 在线备份现有存档，并校验完整性。备份位于 `$DEPLOY_ROOT/backups/<release>/game.sqlite`。随后原子切换 `current` 链接，更新并重启用户 systemd 服务，再次健康检查。部署锁和 Actions concurrency 阻止并行切换。

构建或试启动失败不切换现有服务；切换后失败恢复原服务定义及原版本。正常发布记录 `previous`，可手动回滚：

```bash
bash tools/deploy.sh --rollback
```

回滚切换代码并保留当前数据库，避免覆盖发布期间玩家的新进度。若后续版本引入不兼容数据库迁移，须另行设计迁移回滚，必要时停服后人工恢复备份；脚本不会擅自覆盖存档。发布目录、日志和备份不会自动删除，可按保留需求人工清理。

首次接管应已有 `coc-game.service`，当前 Radxa 符合这一条件。如果端口由手动启动的进程占用，请先停止那个游戏进程；脚本不会终止不归该服务管理的进程。
