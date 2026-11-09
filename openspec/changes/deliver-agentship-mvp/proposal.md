## Why

AgentShip 需要按 BRD v0.57 和 PRD v0.8 完成开发环境的首期规格，使需求配置、运行中协作、外部执行和断点恢复具备可独立验收的边界。现有本机原型提供历史行为证据，目标技术栈为 React + TypeScript、Java Spring Boot、PostgreSQL 和 Java 本机执行程序。

## What Changes

- 支持开放注册、双联系方式验证、邮箱或用户名登录、资料隔离与三类配置负责人。需求名称全平台唯一，流程及 Agent 副负责人按角色获得相应使用权。
- 支持阶段与节点依赖、按需选择子 Agent、启动时流程快照和四种工作类型。校验启动后才准备 Git，交付看板保留节点状态、产物与失败处理。
- 支持多 Agent 定向协作、单标签页操作权和发起人管理聊天权限。在 BRD 阶段由发起人确认需求变更，保留在途节点的原版本。开发流程支持跨阶段修复、复查和局部暂停。发起电脑恢复后沿用原会话或保存进度。
- 保留 54 条 UAT 和 3 条 EXT 的规格和测试追溯。确定性回归与真实开发环境验收分别留证。

## Capabilities

### New Capabilities

- `workspace-access`：账号、资料保护、配置所有权和按权限选择。
- `delivery-workflow`：流程校验与快照、启动和 GitHub、阶段执行、公开产物归档及检查修复。
- `local-agent-collaboration`：设备绑定、多个 Agent、问答、聊天操作权和同次恢复。

### Modified Capabilities

本变更声明三项新增能力。按批次实现账号与配置、Git 和节点执行、检查修复、操作权，以及定向消息、需求修订和交付归档。

## Source baseline

| 来源 | 版本与采用范围 |
|---|---|
| [BRD](../../../output/BRD/AgentShip/BRD-AgentShip.md) 与 [PRD](../../../output/PRD/PRD-AgentShip.md) | BRD v0.57 的已确认规则与拟议验收，PRD v0.8 的 39 项功能和补充验收。 |
| [SA](../../../output/SA/SA-AgentShip.md) 与 [SD](../../../output/SD/SD-AgentShip-index.md) | v0.5 的用例、系统规则、技术约束与逐功能图。技术栈与首期开发环境范围已确认，SA/SD 与具体开发验收环境待评审。 |
| [功能图索引](../../../output/SD/AgentShip-Function-Diagrams.md) | 每个 PRD 功能对应一对 `SA-FR-*` 业务图及 `SD-FR-*` 技术图。共享总览、数据图与中间件拓扑补充跨功能约束。 |
| [API 设计契约](../../../output/SD/contracts/agentship-v1.json) | v1.0.0-draft.13 平台、浏览器与本机执行程序候选契约。首批接口按适用操作实施。 |

用户授权按现有文档实施首批代码，随后授权各批开发，并要求继续完成剩余事项。实现使用 SA、SD、接口契约与 OpenSpec 规格约束。设计签署和真实环境操作许可分别跟踪。实际执行和限制见 [验证记录](evidence.md) 与 [补充测试分析](test-analysis.md)。

## Out of scope

正式发布、生产放行和回退留到后续。UAT-03 与 UAT-45 保留首期测试、复查分区和后续正式发布分区，EXT-03 只用于后续正式发布结果核对。首期真实外部验收限定开发环境下的 GitHub 与 Codex。

## Impact

交付面包括静态 Web、平台 API、PostgreSQL 数据、Java 本机执行程序和外部适配。数据约束、访问路径及迁移以 [数据设计](../../../output/SD/SD-AgentShip-data.md) 和 [设计 SQL](../../../output/SD/data/) 为准。服务入口、数据库连接、任务队列和运行验证以 [中间件设计 SD-M01～02](../../../output/SD/SD-AgentShip-middleware.md) 为准。历史原型、目标栈本地回归与真实开发环境验收分别留证。首期真实验收的执行条件和范围见 [任务 4.2](tasks.md)。
