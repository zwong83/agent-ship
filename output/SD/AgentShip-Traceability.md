# AgentShip BRD 到交付追溯矩阵 v0.5

基线为 [BRD v0.54](../BRD/AgentShip/BRD-AgentShip.md)、[PRD v0.5](../PRD/PRD-AgentShip.md)、[SA v0.5](../SA/SA-AgentShip.md) 与 [SD v0.5](SD-AgentShip-index.md)。每个 UAT 的前置、动作和预期结果以 BRD 第 9 节及相应 OpenSpec 场景为准。每条 PRD 功能的专属业务图、技术图、数据和中间件见 [功能图索引](AgentShip-Function-Diagrams.md)。

## 1. 业务和质量要求

| BRD 来源 | 决策状态 | PRD | SA | SD | SDD 任务 | 原 BRD 验收 |
|---|---|---|---|---|---|---|
| BR-01 | 已确认 | FR-REQ-01、FR-RUN-03 | UC-02、UC-04 | SD-B02、SD-B04、SD-F01、SD-I01、SD-I04 | 1.3、1.4、2.2、2.3、2.6 | UAT-01、UAT-05、UAT-28、UAT-51、UAT-53 |
| BR-02 | 已确认 | FR-RUN-02 | UC-04、UC-08 | SD-B01、SD-B02、SD-B04、SD-B05、SD-F01、SD-F02、SD-I01、SD-I02、SD-I04 | 2.2、2.3、2.6、3.1、4.1、4.2 | UAT-01、UAT-02、UAT-09、UAT-16、UAT-17 |
| BR-03 | 已确认 | FR-DEL-01 | UC-05 | SD-B03、SD-B04、SD-F02、SD-I03 | 2.4、2.6、3.2 | UAT-01 |
| BR-04 | 已确认 | FR-DEL-02 | UC-05 | SD-B03、SD-B04、SD-F02、SD-I03 | 2.4、2.6、3.2 | UAT-01 |
| BR-05 | 已确认 | FR-DEL-02 | UC-05 | SD-B03、SD-B04、SD-F02、SD-I03 | 2.4、2.6、3.2 | UAT-01 |
| BR-06 | 已确认 | FR-DEL-03 | UC-05 | SD-B03、SD-B04、SD-F02、SD-I03 | 2.4、2.6、3.2 | UAT-01、UAT-03 |
| BR-07 | 已确认，正式发布后续 | FR-DEL-04 | UC-07、UC-08 | SD-B01、SD-B03、SD-B04、SD-B05、SD-F02、SD-I02、SD-I04 | 后续发布批次 | UAT-03、UAT-45 的发布分区 |
| BR-08 | 已确认 | FR-RUN-03 | UC-05、UC-08 | SD-B01、SD-B03、SD-B04、SD-B05、SD-F02、SD-I02、SD-I03、SD-I04 | 2.4、2.6、3.1、3.2、4.1、4.2 | UAT-01、UAT-02、UAT-03、UAT-06、UAT-08、UAT-11 |
| BR-09 | 已确认 | FR-AG-01 | UC-03、UC-05 | SD-B03、SD-B04、SD-F01、SD-F02、SD-I03 | 2.1、2.4、2.6、3.2 | UAT-04、UAT-11、UAT-20、UAT-31 |
| BR-10 | 已确认 | FR-CHAT-01 | UC-06 | SD-B02、SD-B05、SD-F02、SD-I01、SD-I03 | 3.3、3.4、3.5 | UAT-05、UAT-22、UAT-23 |
| BR-11 | 拟议 | FR-RUN-05 | UC-04、UC-08 | SD-B01、SD-B02、SD-B04、SD-B05、SD-F01、SD-F02、SD-I01、SD-I02、SD-I04 | 2.2、2.3、2.6、3.1、4.1、4.2 | UAT-02、UAT-06、UAT-36 |
| BR-12 | 已确认 | FR-FLOW-01 | UC-03 | SD-B03、SD-F01 | 2.1、2.6 | UAT-08、UAT-11、UAT-35 |
| BR-13 | 已确认 | FR-REQ-03、FR-RUN-01 | UC-04 | SD-B02、SD-B04、SD-F01、SD-I01、SD-I04 | 2.2、2.3、2.6 | UAT-01、UAT-09、UAT-10、UAT-16、UAT-51、UAT-53、UAT-54 |
| BR-14 | 已确认 | FR-RUN-01 | UC-04 | SD-B02、SD-B04、SD-F01、SD-I01、SD-I04 | 2.2、2.3、2.6 | UAT-01、UAT-09、UAT-10、UAT-16、UAT-52 |
| BR-15 | 已确认 | FR-RUN-01 | UC-03、UC-04 | SD-B02、SD-B03、SD-B04、SD-F01、SD-I01、SD-I04 | 2.1、2.2、2.3、2.6 | UAT-01、UAT-08、UAT-09、UAT-10、UAT-16、UAT-52 |
| BR-16 | 已确认 | FR-FLOW-03 | UC-05 | SD-B03、SD-B04、SD-F02、SD-I03 | 2.4、2.6、3.2 | UAT-01、UAT-08、UAT-09、UAT-11、UAT-16、UAT-17、UAT-35、UAT-37、UAT-38、UAT-43 |
| BR-17 | 已确认 | FR-FLOW-02 | UC-03、UC-05 | SD-B03、SD-B04、SD-F01、SD-F02、SD-I03 | 2.1、2.4、2.6、3.2 | UAT-08、UAT-11、UAT-37、UAT-41、UAT-42 |
| BR-18 | 已确认 | FR-ACC-01 | UC-01 | SD-B02、SD-F01、SD-I01 | 1.2、1.4 | UAT-12 |
| BR-19 | 已确认 | FR-ACC-01 | UC-01 | SD-B02、SD-F01、SD-I01 | 1.2、1.4 | UAT-12 |
| BR-20 | 已确认 | FR-ACC-02 | UC-01 | SD-B02、SD-F01、SD-I01 | 1.2、1.4 | UAT-13 |
| BR-21 | 已确认 | FR-ACC-02 | UC-01 | SD-B02、SD-F01、SD-I01 | 1.2、1.4 | UAT-13 |
| BR-22 | 已确认 | FR-OWN-01 | UC-02 | SD-B02、SD-F01、SD-I01 | 1.3、1.4 | UAT-14 |
| BR-23 | 已确认 | FR-OWN-01 | UC-02 | SD-B02、SD-F01、SD-I01 | 1.3、1.4 | UAT-14、UAT-18、UAT-19、UAT-28 |
| BR-24 | 已确认 | FR-OWN-01 | UC-02 | SD-B02、SD-F01、SD-I01 | 1.3、1.4 | UAT-14、UAT-18、UAT-28 |
| BR-25 | 已确认 | FR-OWN-02 | UC-02、UC-06 | SD-B02、SD-B05、SD-F01、SD-F02、SD-I01、SD-I03 | 1.3、1.4、3.3、3.4、3.5 | UAT-18 |
| BR-26 | 已确认 | FR-OWN-03 | UC-02、UC-06 | SD-B02、SD-B05、SD-F01、SD-F02、SD-I01、SD-I03 | 1.3、1.4、3.3、3.4、3.5 | UAT-19、UAT-29 |
| BR-27 | 已确认 | FR-AG-01、FR-AG-02、FR-AG-03、FR-AG-06、FR-RUN-03 | UC-05、UC-06 | SD-B02、SD-B03、SD-B04、SD-B05、SD-F02、SD-I01、SD-I03 | 2.4、2.6、3.2、3.3、3.4、3.5 | UAT-20、UAT-21、UAT-31 |
| BR-28 | 已确认 | FR-AG-03、FR-CHAT-02 | UC-06 | SD-B02、SD-B05、SD-F02、SD-I01、SD-I03 | 3.3、3.4、3.5 | UAT-21、UAT-33、UAT-34 |
| BR-29 | 已确认 | FR-CHAT-01、FR-RUN-04 | UC-06、UC-08 | SD-B01、SD-B02、SD-B04、SD-B05、SD-F02、SD-I01、SD-I02、SD-I03、SD-I04 | 3.1、3.3、3.4、3.5、4.1、4.2 | UAT-22、UAT-27 |
| BR-30 | 已确认 | FR-CHAT-04 | UC-06 | SD-B02、SD-B05、SD-F02、SD-I01、SD-I03 | 3.3、3.4、3.5 | UAT-23、UAT-24、UAT-25、UAT-26 |
| BR-31 | 已确认 | FR-CHAT-05 | UC-06 | SD-B02、SD-B05、SD-F02、SD-I01、SD-I03 | 3.3、3.4、3.5 | UAT-25 |
| BR-32 | 已确认 | FR-RUN-04 | UC-08 | SD-B01、SD-B04、SD-B05、SD-F02、SD-I02、SD-I04 | 3.1、4.1、4.2 | UAT-27 |
| BR-33 | 已确认 | FR-REQ-01 | UC-02 | SD-B02、SD-F01、SD-I01 | 1.3、1.4 | UAT-28、UAT-29、UAT-30 |
| BR-34 | 已确认 | FR-REQ-04 | UC-04 | SD-B02、SD-B04、SD-F01、SD-I01、SD-I04 | 2.2、2.3、2.6 | UAT-30 |
| BR-35 | 已确认 | FR-AG-02、FR-AG-06 | UC-05 | SD-B03、SD-B04、SD-F02、SD-I03 | 2.4、2.6、3.2 | UAT-31 |
| BR-36 | 已确认 | FR-CHAT-01 | UC-06 | SD-B02、SD-B05、SD-F02、SD-I01、SD-I03 | 3.3、3.4、3.5 | UAT-32 |
| BR-37 | 已确认 | FR-CHAT-03 | UC-06 | SD-B02、SD-B05、SD-F02、SD-I01、SD-I03 | 3.3、3.4、3.5 | UAT-33、UAT-34 |
| BR-38 | 已确认 | FR-FLOW-01、FR-FLOW-04 | UC-03、UC-05、UC-08 | SD-B01、SD-B03、SD-B04、SD-B05、SD-F01、SD-F02、SD-I02、SD-I03、SD-I04 | 2.1、2.4、2.6、3.1、3.2、4.1、4.2 | UAT-35、UAT-39 |
| BR-39 | 已确认 | FR-AG-05、FR-RUN-03 | UC-05、UC-06 | SD-B02、SD-B03、SD-B04、SD-B05、SD-F02、SD-I01、SD-I03 | 2.4、2.6、3.2、3.3、3.4、3.5 | UAT-36 |
| BR-40 | 已确认 | FR-AG-04 | UC-05 | SD-B03、SD-B04、SD-F02、SD-I03 | 2.4、2.6、3.2 | UAT-37、UAT-41 |
| BR-41 | 已确认 | FR-FLOW-03 | UC-05 | SD-B03、SD-B04、SD-F02、SD-I03 | 2.4、2.6、3.2 | UAT-38、UAT-39、UAT-40 |
| BR-42 | 已确认 | FR-FLOW-05 | UC-03、UC-08 | SD-B01、SD-B03、SD-B04、SD-B05、SD-F01、SD-F02、SD-I02、SD-I04 | 2.1、2.6、3.1、4.1、4.2 | UAT-04、UAT-11 |
| BR-43 | 已确认 | FR-FLOW-03 | UC-05 | SD-B03、SD-B04、SD-F02、SD-I03 | 2.4、2.6、3.2 | UAT-40、UAT-41 |
| BR-44 | 已确认 | FR-FLOW-02 | UC-03 | SD-B03、SD-F01 | 2.1、2.6 | UAT-42 |
| BR-45 | 已确认 | FR-FLOW-06 | UC-03、UC-07 | SD-B03、SD-B04、SD-F01、SD-F02、SD-I04 | 2.1、2.5、2.6、3.4 | UAT-43、UAT-44、UAT-50 |
| BR-46 | 已确认 | FR-DEL-04、FR-FLOW-06、FR-FLOW-08 | UC-07 | SD-B03、SD-B04、SD-F02、SD-I04 | 2.5、2.6、3.4 | UAT-45、UAT-46、UAT-47、UAT-48 |
| BR-47 | 已确认 | FR-FLOW-08 | UC-07 | SD-B03、SD-B04、SD-F02、SD-I04 | 2.5、2.6、3.4 | UAT-46、UAT-47、UAT-48、UAT-49 |
| BR-48 | 已确认 | FR-FLOW-09 | UC-06、UC-07 | SD-B02、SD-B03、SD-B04、SD-B05、SD-F02、SD-I01、SD-I03、SD-I04 | 2.5、2.6、3.3、3.4、3.5 | UAT-48 |
| BR-49 | 已确认 | FR-FLOW-07 | UC-06、UC-07 | SD-B02、SD-B03、SD-B04、SD-B05、SD-F02、SD-I01、SD-I03、SD-I04 | 2.5、2.6、3.3、3.4、3.5 | UAT-50 |
| BR-50 | 已确认 | FR-REQ-02 | UC-02、UC-04 | SD-B02、SD-B04、SD-F01、SD-I01、SD-I04 | 1.3、1.4、2.2、2.3、2.6 | UAT-54 |
| BR-51 | 已确认 | FR-CHAT-06 | UC-06 | SD-B02、SD-B05、SD-F02、SD-I01、SD-I03 | 3.3、3.4、3.5 | UAT-05 |
| NFR-01 | 拟议质量目标 | NFR-PRD-01 | UC-01、UC-02、UC-04、UC-06、UC-08 | SD-B02、SD-B05、SD-I01、SD-I02 | 1.2、1.3、2.2、3.1、3.3、4.1 | UAT-07、UAT-14、UAT-18、UAT-23、UAT-28、UAT-29、UAT-30、UAT-32、UAT-52、UAT-54 |
| NFR-02 | 拟议质量目标 | NFR-PRD-02 | UC-04、UC-05、UC-06、UC-07、UC-08 | SD-B03、SD-B04、SD-B05、SD-I04 | 1.1、2.3、2.4、2.5、3.4、4.1、4.2 | UAT-04、UAT-06、UAT-09、UAT-11、UAT-16、UAT-17、UAT-36 |
| NFR-03 | 拟议质量目标 | NFR-PRD-03 | UC-04、UC-07、UC-08 | SD-B04、SD-B05、SD-I02、SD-I04 | 2.3、2.5、3.1、4.1、4.2 | UAT-02、UAT-06、UAT-27 |
| NFR-04 | 拟议质量目标 | NFR-PRD-04 | UC-01、UC-02 | SD-B02、SD-I01 | 1.2、4.1 | UAT-15 |

## 2. 验收场景入口

OpenSpec 场景与补充测试分析保留原 UAT ID。交付任务和测试条件见 [任务](../../openspec/changes/deliver-agentship-mvp/tasks.md) 及 [测试分析](../../openspec/changes/deliver-agentship-mvp/test-analysis.md)。历史原型结果单独归档在该变更的证据文件。

| BRD 验收 | 原关联要求 | OpenSpec 能力条款 | 测试分析条目 |
|---|---|---|---|
| UAT-01 新需求从启动到开发交付 | BR-01、BR-02、BR-03、BR-04、BR-05、BR-06、BR-08、BR-13、BR-14、BR-15、BR-16 | DW-06 | UAT-01 |
| UAT-02 Git 准备失败及恢复 | BR-02、BR-08、BR-11、NFR-03 | DW-03 | UAT-02 |
| UAT-03 开发测试失败与后续发布放行 | BR-06、BR-07、BR-08 | DW-05 | UAT-03 |
| UAT-04 节点配置多个 Agent | BR-09、BR-42、NFR-02 | DW-01 | UAT-04 |
| UAT-05 开发中与 Agent 对话 | BR-01、BR-10、BR-51 | LC-02 | UAT-05 |
| UAT-06 节点失败和重试 | BR-08、BR-11、NFR-02、NFR-03 | DW-06 | UAT-06 |
| UAT-07 权限隔离 | NFR-01 | WA-03 | UAT-07 |
| UAT-08 配置、选择并执行流程 | BR-08、BR-12、BR-15、BR-16、BR-17 | DW-01 | UAT-08 |
| UAT-09 已关联仓库的需求启动运行 | BR-02、BR-13、BR-14、BR-15、BR-16、NFR-02 | DW-03 | UAT-09 |
| UAT-10 启动信息缺失 | BR-13、BR-14、BR-15 | DW-02 | UAT-10 |
| UAT-11 流程修改后的运行追溯 | BR-08、BR-09、BR-12、BR-16、BR-17、BR-42、NFR-02 | DW-01 | UAT-11 |
| UAT-12 注册及校验 | BR-18、BR-19 | WA-01 | UAT-12 |
| UAT-13 登录与页面访问 | BR-20、BR-21 | WA-01 | UAT-13 |
| UAT-14 三类配置的负责人管理 | BR-22、BR-23、BR-24、NFR-01 | WA-02 | UAT-14 |
| UAT-15 账号资料保护 | NFR-04 | WA-01 | UAT-15 |
| UAT-16 已保存需求尚未关联仓库 | BR-02、BR-13、BR-14、BR-15、BR-16、NFR-02 | DW-03 | UAT-16 |
| UAT-17 已有仓库缺少 dev | BR-02、BR-16、NFR-02 | DW-03 | UAT-17 |
| UAT-18 移除副负责人后尝试保存 | BR-23、BR-24、BR-25、NFR-01 | WA-02 | UAT-18 |
| UAT-19 主负责人转交 | BR-23、BR-26 | WA-02 | UAT-19 |
| UAT-20 多个 Agent 参与同一节点 | BR-09、BR-27 | LC-01 | UAT-20 |
| UAT-21 单个 Agent 等待用户回复 | BR-27、BR-28 | LC-02 | UAT-21 |
| UAT-22 网页聊天连接本机 Codex CLI | BR-10、BR-29 | LC-04 | UAT-22 |
| UAT-23 同一聊天页面单人使用 | BR-10、BR-30、NFR-01 | LC-03 | UAT-23 |
| UAT-24 聊天页退出后立即释放 | BR-30 | LC-03 | UAT-24 |
| UAT-25 聊天页断网后保留占用 | BR-30、BR-31 | LC-03 | UAT-25 |
| UAT-26 同一用户打开多个聊天标签页 | BR-30 | LC-03 | UAT-26 |
| UAT-27 发起电脑关机后恢复运行 | BR-29、BR-32、NFR-03 | LC-04 | UAT-27 |
| UAT-28 需求默认仅创建者可见 | BR-01、BR-23、BR-24、BR-33、NFR-01 | WA-03 | UAT-28 |
| UAT-29 需求转交后原创建者失去查看权限 | BR-26、BR-33、NFR-01 | WA-03 | UAT-29 |
| UAT-30 需求发起权限 | BR-33、BR-34、NFR-01 | DW-02 | UAT-30 |
| UAT-31 节点内 Agent 的执行先后 | BR-09、BR-27、BR-35 | LC-01 | UAT-31 |
| UAT-32 需求副负责人无法参与运行聊天 | BR-36、NFR-01 | LC-03 | UAT-32 |
| UAT-33 待回复问题保留至回复或取消 | BR-28、BR-37 | LC-02 | UAT-33 |
| UAT-34 发起人取消待回复问题 | BR-28、BR-37 | LC-02 | UAT-34 |
| UAT-35 结束节点校验与运行完成 | BR-12、BR-16、BR-38 | DW-01 | UAT-35 |
| UAT-36 仅重试失败的 Agent | BR-11、BR-39、NFR-02 | LC-01 | UAT-36 |
| UAT-37 普通节点完成后才启动依赖节点 | BR-16、BR-17、BR-40 | DW-04 | UAT-37 |
| UAT-38 阶段按配置顺序执行 | BR-16、BR-41 | DW-04 | UAT-38 |
| UAT-39 结束节点等待所有并行路线 | BR-38、BR-41 | DW-04 | UAT-39 |
| UAT-40 同阶段节点未满足并行条件 | BR-41、BR-43 | DW-04 | UAT-40 |
| UAT-41 同一上游完成后并行 | BR-17、BR-40、BR-43 | DW-04 | UAT-41 |
| UAT-42 循环依赖校验 | BR-17、BR-44 | DW-01 | UAT-42 |
| UAT-43 根据条件选择路线 | BR-16、BR-45 | DW-05 | UAT-43 |
| UAT-44 条件分支必须配置两条路线 | BR-45 | DW-01 | UAT-44 |
| UAT-45 开发复查通过与后续发布条件 | BR-07、BR-46 | DW-05 | UAT-45 |
| UAT-46 未达上限时自动再次修复 | BR-46、BR-47 | DW-05 | UAT-46 |
| UAT-47 达到自动修复上限后等待人工 | BR-46、BR-47 | DW-05 | UAT-47 |
| UAT-48 达到上限后的人工操作 | BR-46、BR-47、BR-48 | DW-05 | UAT-48 |
| UAT-49 检查节点独立计算修复上限 | BR-47 | DW-05 | UAT-49 |
| UAT-50 检查缺少有效结果时等待人工 | BR-45、BR-49 | DW-05 | UAT-50 |
| UAT-51 启动后在需求阶段补齐描述 | BR-01、BR-13 | DW-02 | UAT-51 |
| UAT-52 工作类型共用有权使用的流程 | BR-14、BR-15、NFR-01 | DW-02 | UAT-52 |
| UAT-53 无需求阶段的流程启动前须填描述 | BR-01、BR-13 | DW-02 | UAT-53 |
| UAT-54 已有同名需求时选择原需求 | BR-13、BR-50、NFR-01 | WA-03 | UAT-54 |

| 补充验收 | 来源 | OpenSpec 能力条款 | 测试分析条目 |
|---|---|---|---|
| 三个以上所选子 Agent 和未选角色 | FR-AG-01～02、FR-AG-06 | LC-01 | EXT-01 |
| 旧设备租约和并发人工操作 | FR-RUN-04、FR-CHAT-02～05 | LC-04 | EXT-02 |
| 后续发布结果不明时的核对与恢复 | FR-DEL-04、NFR-PRD-03 | DW-05 | EXT-03 |

## 3. 业务规则追溯

| BRD 规则 | 原关联要求 | 原验收场景 |
|---|---|---|
| RULE-01 | BR-02 | UAT-01、UAT-02、UAT-09、UAT-16 |
| RULE-02 | BR-02、BR-11 | UAT-02 |
| RULE-03 | BR-06、BR-07 | UAT-03 |
| RULE-04 | BR-01、BR-09、BR-12、BR-16、BR-17 | UAT-04、UAT-11 |
| RULE-05 | BR-01、BR-10、BR-51 | UAT-05 |
| RULE-06 | BR-08、BR-11 | UAT-02、UAT-03、UAT-06 |
| RULE-07 | BR-13、BR-14、BR-15 | UAT-01、UAT-08、UAT-09、UAT-10、UAT-16、UAT-51、UAT-52、UAT-53 |
| RULE-08 | BR-16、BR-17、BR-40 | UAT-08、UAT-37 |
| RULE-09 | BR-20、BR-21 | UAT-13 |
| RULE-10 | BR-18、BR-19 | UAT-12 |
| RULE-11 | BR-22、BR-23、BR-24 | UAT-14 |
| RULE-12 | BR-02 | UAT-01、UAT-17 |
| RULE-13 | BR-25 | UAT-18 |
| RULE-14 | BR-26 | UAT-19 |
| RULE-15 | BR-27 | UAT-20 |
| RULE-16 | BR-28 | UAT-21 |
| RULE-17 | BR-29 | UAT-22 |
| RULE-18 | BR-30 | UAT-23、UAT-24、UAT-26 |
| RULE-19 | BR-31 | UAT-25 |
| RULE-20 | BR-32 | UAT-27 |
| RULE-21 | BR-01、BR-26、BR-33 | UAT-28、UAT-29 |
| RULE-22 | BR-34 | UAT-30 |
| RULE-23 | BR-35 | UAT-31 |
| RULE-24 | BR-36 | UAT-32 |
| RULE-25 | BR-37 | UAT-33、UAT-34 |
| RULE-26 | BR-38 | UAT-35、UAT-39 |
| RULE-27 | BR-39 | UAT-36 |
| RULE-28 | BR-41 | UAT-38 |
| RULE-29 | BR-42 | UAT-04、UAT-11 |
| RULE-30 | BR-43 | UAT-40、UAT-41 |
| RULE-31 | BR-44 | UAT-42 |
| RULE-32 | BR-45 | UAT-43、UAT-44 |
| RULE-33 | BR-07、BR-46 | UAT-45 |
| RULE-34 | BR-46、BR-47 | UAT-46、UAT-47、UAT-49 |
| RULE-35 | BR-48 | UAT-48 |
| RULE-36 | BR-45、BR-49 | UAT-50 |
| RULE-37 | BR-50 | UAT-54 |

## 4. 审查范围

- 51 条业务要求及 4 条质量要求均有产品、用例、设计、任务和 BRD 验收入口。54 个原 UAT 单独保留，37 条规则均能查到原验收。
- 额外验证覆盖三名以上按需选用的子 Agent、并发提交和旧任务回报。通过标准、责任与验证环境见测试分析。
- 待决事项按 PRD 第 13 节和 SA 第 5 节管理。首期验证发起人授予及撤销聊天权、真实 GitHub 和原机续跑。正式发布用例留待后续。
