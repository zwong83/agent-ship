package agentship.worker;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

interface GitProvider {
    record Repository(String provider, String repositoryId, String displayName, String defaultBranch) {
        Map<String,Object> view() { return Map.of("provider",provider,"repositoryId",repositoryId,"displayName",displayName,"defaultBranch",defaultBranch); }
    }
    @FunctionalInterface interface WriteGuard { void check() throws Exception; }
    Repository findRepository(String name, String requirementId, boolean requireMarker) throws Exception;
    void createRepository(String name, String requirementId, WriteGuard guard) throws Exception;
    String reference(Repository repository, String branch) throws Exception;
    void createReference(Repository repository, String branch, String commit, WriteGuard guard) throws Exception;
    final class Failure extends Exception {
        final String code;
        final boolean unknown;
        Failure(String code, boolean unknown) { super(code); this.code=code; this.unknown=unknown; }
    }
}
