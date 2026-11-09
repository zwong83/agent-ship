# AgentShip

AgentShip 是在发起电脑上执行的交付工作台。它把需求、流程配置、Git 分支、Agent 任务、人工介入和节点产物放在一次可追踪的运行中。

## 当前平台

React + TypeScript 工作台由 Java 21 Spring Boot 同源提供。PostgreSQL 通过 Flyway 初始化。可注册并验证邮箱与手机号、登录、查看本人资料，以及创建和管理需求、流程与 Agent 的主副负责人。

页面采用深海蓝与青绿色的交付控制台风格，支持手机布局。AgentShip 的舰船与协作节点 Logo 位于 [agentship-mark.svg](frontend/public/agentship-mark.svg)，同时用于页面品牌与浏览器页签。

流程编辑器支持具名阶段和节点、顺序调整、前置依赖、检查双路线、自动修复上限与多个 Agent 配置。流程全景图可点击或通过键盘选择节点。每次保存形成独立版本，绑定当时的 Agent 版本，保存时复核权限。

先在「Agent 配置」建立所需角色，再在「流程配置」新建流程。添加阶段和工作节点，在节点设置中选择协调 Agent 和所需子 Agent。子 Agent 默认并行，也可改为按列表顺序执行并调整先后。添加最后的结束节点后保存。检查节点需要同时配置「通过」与「需修复」入口，修复路线允许跨阶段。

旧版仅有名称的流程仍可打开编辑，补齐有效结构后可以保存和选用。运行入口支持需求和流程搜索、工作类型选择、启动前补齐说明、本机证明与去重。运行看板显示已保存的阶段、选定 Agent 版本、设备在线状态、Git 步骤、角色进度和最终产物。启用 Agent 执行后，Git 就绪的运行会按固定流程版本推进，完成最后的结束节点后显示已完成。

先构建前端，再将静态资源打包进平台。

```sh
(cd frontend && npm ci && npx --no-install tsc --noEmit && npx --no-install vite build)
mvn -f platform/pom.xml clean package
```

准备一个空的本机开发数据库。数据库角色需要能创建模式和表。以下命令使用回环 HTTP 和本地模拟验证码，按本机数据库设置连接参数。

```sh
AGENTSHIP_JDBC_URL=jdbc:postgresql://127.0.0.1:5432/agentship \
AGENTSHIP_DB_USER=agentship_dev \
AGENTSHIP_LOCAL_VERIFICATION=true \
AGENTSHIP_SECURE_COOKIE=false \
AGENTSHIP_VERIFICATION_KEY="$(openssl rand -base64 32 | tr '+/' '-_')" \
java -jar platform/target/agentship-platform-0.1.0-SNAPSHOT.jar
```

数据库要求密码时，通过本次 Java 进程的 `AGENTSHIP_DB_PASSWORD` 传入。打开 [AgentShip 工作台](http://127.0.0.1:4173)，注册后从验证页面的「本地模拟收件箱」取两组验证码。需要保留待验证注册时，重启沿用相同的本机验证密钥。

`platform/test/verify_first_batch.py` 可创建隔离的回环 PostgreSQL、运行接口验收并重启平台验证数据。脚本需要 PostgreSQL 工具、Python `psycopg` 和 Java 21，可用 `--help` 查看路径参数。加 `--browser` 可通过 Playwright CLI 和 Chrome 验证打包后的工作台。

`platform/test/verify_flow_config.py` 覆盖阶段与依赖校验、多 Agent 顺序、检查路线、不可变版本、撤权和重启读取。两组脚本均使用合成账号与隔离库。

## 配对本机并创建运行

登录后打开「本机设备」，生成一次配对码。在同一台电脑的项目目录启动 Java 本机程序，将下列占位文字替换为页面上的配对码。

```sh
java -jar platform/target/agentship-platform-0.1.0-SNAPSHOT.jar --worker \
  --platform http://127.0.0.1:4173 \
  --state-dir .agentship/local-worker \
  --pair-code '页面上的配对码' \
  --name '我的电脑'
```

本机程序默认使用演练模式，提供配对、签名证明和心跳。它单独运行，通过平台 API 访问运行数据。平台地址必须与浏览器来源一致。回环开发可使用 HTTP，获准的共享平台使用 HTTPS 和 Worker JVM 信任的证书。本机证明桥默认监听 `127.0.0.1:4781`，仅响应配对的平台来源。

下次启动沿用同一状态目录，省略 `--pair-code`，设备身份不变。该目录保存设备私钥和凭据，程序要求目录权限 700、状态文件权限 600，并拒绝同一目录同时启动两个进程。不要把状态目录放入需求 Git 仓库。

打开「运行看板」后点击「发起运行」，选择或创建需求，再选择工作类型和已有流程。没有仓库关联的需求固定为新功能，需填写 GitHub 用户名或组织名；有仓库时沿用原关联。流程没有需求节点时，需在启动前补齐说明。启动成功后进入运行详情，Git 计划与已执行证据分开展示。设备停止心跳后显示「等待发起电脑上线」。

### 启用 Git 准备

在上面的本机命令中加 `--execute-git`，即可在状态目录内创建本地演示 Git 仓库与分支。演示使用真实本地 Git，要求电脑已安装 Git；不会关联需求的真实仓库，也不访问 GitHub。工作分支按 `<workType>/<runId>` 命名。程序重启沿用同一状态目录，会保留设备身份、操作意图与待发送结果。

真实 GitHub 模式需在页面选择 Codex 模式重新配对，使用独立状态目录，并添加 `--execute-git --mode codex --git-provider github`。凭据由启动进程的 `AGENTSHIP_GITHUB_TOKEN` 环境变量提供，不能填到网页或提交到仓库。该模式要求本机 Codex 命令可执行；版本探测不代表已验证登录或 Agent 会话。启动未关联需求的运行会请求创建公开 GitHub 仓库，请先核对页面上的账号或组织名。

新仓库默认名为 `agentship-<requirementId>`。程序读取 GitHub 实际默认分支。新功能、重构与常规修复基于 dev，缺少 dev 时先补建。紧急修复基于实际默认分支。每次写入前核对平台授权与租约，结果不明时只读核对原操作。已确认失败保留原请求与原因，显示待人工处理。

### 启用节点和 Agent 执行

在「本机设备」选择「本地 Git + Agent 演示」或「GitHub + 本机 Codex」。命令需同时带 `--execute-git --execute-agents`。已经配对的电脑沿用同一状态目录，启动时省略 `--pair-code`。每个本机程序最多同时处理四个 Agent 任务，更多角色按容量排队。

本地演示用确定性结果跑通阶段、依赖、串并行与结束汇合。真实模式在原电脑以 stdio 启动 Codex App Server，为每个选中的角色建立独立线程，使用已登录的本机 Codex 环境。协调 Agent 在子角色完成后读取其结果并交付最终产物。失败、待答、产物冲突或缺少证据会保留当前进度，后续操作由对应人工处理功能接续。

当前产物先保存于本机 Git 工作区。看板显示对应提交、路径与摘要，可按节点查看执行尝试、重试或跳过的操作者和时间。

### 检查、修复和人工处理

为检查节点配置「通过」和「需修复」两条路线，并设置该检查的自动修复上限。每轮修复交付后，系统用修复产物回到同一检查的新波次。上限为 0 时直接等人工。看板可查看历次结论、提交和修复轮次。

演练时，在检查协调 Agent 的说明填 `[demo:repair-until=2]`，前两次检查会返回需修复。Codex 模式支持 `[check:git-diff]` 对候选提交运行固定 Git 差异检查。对可信的 Maven 项目，可加 `[check:maven-test]` 在受限环境运行离线 `mvn test`。先准备本机状态目录下的 `maven-repository` 离线依赖缓存。两项可一起配置。测试失败进入修复路线。缺依赖、没有实际运行的测试或证据无法核对时等待人工检查。试点采用的必测项还需在真实开发环境验收。

从看板进入「运行操作」，点击「获取操作权」。当前操作者可在上限后追加一轮或停止，检查缺结论时可重新检查。发起人按注册用户名添加或撤销访客，并分享操作页链接。一个运行同时只允许一个标签页持有操作权。离开后释放，断线后保留五分钟宽限供原页重连。

普通消息默认发给协调 Agent，也可选 `@Agent`。发问后显示待回复，当前操作者可回复，发起人可取消问题并让 Agent 用已有信息继续。发起电脑离线时回复先保存在平台，待原机上线投递到原会话。当前操作者可重试失败角色，或跳过允许跳过的子 Agent。成功的角色结果可继续使用。BRD 节点活跃时，发起人可确认需求变更。运行中的节点保留原输入并标记旧版本。发起人可重跑仍处于本次运行、且下游满足安全条件的旧版本节点。

### 归档交付物

运行完成后，仍是需求主负责人的发起人可以在看板选择当前节点的最终产物归档。先核对页面所示提交的完整文件树及报告，确认所有内容都可公开，再提交归档。账号资料、聊天原文和原始日志由平台保存。若生成的文件含这些内容，应先处理再考虑公开。Worker 使用需求对应仓库创建 `refs/tags/agentship/<运行ID>/<产物ID>`，读回相同提交后显示已归档。归档快照只保留已审阅的文件树和本次起点提交，不带入本机中间提交。真实模式的 GitHub 凭据需具备目标仓库写入权限。

下列验证使用本地 Git、隔离 PostgreSQL、Chrome 和 Codex 协议替身。真实 GitHub、已登录的 Codex 和双设备验收见 [OpenSpec 4.2](openspec/changes/deliver-agentship-mvp/tasks.md)。

```sh
python3 -u -B platform/test/verify_agent_pipeline.py --java "$(/usr/libexec/java_home -v 21)/bin/java" --archive --browser
python3 -u -B platform/test/verify_chat_pipeline.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_repair_pipeline.py --java "$(/usr/libexec/java_home -v 21)/bin/java" --browser
```

新增隔离验收命令（GitHub 使用回环替身，不调用真实账号）：

```sh
python3 -u -B platform/test/verify_git_jobs.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_git_worker.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_git_pipeline.py --java "$(/usr/libexec/java_home -v 21)/bin/java" --browser
```

本批可重复验收：

```sh
python3 -u -B platform/test/verify_device.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_run_start.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_launch_browser.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
```

这些命令使用隔离 PostgreSQL 和合成账号。Chrome 启动验收额外使用本机端口 4781，请先停止你自己的本机程序以避免占用。不会访问 GitHub 或执行 Codex。

## 历史原型演练

使用支持内置 SQLite 的 Node.js 22.13 或更新版本。当前验证使用 Node.js 25.8.0。

1. 在项目目录运行 `node src/server.mjs`，打开 [AgentShip 工作台](http://127.0.0.1:4173)，注册后进入「本机设备」，生成一次性配对码。
2. 在第二个终端运行 `node src/worker.mjs --pair --demo`，输入配对码。重启同一台电脑后，可用 `node src/worker.mjs` 重新连接原设备。
3. 在「流程配置」点击「新建」和「载入示例流程」，保存。示例包括三个阶段、并行研发节点、三个检查子 Agent、修复路线、发布和结束节点。
4. 从「运行看板」点击「发起运行」，新建或搜索已有需求。选择工作类型和示例流程，点击「确认启动」。在运行页查看进度与产物，或进入聊天处理人工操作。

演练模拟 Git、Agent 和发布结果，无需登录外部工具。演练生成的仓库标识不会写入需求的真实仓库关联。需要触发演练问题、首次失败或一轮修复时，可在对应节点任务说明中使用 `[demo:question]`、`[demo:fail-once]` 或 `[demo:repair-once]`。

## 历史原型的真实执行适配

真实模式使用本机登录后的 Codex CLI、Git 和 GitHub CLI。使用同一浏览器为真实模式生成新的配对码，关闭正在占用本机设备端口的演练程序，运行 `node src/worker.mjs --pair --state-dir .agentship/codex-device`。再次启动真实模式时继续传入相同的 `--state-dir`。节点内可以配置超过两个子 Agent，默认并行。执行程序的默认并发容量为 6，`--concurrency` 可调整实际同时执行的任务数。

需要发布的流程须配置 GitHub Actions 工作流文件、环境名称及可触发的 `workflow_dispatch`。该工作流须接受名为 `environment` 的输入。发起真实运行时，网页会要求确认 Git 和发布动作。真实 Codex、GitHub 和 GitHub Actions 的端到端试点验收仍待执行。

工作台和设备桥接均监听回环地址。SQLite 状态和设备状态默认保存在项目内的 `.agentship/`。保留设备状态目录可让原电脑以同一身份恢复运行。

## 校验与交付材料

```sh
node --test test/agentship.test.mjs
openspec validate deliver-agentship-mvp --type change --strict --no-interactive
```

- [PRD](output/PRD/PRD-AgentShip.md)
- [SA](output/SA/SA-AgentShip.md)
- [系统设计](output/SD/SD-AgentShip-index.md)
- [OpenSpec 任务](openspec/changes/deliver-agentship-mvp/tasks.md)
- [验证证据](openspec/changes/deliver-agentship-mvp/evidence.md)
