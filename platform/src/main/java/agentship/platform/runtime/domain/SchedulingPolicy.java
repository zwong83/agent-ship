package agentship.platform.runtime.domain;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public final class SchedulingPolicy {
    private static final Set<String> SETTLED = Set.of("complete", "skipped");

    private SchedulingPolicy() {}

    public record Node(UUID id, UUID execution, int stage, int wave, String kind, String purpose, String order, String state,
                long revision, UUID check, String route, String checkOutcome, String cycleState, List<UUID> dependencies) {
        public boolean settled() {
            return SETTLED.contains(state);
        }

        public boolean active() {
            return !settled() && !"blocked".equals(state);
        }
    }

    public record Activation(List<Node> active, List<Node> ready) {}

    public static Activation select(List<Node> nodes, List<Node> work, Set<UUID> checksUnderRepair) {
        Map<UUID, Node> byId = new HashMap<>();
        nodes.forEach(node -> byId.put(node.id(), node));
        Map<UUID, List<Node>> scopes = new LinkedHashMap<>();
        for (Node node : work) {
            if (!node.settled() && routeOpen(node, byId)) {
                UUID scope = repairScope(node, byId, checksUnderRepair);
                scopes.computeIfAbsent(scope, key -> new ArrayList<>()).add(node);
            }
        }
        List<Node> active = new ArrayList<>();
        List<Node> ready = new ArrayList<>();
        for (var scope : scopes.values()) active.addAll(readyScope(scope, byId, checksUnderRepair, ready));
        return new Activation(active, ready);
    }

    private static List<Node> readyScope(List<Node> scope, Map<UUID, Node> byId, Set<UUID> repairs, List<Node> ready) {
        int stage = scope.stream().mapToInt(Node::stage).min().orElseThrow();
        List<Node> current = scope.stream().filter(node -> node.stage() == stage).toList();
        List<Node> active = new ArrayList<>(current.stream().filter(Node::active).toList());
        for (Node node : current) {
            if (node.active() || !node.dependencies().stream().allMatch(id -> byId.get(id).settled()
                    || repairs.contains(id) && inRepairSubtree(node, id, byId))) continue;
            // A capped check remains a stage barrier, but it no longer competes for execution in this stage.
            if (!active.stream().filter(other -> !"limit_reached".equals(other.cycleState()))
                    .allMatch(other -> sharesCompletedDependency(node, other, byId))) continue;
            ready.add(node);
            active.add(node);
        }
        return active;
    }

    private static boolean routeOpen(Node node, Map<UUID, Node> byId) {
        for (var current = node; current != null && current.check() != null; current = byId.get(current.check())) {
            if (!current.route().equals(current.checkOutcome())) return false;
        }
        return true;
    }

    private static UUID repairScope(Node node, Map<UUID, Node> byId, Set<UUID> repairs) {
        for (var current = node; current != null && current.check() != null; current = byId.get(current.check())) {
            if ("repair".equals(current.route()) && repairs.contains(current.check())) return current.check();
        }
        return null;
    }

    private static boolean sharesCompletedDependency(Node first, Node second, Map<UUID, Node> byId) {
        return first.dependencies().stream().anyMatch(id ->
                second.dependencies().contains(id) && "complete".equals(byId.get(id).state()));
    }

    public static boolean inRepairSubtree(Node node, UUID check, Map<UUID, Node> byId) {
        for (var current = node; current != null && current.check() != null; current = byId.get(current.check())) {
            if (check.equals(current.check())) return "repair".equals(current.route());
        }
        return false;
    }
}
