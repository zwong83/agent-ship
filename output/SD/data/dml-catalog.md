# AgentShip DML 和关键访问目录 v0.5

[数据设计](../SD-AgentShip-data.md) · [DDL](agentship-postgresql-ddl.sql) · [参数化 DML](agentship-postgresql-dml.sql) · [验证断言](agentship-postgresql-assertions.sql) · [事务矩阵](transaction-concurrency-matrix.md) · [索引与访问路径](indexes-and-access-paths.md)。

下表每条对应一个 PRD 功能。已存在的 SQL 以语句名为权威。标为读取契约的项由应用持久层按范围实现，仍须通过授权和执行计划测试。输入由服务端身份、版本及请求上下文绑定。

## 按功能的读写契约

| DML ID / 功能 | 数据 | SQL 或仓储契约 | 边界与基数 | 事务／冲突 | 失败结果 | 验证 |
|---|---|---|---|---|---|---|
| DML-ACC-01／FR-ACC-01 | account | `reclaim_expired_registration_keys`、`purge_expired_registrations`、`register_account`、`lock_registration_account`、`record_contact_verification` | 唯一账号键；一次创建一条 | TX-AUTH／访客注册、字段核验和唯一键 | 重复标识或输入非法，无新增 | UAT-12、15 |
| DML-ACC-02／FR-ACC-02 | account、account_session | `lookup_login`、`read_self_contact` | 登录键命中至多一个账号，按当前会话读取 | TX-AUTH／规范化标识、会话到期及撤销 | 不匹配或已撤销返回安全错误 | UAT-13、15 |
| DML-OWN-01／FR-OWN-01 | configuration、configuration_deputy | `lock_configuration`、`find_owner_candidate`、`change_deputy`、`append_audit` | 配置主键及当前成员唯一键；一次一个成员变更 | TX-CFG／当前授权、预期版本及同对象锁 | 无当前主权限或版本过期不写 | UAT-14、28 |
| DML-OWN-02／FR-OWN-02 | configuration、configuration_deputy、requirement | `lock_configuration`、`update_requirement` | 同对象行串行，业务提交带预期版本 | TX-CFG／当前授权、预期版本及同对象锁 | 撤权或版本冲突，旧页不得覆盖 | UAT-18 |
| DML-OWN-03／FR-OWN-03 | configuration、configuration_deputy、command_receipt | `lock_configuration`、`find_owner_candidate`、`transfer_ownership`、`append_audit` | 按配置主键更新一次，接任者按唯一账号标识核对 | TX-CFG／当前授权、预期版本及同对象锁 | 冲突返回安全结果，同键仅返回最小收据 | UAT-19、29 |
| DML-REQ-01／FR-REQ-01 | requirement、configuration、configuration_deputy | 按当前授权、对象键和有界游标的仓储读取契约 | 授权集合按名称键／对象 ID 有界分页；详情单条 | TX-READ／每次重新查当前权限，按有界游标读取 | 无权统一拒绝；项目权限不替代需求授权 | UAT-07、28、29 |
| DML-REQ-02／FR-REQ-02 | requirement、configuration | `create_requirement` | 全局规范化名称唯一；碰撞只读取有权目标 | TX-CFG／当前授权、预期版本及同对象锁 | 无权限时不给对象或负责人线索 | UAT-54 |
| DML-REQ-03／FR-REQ-03 | requirement、workflow_version、run_requirement_revision、node_execution | `create_requirement`、`lock_start_inputs`、`start_run`；启动后补录用下方仓储契约 | 具体需求及流程版本单条查找；到需求节点时补录 | TX-RUN／启动；TX-DESC／本次运行补录 | 缺描述时按流程条件拒绝；补录不改写其他运行 | UAT-10、51、53 |
| DML-REQ-04／FR-REQ-04 | configuration、device_challenge、run | `lock_start_inputs`、`lock_device_proof`、`start_run` | 锁当前主负责人及指定发起证明；一次一运行 | TX-RUN／需求、流程、挑战、请求收据 | 旧角色或旧挑战不建运行／Git 任务 | UAT-30、52 |
| DML-RUN-01／FR-RUN-01 | requirement、workflow_version、command_receipt、run | `lock_start_inputs`、`lock_device_proof`、`start_run`、`reserve_command_receipt` | 使用权限过滤候选。版本锁定后只接受一个请求，未关联需求冻结 GitHub 命名空间 | TX-RUN／需求、流程、挑战、请求收据 | 拒绝不合法工作类型、无权选择或键复用冲突 | UAT-01、09、10、16、52 |
| DML-FLOW-01／FR-FLOW-01 | workflow_version、workflow_stage、workflow_node | `lock_configuration`、`seal_workflow_version` | 单版本批写，节点主键与结束节点约束 | TX-CFG／当前授权、预期版本及同对象锁 | 无唯一末尾结束标记时不得封存 | UAT-08、35 |
| DML-FLOW-02／FR-FLOW-02 | workflow_dependency、workflow_stage、workflow_version | `seal_workflow_version` | 一个版本的关系图，输入规模上限待定 | TX-CFG／当前授权、预期版本及同对象锁 | 循环、失效或逆向引用不封存 | UAT-08、42 |
| DML-FLOW-03／FR-FLOW-03 | node_execution、role_task、task_attempt | `lock_run`、`claim_tasks`、`accept_task_event` | 读取当前阶段与就绪集合；领取按设备及限额 | TX-TASK／绑定设备、世代、连续序号与结果 | 阶段或依赖不满足不得创建可领取工作 | UAT-38、40、41 |
| DML-FLOW-04／FR-FLOW-04 | run、node_execution | `lock_run`、`accept_task_event` | 按一个运行及其实际路线判断终态 | TX-TASK／绑定设备、世代、连续序号与结果 | 未完成或未发布证据缺失时不得提前完成 | UAT-35、39 |
| DML-FLOW-05／FR-FLOW-05 | workflow_version、workflow_role、run | `seal_workflow_version`、`start_run` | 按已封存版本和节点角色复合键定位 | TX-CFG／当前授权、预期版本及同对象锁 | 旧运行始终使用既有引用 | UAT-04、11 |
| DML-FLOW-06／FR-FLOW-06 | workflow_check、workflow_route_node、check_wave | `seal_workflow_version`、`complete_check_wave` | 按检查与波次唯一记录并只激活一个结果 | TX-CHECK／运行、检查、波次、候选版本及适用权限 | 不完整分支不能封存；无结论阻塞 | UAT-43、44、50 |
| DML-FLOW-07／FR-FLOW-07 | check_cycle、check_wave、chat_lease | `complete_check_wave`、`begin_recheck` | 锁该运行和原检查当前波次 | TX-CHECK／运行、检查、波次、候选版本及适用权限 | 状态失效或越权时不产生重查 | UAT-50 |
| DML-FLOW-08／FR-FLOW-08 | check_cycle、repair_round、check_wave | `complete_check_wave`、`queue_repair_round`、`mark_repair_limit`、`begin_recheck` | 每检查独立计数，同波次最多一修复轮 | TX-CHECK／运行、检查、波次、候选版本及适用权限 | 到上限只阻止活动修复路线及其依赖的新派发和写入授权 | UAT-45、46、47、49 |
| DML-FLOW-09／FR-FLOW-09 | repair_round、chat_lease、run | `queue_repair_round`、`stop_at_repair_limit` | 校验当前占用、目标检查和上限；一次一轮 | TX-CHECK／运行、检查、波次、候选版本及适用权限 | 无权或重复命令不增加轮次 | UAT-48 |
| DML-AG-01／FR-AG-01 | agent_version、workflow_role、role_task | `seal_workflow_version`、`claim_tasks` | 按节点选定角色与版本过滤；派发仅给选择集 | TX-CFG／当前授权、预期版本及同对象锁 | 不可用或无权角色不给任务 | UAT-04、20、EXT-01 |
| DML-AG-02／FR-AG-02 | workflow_role、role_task、task_attempt | `claim_tasks`、`accept_task_event` | 按就绪角色、配置顺序和剩余槽位有界领取 | TX-TASK／绑定设备、世代、连续序号与结果 | 先后条件不满足不提前领取 | UAT-20、31、EXT-01 |
| DML-AG-03／FR-AG-03 | chat_message、agent_inbox、task_event | `send_chat_message`、`accept_task_event`、`record_agent_message`、`record_question`、`resolve_question` | 按运行页或目标任务读取。普通消息解析协调 Agent 或指定角色，问题回复按原会话交付 | TX-CHAT／对象权限、运行及占用、目标问题或角色 | 无权、目标不匹配或会话无效时拒绝 | UAT-05、20、21、22 |
| DML-AG-04／FR-AG-04 | role_task、task_attempt、artifact、node_execution | `lock_run`、`accept_task_event` | 节点选中角色都成功且最终工件可引用 | TX-TASK／绑定设备、世代、连续序号与结果 | 缺成功结果或产物时不释放下游 | UAT-37 |
| DML-AG-05／FR-AG-05 | role_task、task_attempt、chat_lease | `retry_failed_role`、`skip_failed_role`、`append_audit` | 按未处置的失败角色新增尝试或记录跳过，保留失败与成功证据 | TX-CHAT／对象权限、运行及占用、目标问题或角色 | 旧租约、重复或非失败角色拒绝 | UAT-36、EXT-02 |
| DML-AG-06／FR-AG-06 | device、task_attempt | `mark_device_present`、`claim_tasks` | 设备可用槽位加数据库批次上限，持久等待 | TX-TASK／绑定设备、世代、连续序号与结果 | 容量不足时保留未领取项 | EXT-01 |
| DML-RUN-02／FR-RUN-02 | run、requirement、repository、external_operation | `authorize_external_effect`、`record_external_observation`、`link_confirmed_repository`、`attach_confirmed_git` | 原建仓与分支操作键／实际外部引用 | TX-EXT／稳定操作键、任务租约、动作与目标 | 失败或未知不释放研发，不盲目重发 | UAT-01、02、09、16、17 |
| DML-RUN-03／FR-RUN-03 | run、node_execution、task_attempt、artifact | `node_revision_projection`、`read_run_attempt_history` | 授权运行摘要含节点输入版本，历史按节点或任务筛选并按复合键分页 | TX-READ／每次重新查当前权限，按有界游标读取 | 过期或无权视图不覆盖新状态，聊天权限不授予看板历史 | UAT-01、06、11、27 |
| DML-RUN-04／FR-RUN-04 | device、role_task、task_attempt、run | `mark_device_present`、`claim_tasks`、`renew_task`、`accept_task_event` | 绑定设备与当前尝试复核，新世代从序号 1 | TX-TASK／绑定设备、世代、连续序号与结果 | 错误设备、迟到或缺号不得改写原运行 | UAT-22、27、EXT-02 |
| DML-RUN-05／FR-RUN-05 | external_operation、operation_evidence、audit_event | `record_external_observation`、`append_audit` | 只按原操作或有界未决集合核对 | TX-EXT／稳定操作键、任务租约、动作与目标 | 未知不得重复写；终止后授权范围待定 | UAT-02、06、EXT-03 |
| DML-CHAT-01／FR-CHAT-01 | run_permission、chat_lease、chat_message、agent_inbox | `find_chat_guest`、`change_run_chat_grant`、`acquire_chat`、`read_chat_occupant` | 当前持有页按运行和消息游标读取 | TX-CHAT／对象权限、运行及占用、目标问题或角色 | 副负责人或无授权拒绝，撤销来宾权限同时清理其占用 | UAT-05、22、32 |
| DML-CHAT-02／FR-CHAT-02 | agent_question、question_resolution、agent_inbox | `record_question`、`resolve_question` | 按问题唯一终结，投递定位原任务和会话 | TX-CHAT／对象权限、运行及占用、目标问题或角色 | 越权或已回复不能追加第二次 | UAT-21、33、EXT-02 |
| DML-CHAT-03／FR-CHAT-03 | agent_question、question_resolution、agent_inbox | `resolve_question`、`append_audit` | 一次终结，发起人取消与回复竞争 | TX-CHAT／对象权限、运行及占用、目标问题或角色 | 关闭页面不删除问题，其他人不得取消 | UAT-33、34、EXT-02 |
| DML-CHAT-04／FR-CHAT-04 | run_permission、chat_lease | `acquire_chat`、`read_chat_occupant`、`release_chat` | 每运行一条占用，世代和页面匹配 | TX-CHAT／对象权限、运行及占用、目标问题或角色 | 竞争页拒绝，旧页不能释放新租约 | UAT-23、24、26、32 |
| DML-CHAT-05／FR-CHAT-05 | chat_lease | `renew_chat`、`acquire_chat` | 检测时点至 5 分钟，按运行键更新一条 | TX-CHAT／对象权限、运行及占用、目标问题或角色 | 过期页不获旧权，正常关闭规则另验收 | UAT-25、EXT-02 |
| DML-CHAT-06／FR-CHAT-06 | requirement_change、run_requirement_revision、run | `create_run_change`、`confirm_run_change`、`append_audit` | 提案绑定活动 BRD 节点、原需求版本和运行修订，发起人确认更新两处 | TX-CHANGE／原需求、运行、占用和提案 | 未确认或越权时沿用旧修订 | UAT-05 |
| DML-DEL-01／FR-DEL-01 | artifact、node_execution、run_requirement_revision | `accept_task_event` | 从节点和运行输入产生只读工件引用 | TX-TASK／绑定设备、世代、连续序号与结果 | 缺最终产物不开放研发 | UAT-01、37 |
| DML-DEL-02／FR-DEL-02 | artifact、artifact_archive、repository、external_operation | `attach_confirmed_git`、`approve_artifact_archive`、`pin_artifact_archive_export`、`confirm_artifact_archive` | 按节点、分支和提交关联产物。每个产物至多一个归档记录 | TX-EXT／固定原机、世代、审批、标签与快照 | 工件或引用不一致时待处理，未知结果只核对 | UAT-01、06、09 |
| DML-DEL-03／FR-DEL-03 | artifact、check_wave、node_execution | `accept_task_event`、`complete_check_wave` | 按被测候选、提交与需求修订保存结果 | TX-CHECK／运行、检查、波次、候选版本及适用权限 | 失败和未确认测试不满足必测门槛 | UAT-01、03、45 |
| DML-DEL-04／FR-DEL-04 | publication_gate、publication_check_evidence、external_operation | `verify_publication_gate`、`authorize_external_effect`、`record_external_observation`、`attach_confirmed_publication` | 正式发布后续预留，按精确工件、候选提交、修订和发布目标核对 | TX-EXT／稳定操作键、任务租约、动作与目标 | 开发环境不发起正式发布。同提交其他工件、失败报告、未知结果不准报成功 | UAT-03、45、EXT-03 |

## 补充写入契约

| 操作 | 输入、前置及提交结果 |
|---|---|
| DML-REQ-03 启动后补录描述 | 参数绑定运行、原需求、当前提交人、预期需求版本、预期运行修订、请求键和描述。按需求 → 运行 → 需求节点顺序加锁。当前运行须确在允许补录的需求节点，提交权限有效。同事务更新目标需求及本次运行生效输入，保存收据、审计并开放相应下游。旧版本、节点已离开或无权时零写入。其他运行保留原快照。 |
| DML-CHAT-06 创建提案 | 参数绑定运行、BRD 节点、提案人、当前页占用、原需求版本、运行修订、请求键和内容。锁配置和运行后核验当前权，写一条待确认提案及收据。只有发起人确认时才同时更新原需求及运行修订。同键返回原提案收据，竞争或越权不产生有效修订。 |

补录描述仍由应用仓储实现。v0.5 的 BRD 提案与确认已在设计 SQL 中提供，其他应用接入仍需验收。

## 准备语句注册表

| SQL 标识 | DML 来源行 | 参数类型 |
|---|---:|---|
| `reclaim_expired_registration_keys` | [第 14 行](agentship-postgresql-dml.sql#L14) | `text,text,text` |
| `purge_expired_registrations` | [第 27 行](agentship-postgresql-dml.sql#L27) | `integer` |
| `register_account` | [第 42 行](agentship-postgresql-dml.sql#L42) | `uuid,text,text,text,text,text,text,text` |
| `lock_registration_account` | [第 49 行](agentship-postgresql-dml.sql#L49) | `uuid` |
| `record_contact_verification` | [第 56 行](agentship-postgresql-dml.sql#L56) | `uuid,text,text` |
| `lookup_login` | [第 70 行](agentship-postgresql-dml.sql#L70) | `text,text` |
| `read_self_contact` | [第 77 行](agentship-postgresql-dml.sql#L77) | `uuid,uuid` |
| `lock_configuration` | [第 83 行](agentship-postgresql-dml.sql#L83) | `uuid` |
| `find_owner_candidate` | [第 88 行](agentship-postgresql-dml.sql#L88) | `uuid,uuid,uuid,text` |
| `create_requirement` | [第 97 行](agentship-postgresql-dml.sql#L97) | `uuid,uuid,uuid,uuid,text,text,text` |
| `update_requirement` | [第 114 行](agentship-postgresql-dml.sql#L114) | `uuid,uuid,uuid,bigint,text,text,text` |
| `change_deputy` | [第 132 行](agentship-postgresql-dml.sql#L132) | `uuid,uuid,uuid,bigint,uuid,text` |
| `transfer_ownership` | [第 156 行](agentship-postgresql-dml.sql#L156) | `uuid,uuid,uuid,bigint,uuid` |
| `reserve_command_receipt` | [第 174 行](agentship-postgresql-dml.sql#L174) | `text,uuid,uuid,text,text,bytea` |
| `read_command_receipt` | [第 182 行](agentship-postgresql-dml.sql#L182) | `text,uuid,text,text` |
| `finish_command_receipt` | [第 187 行](agentship-postgresql-dml.sql#L187) | `text,uuid,text,text,text,uuid` |
| `seal_workflow_version` | [第 195 行](agentship-postgresql-dml.sql#L195) | `uuid,bigint` |
| `lock_start_inputs` | [第 201 行](agentship-postgresql-dml.sql#L201) | `uuid,uuid` |
| `lock_device_proof` | [第 207 行](agentship-postgresql-dml.sql#L207) | `uuid,uuid,uuid,uuid,text` |
| `start_run` | [第 223 行](agentship-postgresql-dml.sql#L223) | `uuid,uuid,uuid,uuid,bigint,uuid,bigint,uuid,uuid,text,timestamptz,uuid,uuid,text` |
| `lock_run_configuration` | [第 271 行](agentship-postgresql-dml.sql#L271) | `uuid` |
| `lock_run` | [第 273 行](agentship-postgresql-dml.sql#L273) | `uuid` |
| `find_chat_guest` | [第 278 行](agentship-postgresql-dml.sql#L278) | `uuid,uuid,uuid,text` |
| `change_run_chat_grant` | [第 290 行](agentship-postgresql-dml.sql#L290) | `uuid,uuid,uuid,uuid,text` |
| `acquire_chat` | [第 323 行](agentship-postgresql-dml.sql#L323) | `uuid,uuid,uuid,uuid,integer` |
| `read_chat_occupant` | [第 344 行](agentship-postgresql-dml.sql#L344) | `uuid,uuid,uuid` |
| `renew_chat` | [第 353 行](agentship-postgresql-dml.sql#L353) | `uuid,uuid,uuid,uuid,bigint,integer` |
| `release_chat` | [第 362 行](agentship-postgresql-dml.sql#L362) | `uuid,uuid,uuid,uuid,bigint` |
| `send_chat_message` | [第 372 行](agentship-postgresql-dml.sql#L372) | `uuid,uuid,uuid,uuid,bigint,uuid,uuid,text,uuid,uuid` |
| `claim_tasks` | [第 395 行](agentship-postgresql-dml.sql#L395) | `uuid,integer,integer` |
| `read_run_attempt_history` | [第 401 行](agentship-postgresql-dml.sql#L401) | `uuid,uuid,uuid,uuid,integer,integer` |
| `mark_device_present` | [第 417 行](agentship-postgresql-dml.sql#L417) | `uuid,text` |
| `renew_task` | [第 423 行](agentship-postgresql-dml.sql#L423) | `uuid,uuid,uuid,bigint,integer` |
| `accept_task_event` | [第 435 行](agentship-postgresql-dml.sql#L435) | `uuid,uuid,uuid,bigint,bigint,text,uuid,text,jsonb,text,text` |
| `record_agent_message` | [第 459 行](agentship-postgresql-dml.sql#L459) | `uuid,uuid,text,text,uuid` |
| `record_question` | [第 475 行](agentship-postgresql-dml.sql#L475) | `uuid,uuid,text` |
| `resolve_question` | [第 488 行](agentship-postgresql-dml.sql#L488) | `uuid,uuid,uuid,uuid,uuid,bigint,text,text,uuid` |
| `retry_failed_role` | [第 518 行](agentship-postgresql-dml.sql#L518) | `uuid,uuid,uuid,uuid,uuid,bigint,uuid` |
| `skip_failed_role` | [第 534 行](agentship-postgresql-dml.sql#L534) | `uuid,uuid,uuid,uuid,uuid,bigint` |
| `create_run_change` | [第 546 行](agentship-postgresql-dml.sql#L546) | `uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text,text` |
| `confirm_run_change` | [第 561 行](agentship-postgresql-dml.sql#L561) | `uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint` |
| `complete_check_wave` | [第 602 行](agentship-postgresql-dml.sql#L602) | `uuid,uuid,integer,uuid,text,text,uuid,text,text` |
| `mark_repair_limit` | [第 633 行](agentship-postgresql-dml.sql#L633) | `uuid,uuid` |
| `queue_repair_round` | [第 647 行](agentship-postgresql-dml.sql#L647) | `uuid,uuid,text,uuid,uuid,uuid,bigint` |
| `begin_recheck` | [第 671 行](agentship-postgresql-dml.sql#L671) | `uuid,uuid,uuid,uuid,uuid,uuid,bigint` |
| `stop_at_repair_limit` | [第 693 行](agentship-postgresql-dml.sql#L693) | `uuid,uuid,uuid,uuid,uuid,bigint` |
| `verify_publication_gate` | [第 709 行](agentship-postgresql-dml.sql#L709) | `uuid,uuid,text,text,text` |
| `authorize_external_effect` | [第 723 行](agentship-postgresql-dml.sql#L723) | `uuid,uuid,uuid,uuid,bigint,text,text,timestamptz,uuid,text` |
| `record_external_observation` | [第 759 行](agentship-postgresql-dml.sql#L759) | `uuid,uuid,uuid,bigint,uuid,text,text,uuid,text,text,text,text,timestamptz,uuid` |
| `link_confirmed_repository` | [第 793 行](agentship-postgresql-dml.sql#L793) | `uuid,uuid,uuid` |
| `attach_confirmed_git` | [第 808 行](agentship-postgresql-dml.sql#L808) | `uuid,uuid,uuid,text,text,text` |
| `attach_confirmed_publication` | [第 821 行](agentship-postgresql-dml.sql#L821) | `uuid,uuid,uuid,uuid,uuid,uuid,text,text` |
| `approve_artifact_archive` | [第 846 行](agentship-postgresql-dml.sql#L846) | `uuid,uuid,uuid,text,timestamptz` |
| `pin_artifact_archive_export` | [第 867 行](agentship-postgresql-dml.sql#L867) | `uuid,uuid,bigint,text` |
| `confirm_artifact_archive` | [第 878 行](agentship-postgresql-dml.sql#L878) | `uuid,uuid,bigint,text` |
| `append_audit` | [第 887 行](agentship-postgresql-dml.sql#L887) | `uuid,text,uuid,uuid,uuid,text,uuid,text,text,text` |
