package agentship.platform.runtime.application.execution;

import agentship.platform.runtime.application.port.RepairStore;
import agentship.platform.runtime.application.port.WorkerTaskStore.TaskContext;
import agentship.platform.runtime.domain.SchedulingPolicy;
import agentship.platform.runtime.domain.SchedulingPolicy.Node;
import agentship.platform.web.RequestFields;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/** All mutations in this component run under the configuration and run locks. */
@Component
public class RepairCycle {
    private final RepairStore store;

    RepairCycle(RepairStore store) {
        this.store = store;
    }

    void activate(Map<String, Object> run) {
        for (var check : store.eligibleChecks((UUID) run.get("id"))) {
            UUID node = (UUID) check.get("check_node_id");
            int count = ((Number) check.get("automatic_repair_count")).intValue();
            int limit = ((Number) check.get("automatic_repair_limit")).intValue();
            if (count >= limit) {
                store.limitReached(run, node);
            } else {
                startRound(run, node, null);
            }
        }
    }

    public void manualRepair(Map<String, Object> lockedRun, UUID check, UUID actor) {
        requireState(lockedRun, check, "limit_reached");
        if (actor == null) throw new IllegalArgumentException("Manual repair requires the authorized actor");
        startRound(lockedRun, check, actor);
    }

    public void manualRecheck(Map<String, Object> lockedRun, UUID check) {
        requireState(lockedRun, check, "unresolved");
        Integer sourceRound = store.recheckSource(lockedRun, check);
        nextCheck(lockedRun, check, sourceRound);
    }

    public void stop(Map<String, Object> lockedRun, UUID check) {
        requireState(lockedRun, check, "limit_reached");
        store.stop(lockedRun, check);
    }

    private void requireState(Map<String, Object> run, UUID check, String state) {
        boolean available = run.get("finished_at") == null && store.actionAvailable(run, check, state);
        if (!available) throw RequestFields.conflict("CHECK_ACTION_UNAVAILABLE", "当前检查状态不允许此操作");
    }

    private void startRound(Map<String, Object> run, UUID check, UUID actor) {
        int inserted = store.startRound(run, check, actor);
        if (inserted != 1) throw RequestFields.conflict("CHECK_ACTION_UNAVAILABLE", "当前检查已安排修复或状态已变化");
        resetUsedRoute(run, check);
    }

    private void resetUsedRoute(Map<String, Object> run, UUID check) {
        var used = store.usedRoute(run, check);
        for (var row : used) {
            UUID node = (UUID) row.get("node_id");
            int wave = ((Number) row.get("wave")).intValue() + 1;
            store.newExecution(run, node, wave, "blocked");
            if ("check".equals(row.get("kind"))) store.pendingCheck(run, node, wave, null);
        }
    }

    Set<UUID> activeChecks(Map<String, Object> run) {
        return store.activeRounds((UUID) run.get("id")).stream()
                .map(row -> (UUID) row.get("check_node_id")).collect(Collectors.toSet());
    }

    void finishSettledRounds(Map<String, Object> run, List<Node> nodes) {
        var byId = new java.util.HashMap<UUID, Node>();
        nodes.forEach(node -> byId.put(node.id(), node));
        for (var round : store.activeRounds((UUID) run.get("id"))) {
            UUID check = (UUID) round.get("check_node_id");
            var members = nodes.stream().filter(node -> SchedulingPolicy.inRepairSubtree(node, check, byId)).toList();
            if (members.isEmpty() || members.stream().anyMatch(node -> !node.settled())) continue;
            int number = ((Number) round.get("round_number")).intValue();
            store.finishRound(run, check, number);
            nextCheck(run, check, number);
        }
    }

    void onClaim(TaskContext context) {
        store.markClaimed(context.run(), (UUID) context.attempt().get("node_id"));
    }

    private void nextCheck(Map<String, Object> run, UUID check, Integer round) {
        int wave = store.nextWave(run, check);
        store.newExecution(run, check, wave, "blocked");
        store.pendingCheck(run, check, wave, round);
    }
}
