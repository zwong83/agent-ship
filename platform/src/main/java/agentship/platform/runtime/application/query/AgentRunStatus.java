package agentship.platform.runtime.application.query;

public final class AgentRunStatus {
    private AgentRunStatus() {}

    public static String message(String code) {
        if (code == null) return null;
        return switch (code) {
            case "AGENT_EXECUTION_FAILED" -> "Agent 执行失败，请在发起电脑检查 Codex 连接和任务设置。";
            case "AGENT_RESUME_REQUIRED" -> "原 Codex 执行结果尚未确认，需要人工检查后继续。";
            case "AGENT_QUESTION_PENDING" -> "Agent 有待答问题，当前节点等待人工回复。";
            case "AGENT_CHECK_UNRESOLVED" -> "检查缺少可核对的结果，相关路线等待处理。";
            case "AGENT_REPAIR_REQUIRED" -> "检查结果为需修复，相关路线等待处理。";
            case "AGENT_REPAIR_LIMIT_REACHED" -> "自动修复已达上限，相关路线等待人工处理。";
            case "RUN_STOPPED_BY_OPERATOR" -> "当前操作者已停止本次运行。";
            case "AGENT_ARTIFACT_CONFLICT" -> "协调 Agent 未能解决产物冲突，当前节点等待人工处理。";
            case "AGENT_ARTIFACT_REQUIRED" -> "Agent 未交付有效产物，依赖节点继续等待。";
            case "AGENT_REQUIREMENT_REQUIRED" -> "请在需求节点补齐需求说明后继续。";
            case "AGENT_ROLE_MISSING" -> "流程快照缺少协调 Agent，需要检查流程配置。";
            case "AGENT_PUBLICATION_UNAVAILABLE" -> "当前环境尚未开启发布执行。";
            default -> null;
        };
    }
}
