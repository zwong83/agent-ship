# AgentShip 前端系统设计 v0.5

Proposed。以 [PRD v0.8](../PRD/PRD-AgentShip.md)、[SA](../SA/SA-AgentShip.md) 和 [API v1.0.0-draft.13](contracts/agentship-v1.json) 为基线。前端设计管页面、组件和客户端状态，授权、事务与协议分别见 [后端设计](SD-AgentShip-backend.md) 和 [集成设计](SD-AgentShip-integration.md)。总覆盖与就绪状态见 [设计索引](SD-AgentShip-index.md)。

## SD-F01 页面、组件与状态

| 旅程概览 | 历史原型 | 拟议界面 |
|---|---|---|
| [账号](diagrams/sd-ui-01-auth.svg) | 原生页面、回环 Cookie 登录 | React 会话守卫、错误聚焦及权限清缓存 |
| [配置与负责人](diagrams/sd-ui-02-ownership.svg) | 配置表单、版本检查、用户名选择 | 授权投影和当前动作；转交与撤权失去访问时清除受限数据 |
| [流程和启动](diagrams/sd-ui-03-flow-launch.svg) | 阶段表单及本机时间戳证明 | 键盘可编辑的阶段及依赖表单、已保存流程选择、限时挑战 |

React + TypeScript 静态单页应用由 Spring Boot 同源提供。各功能模块依赖共享会话、API 客户端及界面组件，跨模块传递资源 ID 或服务端投影。API 数据和动作资格以服务器为准；表单草稿在当前页面内存，URL 只含允许分享的导航标识。

## SD-F02 运行、聊天和人工恢复

[运行及聊天概览](diagrams/sd-ui-04-run-chat.svg)。历史原型为单主负责人和标签页控制，发起人可管理本次运行的聊天授权，原机跨设备及真实 Codex 证据待验证。拟议看板以相同运行 ID 同步，区分设备离线、聊天断线、待答、人工处理、停止和结束。聊天操作权绑定页实例，取得后才加载会话。获权访客可从本次聊天链接直接进入，页面先请求租约和聊天数据。运行看板权限单独判断。需求副负责人仅见有权读取的运行数据。

### 39 项功能的页面技术流

| 功能 | 路由 · 组件 | 客户端数据流 | 状态与异常 | 技术图 |
|---|---|---|---|---|
| FR-ACC-01 | /register · RegistrationForm | 资料草稿 → register → 核对邮箱和手机号的待验证状态 | 202 表示受理，业务会话由登录取得。两项都通过才提示登录。显示受理期限，到期提示重新注册。已登录用户从本人资料入口读取联系方式 | [SD-FR-ACC-01](diagrams/sd-fr-acc-01.svg) · [源](diagrams/sd-fr-acc-01.puml) |
| FR-ACC-02 | /login · SessionGate | 登录标识 → login；me 守卫；logout | 匿名回登录；无效会话清缓存；错误聚焦 | [SD-FR-ACC-02](diagrams/sd-fr-acc-02.svg) · [源](diagrams/sd-fr-acc-02.puml) |
| FR-OWN-01 | /requirements · /flows · /agents · OwnerPanel | 配置详情的允许动作 → 新建 / 编辑 / 管理成员 | 无成员为空态。副负责人无名单操作。新增副负责人输入完整用户名 | [SD-FR-OWN-01](diagrams/sd-fr-own-01.svg) · [源](diagrams/sd-fr-own-01.puml) |
| FR-OWN-02 | 三类配置详情 · ConfigEditor | 草稿和 expectedVersion → PATCH → 授权重读 | ACCESS_REVOKED 清除投影；STALE_VERSION 保留草稿 | [SD-FR-OWN-02](diagrams/sd-fr-own-02.svg) · [源](diagrams/sd-fr-own-02.puml) |
| FR-OWN-03 | 三类配置详情 · TransferOwnerDialog | 当前版本及接任人用户名 → transfer → 最小收据 → 重取授权列表 | 同键重试。确认后清原对象的缓存及编辑草稿 | [SD-FR-OWN-03](diagrams/sd-fr-own-03.svg) · [源](diagrams/sd-fr-own-03.puml) |
| FR-REQ-01 | /requirements 与 /runs/new · RequirementPicker | 启动搜索用 purpose=view，按 allowedActions 显示发起状态 | 无匹配为空；撤权清旧投影；副负责人可见不代表可发起 | [SD-FR-REQ-01](diagrams/sd-fr-req-01.svg) · [源](diagrams/sd-fr-req-01.puml) |
| FR-REQ-02 | 需求创建 · / 启动 · RequirementNameInput | 创建意图 → 授权冲突或新 ID → 原选择 | 可见重复显示已有入口；不可见重复只显示通用提示 | [SD-FR-REQ-02](diagrams/sd-fr-req-02.svg) · [源](diagrams/sd-fr-req-02.puml) |
| FR-REQ-03 | /runs/new 与 /runs/:id · StartWizard · / DescriptionPanel | 选中需求 ID；按是否含需求阶段保存描述；使用修订 | 仅搜索不推进；描述必填先保存；补填冲突刷新 | [SD-FR-REQ-03](diagrams/sd-fr-req-03.svg) · [源](diagrams/sd-fr-req-03.puml) |
| FR-REQ-04 | /runs/new · StartGate | allowedActions 启动入口；提交版本、证明和请求键 | 副负责人直调由服务端拒绝；版本或证明失效需重核 | [SD-FR-REQ-04](diagrams/sd-fr-req-04.svg) · [源](diagrams/sd-fr-req-04.puml) |
| FR-FLOW-01 | /flows/:id · WorkflowEditor | 有序阶段、节点和结束标记草稿 → 保存版本 | 空阶段或缺结束点提示；结束点隐藏 Agent 选项 | [SD-FR-FLOW-01](diagrams/sd-fr-flow-01.svg) |
| FR-FLOW-02 | /flows/:id · DependencyEditor | 前置关系草稿 → 服务器校验字段或节点错误 | 晚阶段、环路、失效引用定位；草稿保留 | [SD-FR-FLOW-02](diagrams/sd-fr-flow-02.svg) |
| FR-FLOW-03 | /runs/:id · StageTimeline | RunDetail 与事件重读展示阶段屏障及同阶段执行顺序 | 阻塞显示待完成前置；以服务器排序覆盖旧投影 | [SD-FR-FLOW-03](diagrams/sd-fr-flow-03.svg) |
| FR-FLOW-04 | /runs/:id · CompletionSummary | 等待路线及结束状态 → 展示同次运行结果 | 仍有活动路线保持等待；完成、停止、失败分开展示 | [SD-FR-FLOW-04](diagrams/sd-fr-flow-04.svg) |
| FR-FLOW-05 | /flows/:id 与 /runs/:id · VersionBadge | 流程编辑器显示 `workflowVersion`，保存仍提交配置的 `version` 作为乐观锁；负责人变化不增加图版本。看板与历史尝试读取启动快照和固定的角色显示名 | 旧编辑冲突后重读，不用当前目录替换历史显示名。存量空图显示「待完善」 | [SD-FR-FLOW-05](diagrams/sd-fr-flow-05.svg) |
| FR-FLOW-06 | /flows/:id 与 /runs/:id · CheckRoutes | 配置两路线；看板按本波检查结果标记活动路线 | 缺路线阻止保存；未确定结论时路线继续等待 | [SD-FR-FLOW-06](diagrams/sd-fr-flow-06.svg) |
| FR-FLOW-07 | /runs/:id · CheckRecovery | 缺有效结论 → 有权操作者提交 recheck → 重读原节点波次 | 租约失效禁操作；同键不重复开波次；仍无结论回待人工 | [SD-FR-FLOW-07](diagrams/sd-fr-flow-07.svg) |
| FR-FLOW-08 | /flows/:id 与 /runs/:id · RepairCounter | 设置节点上限；以 CheckStatus 读轮数及复查波次 | 上限、待复查、通过分别展示；独立计数 | [SD-FR-FLOW-08](diagrams/sd-fr-flow-08.svg) |
| FR-FLOW-09 | /runs/:id · RepairLimitActions | 当前租约提交 repair 或 stop → 重读运行 | 只显示允许动作；冲突后刷新；停止状态不视作完成 | [SD-FR-FLOW-09](diagrams/sd-fr-flow-09.svg) |
| FR-AG-01 | /flows/:id 与 /runs/:id · RolePicker · / TaskList | 按 flowId 查询可用角色 → 草稿 → 服务端复核并保存 → 运行投影 | 角色不可用或撤权拒绝；历史显示名须来自快照 | [SD-FR-AG-01](diagrams/sd-fr-ag-01.svg) |
| FR-AG-02 | /flows/:id 与 /runs/:id · RoleOrder | 串行顺序或默认并行写入配置；任务状态来自运行 | 键盘可调整顺序；状态未就绪显示等待 | [SD-FR-AG-02](diagrams/sd-fr-ag-02.svg) |
| FR-AG-03 | /runs/:id/chat · AgentThread | 当前节点和波次 → 默认协调 Agent 或选择 @Agent → 投递 → 以游标刷新授权会话 | 无可用目标提示。受理、已投递及待核对分别展示 | [SD-FR-AG-03](diagrams/sd-fr-ag-03.svg) |
| FR-AG-04 | /runs/:id · NodeArtifacts | 节点状态与最终工件分开读取；工件详情按权限打开 | 成功角色仍等待汇总时显示阻塞；暂无最终产物为空 | [SD-FR-AG-04](diagrams/sd-fr-ag-04.svg) |
| FR-AG-05 | /runs/:id · RoleRetry | 失败原因和尝试号 → 按资格重试或跳过指定角色 → 重读处置和历史 | 当前角色显示「已跳过」，历史尝试同时显示「失败」和跳过处置。不明原因用安全提示，成功结果保留 | [SD-FR-AG-05](diagrams/sd-fr-ag-05.svg) |
| FR-AG-06 | /runs/:id · CapacityStatus | 任务投影区分队列和执行；只显示服务器容量原因 | 容量不足可排队或有明确阻塞，口径待 SA-D05 | [SD-FR-AG-06](diagrams/sd-fr-ag-06.svg) |
| FR-RUN-01 | /runs/new · StartWizard | 需求 → 工作类型 → 按 requirementId 查有权流程 → 同机证明 | 无仓仅新功能且输入 GitHub 账号或组织。无可选流程显示空态 | [SD-FR-RUN-01](diagrams/sd-fr-run-01.svg) |
| FR-RUN-02 | /runs/:id · GitPreparation | RunDetail Git 引用、状态及原因 → 异步刷新 | 准备中、失败和待核对分开；失去权限清除引用 | [SD-FR-RUN-02](diagrams/sd-fr-run-02.svg) |
| FR-RUN-03 | /runs 与 /runs/:id · RunBoard | 授权分页、运行快照及版本游标 → 看板。按节点或任务分页读取历史 | 游标过期重取。显示固定的角色名及「基于旧版本」标记 | [SD-FR-RUN-03](diagrams/sd-fr-run-03.svg) |
| FR-RUN-04 | /devices 与 /runs/:id · DevicePanel | 配对、设备证明与在线观测；离线按同一 ID 刷新 | 浏览器回环拒绝、挑战过期和 CLI 不可用分别提示 | [SD-FR-RUN-04](diagrams/sd-fr-run-04.svg) |
| FR-RUN-05 | /runs/:id · ExternalRecovery | 查看原结果 → 有权核对 / 重试 → 新尝试证据 | 外部未知提示先核对。维护者资格及核对权限待定 | [SD-FR-RUN-05](diagrams/sd-fr-run-05.svg) |
| FR-CHAT-01 | /runs/:id/chat · SessionThread | 发起人管理本次聊天授权。获权访客可从聊天链接先取租约，再读取和定向发消息 | 副负责人拒绝且无占用详情；空会话或失效租约分开 | [SD-FR-CHAT-01](diagrams/sd-fr-chat-01.svg) · [源](diagrams/sd-fr-chat-01.puml) |
| FR-CHAT-02 | /runs/:id/chat · QuestionReply | ChatView 发问角色 → 答复命令 → 原任务投递状态 | 等待、已接受、已投递与未知分开；重复或已处理刷新 | [SD-FR-CHAT-02](diagrams/sd-fr-chat-02.svg) · [源](diagrams/sd-fr-chat-02.puml) |
| FR-CHAT-03 | /runs/:id/chat · QuestionPanel | 重开加载原问题；发起人按资格提交 cancel-question | 无问题为空；非发起人无取消；与回复竞态只显示实际结果 | [SD-FR-CHAT-03](diagrams/sd-fr-chat-03.svg) · [源](diagrams/sd-fr-chat-03.puml) |
| FR-CHAT-04 | /runs/:id/chat · LeaseGate | 独立 tabId 申请、持有、释放；竞争页读安全错误 | 占用弹窗获焦；迟到释放忽略；关闭通知能力待实测 | [SD-FR-CHAT-04](diagrams/sd-fr-chat-04.svg) · [源](diagrams/sd-fr-chat-04.puml) |
| FR-CHAT-05 | /runs/:id/chat · ReconnectBanner | 页内凭据续约；恢复后重读待答和未完动作 | 断线保留凭据；届满或撤权清除；与设备离线分开 | [SD-FR-CHAT-05](diagrams/sd-fr-chat-05.svg) · [源](diagrams/sd-fr-chat-05.puml) |
| FR-CHAT-06 | /runs/:id/chat · ChangeProposal | 在活动 BRD 节点提交提案，由发起人确认。刷新生效版本并标记基于旧版本的在途结果 | 待确认沿用原版本；冲突或越权禁止生效 | [SD-FR-CHAT-06](diagrams/sd-fr-chat-06.svg) · [源](diagrams/sd-fr-chat-06.puml) |
| FR-DEL-01 | /runs/:id/artifacts · ProductArtifact | 按节点和需求修订打开授权产品定义 | 暂无产物或已失效分开；内容安全渲染 | [SD-FR-DEL-01](diagrams/sd-fr-del-01.svg) |
| FR-DEL-02 | /runs/:id/artifacts · CodeArtifact | 对应前后端节点 → 仓库、工作分支及提交 | 等待代码、证据不匹配、未获权分开 | [SD-FR-DEL-02](diagrams/sd-fr-del-02.svg) |
| FR-DEL-03 | /runs/:id/artifacts · TestArtifact | 显示被测提交 / 工件、实际结论和失败详情 | 未执行、失败、未确认分开；必测项待批准 | [SD-FR-DEL-03](diagrams/sd-fr-del-03.svg) |
| FR-DEL-04 | /runs/:id/artifacts · PublicationArtifact | 保留后续发布的设计入口。开发范围验证交付物及仓库引用 | 本期不显示正式放行动作 | [SD-FR-DEL-04](diagrams/sd-fr-del-04.svg) |

### 共享交互、数据及验收

| 边界 | 约束与验收 |
|---|---|
| 授权与隐私 | 当前身份隔离缓存；登出、401 或授权撤回清投影。草稿、会话与租约凭据不持久化；日志只关联脱敏请求 ID。聊天、外部文本与链接安全渲染。 |
| 并发和重试 | 写入遵循期望版本和请求键，未知结果沿用同一键。响应确认后刷新，服务端拒绝时保留可编辑草稿。事件以版本和有界游标重读相关投影，过期重拉授权快照。 |
| 加载、空态和失败 | 查询期间展示加载，权限错误清数据并给安全说明，暂时不可用可手动重试；命令受理、实际执行、结果核对分别呈现。 |
| 占用与恢复 | 页标识随机且独立，当前凭据只留内存。正常离开或可送达关闭触发释放；未送达由服务器在检测后保留五分钟。重连按平台状态恢复。 |
| 可访问及构建 | 默认中文，时间按浏览器时区显示；键盘可编辑依赖、操作弹窗及表单，弹窗关闭恢复焦点，窄屏保留关键动作。Deno + Vite 暂定，固定依赖与锁文件，发布包标识 API 版本。浏览器范围、刷新预算、回环和共享部署待验。 |
| 证据 | 使用 [UAT 与补充测试矩阵](../../openspec/changes/deliver-agentship-mvp/test-analysis.md)；每项验证其允许、拒绝及恢复分区。原型演练、协议替身与真实环境证据分别记录。 |

### draft.4 接口对齐与待验事项

| 影响 | 界面使用与验收 |
|---|---|
| SD-C01、SD-C02 · FR-OWN-01、FR-OWN-03 | 新增副负责人及转交直接提交完整用户名。移除使用当前授权列表中的账号 ID。转交相同请求键重试只读取最小收据。确认后关闭旧编辑并重新拉取按当前权限过滤的列表。 |
| SD-C05 · FR-REQ-01、FR-REQ-04、FR-AG-01 | 查看需求与发起权限分别显示。流程候选绑定所选需求，Agent 候选绑定编辑的流程。撤权、版本或上下文变化后清除旧候选和相关选中值，再查当前列表。提交仍由服务端校验。首期仅当前主、副负责人可选用对应配置。 |
| SD-C03 · FR-CHAT-01～02、FR-AG-03 | 默认消息发送至所选节点的协调 Agent。指定消息使用角色 ID，角色名字仅用于显示。并行时先确定节点和波次。普通回复通过授权聊天游标读取，运行事件只通知刷新。问题答复仍提交原问题 ID。 |
| SD-C04 · FR-FLOW-05、FR-AG-01、FR-AG-05、FR-RUN-03、FR-RUN-05 | 看板采用节点输入修订及旧版本标记。历史页按节点或任务分页，角色名来自已选 Agent 的不可变版本。请求记录和产物的可见性继续按当前权限校验。 |
| FR-ACC-01、FR-CHAT-04～06 | 首期使用本地模拟渠道验收注册，重跑对已用旧结果的下游影响仍待定。撤回聊天权后清租约、聊天正文和操作投影。浏览器关闭通知及 5 分钟恢复边界待实测。 |

Frontend-Ready 与 Contract-Ready 等待接口实现证据、开放事项及目标浏览器验证。
