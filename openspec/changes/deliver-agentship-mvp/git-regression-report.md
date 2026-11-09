# Git 准备批次回归报告

当前状态：`Regression-Passed`，仅覆盖本批 Git 准备及其受影响的既有行为。5 套独立执行的既有回归通过；设备套件的一项旧状态码预期按新增租约契约修正后整套通过。新功能专项与集成证据由对应执行负责人提供，来源见下文。

## 范围与基线

本批范围为任务 2.3 的 Git 准备，以及其依赖的设备任务租约、回报和只读运行页面。节点调度、Codex 会话、聊天操作权和实际 GitHub 验收不在本次结论范围。

仓库当前内容尚未形成可比较的 Git 提交。基线采用上一批已验证的 Java 包 SHA-256：`8c39004a50abbc732dcbf45cc11191baaee6fcdf9f9b6d5492cb104a62b6908e`。2026-11-09 18:46:40 的目标包为 `platform/target/agentship-platform-0.1.0-SNAPSHOT.jar`，SHA-256 `dfe86d0fea9f18956d9a5f0231f5cb8ed5a54676352d185e4b1634505946aff8`，独立执行前已用 `shasum -a 256` 核实。

## 影响与所选回归

| 影响路径 | 回归及理由 | 执行状态 |
|---|---|---|
| V3 迁移、鉴权过滤器、配置服务及运行授权 | `verify_first_batch.py --browser`：账号、负责人、数据库初始化与重启、已有页面关键旅程 | 6 组通过，退出 0 |
| 启动采用流程快照及 Agent 配置 | `verify_flow_config.py`：阶段/节点、版本、权限、路线和多 Agent 规则 | 3 组通过，退出 0 |
| WorkerMain 增加 opt-in Git，原心跳路径转入任务服务 | `verify_device.py`：配对、签名、来源约束、状态私有性、默认不开启执行及重启 | 旧预期经主代理修正后，4 组通过，退出 0 |
| RunService 新增准确范围的 Git grants | `verify_run_start.py`：四类计划、权限与当前版本、并发、去重、事务回滚 | 7 组通过，退出 0 |
| 运行详情及本机设备页面增加 Git 状态 | `verify_launch_browser.py`：真实 Java 程序与 Chrome 启动、丢失响应重试、只读阶段和移动端 | 3 组通过，退出 0 |
| 新任务领取、旧租约隔离、外部意图和结果核对 | `verify_git_jobs.py`、`verify_git_worker.py` 及实现负责人的新增专项测试 | 后端 7 组、worker 18 组通过，由主代理汇总专项执行证据 |
| 从已签名的 HTTP 启动到真实本地 Git 再到 Chrome 看板 | 主代理的完整 Git pipeline 验收；浏览器发起运行本身另由启动 Chrome 套件验证 | 4 组通过，由主代理执行并提供结果 |

测试使用回环 HTTP、隔离 PostgreSQL、合成账号和临时状态。GitHub 替身必须为本地接口；不访问实际 GitHub，不读取用户凭据。Chrome 固定桥端口相关套件串行运行。

## 独立审查记录

以下发现均已由实现负责人修正；回归负责人复核了相关修正和针对性测试代码。专项实际通过结果由主代理提供，独立既有回归另行实跑。

| 编号 | 风险 | 最终处置与证据 |
|---|---|---|
| GR-01 | 明确被拒绝的供应商写入被 `catch(Exception)` 转为结果未知 | 已修正：明确 `GitProvider.Failure` 直接保留；worker `denied` 样例断言一次写入、失败结果和 `retryable=false` |
| GR-02 | 新建仓库各步骤未固定同一供应商仓库 ID；SHA 证据可能互相冲突 | 已修正：比对所有先前成功步骤的仓库身份及 SHA；Git jobs 样例拒绝仓库 ID、headCommit 和 providerResultId 篡改 |
| GR-03 | 响应头后停滞的 InputStream 可占住持续续租任务 | 已修正：平台与 GitHub 响应均经 BoundedHttp 总时限读取；worker `stalled_body` 样例通过 |
| GR-04 | 同设备并发 poll 先持有 SHARE 再升级 UPDATE，可造成死锁 | 已修正：poll 路径不先持设备 SHARE；Git jobs 双连接同设备、不同任务领取及过期恢复通过 |
| GR-05 | 已成功步骤之后的读失败，可能把成功步骤作为失败证据回报并永远被拒绝 | 已修正：成功回报后持久化 resolved 并清除当前待核对操作；worker `ref_denied` 不附带已成功步骤的失败证据；写入后读被拒保留 unknown |
| GR-06 | 平台的稳定 403/409 被当作临时传输错误，撤权后任务可能持续续租并停在准备中 | 已修正：PlatformRejection 区分旧租约与永久拒绝，拒绝授权的任务失败不附带未授权意图；worker `authorization_revoked` 与后端 grant 撤销样例通过 |

## 排除与限制

正式 GitHub、真实 Codex、双设备断电、生产发布、负载及完整流程收敛留在任务 4.2 或后续范围。历史 Node.js 原型未参与本批 Java 目标栈的回归结论。未发现即不能声称不存在漏洞；此处为范围内代码审查及功能回归。

## 最终证据与结论

独立执行的准确命令如下。前两套并行，设备和启动接口套件随后并行，Chrome 启动套件待首批 Chrome 套件完成后执行。每套各用独立临时 PostgreSQL 和合成数据。

```sh
python3 -u -B platform/test/verify_first_batch.py --browser --java /Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java
python3 -u -B platform/test/verify_flow_config.py --java /Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java
python3 -u -B platform/test/verify_device.py --java /Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java
python3 -u -B platform/test/verify_run_start.py --java /Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java
python3 -u -B platform/test/verify_launch_browser.py --java /Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java
```

设备套件首次运行退出 1：`pair_negatives` 向 `/api/worker/poll` 提交 `active: [{}]`，旧断言预期 409，实际返回 400。新增协议要求每个 active 项必须有 taskId、attemptId 和 epoch，此样例缺少字段；旧批次的 409 表示当时尚不支持 active。主代理确认契约迁移并把该断言改为 400，附加说明；回归负责人随后重新运行完整命令，4 组全部通过、退出 0。生产包没有改变，复核 SHA-256 仍与目标一致。此项分类为测试预期迁移，不是靠重复运行掩盖随机失败。

专项证据来源：主代理确认最终包上的 Git jobs 为 7 组、worker 为 18 组（真实本地 Git 1 组、本地 GitHub HTTP 替身 17 组），覆盖丢失响应、重启核对、用户/组织、四类工作、main/master、明确拒绝、结果未知和权限撤销。主代理执行 pipeline 4 组，覆盖真实 Java/PG/本地 Git、Chrome 390px 看板、worker 重启复用仓库及平台重启。前端负责人提供 Git 状态 fixture 通过，构建资产为 `index-JKPqTZQR.js` / `index-BbRkxw7w.css`；没有将 HTTP 替身当作真实 GitHub 验收。

主代理另提供 OpenAPI 静态校验、OpenSpec strict 与设计 SQL（48 张表、53 条预备语句、断言和并发矩阵）通过结果。以上专项结果由各负责人执行，本报告不将它们标为回归负责人亲自重跑。

最终为 `Regression-Passed`：所选既有套件全通过，6 项重要审查发现已修正并有对应专项证据，无未处置的范围内关键缺陷。没有静默跳过、已知不稳定用例或隔离用例。完整耗时未统一计量，不能据此作性能结论。真实供应商和后续完整交付流程仍按前述排除范围留待验收。本报告交主代理及收敛评审使用，不表示完整 17 项 OpenSpec 任务均已完成。
