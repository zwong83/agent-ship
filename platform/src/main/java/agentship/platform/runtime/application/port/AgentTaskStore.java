package agentship.platform.runtime.application.port;

import agentship.platform.runtime.application.port.WorkerTaskStore.TaskContext;
import agentship.platform.runtime.domain.SchedulingPolicy.Node;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface AgentTaskStore {
    boolean claimable(TaskContext context);
    void pinRevision(TaskContext context);
    Map<String, Object> dispatchDetails(UUID task);
    List<UUID> dependencies(Map<String, Object> run, Object node);
    List<Map<String, Object>> upstream(TaskContext context);
    List<Map<String, Object>> siblings(TaskContext context);
    void pinCheckCandidate(TaskContext context, Map<String, Object> node, Map<String, Object> candidate);
    Map<String, Object> checkCandidate(TaskContext context, Object node, Object wave);
    void progress(TaskContext context, String thread, String checkpoint);
    UUID saveArtifact(TaskContext context, String kind, String title, String source, byte[] digest, String commit);
    void recordCheck(TaskContext context, Node node, String outcome, String commit, String version, String reason, UUID artifact);
    void skipRepairBranch(TaskContext context, Node node);
    boolean hasDescription(TaskContext context);
    void fail(TaskContext context, String code);
    void awaitReply(TaskContext context);
    void nodeState(TaskContext context, String state);
}
