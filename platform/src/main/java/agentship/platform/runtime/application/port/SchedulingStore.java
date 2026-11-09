package agentship.platform.runtime.application.port;

import agentship.platform.runtime.domain.SchedulingPolicy.Node;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface SchedulingStore {
    record Candidate(UUID run, UUID requirement) {}

    List<Candidate> initializationCandidates(UUID device);
    List<Node> nodes(Map<String, Object> run);
    void completeRun(Map<String, Object> run, Node end);
    void ready(Node node);
    List<Map<String, Object>> roles(Map<String, Object> run, Node node);
    void nodeState(Node node, String state);
    String checkBlocker(Map<String, Object> run, Node node);
    void queue(Map<String, Object> run, Node node, Map<String, Object> role, String kind);
    void updateRun(Map<String, Object> run, String state, String reason);
}
