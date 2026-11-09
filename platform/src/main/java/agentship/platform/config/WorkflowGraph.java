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
    record Node(UUID id, String name, String type, String purpose, List<UUID> dependencies,
                UUID coordinatorId, List<UUID> agentIds, String agentOrder, CheckRoutes checkRoutes, Route route) {}

    record CheckRoutes(UUID passNodeId, UUID repairNodeId, int automaticRepairLimit) {}
    record Route(UUID checkNodeId, String outcome) {}
    private record Located(Node node, int stage) {}

    static WorkflowGraph parse(JsonNode data) {
        fields(data, Set.of("stages"), "流程");
        List<Stage> stages = new ArrayList<>();
        Set<UUID> stageIds = new HashSet<>();
        for (JsonNode rawStage : array(data.get("stages"), "阶段")) {
            fields(rawStage, Set.of("id", "name", "nodes"), "阶段");
            UUID stageId = uuid(rawStage.get("id"), "阶段标识");
            if (!stageIds.add(stageId)) throw invalid("阶段标识重复");
            List<Node> nodes = new ArrayList<>();
            for (JsonNode rawNode : array(rawStage.get("nodes"), "节点")) nodes.add(parseNode(rawNode));
            if (nodes.isEmpty()) throw invalid("每个阶段至少添加一个节点");
            stages.add(new Stage(stageId, name(rawStage.get("name"), "阶段名称"), List.copyOf(nodes)));
        }
        if (stages.isEmpty()) throw invalid("至少添加一个阶段，并在末尾设置结束节点");
        var graph = new WorkflowGraph(List.copyOf(stages));
        graph.validate();
        return graph;
    }

    private static Node parseNode(JsonNode raw) {
        fields(raw, Set.of("id", "name", "type", "purpose", "dependencies", "coordinatorId", "agentIds",
                "agentOrder", "checkRoutes", "route", "publication"), "节点");
        UUID id = uuid(raw.get("id"), "节点标识");
        String name = name(raw.get("name"), "节点名称");
        String type = choice(raw.get("type"), Set.of("work", "check", "publish", "end"), "节点类型");
        if (type.equals("publish") || raw.has("publication")) {
            throw invalid("当前开发版本不支持正式发布节点及发布目标");
        }
        List<UUID> dependencies = ids(raw.get("dependencies"), "依赖节点").stream()
                .sorted(java.util.Comparator.comparing(UUID::toString)).toList();
        if (type.equals("end")) {
            if (raw.has("coordinatorId") || raw.has("agentOrder") || raw.has("purpose")
                    || raw.has("checkRoutes") || raw.has("route")
                    || (raw.has("agentIds") && !ids(raw.get("agentIds"), "子 Agent").isEmpty())) {
                throw invalid("结束节点只标记完成，不能配置 Agent、用途或条件路线");
            }
            return new Node(id, name, type, null, dependencies, null, null, null, null, null);
        }
        String purpose = raw.has("purpose") ? choice(raw.get("purpose"),
                Set.of("requirement", "product", "frontend", "backend", "test", "repair", "other"), "节点用途") : null;
        UUID coordinator = uuid(raw.get("coordinatorId"), "协调 Agent");
        List<UUID> agents = raw.has("agentIds") ? ids(raw.get("agentIds"), "子 Agent") : List.of();
        if (agents.contains(coordinator)) throw invalid("协调 Agent 与子 Agent 不能重复");
        String order = raw.has("agentOrder") ? choice(raw.get("agentOrder"), Set.of("parallel", "serial"), "Agent 顺序") : "parallel";
        CheckRoutes routes = null;
        if (type.equals("check")) {
            JsonNode value = raw.get("checkRoutes");
            fields(value, Set.of("passNodeId", "repairNodeId", "automaticRepairLimit"), "检查路线");
            UUID pass = uuid(value.get("passNodeId"), "通过路线入口");
            UUID repair = uuid(value.get("repairNodeId"), "需修复路线入口");
            JsonNode limit = value.get("automaticRepairLimit");
            if (limit == null || !limit.isIntegralNumber() || !limit.canConvertToInt() || limit.intValue() < 0) {
                throw invalid("自动修复上限须为大于等于 0 的整数");
            }
            if (pass.equals(repair) || pass.equals(id) || repair.equals(id)) throw invalid("检查两条路线须指向不同的其他执行节点");
            routes = new CheckRoutes(pass, repair, limit.intValue());
        } else if (raw.has("checkRoutes")) {
            throw invalid("只有检查节点可以配置条件路线");
        }
        Route route = null;
        if (raw.has("route")) {
            JsonNode value = raw.get("route");
            fields(value, Set.of("checkNodeId", "outcome"), "路线归属");
            route = new Route(uuid(value.get("checkNodeId"), "路线检查节点"),
                    choice(value.get("outcome"), Set.of("pass", "repair"), "路线结果"));
        }
        return new Node(id, name, type, purpose, dependencies, coordinator, agents, order, routes, route);
    }

    private void validate() {
        Map<UUID, Located> nodes = new LinkedHashMap<>();
        int endCount = 0;
        for (int stage = 0; stage < stages.size(); stage++) {
            for (Node node : stages.get(stage).nodes()) {
                if (nodes.putIfAbsent(node.id(), new Located(node, stage)) != null) throw invalid("节点标识重复");
                if (node.type().equals("end")) endCount++;
            }
        }
        if (endCount != 1 || !stages.getLast().nodes().getLast().type().equals("end")) {
            throw invalid("流程末尾必须有且只有一个结束节点");
        }
        for (Located located : nodes.values()) {
            Node node = located.node();
            for (UUID dependency : node.dependencies()) {
                Located parent = nodes.get(dependency);
                if (parent == null || parent.node().type().equals("end")) throw invalid(node, "依赖节点不存在或引用了结束节点");
            }
            if (node.checkRoutes() != null) {
                requireEntry(nodes, node, node.checkRoutes().passNodeId(), "pass");
                requireEntry(nodes, node, node.checkRoutes().repairNodeId(), "repair");
            }
            if (node.route() != null) {
                Located check = nodes.get(node.route().checkNodeId());
                if (check == null || !check.node().type().equals("check") || check.node().id().equals(node.id())) {
                    throw invalid(node, "条件路线必须引用流程内的其他检查节点");
                }
                if (node.route().outcome().equals("pass") && located.stage() < check.stage()) {
                    throw invalid(node, "通过路线不能回到更早阶段");
                }
            }
        }
        validateDependencies(nodes);
        for (Located located : nodes.values()) for (UUID dependency : located.node().dependencies()) {
            if (nodes.get(dependency).stage() > located.stage()) {
                throw invalid(located.node(), "常规依赖不能指向更晚阶段");
            }
        }
    }

    private static void requireEntry(Map<UUID, Located> nodes, Node check, UUID id, String outcome) {
        Located entry = nodes.get(id);
        if (entry == null || entry.node().type().equals("end")) throw invalid(check, "检查路线入口必须为流程内的执行节点");
        if (!new Route(check.id(), outcome).equals(entry.node().route())) {
            throw invalid(check, "检查路线入口的归属与检查结果不一致");
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
                        throw invalid(node, "需修复路线的产物只能作为同一修复路线的常规依赖");
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
            throw invalid(nodes.get(involved).node(), "有循环依赖，请检查节点依赖和条件路线");
        }
    }

    private static void requireOutcome(Node node, Map<UUID, String> required, UUID check, String outcome) {
        String previous = required.putIfAbsent(check, outcome);
        if (previous != null && !previous.equals(outcome)) {
            throw invalid(node, "依赖同时要求互斥的通过和需修复路线，无法满足产物条件");
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
        if (value == null || !value.isObject()) throw invalid(label + "配置不完整");
        value.fieldNames().forEachRemaining(field -> {
            if (!allowed.contains(field)) throw invalid(label + "包含不支持的字段");
        });
    }

    private static JsonNode array(JsonNode value, String label) {
        if (value == null || !value.isArray()) throw invalid(label + "须为列表");
        return value;
    }

    private static List<UUID> ids(JsonNode value, String label) {
        List<UUID> result = new ArrayList<>();
        Set<UUID> unique = new HashSet<>();
        for (JsonNode item : array(value, label)) {
            UUID id = uuid(item, label);
            if (!unique.add(id)) throw invalid(label + "标识重复");
            result.add(id);
        }
        return List.copyOf(result);
    }

    private static UUID uuid(JsonNode value, String label) {
        if (value == null || !value.isTextual()) throw invalid(label + "无效");
        try {
            UUID id = UUID.fromString(value.textValue());
            if (!id.toString().equalsIgnoreCase(value.textValue())) throw invalid(label + "无效");
            return id;
        } catch (IllegalArgumentException invalidId) {
            throw invalid(label + "无效");
        }
    }

    private static String name(JsonNode value, String label) {
        if (value == null || !value.isTextual() || value.textValue().isBlank()
                || value.textValue().indexOf(0) >= 0
                || value.textValue().codePointCount(0, value.textValue().length()) > 120) {
            throw invalid(label + "不能为空且最长 120 字符");
        }
        return value.textValue().strip();
    }

    private static String choice(JsonNode value, Set<String> allowed, String label) {
        if (value == null || !value.isTextual() || !allowed.contains(value.textValue())) throw invalid(label + "无效");
        return value.textValue();
    }

    private static ApiProblem invalid(String message) {
        return new ApiProblem(400, "INVALID_REQUEST", message);
    }

    private static ApiProblem invalid(Node node, String message) {
        return new ApiProblem(400, "INVALID_REQUEST", "节点「" + node.name() + "」" + message,
                Map.of("nodeId", node.id().toString(), "nodeName", node.name()));
    }
}
