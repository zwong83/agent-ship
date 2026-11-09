package agentship.platform.runtime.application.execution;

import agentship.platform.device.api.WorkerDevices;
import agentship.platform.runtime.application.port.RunLocks;
import agentship.platform.runtime.application.port.SchedulingStore;
import agentship.platform.runtime.domain.SchedulingPolicy;
import agentship.platform.runtime.domain.SchedulingPolicy.Node;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Advances one frozen run while its configuration and run rows are locked. */
@Component
public class NodeScheduler {
    private final SchedulingStore store;
    private final RunLocks locks;
    private final RepairCycle repairs;

    NodeScheduler(SchedulingStore store, RunLocks locks, RepairCycle repairs) {
        this.store = store; this.locks = locks;
        this.repairs = repairs;
    }

    void initialize(WorkerDevices.Device device) {
        for (var candidate : store.initializationCandidates(device.id())) {
            var run = locks.lock(candidate.run(), candidate.requirement(), true);
            if (run != null && ("AGENT_EXECUTION_PENDING".equals(run.get("reason_code"))
                    || "AGENT_REPAIR_REQUIRED".equals(run.get("reason_code")))) {
                advance(run);
            }
        }
    }

    public void advance(Map<String, Object> run) {
        if (run.get("finished_at") != null) return;
        repairs.activate(run);
        var existing = nodes(run);
        repairs.finishSettledRounds(run, existing);
        List<Node> nodes = nodes(run);
        if (nodes.isEmpty()) return;
        List<Node> work = nodes.stream().filter(node -> !"end".equals(node.kind())).toList();
        if (work.stream().allMatch(Node::settled)) {
            Node end = nodes.stream().filter(node -> "end".equals(node.kind())).findFirst().orElseThrow();
            store.completeRun(run, end);
            return;
        }

        Set<UUID> checksUnderRepair = repairs.activeChecks(run);
        var activation = SchedulingPolicy.select(nodes, work, checksUnderRepair);
        activation.ready().forEach(store::ready);
        var active = activation.active();

        String blocker = null;
        boolean waiting = false;
        for (Node node : active) {
            if (checksUnderRepair.contains(node.id())) continue;
            String reason = queueNextRole(run, node);
            if ("AGENT_QUESTION_PENDING".equals(reason)) waiting = true;
            else if (blocker == null) blocker = reason;
        }
        if (active.isEmpty()) blocker = "AGENT_CHECK_UNRESOLVED";
        store.updateRun(run, blocker != null ? "needs_attention" : waiting ? "waiting" : "running",
                blocker != null ? blocker : waiting ? "AGENT_QUESTION_PENDING" : null);
    }

    private String queueNextRole(Map<String, Object> run, Node node) {
        if ("limit_reached".equals(node.cycleState())) return "AGENT_REPAIR_LIMIT_REACHED";
        if ("publish".equals(node.kind())) return pause(node, "AGENT_PUBLICATION_UNAVAILABLE");
        var roles = store.roles(run, node);
        if (roles.stream().noneMatch(role -> "coordinator".equals(role.get("role")))) {
            return pause(node, "AGENT_ROLE_MISSING");
        }
        for (var role : roles) {
            String state = (String) role.get("state");
            if (("failed".equals(state) || "needs_attention".equals(state)) && !"skipped".equals(role.get("disposition"))) {
                return pause(node, (String) role.getOrDefault("reason_code", "AGENT_EXECUTION_FAILED"));
            }
        }
        if (roles.stream().anyMatch(role -> "waiting_reply".equals(role.get("state")))) {
            if (!"waiting_reply".equals(node.state())) {
                store.nodeState(node, "waiting_reply");
            }
            return "AGENT_QUESTION_PENDING";
        }
        if ("needs_attention".equals(node.state())) {
            String check = store.checkBlocker(run, node);
            if (check != null) return check;
            if ("requirement".equals(node.purpose())) return "AGENT_REQUIREMENT_REQUIRED";
            return "AGENT_EXECUTION_FAILED";
        }
        List<Map<String, Object>> pendingChildren = roles.stream()
                .filter(role -> "subagent".equals(role.get("role")) && !roleSettled(role)).toList();
        if (pendingChildren.isEmpty()) {
            roles.stream().filter(role -> "coordinator".equals(role.get("role")) && role.get("task_id") == null)
                    .findFirst().ifPresent(role -> store.queue(run, node, role, "coordinator"));
        } else if ("serial".equals(node.order())) {
            var first = pendingChildren.getFirst();
            if (first.get("task_id") == null) store.queue(run, node, first, "agent");
        } else {
            for (var role : pendingChildren) {
                if (role.get("task_id") == null) store.queue(run, node, role, "agent");
            }
        }
        return null;
    }

    private boolean roleSettled(Map<String, Object> role) {
        return "succeeded".equals(role.get("state")) || "skipped".equals(role.get("disposition"));
    }

    private String pause(Node node, String reason) {
        if (!"needs_attention".equals(node.state())) {
            store.nodeState(node, "needs_attention");
        }
        return reason == null ? "AGENT_EXECUTION_FAILED" : reason;
    }

    List<Node> nodes(Map<String, Object> run) {
        return store.nodes(run);
    }
}
