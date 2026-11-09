# AgentShip 索引与访问路径 v0.5

[DDL 权威](agentship-postgresql-ddl.sql) · [功能读写契约](dml-catalog.md)。索引是访问路径设计，执行计划和容量需在代表数据上验证。

| 访问路径 | 过滤、排序与边界 | 索引或约束 |
|---|---|---|
| 登录与会话 | 规范化账号键精确查找，按账号和到期核验会话 | account 唯一键、account_session_account_idx |
| 配置与需求 | 按当前授权、配置类型、名称键及 ID 有界分页 | configuration_owner_idx、configuration_deputy_active_idx、requirement_project_name_idx、全局名称唯一键 |
| 已封存流程与角色 | 一个版本按阶段、节点及角色复合键读取 | workflow_one_end_idx、workflow_one_coordinator_idx、workflow_dependency_successors_idx、复合主外键 |
| 运行与任务 | 按需求／设备查运行。按设备、可用时间和任务 ID 限量领取 | run_requirement_idx、run_device_active_idx、role_task_run_idx、task_attempt_ready_idx、task_attempt_expired_idx |
| 设备证明及聊天 | 设备按账号和最近可见时间，挑战按会话和期限；占用单行 | device_account_idx、device_challenge_session_idx、chat_lease 主键 |
| 消息、问答和待投递 | 授权运行的普通消息按受理序号滚动，目标任务限量读取待投递 | chat_message_page_idx、agent_question_run_idx、agent_inbox_pending_idx、requirement_change_run_idx |
| 产物、外部证据和审计 | 按运行、外部键或未决状态取证，稳定时间和 ID 排序 | artifact_run_idx、artifact_attempt_history_idx、external_repository_intent_idx、external_publication_intent_idx、external_unresolved_idx、operation_evidence_lookup_idx、审计索引 |

校验跨项目授权、同名竞争、队列热点、撤权和稳定分页。性能测试前确定代表数据量、连接预算、查询时限、锁等待及索引写入成本。首期容量、真实选择性和延迟目标待环境方确认。
