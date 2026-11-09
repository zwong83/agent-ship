package agentship.platform.runtime.application.port;

import agentship.platform.catalog.api.RequirementEdits.Content;
import java.util.Map;
import java.util.UUID;

public interface ChatActionsStore {
    record NodeTarget(UUID run, UUID node, long wave) {}
    record Revision(NodeTarget node, UUID actor, UUID requirement, long revision, long sourceVersion, UUID execution) {
        public long next() { return revision + 1; }
    }

    boolean send(NodeTarget node, UUID actor, String role, String text, UUID message);
    boolean resolve(UUID run, UUID question, UUID actor, boolean reply, String text);
    Map<String, Object> failedRole(UUID run, UUID task);
    void retryRole(UUID task, long attemptNumber, UUID nextAttempt);
    void skipRole(UUID task, long attemptNumber, UUID actor);
    void resumeExecution(UUID execution);
    Map<String, Object> activeRequirement(NodeTarget node);
    Content proposal(Revision revision, UUID proposal);
    void addProposal(Revision revision, UUID proposal, Content content);
    void confirmProposal(Revision revision, UUID proposal);
    void recordRevision(Revision revision, Content content);
    void rejectStaleProposals(Revision revision);
    boolean canRerun(NodeTarget node);
    void rerun(NodeTarget node);
}
