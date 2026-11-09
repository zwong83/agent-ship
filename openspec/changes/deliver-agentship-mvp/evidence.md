# AgentShip 验证记录

## 2026-11-09 代码模块迁移第一批

原 `platform.git` 的运行入口、Worker 任务、Git 准备、协作及归档职责按 [SD-B06](../../../output/SD/SD-AgentShip-backend.md#sd-b06-代码模块与分层) 迁移。运行用例通过专用端口调用 JDBC 适配。归档使用运行、设备和会话公开接口。看板在一次只读事务中组合运行与归档视图。旧启动用例及运行读模型的部分 SQL 仍在迁移范围之外。

Java 21 离线打包产物 SHA-256 为 `1ef43a2c447eb02e9adf480d900ada744b4a3928cdc349d7a75f9b2383f9162f`。同一构建通过 19 次既有回归套件，共 107 组行为检查。归档及聊天后端 12 组，离线聊天及修复 14 组，Codex Worker 23 组，账号到调度 29 组，Git 29 组。新增 [模块边界检查](../../../platform/test/verify_runtime_boundaries.py) 通过。Flyway V1～V5 资源与基线逐字节一致，OpenSpec 严格校验通过。

Worker 默认套件首次运行通过业务断言，临时目录清理返回 `Directory not empty`。同一构建复跑退出码为 0，聊天和 Maven 分区也各自通过。本地验证使用隔离 PostgreSQL、Chrome、本地 Git 和外部服务替身。真实环境验收见任务 4.2。

## 2026-11-09 网页协作、开发验证与产物归档

本批完成网页定向消息与历史、持久问答、原机恢复、失败角色重试和跳过、活动 BRD 修订及受控重跑。开发检查接入固定 Git 与离线 Maven 预设。运行完成后，可对当前节点的最终产物明确审批并在需求仓库创建交付标签。API draft.13、Flyway V5、数据字典及配套 DDL/DML 与应用同步。

测试包 [agentship-platform-0.1.0-SNAPSHOT.jar](../../../platform/target/agentship-platform-0.1.0-SNAPSHOT.jar) SHA-256 为 `536790b1db0218b92c58669f9e3772c737413476fcfefbf3b9e18cfb134eb0dc`。前端为 `index-DXn7pfDh.js` / `index-CdL3erBk.css`。所有本地应用测试使用 Java 21、隔离 PostgreSQL 17.10、合成数据和回环端口。Chrome 访问打包后的前端。外部适配使用本地 Git、GitHub 回环替身及 Codex stdio 协议替身。

最终包 19 次套件执行均退出 0，共 107 组通过。归档与聊天后端 12 组，聊天与修复 14 组，Codex Worker 23 组，账号到调度 29 组，Git 29 组。任务 1.1～4.1 的本地实现和验证记录为 16 / 17。4.2 保持待验收，独立结论为 `Not Converged`。

| 验证 | 实际覆盖 |
|---|---|
| 归档和聊天后端 | 归档授权及重放、原设备与世代隔离、未知结果只读核对、候选完整树和原始父提交、同名标签保护、Chrome 归档状态及重启读取。后端并发回复取消、定向收件箱、角色处置审计、BRD 确认和版本隔离通过。 |
| 聊天与修复端到端 | 原机停止时 Chrome 回复并显示待投递。原机重启，同一任务及会话继续，合成私密回复未进入生成产物。自动跨阶段修复两轮后达到上限，Chrome 操作者追加一轮，原检查复查通过并汇合至结束。 |
| 账号、配置、启动、设备与调度 | 注册双验证、三类配置负责人、流程保存与版本、四类启动计划、原机证明、权限拒绝、设备和平台重启、多角色调度及结束汇合。显式 HTTPS 连接发起 TLS 握手并拒绝未验证对端。 |
| Git 准备 | 实际本地 Git、Chrome、固定分支和重复结果核对。GitHub 替身覆盖明确拒绝、冲突、过期许可、授权撤回和响应丢失。明确失败留在人工处理，未知结果按原引用核对。 |
| Codex Worker | stdio 替身验证各角色产物、原线程恢复、待答与定向投递、丢失回执、冲突处理、固定 Git 检查和 Maven 通过、失败、跳过及无法核对。 |
| 设计及契约 | OpenAPI 3.1 draft.13 的 34 条路径通过静态校验。OpenSpec strict 通过。PostgreSQL 17.10 加载 49 张设计表与 56 条预备语句，夹具和双连接断言通过。字段清单核对 413 列。 |

回归驱动的失败证据包括旧归档请求重放造成再次入队，以及旧 Worker 未尝试连接指定 HTTPS 地址。修正后分别验证失败记录审批时间与 TLS 首个握手。独立收敛评审在前一包核对 Git、流程、启动、节点及修复共 51 组，最终包重跑相同套件。独立评审也核对了最终包的归档重放及 HTTPS 增量。前一包的哈希为 `290a340c97ac36ba035d6f3c13364e88328e30be944a36aaf333d4684679e93e`。

可用 [README 的启动和验证命令](../../../README.md) 重复运行。专项脚本位于 [platform/test](../../../platform/test)，涵盖 `verify_archive_jobs.py`、`verify_chat_jobs.py`、`verify_agent_pipeline.py --archive --browser`、`verify_chat_pipeline.py`、`verify_repair_pipeline.py --browser` 及 `verify_codex_worker.py` 的默认、`--chat-only` 与 `--maven-only` 三种分区。移动聊天界面证据为 `.agentship/verification/chat-pipeline-mobile.png`。

公开归档依赖发起人审阅完整候选树。已知私密路径受过滤，普通文件内容仍需审阅。Maven 预设仅适用于可信项目的离线构建，结果判定依赖 Maven 的退出状态及测试汇总。原会话失效且执行结果无法核对时，保留检查点等待人工处理。显式旧版本重跑限于仍在运行且下游满足安全条件的节点。完整变更的真实开发环境验收待执行，范围与前置条件见 [测试分析第 11 节](test-analysis.md#11-最终包本地验证及真实验收入口)。

## 2026-11-09 检查修复与运行操作

本批实现跨阶段修复、原检查复查、各检查独立计数、到限局部暂停、人工追加和停止。运行操作页支持发起人按用户名授权或撤销、同一运行单标签页持有、占用者提示、离开释放与断线五分钟宽限。继续复用现有的签名设备租约和运行事务。V4 将复查波次绑定到产生候选的修复轮，并强化路线与人工操作谓词。

最终包 SHA-256 `1bd238107ac0d119b26172f74d8de56e801e0224006252c98f04c117d6821843`，前端 `index-BqEtEKoS.js` / `index-BnlG2ZJ2.css`。此前同一 Java 实现的合并包 `51b607e15037bf1ed42803e76056d32ae46f7ab7a420cf95bdcf791f3893e8a6` 完成基础回归，最终包增加浏览器占用弹框并复跑操作与端到端验收。

| 验证 | 实际结果 |
|---|---|
| 修复调度 | 最终包 4 组通过。两轮跨阶段修复、上限边缘通过、持续失败暂停、独立续行、并发领取、嵌套计数、零上限和异常结论。 |
| 操作权与命令 | 最终包 3 组通过。跨账号竞争、同账号跨标签页隔离、宽限前后、撤权、CSRF、陈旧波次、重复请求、缺结论复查、一次追加、停止、审计和退出释放。 |
| 完整演练 | 最终包 4 组通过。真实 Java Worker、PostgreSQL 和本地 Git 完成两轮自动修复，到限后由 Chrome 追加一轮，复查通过后到达结束节点。验证不同候选 SHA、两标签页弹框及离开释放、390px 看板和平台重启保留历史。 |
| Worker 与既有功能 | 合并包 Worker 13 组、节点调度 5 组和独立既有回归 38 组通过。新增 Worker 用例覆盖固定 Git 检查通过及失败、错误引用待确认、模型自报无效和波次演练。React 修复与四组既有浏览器夹具通过。 |
| 构建、契约、数据设计 | TypeScript、Vite、Java 21 Maven package、OpenAPI 3.1 draft.12 和 OpenSpec strict 通过。PostgreSQL 17.10 验证 48 张表、53 条准备语句和双连接争用。设计夹具补齐通过及修复路线的成员记录，与实际流程保存约束一致。 |

TDD 红灯包括旧版本检查结果未开启修复、暂停误挡独立后继、真实 Git 未识别检查配置、演练按轮次不切换、缺少操作权入口与看板计数。对应测试在实现后通过。运行操作页截图位于 `.agentship/verification/repair-pipeline-mobile.png`。

可重复命令：

```sh
python3 -u -B platform/test/verify_repair_jobs.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_repair_operator.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_repair_pipeline.py --java "$(/usr/libexec/java_home -v 21)/bin/java" --browser
python3 -u -B platform/test/verify_codex_worker.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
openspec validate deliver-agentship-mvp --type change --strict --no-interactive
```

真实检查的实施范围为显式 `[check:git-diff]`，校验实际候选的空白和冲突标记。应用必测项仍依 PRD Q-07 配置，真实 Codex 和 GitHub 账号验收仍归 4.2。网页消息、回复及 Agent 失败角色操作仍归 3.4 和 3.5。公开归档与正式发布继续按对应任务实施。

## 2026-11-09 节点调度与 Codex 多 Agent

本批实施 2.4 的节点调度与本机产物门槛、3.2 的角色执行与会话，以及 2.6 的看板和 3.1 的角色租约分区。配置和运行快照沿用现有 PostgreSQL 表。契约升级至 draft.11，加入 Agent 领取开关和任务、依赖、产物投影。

冻结包 `platform/target/agentship-platform-0.1.0-SNAPSHOT.jar` 的 SHA-256 为 `1503640e3d98066d41415a4c3b6d9e4533aafbaaf8f3cbfd305c4e21e7d7f537`，前端为 `index-BHdePWh9.js` / `index-Bz9H0cbi.css`。

| 验证 | 结果 |
|---|---|
| 节点调度 HTTP／PostgreSQL | 冻结包 5 组通过。覆盖首次领取、串行及共享上游并行、阶段顺序、冻结修订、明确产物依赖、结束只触发一次、重复回报、租约隔离、待答保存、并行同伴继续、检查候选和通过路线。 |
| Java worker／Codex stdio | 冻结包 8 组通过。覆盖真实本地 Git、多个选中角色交接与代码汇总、回报丢失重放、原 turn 核对、worker 整进程重启后原线程和新租约、待答、缺少产物、协调者尝试解决文本冲突和未解决时暂停。 |
| 目标栈整链路 | 冻结包 3 组通过。真实签名启动、Java 平台、隔离 PostgreSQL、Java worker 和本地 Git 跑到结束。三个已选子 Agent 执行，未选角色没有任务，两条路线汇合。以 `git show` 重读最终产物并核对摘要。Chrome 读取实际完成状态、角色与产物，390px 无横向溢出。平台重启后快照和结果保持。 |
| 浏览器夹具 | 节点执行、Git 准备、启动、流程编辑 4 组通过。分别验证 Git 就绪不掩盖待答、执行模式、角色版本和尝试、最终产物以及 390px 排版。 |
| 既有功能回归 | 冻结包 8 套共 52 组通过。独立执行 Git 任务 7、Git worker 18、Git 链路含 Chrome 4、启动 7、流程配置 3。主执行另验证账号／配置含 Chrome 6、设备 4、Chrome 签名启动 3。 |
| 构建及文档 | TypeScript、Vite、Java 21 Maven package、OpenAPI 3.1 draft.11 静态校验、OpenSpec strict 校验通过。测试前后包摘要一致。 |
| 验证来源 | Codex CLI 0.166.0 生成的 App Server schema 用于校对方法和字段。本机替身用于验证协议交互、工作区与恢复。真实账户执行归任务 4.2。 |

TDD 初始失败分别为 Git 就绪后不派发角色、worker 不接受 `--execute-agents`、看板将待答误显示为 Git 就绪和设备页缺少执行模式。真实 PostgreSQL 联调另发现角色产物查询使用了保留字别名，修正后领取及整条演练通过。独立审查补齐了待答时并行同伴领取、协调者尝试处理文本冲突、真实检查等待必测证据的边界。

可重复命令：

```sh
(cd frontend && npx --no-install tsc --noEmit && npx --no-install vite build)
JAVA_HOME="$(/usr/libexec/java_home -v 21)" mvn -f platform/pom.xml package
python3 -u -B platform/test/verify_node_jobs.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_codex_worker.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_agent_pipeline.py --java "$(/usr/libexec/java_home -v 21)/bin/java" --browser
openspec validate deliver-agentship-mvp --type change --strict --no-interactive
```

实施默认采用独立 App Server 角色线程与最多四个本机任务并发。显式依赖的产物由下游读取。子 Agent 的代码提交在协调者工作区汇总，支持协调者处理可核对的文本冲突，其余冲突保留人工状态。当前交付物为本机 Git 提交，公开 GitHub 归档、真实检查、修复复查、网页定向回复与重试由对应任务继续。

真实运行数据的 Chrome 截图位于 `.agentship/verification/agent-pipeline-desktop.png` 和 `.agentship/verification/agent-pipeline-mobile.png`。

## 2026-11-09 Git 准备与本机任务租约

用户「继续」授权在原技术栈上实施任务 2.3 及其依赖的 3.1 / 2.6 分区。本批交付 Java 平台 Git 任务服务、Java worker 的本地 Git / GitHub REST 适配及 React Git 进度与证据。范围内 TDD、集成和独立回归分开记录；完整 Agent 执行和全局设计就绪不由本批结论代替。

最终构建于 2026-11-09 18:46:40 +08:00 生成。Java 包 `platform/target/agentship-platform-0.1.0-SNAPSHOT.jar` SHA-256 为 `dfe86d0fea9f18956d9a5f0231f5cb8ed5a54676352d185e4b1634505946aff8`。前端为 `index-JKPqTZQR.js` / `index-BbRkxw7w.css`。

| 实际验证 | 结果与范围 |
|---|---|
| 后端 Git HTTP / PostgreSQL，7 组 | 最终包通过。任务领取与续租、当前设备、过期回收、事件顺序与同键去重、不同正文冲突、旧 epoch 拒绝、精确目标授权、权限撤销、仓库及提交一致性、未知结果只读核对、明确失败不自动重试、并发轮询与共享仓库操作均验证。真实模式关联用合成提供方证据验证，不代表访问真实 GitHub。 |
| Java worker，18 组 | 最终包通过。1 组实际本地 Git，17 组回环 GitHub 替身。覆盖用户／组织、新仓库、已有仓库四类工作分支、实际 main/master、已有 dev 提交复用、仓库与分支冲突、拒绝写入、未知结果、响应及事件收据丢失、只读核对、过期授权、响应体停滞、步骤间撤权、已成功步骤后的读取失败及写后读取失败。实际杀进程后保留状态，以新 epoch 回读，仓库创建仅一次。 |
| 完整 Git 集成，4 组 | 最终包通过。真实平台 + PostgreSQL + Java worker + 本地 Git：已签名 HTTP 启动、Git 证据回写、Chrome 读取看板、worker 重启后复用仓库并为新运行创建独立分支、平台重启后证据与等待状态保持。demo 未关联需求真实仓库，Agent 节点仍未执行。 |
| 前端行为 | 独立夹具验证 ready / preparing / unknown / failed、安全 GitHub 链接、demo 无远端链接、三种本机模式及 390px 布局通过；真实平台 Chrome 查看 Git 准备与提交证据通过。桌面及移动视口截图已检查。页面沿用舰船 Logo 与深海蓝、青绿色风格。 |
| 原有功能独立回归 | 同一最终包，5 套共 23 组通过：账号／配置 6、流程编辑 3、设备 4、启动 7、真实 Chrome 启动 3。设备旧测试把空租约条目预期为 409；新协议支持租约，缺少身份字段应返回 400，确认后只修正断言并整套重跑通过。具体命令与处置见 [独立回归报告](git-regression-report.md)。 |
| 构建与结构 | TypeScript、Vite、Maven clean package、OpenAPI 3.1 draft.10 静态校验与 OpenSpec strict 校验通过。Maven 没有内置 JUnit 用例；应用证据来自实际执行的 Python HTTP / PostgreSQL / worker / Chrome 套件。 |
| 数据设计 | PostgreSQL 17.10 隔离验证通过：48 表、53 条参数化预备语句、断言及双连接竞争。字典同步至 400 字段。V3 新增仓库与运行的实际默认分支字段，当前测试覆盖新库迁移及持久状态重启。 |

TDD 初始 Red：后端旧轮询返回空任务；旧 worker 不支持 `--execute-git`；前端缺少 Git 已就绪证据及模式选择。对应行为随后 Green。后续恢复与审查修正归补充回归，不追认为全部先写测试。独立审查发现并修正了明确拒绝与未知结果混淆、跨步骤仓库身份/SHA 不一致、响应体无限等待、轮询锁升级风险、成功步骤被错误降级，以及永久平台拒绝被无限重试。完整处置见独立报告。

可重复命令（在项目根目录执行）：

```sh
(cd frontend && npx --no-install tsc --noEmit && npx --no-install vite build)
JAVA_HOME="$(/usr/libexec/java_home -v 21)" mvn -f platform/pom.xml clean package
python3 -u -B platform/test/verify_git_jobs.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_git_worker.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_git_pipeline.py --java "$(/usr/libexec/java_home -v 21)/bin/java" --browser
python3 -u -B output/SD/data/verify-postgresql-design.py --pg-bin .agentship/verification/tools/pg17/bin --psycopg-path .agentship/verification/pg-python
openspec validate deliver-agentship-mvp --type change --strict --no-interactive
```

契约 draft.10 增加 `gitPreparation`、`gitOperations`、检查点外部证据和 `dispatch / reconcile / already_succeeded` 决策。数据库 V3 只扩展默认分支列；Git 意图、授权、租约、事件和证据复用现有表。DML 的已确认 Git 完成转为 `waiting / AGENT_EXECUTION_PENDING`，不会冒充节点或流程完成。默认心跳仍为 10 秒，任务租约 60 秒，未知结果每 30 秒允许只读核对，启动范围授权有效 24 小时；时效为实施默认。

本批未操作真实 GitHub、未验证 Codex 登录或会话、未部署、未 commit/push。Codex 可用性仅指版本探测成功。明确 Git 失败仍无人工恢复按钮，待聊天操作权接入；节点调度、产物门槛、结束汇合、Agent 派发与聊天仍为后续任务。供应商适配依据官方 [仓库 API](https://docs.github.com/en/rest/repos/repos) 和 [Git refs API](https://docs.github.com/en/rest/git/refs)，实际账号及双设备验收保留任务 4.2。

## 2026-11-09 启动运行与本机设备

用户要求「继续下一批」。本次实施任务 2.2，及 2.6 的启动/运行详情、3.1 的设备前置、3.5 的设备页面分区，累计完成 6 / 17。依据现有 DW-02～03、LC-04、WA-02～03 及 SA/SD 对应约束，完整变更的评审与收敛状态不变。运行真实持久化为 `queued`，初始 Git 任务也入库；本批不领取该任务、不调用 GitHub、不执行 Codex。

| 实际验证 | 结果与范围 |
|---|---|
| 构建 | TypeScript、Vite 和 Java 21 Maven clean package 通过。最终静态资源为 `index-1jWgGuSl.js`、`index-BMOywFPw.css`。Maven 跳过 Java 单元测试，仅用于编译打包；行为验收由独立 HTTP/PostgreSQL/Chrome 脚本执行。 |
| 运行接口 7 组 | 真实 Java worker 签名启动；排队 Git 任务；同键重放和并发去重；不同键复用证明拒绝；四类关联仓库计划；需求与角色快照；描述前置/延后；版本冲突；无权需求 404、副负责人不能启动、撤权后保存无副作用；绑定查询范围的分页与重启均通过。 |
| 原子回滚 | 合成数据库触发器在证明消费后故意拒绝运行写入，证明、收据和运行一并回滚；移除测试触发器后，以相同输入重新提交成功。同账号不同浏览器会话、错误签名与过期证明均拒绝。 |
| 设备接口 4 组 | 配对码失效/重放、注销、错误公钥与协议、Bearer/撤销设备、精确 Origin/Host、CORS 预检、请求大小限制、文件 0600 和进程互斥通过；Java worker 与平台重启后同一设备身份可读。配对未心跳保持离线，首次认证心跳后才显示在线。 |
| Chrome 实际启动 3 组 | 真实 Spring Boot、PostgreSQL、Java 本机桥组成的应用完成新建/搜索/下拉选需求、重名提示选择已有需求、未关联需求锁定新功能、已有仓库四类手选、无需求节点缺描述拦截、选择流程、签名和启动；页面重开及平台重启保留两条正确运行。 |
| 丢失响应 | Chrome 测试先让真实 `POST /runs` 提交成功，再拦截丢弃响应。用户点击「重试确认启动」后返回原运行 ID，没有第二条运行；后端也验证同键和单次证明并发边界。 |
| 前端补充夹具 | 已验证浏览器返回时取消离开保留待确认的证明、请求体及幂等键，再重试原请求；缺描述先于设备证明；按配置版本保存说明、按流程版本启动；固定角色、排队、设备及 390px 布局。取消原生确认框使用 `confirm=false` 夹具。 |
| 独立既有回归 | 账号/权限/Chrome 6 组和流程图 3 组全部通过，无需修改旧测试。覆盖原有双验证、负责人、撤权、移动端编辑、条件路线、版本与重启。 |
| 视觉核对 | 保留舰船 Logo 与深海蓝、青绿色风格。新增启动摘要、分阶段表单、运行卡片、角色版本和 Git 计划。390px 导航改为两行，避免六项菜单逐字竖排；启动与详情无页面横向溢出。 |

核心测试入口为 [启动后端](../../../platform/test/verify_run_start.py)、[设备](../../../platform/test/verify_device.py)、[实际浏览器](../../../platform/test/verify_launch_browser.py) 和 [Chrome 旅程](../../../platform/test/launch_browser.js)。命令：

```sh
(cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build)
JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn -o -B -f platform/pom.xml clean package -DskipTests
python3 -u -B platform/test/verify_run_start.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_device.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_launch_browser.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_first_batch.py --java "$(/usr/libexec/java_home -v 21)/bin/java" --browser
python3 -u -B platform/test/verify_flow_config.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
openspec validate deliver-agentship-mvp --type change --strict --no-interactive
```

运行、设备和独立回归通过的包 SHA-256 为 `9356aed8b2672636ea7ed1a4c59711eff80f2d20c1a34f9685327eb6cc64ab65`。之后只调整手机导航 CSS，重新 typecheck/build/clean package 并通过实际 Chrome 启动验收；最终包 SHA-256 为 `8c39004a50abbc732dcbf45cc11191baaee6fcdf9f9b6d5492cb104a62b6908e`。Java 源码未再更改。截图保存于 `.agentship/verification/launch-wizard-desktop.png`、`launch-wizard-mobile.png`、`run-detail-desktop.png`、`run-detail-mobile.png` 和 `run-board-desktop.png`，不含配对码或设备凭据。

TDD 初始 Red：运行列表和配对端点返回 404，旧界面缺少「发起运行」。独立复核发现首次心跳前误报在线、浏览器返回可能丢弃待确认请求；修复并覆盖。新增无心跳断言在旧包上复现失败，在修复包通过。实际 Chrome 旅程中的重复按钮、角色文本和异步选择等待问题修正了测试定位，没有改变业务判断。

契约 draft.9 新增只读 `gitPlan`、`selectedRoles` 和本机 `/status`，分别表示待执行计划、固定角色及当前连接状态。OpenAPI 3.1 静态校验、OpenSpec 严格校验通过。未实际生成任务时 `tasks` 为空；未开始节点的输入修订仍为空；`eventsCursor` 为初始 `0`，实时事件接口留后续。不增加数据库迁移，复用 V1/V2 表。命名规则、协议常量和时效默认见设计。本批没有生产部署、Git commit/push、GitHub 写入或真实 Codex 调用。

## 2026-11-09 流程配置与品牌更新

用户授权继续完成阶段、节点、依赖和多个 Agent 配置，并沿用科技感页面、更换与 AgentShip 名称相符的 Logo。本批完成任务 2.1 和 2.6 的流程编辑器部分，累计 5 / 17；完整变更仍未收敛。API 更新至 draft.8，新增只读 `workflowVersion`，与配置乐观锁 `version` 分离。负责人变更不增加流程图版本。

| 实际验证 | 结果与边界 |
|---|---|
| 前端与打包 | TypeScript 检查、Vite 生产构建、Java 21 Maven clean package 通过。资源为 `index-Bg1KsMRm.js`、`index-DYeemmLa.css`。Maven 负责编译和打包；行为测试由下面的独立脚本执行。 |
| 图与角色 | 阶段、节点、多 Agent 选择及顺序保存回读通过；未选角色不写入图。覆盖无结束节点、空阶段、重复或无效引用、循环、逆序阶段、互斥路线冲突及嵌套路线矛盾。允许合法跨阶段修复、每检查独立上限及上限为 0。 |
| 权限与事务 | 保存前复核全部选中 Agent 的使用权；撤权与不可见角色拒绝。相同幂等键重试、冲突输入、过期版本、无效图失败无新版本、历史图与 Agent 版本不变均通过。存量空图可补齐，补齐前不进入使用候选。 |
| 重启持久化 | 隔离 PostgreSQL 与 Java 应用重新启动后，阶段、节点、依赖、条件路线、选中角色和顺序可读。配置版本与图版本分别递增的断言通过。 |
| 实际 Chrome 应用 | 打包后应用通过三阶段、分叉汇合、三名已选子 Agent 加一名未选角色、默认并行、串行调序、版本 1/2 保存并立即刷新、键盘选择图节点、缺结束点、缺双路线及循环提示。独立账号及权限浏览器回归也通过。 |
| 前端补充夹具 | 覆盖两阶段、跨阶段依赖、串行顺序、无效图不提交、取消离开保留草稿、保存重开、键盘选择和 390px 无横向溢出。取消导航分支使用 `confirm=false` 夹具，实际界面使用原生确认框。 |
| 缺陷修复 | 新增嵌套路线互斥用例先复现错误接收，再修正为拒绝。实际 Chrome 复现保存成功后立即刷新仍出现未保存提示，以同步 dirty ref 修正后通过。 |
| 品牌 | 原有深海蓝与青绿色样式保留；SVG Logo 改为正面舰船、驾驶舱和三个连接节点，应用于登录、导航与 favicon。 |

后端 TDD 的初始 Red 为有效流程创建被旧接口拒绝；前端初始 Red 为缺少“添加阶段”入口。其余回归是实现后补充，未将它们全部描述为测试先行。

```sh
(cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build)
JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn -o -B -f platform/pom.xml clean package -DskipTests
python3 -u -B platform/test/verify_flow_config.py --java "$(/usr/libexec/java_home -v 21)/bin/java"
python3 -u -B platform/test/verify_first_batch.py --java "$(/usr/libexec/java_home -v 21)/bin/java" --browser
openspec validate deliver-agentship-mvp --type change --strict --no-interactive
```

[流程接口验收](../../../platform/test/verify_flow_config.py) 的三个结果组均通过；[联合应用验收](../../../platform/test/verify_first_batch.py) 的六个结果组通过并以退出码 0 结束，包含 [Chrome 流程旅程](../../../platform/test/flow_browser.js)。后端独立验收后仅修改前端刷新提示逻辑，最终打包重新执行联合回归。最终包 SHA-256：`a3f83d02fe1ce90f8740ecd8135237abf509b1147aaf07a523dcf937dd66bcb3`。

本机截图位于 `.agentship/verification/flow-editor-desktop.png`、`flow-editor-mobile.png`、`flow-editor-mobile-map.png` 和 `first-batch-login.png`。已检查 1440px 桌面和 390px 手机实际页面；手机图在自身容器中横向滚动，页面能纵向进入节点设置，无文档横向溢出。OpenAPI draft.8 静态校验和更新后的 OpenSpec 严格校验通过。无新增数据库迁移，使用既有 V1/V2 的规范化流程表。

实施默认值：普通及检查节点须选协调 Agent，允许不选子 Agent；仅结束标记的图也可保存。这些是对现有契约的兼容实现，协调者独立执行的业务复核仍列于 SA-D05，并非新增用户确认。当前支持配置和版本存储，真实 Codex 派发、运行看板、GitHub 和人工修复执行继续由后续任务验证。

## 2026-11-09 首批平台实现与界面

用户授权按现有文档实施首批 1.1～1.4，随后要求使用当前模型继续编码，并让页面看板具有符合 AgentShip 主题的科技感与 Logo。此次使用 BRD v0.57、PRD v0.8、SA/SD v0.5、API draft.7 与 `workspace-access` 规格作为首批实现依据。完成 4 / 17 项任务，完整变更尚待后续任务及收敛验收。

| 实际验证 | 结果与适用范围 |
|---|---|
| React 构建 | TypeScript 5.8.3 `tsc --noEmit` 与 Vite 6.4.1 生产构建通过。新静态资源打包进 Spring Boot。 |
| Java 构建 | Java 21.0.8，Spring Boot 3.5.6，Maven 打包通过。Maven 本次用于编译与打包，行为验收由下列 HTTP、数据库和 Chrome 脚本执行。 |
| 账号接口 | 双渠道验证后激活、未验证账号登录拒绝、用户名大小写及 100 字符边界、密码上下限与确认、邮箱与电话规范化判重、并发同名、24 小时过期及标识释放、旧验证码失效、本人联系方式隔离均通过。 |
| 配置与权限接口 | 三类配置创建和编辑、跨用户隐藏、全平台需求名称唯一、可见与不可见重名提示、负责人候选使用权、添加和移除副负责人、撤权后提交拒绝、转交与相同幂等键重放通过。 |
| 隔离 PostgreSQL | PostgreSQL 17.10 回环库从空库应用 Flyway V1/V2。重启平台后账号、会话、配置主负责人和审计可读。登出后会话失效。审计含实际 HTTP 请求 ID，凭据与联系方式未出现在审计事件。 |
| Chrome 实际应用 | Chrome 156.0.8078.80 与 Playwright CLI 0.1.18。打包后的页面通过注册、两渠道验证、登录、创建三类配置、添加移除负责人、详情页直接刷新、本人联系方式与退出。390px 宽页面无横向溢出。 |
| 视觉检查 | 深海蓝控制台、青绿色操作重点、节点连线图形及船首结合协作节点的 SVG Logo。桌面登录页、工作台与手机配置页已截图检查。Logo 同时作为页签图标。 |
| OpenSpec 校验 | `openspec validate deliver-agentship-mvp --type change --strict --no-interactive` 通过。任务 1.1～1.4 已勾选，剩余 13 项继续跟踪。 |

可复现的应用验收入口为 [verify_first_batch.py](../../../platform/test/verify_first_batch.py)，浏览器旅程为 [first_batch_browser.js](../../../platform/test/first_batch_browser.js)。执行命令如下。

```sh
(cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build)
JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn -o -B -f platform/pom.xml -DskipTests package
python3 -u -B platform/test/verify_first_batch.py --java "$(/usr/libexec/java_home -v 21)/bin/java" --browser
```

脚本使用项目内的隔离 PostgreSQL 工具和合成账号。测试监听回环地址，验证码由显式启用的本地模拟渠道提供。应用启动和构建步骤见 [README](../../../README.md)。

最终验收包 `platform/target/agentship-platform-0.1.0-SNAPSHOT.jar` 的 SHA-256 为 `0b1e7d1afc41320d3335b45b2cc0a139c43f8b92a3d1dd02c73271bee69dec8c`。浏览器脚本生成 `.agentship/verification/first-batch-login.png`、`first-batch-dashboard.png` 和 `first-batch-mobile.png` 供本机视觉核对。

本次实施采用以下可调整的默认值。新账号完成激活时建立个人工作区并授予该账号需求创建权，登录会话有效期为 12 小时。模拟收件箱为仅本机开发使用的附加端点，普通注册响应仅含注册引用、期限与验证状态。流程首批保存基本资料，阶段和节点编辑安排在 2.1 与 2.6。UAT-27、33 的运行和设备恢复分区，以及真实 GitHub/Codex 验收继续由后续任务留证。

## v0.5 开发范围与文档对齐（历史）

当前基线为 BRD v0.57、PRD v0.8、[SA v0.5](../../../output/SA/SA-AgentShip.md)、[SD v0.5](../../../output/SD/SD-AgentShip-index.md) 与 [API v1.0.0-draft.7](../../../output/SD/contracts/agentship-v1.json) 候选契约。

| 核对项 | 本次结果 |
|---|---|
| OpenSpec 1.2.0 | `openspec validate deliver-agentship-mvp --type change --strict --no-interactive --json` 返回 `valid: true`，无问题。CLI 的结构状态与实施就绪分开。 |
| 规格、任务与补充 TA | 54 个 BRD UAT 与 3 个 EXT 各在规格和 TA 出现一次。17 个任务编号保留，完成 0 项。UAT-03、UAT-45 的正式发布分区和 EXT-03 留后续。任务 4.2 仅覆盖获准的开发环境。 |
| 图与追溯 | PlantUML 1.2025.2 渲染通过。62 张 SA 图、64 张 SD 图，含 39 对功能图。PRD、SA、SD 和功能图索引的 39 个功能 ID 一致。 |
| API 草案 | OpenAPI 3.1 静态校验通过。draft.7 通过 OpenAPI 校验和本人联系方式结构检查，33 个操作 ID 唯一。draft.6 的 8 个历史注册样例覆盖期限、渠道和激活。draft.5 的 6 个密码样例涵盖边界、空格、符号和 Unicode。draft.4 的 50 个历史契约样例覆盖其他流程。运行时权限、重放、游标和真实 Codex 回报仍待实现验收。 |
| PostgreSQL 设计与竞态 | PostgreSQL 17.10 回环隔离验证通过。加载 48 张表和 53 条参数化预备语句，字段字典覆盖 398 个字段。本人及跨会话读取、当前负责人和撤权后的使用权断言通过。双渠道激活、待验证账号禁用登录、联系方式唯一、24 小时到期、旧验证失效、重注册及批量清理断言通过。断言覆盖 GitHub 命名空间不变、历史筛选、聊天撤权、失败后跳过、原需求和运行修订同步及首次领取版本固定。双连接覆盖修复上限与领取及外部授权竞争，证实无关路线可继续。[验证脚本](../../../output/SD/data/verify-postgresql-design.py) · [运行步骤](../../../output/SD/data/transaction-concurrency-matrix.md) |
| 独立 SD 复核 | 核对 39 项图、开发范围及关键契约。复核发现的命名空间、历史筛选与跳过标记、首次领取版本固定已修订并复验。首批验证采用本地模拟。仍待重跑后的下游处理及适用审批。 |
| 目标栈应用与真实开发验收 | 目标栈回归、真实 GitHub/Codex 开发验收及收敛待执行。历史原型和既有版本的设计证据见下文。 |
| 实施就绪 | Apply 和 TA 保持 Blocked。账号激活、联系方式去重和密码规则已确认。开发模拟验证和 24 小时期限已确认。首批的账号和配置使用范围已确认。适用上游批准、首批设计与测试分析准入和实现验收待完成。其他决策见 [补充测试分析第 8 节](test-analysis.md#8-待定与阻塞)。 |

## v0.4 文档对齐与实施门槛（历史）

本轮工作为 OpenSpec 文档评审与细化，随后对齐补充测试分析。基线为 BRD v0.51、PRD v0.2、[SA v0.4](../../../output/SA/SA-AgentShip.md)、[SD v0.4](../../../output/SD/SD-AgentShip-index.md) 和 [API v1.0.0-draft.3](../../../output/SD/contracts/agentship-v1.json)。

| 范围 | 结果与证据 |
|---|---|
| OpenSpec 1.2.0，`spec-driven` | 结构校验通过。动态指令列出 4 项已存在的主产物和 17 项未勾选任务。`state: ready` 表示 CLI 可列出实施任务，SDD Apply 仍为 Blocked。 |
| 规格与 TA | 保留三项能力规格，以及 54 个 BRD UAT 和 3 个 EXT 的编号与用例状态。补充 TA 为 `TA-Blocked`，详见第 8 节。 |
| 图、数据与中间件 | PlantUML 渲染通过。62 张 SA 图、64 张 SD 图，其中 39 对是专属功能图，见[功能图索引](../../../output/SD/AgentShip-Function-Diagrams.md)。核对 49 张设计表、392 个字段、40 条既有预备语句及逐功能读写目录。访问路径、迁移和 SQL 见 [SD-D01～03](../../../output/SD/SD-AgentShip-data.md)，运行依赖见 [SD-M01～03](../../../output/SD/SD-AgentShip-middleware.md)。 |
| 接口和独立 SD 评审 | OpenAPI v1.0.0-draft.3 静态校验通过。独立评审为 Blocked。已补需求描述补录和变更提案的仓储契约，接口对齐和修复上限并发风险见 [SD 索引](../../../output/SD/SD-AgentShip-index.md)。既有 SQL 运行证据见 v0.3。 |
| 目标栈应用、真实供应商与收敛 | Not-Converged。待任务 4.1 和 4.2。业务口径、适用的 SRS/FRS 与 Change Request、SD-Ready、Contract-Ready、TA-Ready 及实施授权待完成。 |

当前实施任务进度为 0 / 17。下列历史证据按版本保留。新的应用与真实交付证据进入 [任务](tasks.md) 和 [补充测试分析](test-analysis.md) 对应条目。

## v0.3 OpenSpec 文档验证（历史）

本次更新覆盖 OpenSpec 规格、任务与补充测试分析。React + TypeScript、Java Spring Boot、PostgreSQL 和 Java worker 的构建、回归与真实环境验证待实施。实际证据按 [任务 4.1 与 4.2](tasks.md) 分别记录，下面的历史结果不能用于勾选当前实现任务或判定 Apply、Converge 或发布就绪。

| 文档核对 | 结果 | 证据范围 |
|---|---|---|
| OpenSpec 1.2.0 严格校验 | 通过 | `openspec validate deliver-agentship-mvp --type change --strict --no-interactive --json` 返回 `valid: true`，问题列表为空 |
| 追溯 ID 核对 | 通过 | 54 个 BRD UAT 在规格和测试矩阵各出现一次，另有 3 个补充用例。源项覆盖 51 条 BR、4 条 BRD NFR、39 条 PRD FR |
| 跨文档引用核对 | 通过 | [交付追溯矩阵](../../../output/SD/AgentShip-Traceability.md) 中 55 条源需求的 PRD、8 个 SA 用例、11 个 SD 段落、任务和 UAT 引用均存在。37 条 BRD 规则均保留验收入口 |
| OpenAPI 3.1 格式校验 | 通过 | 对 [API v1 设计草案](../../../output/SD/contracts/agentship-v1.json) 运行 `openapi-spec-validator` 0.7.2，并检查 JSON 键及 28 个操作 ID 无重复。结果是契约静态校验，实施后的接口一致性待验收 |
| 任务状态 | 0 / 17 | 动态任务清单有 17 个待实施任务，每项可追溯到测试用例。工具产物完成仅代表文档结构齐备，业务条件见测试分析第 8 节 |

## v0.3 设计验证

| 检查 | 结果 | 证据范围 |
|---|---|---|
| 图源与 SVG | 通过 | PlantUML 1.2025.2 渲染 17 张 SA 图、22 张 SD 图。[功能图索引](../../../output/SD/AgentShip-Function-Diagrams.md) 与 PRD 的 39 个功能 ID 一一对应，每项均链接业务和技术图。 |
| PostgreSQL DDL 与 DML | 通过 | PostgreSQL 17.10 隔离实例加载 49 张设计表和 40 条参数化准备语句。运行[断言脚本](../../../output/SD/data/agentship-postgresql-assertions.sql)，验证启动重放、撤权、不可变快照、聊天占用、过期租约、事件缺号、离线问答和发布证据。 |
| OpenAPI 3.1 | 通过 | 静态校验通过。额外验证检查通过须带已测试的候选工件版本，测试报告须带实际结论和候选版本。 |

本节验证图和数据库设计草案。应用接入、真实供应商、共享环境和发布批准按实施与验收任务办理。

## 历史原型证据

验证日期为 2026-11-09。Node.js 25.8.0、OpenSpec 1.2.0、Chrome。浏览器和 HTTP 测试使用合成账号、本机回环连接及隔离状态。

| 检查 | 结果 | 证据范围 |
|---|---|---|
| OpenSpec 严格校验 | 通过 | `openspec validate deliver-agentship-mvp --type change --strict --no-interactive --json` 返回 `valid: true`，无问题项 |
| JavaScript 语法 | 通过 | `src`、`web`、`test` 下所有 `.mjs` 文件均通过 `node --check` |
| 自动回归 | 15 项通过 | `node --test test/agentship.test.mjs`。覆盖登录、权限、分支计划、流程依赖、三个子 Agent、顺序交接、只重试失败角色、需求变更确认、问题取消、独立修复上限和设备恢复 |
| 浏览器交付演练 | 通过 | 注册、配对设备、保存示例流程、从运行看板新建需求、筛选并选择流程、启动、查看模拟发布记录、到达结束节点 |
| 双标签页聊天 | 通过 | 第二个标签页看到当前占用者。首个标签页显式离开后，第二个标签页立即取得操作权 |
| SQLite 持久化 | 通过 | 已提交的同一运行及待答问题在关闭并重新打开生成的测试数据库后仍可读取。未完成的事务已回滚 |
| Codex 和 GitHub 适配 | 测试替身通过 | Codex 结构化提问及原会话恢复、Git 分支计划、GitHub Actions 发布重试核对已有运行 |
| 真实供应商试点 | 待验证 | 原型时期任务 3.2。需使用获准的本机 Codex、GitHub 仓库及 GitHub Actions 目标环境取得实际交付证据 |

### 历史原型实现边界

- 本机交付实现使用 Node.js、SQLite 和回环地址。已选子 Agent 按配置排队，默认同时执行，每个角色有独立 Codex App Server 会话。直接使用原生 `spawn_agent` 属于试点验证范围。
- 实际供应商路径按 GitHub 及 GitHub Actions 设计。部署使用工作流结果作为本期凭证。发布遇到不明确的外部结果时，先核对原发布运行。
- 首期使用大小写不敏感的用户名判重，密码长度 10 至 128，不要求邮箱或短信验证。正式需求变更由持有运行聊天操作权的需求主负责人确认，对当前运行生效。首期修复路线在原检查所在阶段，支持每个检查 1 至 100 次自动修复。
- PRD、SA 和 SD 的业务待定项继续保留。该 OpenSpec 变更维持待试点验收状态。
