package agentship.platform.config;

import agentship.platform.web.ApiProblem;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

record WorkflowGraph(List<WorkflowGraph.Stage> stages) {
    record Stage(UUID id, String name, List<Node> nodes) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Node(UUID id, String name, String type, String purpose, boolean collectRequirements, List<UUID> dependencies,
                UUID coordinatorId, List<UUID> agentIds, String agentOrder, CheckRoutes checkRoutes, Route route) {}

    record CheckRoutes(UUID passNodeId, UUID repairNodeId, int automaticRepairLimit) {}
    record Route(UUID checkNodeId, String outcome) {}
    private record Located(Node node, int stage) {}

    static WorkflowGraph parse(JsonNode data) {
        fields(data, Set.of("stages"), "process");
        List<Stage> stages = new ArrayList<>();
        Set<UUID> stageIds = new HashSet<>();
        for (JsonNode rawStage : array(data.get("stages"), "Stage")) {
            fields(rawStage, Set.of("id", "name", "nodes"), "Stage");
            UUID stageId = uuid(rawStage.get("id"), "stage identification");
            if (!stageIds.add(stageId)) throw invalid("Duplicate stage identifier");
            List<Node> nodes = new ArrayList<>();
            for (JsonNode rawNode : array(rawStage.get("nodes"), "Node")) nodes.add(parseNode(rawNode));
            if (nodes.isEmpty()) throw invalid("Add at least one node per stage");
            stages.add(new Stage(stageId, name(rawStage.get("name"), "Stage name"), List.copyOf(nodes)));
        }
        if (stages.isEmpty()) throw invalid("Add at least one stage and set an end node at the end");
        var graph = new WorkflowGraph(List.copyOf(stages));
        graph.validate();
        return graph;
    }

    private static Node parseNode(JsonNode raw) {
        fields(raw, Set.of("id", "name", "type", "purpose", "dependencies", "coordinatorId", "agentIds",
                "agentOrder", "checkRoutes", "route", "publication", "collectRequirements"), "Node");
        UUID id = uuid(raw.get("id"), "Node ID");
        String name = name(raw.get("name"), "Node name");
        String type = choice(raw.get("type"), Set.of("work", "check", "publish", "end"), "Node type");
        if (type.equals("publish") || raw.has("publication")) {
            throw invalid("The current development version does not support official release nodes and release targets.");
        }
        List<UUID> dependencies = ids(raw.get("dependencies"), "Dependency node").stream()
                .sorted(java.util.Comparator.comparing(UUID::toString)).toList();
        if (raw.has("collectRequirements") && !raw.get("collectRequirements").isBoolean()) throw invalid("Gather requirement details must be true or false");
        if (type.equals("end")) {
            if (raw.has("coordinatorId") || raw.has("agentOrder") || raw.has("purpose") || raw.path("collectRequirements").asBoolean(false)
                    || raw.has("checkRoutes") || raw.has("route")
                    || (raw.has("agentIds") && !ids(raw.get("agentIds"), "Sub-agent").isEmpty())) {
                throw invalid("The end node is only marked as completed and cannot be configured with agents, requirement gathering or conditional routes.");
            }
            return new Node(id, name, type, null, false, dependencies, null, null, null, null, null);
        }
        String purpose = raw.has("purpose") ? choice(raw.get("purpose"),
                Set.of("requirement", "product", "frontend", "backend", "test", "repair", "other"), "Node purpose") : null;
        boolean collectRequirements = raw.has("collectRequirements") ? raw.get("collectRequirements").booleanValue() : "requirement".equals(purpose);
        UUID coordinator = uuid(raw.get("coordinatorId"), "Coordinator");
        List<UUID> agents = raw.has("agentIds") ? ids(raw.get("agentIds"), "Sub-agent") : List.of();
        if (agents.contains(coordinator)) throw invalid("Coordinating Agent and sub-Agent cannot be duplicated");
        String order = raw.has("agentOrder") ? choice(raw.get("agentOrder"), Set.of("parallel", "serial"), "Agent order") : "parallel";
        CheckRoutes routes = null;
        if (type.equals("check")) {
            JsonNode value = raw.get("checkRoutes");
            fields(value, Set.of("passNodeId", "repairNodeId", "automaticRepairLimit"), "Check route");
            UUID pass = uuid(value.get("passNodeId"), "via route entrance");
            UUID repair = uuid(value.get("repairNodeId"), "Route entrance needs to be repaired");
            JsonNode limit = value.get("automaticRepairLimit");
            if (limit == null || !limit.isIntegralNumber() || !limit.canConvertToInt() || limit.intValue() < 0) {
                throw invalid("The upper limit of automatic repair must be an integer greater than or equal to 0");
            }
            if (pass.equals(repair) || pass.equals(id) || repair.equals(id)) throw invalid("Check that the two routes must point to different other execution nodes");
            routes = new CheckRoutes(pass, repair, limit.intValue());
        } else if (raw.has("checkRoutes")) {
            throw invalid("Only check nodes can configure conditional routes");
        }
        Route route = null;
        if (raw.has("route")) {
            JsonNode value = raw.get("route");
            fields(value, Set.of("checkNodeId", "outcome"), "Route ownership");
            route = new Route(uuid(value.get("checkNodeId"), "route check node"),
                    choice(value.get("outcome"), Set.of("pass", "repair"), "route results"));
        }
        return new Node(id, name, type, purpose, collectRequirements, dependencies, coordinator, agents, order, routes, route);
    }

    private void validate() {
        Map<UUID, Located> nodes = new LinkedHashMap<>();
        int endCount = 0;
        for (int stage = 0; stage < stages.size(); stage++) {
            for (Node node : stages.get(stage).nodes()) {
                if (nodes.putIfAbsent(node.id(), new Located(node, stage)) != null) throw invalid("Duplicate node ID");
                if (node.type().equals("end")) endCount++;
            }
        }
        if (endCount != 1 || !stages.getLast().nodes().getLast().type().equals("end")) {
            throw invalid("There must be and only one end node at the end of the process");
        }
        for (Located located : nodes.values()) {
            Node node = located.node();
            for (UUID dependency : node.dependencies()) {
                Located parent = nodes.get(dependency);
                if (parent == null || parent.node().type().equals("end")) throw invalid(node, "The dependent node does not exist or refers to the end node");
            }
            if (node.checkRoutes() != null) {
                requireEntry(nodes, node, node.checkRoutes().passNodeId(), "pass");
                requireEntry(nodes, node, node.checkRoutes().repairNodeId(), "repair");
            }
            if (node.route() != null) {
                Located check = nodes.get(node.route().checkNodeId());
                if (check == null || !check.node().type().equals("check") || check.node().id().equals(node.id())) {
                    throw invalid(node, "Conditional routes must reference other check nodes within the process");
                }
                if (node.route().outcome().equals("pass") && located.stage() < check.stage()) {
                    throw invalid(node, "Passing a route cannot go back to an earlier stage");
                }
            }
        }
        validateDependencies(nodes);
        for (Located located : nodes.values()) for (UUID dependency : located.node().dependencies()) {
            if (nodes.get(dependency).stage() > located.stage()) {
                throw invalid(located.node(), "Regular dependencies cannot point to later stages");
            }
        }
    }

    private static void requireEntry(Map<UUID, Located> nodes, Node check, UUID id, String outcome) {
        Located entry = nodes.get(id);
        if (entry == null || entry.node().type().equals("end")) throw invalid(check, "Check that the route entry must be an execution node within the process");
        if (!new Route(check.id(), outcome).equals(entry.node().route())) {
            throw invalid(check, "The ownership of the check route entrance is inconsistent with the check result");
        }
    }

    private static void validateDependencies(Map<UUID, Located> nodes) {
        Map<UUID, Set<UUID>> pending = new LinkedHashMap<>();
        Map<UUID, List<UUID>> successors = new HashMap<>();
        for (Located located : nodes.values()) {
            Node node = located.node();
            Set<UUID> predecessors = new HashSet<>(node.dependencies());
            if (node.route() != null) predecessors.add(node.route().checkNodeId());
            pending.put(node.id(), predecessors);
            for (UUID predecessor : predecessors) successors.computeIfAbsent(predecessor, ignored -> new ArrayList<>()).add(node.id());
        }
        ArrayDeque<UUID> ready = new ArrayDeque<>();
        pending.forEach((id, predecessors) -> { if (predecessors.isEmpty()) ready.add(id); });
        Map<UUID, Map<UUID, String>> requiredRoutes = new HashMap<>();
        int visited = 0;
        while (!ready.isEmpty()) {
            UUID id = ready.removeFirst();
            Node node = nodes.get(id).node();
            Map<UUID, String> requirements = new HashMap<>();
            if (node.route() != null) {
                requirements.putAll(requiredRoutes.get(node.route().checkNodeId()));
                requireOutcome(node, requirements, node.route().checkNodeId(), node.route().outcome());
            }
            Map<UUID, String> activation = Map.copyOf(requirements);
            for (UUID dependency : node.dependencies()) {
                for (var requirement : requiredRoutes.get(dependency).entrySet()) {
                    requireOutcome(node, requirements, requirement.getKey(), requirement.getValue());
                    if (requirement.getValue().equals("repair")
                            && !"repair".equals(activation.get(requirement.getKey()))) {
                        throw invalid(node, "The products of the repair route can only be used as regular dependencies on the same repair route.");
                    }
                }
            }
            requiredRoutes.put(id, requirements);
            visited++;
            for (UUID successor : successors.getOrDefault(id, List.of())) {
                if (pending.get(successor).remove(id) && pending.get(successor).isEmpty()) ready.add(successor);
            }
        }
        if (visited != nodes.size()) {
            UUID involved = pending.entrySet().stream().filter(entry -> !entry.getValue().isEmpty()).findFirst().orElseThrow().getKey();
            throw invalid(nodes.get(involved).node(), "There are circular dependencies, please check node dependencies and conditional routes");
        }
    }

    private static void requireOutcome(Node node, Map<UUID, String> required, UUID check, String outcome) {
        String previous = required.putIfAbsent(check, outcome);
        if (previous != null && !previous.equals(outcome)) {
            throw invalid(node, "Dependence requires mutually exclusive pass and repair routes at the same time, unable to meet product conditions");
        }
    }

    Set<UUID> agentIds() {
        Set<UUID> ids = new HashSet<>();
        for (Stage stage : stages) for (Node node : stage.nodes()) {
            if (node.coordinatorId() != null) ids.add(node.coordinatorId());
            if (node.agentIds() != null) ids.addAll(node.agentIds());
        }
        return ids;
    }

    private static void fields(JsonNode value, Set<String> allowed, String label) {
        if (value == null || !value.isObject()) throw invalid(label + "Incomplete configuration");
        value.fieldNames().forEachRemaining(field -> {
            if (!allowed.contains(field)) throw invalid(label + "Contains unsupported fields");
        });
    }

    private static JsonNode array(JsonNode value, String label) {
        if (value == null || !value.isArray()) throw invalid(label + "Must be a list");
        return value;
    }

    private static List<UUID> ids(JsonNode value, String label) {
        List<UUID> result = new ArrayList<>();
        Set<UUID> unique = new HashSet<>();
        for (JsonNode item : array(value, label)) {
            UUID id = uuid(item, label);
            if (!unique.add(id)) throw invalid(label + "Identity duplicate");
            result.add(id);
        }
        return List.copyOf(result);
    }

    private static UUID uuid(JsonNode value, String label) {
        if (value == null || !value.isTextual()) throw invalid(label + "invalid");
        try {
            UUID id = UUID.fromString(value.textValue());
            if (!id.toString().equalsIgnoreCase(value.textValue())) throw invalid(label + "invalid");
            return id;
        } catch (IllegalArgumentException invalidId) {
            throw invalid(label + "invalid");
        }
    }

    private static String name(JsonNode value, String label) {
        if (value == null || !value.isTextual() || value.textValue().isBlank()
                || value.textValue().indexOf(0) >= 0
                || value.textValue().codePointCount(0, value.textValue().length()) > 120) {
            throw invalid(label + "Cannot be empty and can be up to 120 characters");
        }
        return value.textValue().strip();
    }

    private static String choice(JsonNode value, Set<String> allowed, String label) {
        if (value == null || !value.isTextual() || !allowed.contains(value.textValue())) throw invalid(label + "invalid");
        return value.textValue();
    }

    private static ApiProblem invalid(String message) {
        return new ApiProblem(400, "INVALID_REQUEST", message);
    }

    private static ApiProblem invalid(Node node, String message) {
        return new ApiProblem(400, "INVALID_REQUEST", "node\"" + node.name() + "”" + message,
                Map.of("nodeId", node.id().toString(), "nodeName", node.name()));
    }
}
