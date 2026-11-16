package agentship.platform.runtime.application.query;

public final class AgentRunStatus {
    private AgentRunStatus() {}

    public static String message(String code) {
        if (code == null) return null;
        return switch (code) {
            case "AGENT_EXECUTION_FAILED" -> "Agent execution failed, please check the Codex connection and task settings on the initiating computer.";
            case "AGENT_RESUME_REQUIRED" -> "The original Codex execution results have not yet been confirmed and require manual inspection before continuing.";
            case "AGENT_QUESTION_PENDING" -> "Agent has questions to answer, and the current node is waiting for manual reply.";
            case "AGENT_CHECK_UNRESOLVED" -> "The check lacks verifiable results and the associated route is pending.";
            case "AGENT_REPAIR_REQUIRED" -> "The inspection result is that it needs to be repaired, and the relevant routes are waiting for processing.";
            case "AGENT_REPAIR_LIMIT_REACHED" -> "Automatic repair has reached the upper limit, and the relevant routes are waiting for manual processing.";
            case "RUN_STOPPED_BY_OPERATOR" -> "The current operator has stopped this run.";
            case "AGENT_ARTIFACT_CONFLICT" -> "The coordinator failed to resolve product conflicts, and the current node is waiting for manual processing.";
            case "AGENT_ARTIFACT_REQUIRED" -> "The Agent has not delivered a valid product, and the dependent node continues to wait.";
            case "AGENT_REQUIREMENT_REQUIRED" -> "Please complete the requirement description at the requirement node before continuing.";
            case "AGENT_ROLE_MISSING" -> "The process snapshot lacks the coordinator and the process configuration needs to be checked.";
            case "AGENT_PUBLICATION_UNAVAILABLE" -> "Release execution has not yet been enabled in the current environment.";
            default -> null;
        };
    }
}
