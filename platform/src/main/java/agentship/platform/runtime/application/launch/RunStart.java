package agentship.platform.runtime.application.launch;

import agentship.platform.web.ApiProblem;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;
import java.util.UUID;

record RunStart(UUID requirementId, long requirementVersion, UUID workflowId, long workflowVersion,
                String workType, String githubNamespace, JsonNode deviceProof) {
    static RunStart parse(JsonNode body) {
        if (body == null || !body.isObject()) throw ApiProblem.invalid();
        Set<String> fields = Set.of("requirementId","requirementVersion","workflowId","workflowVersion",
                "workType","githubNamespace","deviceProof");
        body.fieldNames().forEachRemaining(field -> { if (!fields.contains(field)) throw ApiProblem.invalid(); });
        String type = text(body,"workType");
        if (!Set.of("feature","refactor","hotfix","fix").contains(type)) throw ApiProblem.invalid();
        String namespace = body.has("githubNamespace") ? text(body,"githubNamespace") : null;
        if (namespace != null && !namespace.matches("[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?")) {
            throw new ApiProblem(400,"INVALID_REQUEST","请填写有效的 GitHub 用户名或组织名");
        }
        JsonNode proof = body.get("deviceProof");
        if (proof == null || !proof.isObject()) throw ApiProblem.invalid();
        return new RunStart(id(body,"requirementId"),version(body,"requirementVersion"),
                id(body,"workflowId"),version(body,"workflowVersion"),type,namespace,proof.deepCopy());
    }

    private static String text(JsonNode node,String field) {
        JsonNode value=node.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) throw ApiProblem.invalid();
        return value.textValue();
    }
    private static UUID id(JsonNode node,String field) {
        String value=text(node,field);
        try {
            UUID id=UUID.fromString(value);
            if (!id.toString().equalsIgnoreCase(value)) throw ApiProblem.invalid();
            return id;
        } catch (IllegalArgumentException invalid) { throw ApiProblem.invalid(); }
    }
    private static long version(JsonNode node,String field) {
        JsonNode value=node.get(field);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong() || value.longValue()<1) throw ApiProblem.invalid();
        return value.longValue();
    }
}
