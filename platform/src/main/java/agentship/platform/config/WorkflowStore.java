package agentship.platform.config;

import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class WorkflowStore {
    private final NamedParameterJdbcTemplate jdbc;

    WorkflowStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    void save(UUID workflowId, WorkflowGraph graph, Actor actor) {
        Map<UUID, Long> agents = lockAgentVersions(graph, actor);
        Long version = jdbc.queryForObject("""
                SELECT coalesce(max(version),0)+1 FROM workflow_version WHERE workflow_id=:id
                """, Map.of("id", workflowId), Long.class);
        var versionArgs = new MapSqlParameterSource("workflow", workflowId).addValue("version", version);
        jdbc.update("""
                INSERT INTO workflow_version(workflow_id,version,saved_by,schema_version)
                VALUES (:workflow,:version,:actor,1)
                """, versionArgs.addValue("actor", actor.id()));
        int stageOrdinal = 0;
        for (WorkflowGraph.Stage stage : graph.stages()) {
            jdbc.update("""
                    INSERT INTO workflow_stage(workflow_id,workflow_version,stage_id,name,ordinal)
                    VALUES (:workflow,:version,:stage,:name,:ordinal)
                    """, new MapSqlParameterSource(versionArgs.getValues()).addValue("stage", stage.id())
                    .addValue("name", stage.name()).addValue("ordinal", ++stageOrdinal));
            int nodeOrdinal = 0;
            for (WorkflowGraph.Node node : stage.nodes()) {
                jdbc.update("""
                        INSERT INTO workflow_node(workflow_id,workflow_version,node_id,stage_id,name,ordinal,kind,purpose,agent_order)
                        VALUES (:workflow,:version,:node,:stage,:name,:ordinal,:kind,:purpose,:agentOrder)
                        """, nodeArgs(versionArgs, node).addValue("stage", stage.id()).addValue("name", node.name())
                        .addValue("ordinal", ++nodeOrdinal).addValue("kind", node.type())
                        .addValue("purpose", node.purpose()).addValue("agentOrder", node.agentOrder()));
            }
        }
        for (WorkflowGraph.Stage stage : graph.stages()) for (WorkflowGraph.Node node : stage.nodes()) {
            var args = nodeArgs(versionArgs, node);
            for (UUID dependency : node.dependencies()) {
                jdbc.update("""
                        INSERT INTO workflow_dependency(workflow_id,workflow_version,node_id,prerequisite_node_id)
                        VALUES (:workflow,:version,:node,:dependency)
                        """, args.addValue("dependency", dependency));
            }
            if (node.coordinatorId() != null) {
                saveRole(args, node.type(), node.coordinatorId(), agents.get(node.coordinatorId()), "coordinator", 1);
                int ordinal = 0;
                for (UUID agent : node.agentIds()) saveRole(args, node.type(), agent, agents.get(agent), "subagent", ++ordinal);
            }
            if (node.checkRoutes() != null) {
                var routes = node.checkRoutes();
                jdbc.update("""
                        INSERT INTO workflow_check(workflow_id,workflow_version,check_node_id,pass_entry_node_id,repair_entry_node_id,automatic_repair_limit)
                        VALUES (:workflow,:version,:node,:pass,:repair,:repairLimit)
                        """, args.addValue("pass", routes.passNodeId()).addValue("repair", routes.repairNodeId())
                        .addValue("repairLimit", routes.automaticRepairLimit()));
            }
        }
        // Checks must exist before route memberships because the membership foreign key is immediate.
        for (WorkflowGraph.Stage stage : graph.stages()) for (WorkflowGraph.Node node : stage.nodes()) {
            if (node.route() != null) {
                jdbc.update("""
                        INSERT INTO workflow_route_node(workflow_id,workflow_version,check_node_id,node_id,outcome)
                        VALUES (:workflow,:version,:check,:node,:outcome)
                        """, nodeArgs(versionArgs, node).addValue("check", node.route().checkNodeId())
                        .addValue("outcome", node.route().outcome()));
            }
        }
        jdbc.update("""
                UPDATE workflow_version SET sealed_at=clock_timestamp()
                WHERE workflow_id=:workflow AND version=:version
                """, versionArgs);
    }

    private Map<UUID, Long> lockAgentVersions(WorkflowGraph graph, Actor actor) {
        var ids = graph.agentIds().stream().sorted(Comparator.comparing(UUID::toString)).toList();
        Map<UUID, Long> versions = new HashMap<>();
        for (UUID agent : ids) {
            var args = new MapSqlParameterSource("agent", agent).addValue("actor", actor.id());
            List<UUID> locked = jdbc.query("""
                    SELECT c.id FROM configuration c JOIN agent_definition d ON d.agent_config_id=c.id
                    WHERE d.id=:agent AND c.kind='agent' FOR UPDATE OF c
                    """, args, (rs, row) -> rs.getObject(1, UUID.class));
            if (locked.isEmpty()) throw unavailableAgent();
            List<Long> visible = jdbc.query("""
                    SELECT max(v.version) FROM agent_definition d
                    JOIN configuration c ON c.id=d.agent_config_id JOIN agent_version v ON v.agent_id=d.id
                    WHERE d.id=:agent AND (c.owner_id=:actor OR EXISTS (
                        SELECT 1 FROM configuration_deputy p
                        WHERE p.configuration_id=c.id AND p.account_id=:actor AND p.revoked_at IS NULL))
                    GROUP BY d.id
                    """, args, (rs, row) -> rs.getLong(1));
            if (visible.isEmpty()) throw unavailableAgent();
            versions.put(agent, visible.getFirst());
        }
        Boolean session = jdbc.queryForObject("SELECT active_browser_session(:actor,:session)",
                Map.of("actor", actor.id(), "session", actor.sessionId()), Boolean.class);
        if (!Boolean.TRUE.equals(session)) throw ApiProblem.unauthenticated();
        return versions;
    }

    private void saveRole(MapSqlParameterSource base, String kind, UUID agent, long version, String role, int ordinal) {
        jdbc.update("""
                INSERT INTO workflow_role(workflow_id,workflow_version,node_id,node_kind,agent_id,agent_version,role,ordinal)
                VALUES (:workflow,:version,:node,:kind,:agent,:agentVersion,:role,:ordinal)
                """, new MapSqlParameterSource(base.getValues()).addValue("kind", kind).addValue("agent", agent)
                .addValue("agentVersion", version).addValue("role", role).addValue("ordinal", ordinal));
    }

    WorkflowGraph read(UUID workflow, Long version) {
        if (version == null) return new WorkflowGraph(List.of());
        var args = new MapSqlParameterSource("workflow", workflow).addValue("version", version);
        Map<UUID, List<UUID>> dependencies = new HashMap<>();
        jdbc.query("""
                SELECT node_id,prerequisite_node_id FROM workflow_dependency
                WHERE workflow_id=:workflow AND workflow_version=:version ORDER BY prerequisite_node_id
                """, args, rs -> {
            UUID node = rs.getObject("node_id", UUID.class);
            dependencies.computeIfAbsent(node, ignored -> new ArrayList<>()).add(rs.getObject("prerequisite_node_id", UUID.class));
        });
        Map<UUID, UUID> coordinators = new HashMap<>();
        Map<UUID, List<UUID>> children = new HashMap<>();
        jdbc.query("""
                SELECT node_id,agent_id,role FROM workflow_role
                WHERE workflow_id=:workflow AND workflow_version=:version ORDER BY ordinal
                """, args, rs -> {
            UUID node = rs.getObject("node_id", UUID.class);
            UUID agent = rs.getObject("agent_id", UUID.class);
            if (rs.getString("role").equals("coordinator")) coordinators.put(node, agent);
            else children.computeIfAbsent(node, ignored -> new ArrayList<>()).add(agent);
        });
        Map<UUID, WorkflowGraph.CheckRoutes> checks = new HashMap<>();
        jdbc.query("""
                SELECT check_node_id,pass_entry_node_id,repair_entry_node_id,automatic_repair_limit FROM workflow_check
                WHERE workflow_id=:workflow AND workflow_version=:version
                """, args, rs -> {
            checks.put(rs.getObject("check_node_id", UUID.class), new WorkflowGraph.CheckRoutes(
                    rs.getObject("pass_entry_node_id", UUID.class), rs.getObject("repair_entry_node_id", UUID.class),
                    rs.getInt("automatic_repair_limit")));
        });
        Map<UUID, WorkflowGraph.Route> routes = new HashMap<>();
        jdbc.query("""
                SELECT node_id,check_node_id,outcome FROM workflow_route_node
                WHERE workflow_id=:workflow AND workflow_version=:version
                """, args, rs -> {
            routes.put(rs.getObject("node_id", UUID.class), new WorkflowGraph.Route(
                    rs.getObject("check_node_id", UUID.class), rs.getString("outcome")));
        });
        Map<UUID, List<WorkflowGraph.Node>> nodes = new LinkedHashMap<>();
        jdbc.query("""
                SELECT node_id,stage_id,name,kind,purpose,agent_order FROM workflow_node
                WHERE workflow_id=:workflow AND workflow_version=:version ORDER BY ordinal
                """, args, rs -> {
            UUID id = rs.getObject("node_id", UUID.class);
            boolean end = rs.getString("kind").equals("end");
            var node = new WorkflowGraph.Node(id, rs.getString("name"), rs.getString("kind"), rs.getString("purpose"),
                    dependencies.getOrDefault(id, List.of()), coordinators.get(id),
                    end ? null : children.getOrDefault(id, List.of()), rs.getString("agent_order"), checks.get(id), routes.get(id));
            nodes.computeIfAbsent(rs.getObject("stage_id", UUID.class), ignored -> new ArrayList<>()).add(node);
        });
        List<WorkflowGraph.Stage> stages = jdbc.query("""
                SELECT stage_id,name FROM workflow_stage
                WHERE workflow_id=:workflow AND workflow_version=:version ORDER BY ordinal
                """, args, (rs, row) -> {
            UUID id = rs.getObject("stage_id", UUID.class);
            return new WorkflowGraph.Stage(id, rs.getString("name"), nodes.getOrDefault(id, List.of()));
        });
        return new WorkflowGraph(stages);
    }

    private static MapSqlParameterSource nodeArgs(MapSqlParameterSource base, WorkflowGraph.Node node) {
        return new MapSqlParameterSource(base.getValues()).addValue("node", node.id());
    }

    private static ApiProblem unavailableAgent() {
        return new ApiProblem(403, "AGENT_UNAVAILABLE", "流程包含无权使用或不存在的 Agent，请重新选择");
    }
}
