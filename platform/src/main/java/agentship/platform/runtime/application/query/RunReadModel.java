package agentship.platform.runtime.application.query;

import agentship.platform.device.api.RunDevices;
import agentship.platform.runtime.api.RunDetailsQuery.Details;
import agentship.platform.runtime.application.port.GitPreparationQuery;
import agentship.platform.runtime.domain.GitPlan;
import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class RunReadModel {
    private static final String SELECT="""
            SELECT r.*,v.title,v.requirement_version,v.description,c.owner_id AS current_owner,repo.display_name AS repository_name,
                   repo.provider,repo.provider_repository_id
            FROM run r JOIN run_requirement_revision v ON v.run_id=r.id AND v.revision=r.current_revision
            JOIN configuration c ON c.id=r.requirement_id
            LEFT JOIN repository repo ON repo.id=r.repository_id
            WHERE (c.owner_id=:actor OR EXISTS(SELECT 1 FROM configuration_deputy d
                  WHERE d.configuration_id=c.id AND d.account_id=:actor AND d.revoked_at IS NULL))
            """;
    private final NamedParameterJdbcTemplate jdbc;
    private final RunDevices devices;
    private final RunCursor cursors;
    private final GitPreparationQuery gitPreparation;
    RunReadModel(NamedParameterJdbcTemplate jdbc,RunDevices devices,RunCursor cursors,GitPreparationQuery gitPreparation) {
        this.jdbc=jdbc; this.devices=devices; this.cursors=cursors; this.gitPreparation=gitPreparation;
    }

    public Map<String,Object> list(Actor actor,UUID project,String query,String cursor,Integer requestedSize) {
        int size=requestedSize==null?30:requestedSize;
        String search=query==null?"":query.strip();
        if(size<1 || size>100 || search.codePointCount(0,search.length())>120 || search.indexOf(0)>=0) throw ApiProblem.invalid();
        String scope=actor.id()+"|"+project+"|"+search;
        var position=cursors.decode(cursor,scope);
        var args=new MapSqlParameterSource().addValue("actor",actor.id()).addValue("limit",size+1);
        StringBuilder sql=new StringBuilder(SELECT);
        if(project!=null) { sql.append(" AND r.project_id=:project"); args.addValue("project",project); }
        if(!search.isEmpty()) {
            sql.append(" AND v.title ILIKE :query ESCAPE '!'");
            args.addValue("query","%"+search.replace("!","!!").replace("%","!%").replace("_","!_")+"%");
        }
        if(position!=null) { sql.append(" AND r.id>:after"); args.addValue("after",position.id()); }
        sql.append(" ORDER BY r.id LIMIT :limit");
        var rows=jdbc.queryForList(sql.toString(),args);
        List<Map<String,Object>> items=new ArrayList<>();
        rows.stream().limit(size).forEach(row->items.add(summary(row)));
        String next=rows.size()>size?cursors.encode(scope,new RunCursor.Position("",(UUID)rows.get(size-1).get("id"))):null;
        Map<String,Object> page=new LinkedHashMap<>(); page.put("items",items); page.put("nextCursor",next);
        return page;
    }

    public Details detail(Actor actor,UUID id) {
        var row=authorizedRun(actor,id);
        Map<String,Object> result=summary(row);
        result.put("initiatorId",row.get("initiator_id"));
        result.put("requirementRevision",row.get("current_revision"));
        result.put("sourceRequirementVersion",row.get("requirement_version"));
        Map<UUID, Map<String, Object>> displayedArtifacts = new LinkedHashMap<>();
        result.put("stages",stages(row, displayedArtifacts));
        Boolean canOperate=jdbc.queryForObject("SELECT can_chat(:run,:actor)",Map.of("run",id,"actor",actor.id()),Boolean.class);
        var actions=new ArrayList<>(List.of("view"));
        if(Boolean.TRUE.equals(canOperate)) actions.add("open_repair_control");
        if("completed".equals(row.get("state")) && actor.id().equals(row.get("current_owner")) && actor.id().equals(row.get("initiator_id"))) {
            actions.add("archive_deliverable");
        }
        result.put("allowedActions",actions);
        result.put("eventsCursor",eventCursor(actor,id,((Number)row.get("state_version")).longValue()));
        result.put("gitPlan",GitPlan.projection(row));
        var preparation=gitPreparation.read(row);
        if(preparation!=null) result.put("gitPreparation",preparation);
        if(row.get("reason_code")!=null) {
            result.put("blockerCode",row.get("reason_code"));
            result.put("blocker",message((String)row.get("reason_code")));
        }
        // A plan is not an executed Git context. Expose commits only after a worker has recorded them.
        if(row.get("base_commit")!=null) {
            result.put("git",Map.of("repository",Map.of("provider",row.get("provider"),"repositoryId",row.get("provider_repository_id"),
                    "displayName",row.get("repository_name"),"defaultBranch",row.get("git_default_branch")),"baseBranch",row.get("base_branch"),
                    "workBranch",row.get("work_branch"),"baseCommit",row.get("base_commit"),"headCommit",row.get("base_commit")));
        }
        return new Details(result, displayedArtifacts);
    }

    public Map<String,Object> events(Actor actor, UUID id, String cursor, Integer size) {
        if(size!=null && (size<1 || size>100)) throw ApiProblem.invalid();
        var run=authorizedRun(actor,id);
        long version=((Number)run.get("state_version")).longValue();
        var position=cursors.decode(cursor,eventScope(actor,id));
        long previous=position==null?0:Long.parseLong(position.name());
        if(previous>version) throw new ApiProblem(410,"CURSOR_EXPIRED","运行进度已更新，请重新读取。 ");
        List<Map<String,Object>> items=previous==version?List.of():List.of(Map.of(
                "sequence",version,"runVersion",version,"kind","run_changed","time",Instant.now().toString()));
        return Map.of("items",items,"nextCursor",eventCursor(actor,id,version));
    }

    private Map<String,Object> authorizedRun(Actor actor, UUID id) {
        var rows=jdbc.queryForList(SELECT+" AND r.id=:id",Map.of("actor",actor.id(),"id",id));
        if(rows.isEmpty()) throw new ApiProblem(404,"NOT_FOUND","运行不存在或没有访问权限");
        return rows.getFirst();
    }

    private static String eventScope(Actor actor, UUID id) { return "events|"+actor.id()+"|"+id; }

    private String eventCursor(Actor actor, UUID id, long version) {
        return cursors.encode(eventScope(actor,id),new RunCursor.Position(Long.toString(version),id));
    }

    private Map<String,Object> summary(Map<String,Object> row) {
        Map<String,Object> value=new LinkedHashMap<>();
        value.put("id",row.get("id")); value.put("projectId",row.get("project_id"));
        value.put("requirementId",row.get("requirement_id")); value.put("requirementName",row.get("title"));
        value.put("workType",row.get("work_type")); value.put("workflowId",row.get("workflow_id"));
        value.put("workflowVersion",row.get("workflow_version")); value.put("state",row.get("state"));
        value.put("mode",row.get("mode")); value.put("version",row.get("state_version"));
        value.put("deviceStatus",devices.status((UUID)row.get("device_id")));
        return value;
    }

    private List<Map<String,Object>> stages(Map<String,Object> run, Map<UUID, Map<String, Object>> displayedArtifacts) {
        var args=new MapSqlParameterSource().addValue("run",run.get("id")).addValue("workflow",run.get("workflow_id"))
                .addValue("version",run.get("workflow_version"));
        var tasks=tasks(args);
        var artifacts=artifacts(args);
        var dependencies=dependencies(args);
        var checkHistory=checkHistory(args);
        var stages=jdbc.queryForList("""
                SELECT stage_id,name FROM workflow_stage WHERE workflow_id=:workflow AND workflow_version=:version ORDER BY ordinal
                """,args);
        List<Map<String,Object>> result=new ArrayList<>();
        for(var stage:stages) {
            args.addValue("stage",stage.get("stage_id"));
            var nodes=jdbc.queryForList("""
                    SELECT n.*,e.id AS execution_id,e.state,e.wave,e.requirement_revision,e.started_at,
                           c.state AS check_state,c.current_wave,c.automatic_repair_count,c.manual_repair_count,
                           w.automatic_repair_limit,b.reason_code AS check_reason
                    FROM workflow_node n JOIN node_execution e ON e.run_id=:run AND e.node_id=n.node_id
                    AND e.workflow_id=n.workflow_id AND e.workflow_version=n.workflow_version
                    LEFT JOIN check_cycle c ON c.run_id=e.run_id AND c.check_node_id=e.node_id
                    LEFT JOIN workflow_check w ON w.workflow_id=n.workflow_id AND w.workflow_version=n.workflow_version
                        AND w.check_node_id=n.node_id
                    LEFT JOIN check_wave b ON b.run_id=e.run_id AND b.check_node_id=e.node_id AND b.wave=e.wave
                    WHERE n.workflow_id=:workflow AND n.workflow_version=:version AND n.stage_id=:stage
                    AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE x.run_id=e.run_id AND x.node_id=e.node_id)
                    ORDER BY n.ordinal
                    """,args);
            List<Map<String,Object>> projected=new ArrayList<>();
            for(var node:nodes) {
                Map<String,Object> item=new LinkedHashMap<>();
                item.put("nodeId",node.get("node_id")); item.put("wave",node.get("wave")); item.put("name",node.get("name"));
                item.put("type",node.get("kind")); item.put("state",node.get("state"));
                UUID execution=(UUID)node.get("execution_id");
                List<Map<String,Object>> nodeTasks=tasks.getOrDefault(execution,List.of());
                List<Map<String,Object>> nodeArtifacts=artifacts.getOrDefault(execution,List.of());
                for (var artifact : nodeArtifacts) displayedArtifacts.put((UUID) artifact.get("id"), artifact);
                item.put("tasks",nodeTasks);
                item.put("artifactIds",nodeArtifacts.stream().map(value->value.get("id")).toList());
                item.put("artifacts",nodeArtifacts);
                item.put("dependencies",dependencies.getOrDefault(node.get("node_id"),List.of()));
                if(node.get("agent_order")!=null) item.put("agentOrder",node.get("agent_order"));
                if(node.get("check_state")!=null) item.put("check",Map.of(
                        "originalCheckNodeId",node.get("node_id"),"checkWave",node.get("current_wave"),
                        "automaticRepairCount",node.get("automatic_repair_count"),"automaticRepairLimit",node.get("automatic_repair_limit"),
                        "manualRepairCount",node.get("manual_repair_count"),"status",node.get("check_state"),
                        "history",checkHistory.getOrDefault(node.get("node_id"),List.of())));
                if(node.get("check_reason") instanceof String reason) item.put("reason",message(reason));
                else nodeTasks.stream().map(task->task.get("reason")).filter(java.util.Objects::nonNull)
                        .findFirst().ifPresent(reason->item.put("reason",reason));
                item.put("selectedRoles",roles(args.addValue("node",node.get("node_id")),(String)node.get("agent_order")));
                item.put("inputRequirementRevision",node.get("started_at")==null?null:node.get("requirement_revision"));
                item.put("basedOnOlderRequirementRevision",node.get("started_at")!=null &&
                        ((Number)node.get("requirement_revision")).longValue()<((Number)run.get("current_revision")).longValue());
                projected.add(item);
            }
            result.add(Map.of("id",stage.get("stage_id"),"name",stage.get("name"),"nodes",projected));
        }
        return result;
    }

    private Map<UUID,List<Map<String,Object>>> checkHistory(MapSqlParameterSource args) {
        Map<UUID,List<Map<String,Object>>> grouped=new LinkedHashMap<>();
        for(var row:jdbc.queryForList("""
                SELECT v.check_node_id,v.wave,v.outcome,v.checked_commit,v.completed_at,
                       rr.round_number,rr.kind,rr.state AS round_state
                FROM check_wave v LEFT JOIN repair_round rr
                    ON (rr.run_id,rr.check_node_id,rr.triggering_wave)=(v.run_id,v.check_node_id,v.wave)
                WHERE v.run_id=:run ORDER BY v.check_node_id,v.wave
                """,args)) {
            Map<String,Object> wave=new LinkedHashMap<>();
            wave.put("wave",row.get("wave")); wave.put("outcome",row.get("outcome"));
            if(row.get("checked_commit")!=null) wave.put("testedCommit",row.get("checked_commit"));
            if(row.get("completed_at") instanceof Timestamp stamp) wave.put("completedAt",stamp.toInstant().toString());
            if(row.get("round_number")!=null) wave.put("repairRound",Map.of("number",row.get("round_number"),
                    "kind",row.get("kind"),"state",row.get("round_state")));
            grouped.computeIfAbsent((UUID)row.get("check_node_id"),key->new ArrayList<>()).add(wave);
        }
        return grouped;
    }

    private Map<UUID,List<UUID>> dependencies(MapSqlParameterSource args) {
        Map<UUID,List<UUID>> grouped=new LinkedHashMap<>();
        for(var row:jdbc.queryForList("""
                SELECT node_id,prerequisite_node_id FROM workflow_dependency
                WHERE workflow_id=:workflow AND workflow_version=:version ORDER BY prerequisite_node_id
                """,args)) {
            grouped.computeIfAbsent((UUID)row.get("node_id"),key->new ArrayList<>()).add((UUID)row.get("prerequisite_node_id"));
        }
        return grouped;
    }

    private Map<UUID,List<Map<String,Object>>> tasks(MapSqlParameterSource args) {
        Map<UUID,List<Map<String,Object>>> grouped=new LinkedHashMap<>();
        for(var row:jdbc.queryForList("""
                SELECT t.id,t.execution_id,t.kind,t.current_attempt,a.state,a.reason_code,a.disposition,d.role_key,v.display_name
                FROM role_task t JOIN task_attempt a ON a.task_id=t.id AND a.attempt_number=t.current_attempt
                JOIN agent_definition d ON d.id=t.agent_id
                JOIN agent_version v ON v.agent_id=t.agent_id AND v.version=t.agent_version
                JOIN workflow_role w ON w.workflow_id=t.workflow_id AND w.workflow_version=t.workflow_version
                    AND w.node_id=t.node_id AND w.agent_id=t.agent_id
                WHERE t.run_id=:run ORDER BY CASE WHEN t.kind='coordinator' THEN 1 ELSE 0 END,w.ordinal,t.id
                """,args)) {
            Map<String,Object> task=new LinkedHashMap<>();
            task.put("taskId",row.get("id")); task.put("state",row.get("state")); task.put("kind",row.get("kind"));
            task.put("attemptNumber",row.get("current_attempt")); task.put("roleId",row.get("role_key"));
            task.put("roleDisplayName",row.get("display_name"));
            if(row.get("reason_code") instanceof String reason) {
                task.put("reasonCode",reason); task.put("reason",message(reason));
            }
            if(row.get("disposition")!=null) task.put("disposition",row.get("disposition"));
            grouped.computeIfAbsent((UUID)row.get("execution_id"),key->new ArrayList<>()).add(task);
        }
        return grouped;
    }

    private Map<UUID,List<Map<String,Object>>> artifacts(MapSqlParameterSource args) {
        Map<UUID,List<Map<String,Object>>> grouped=new LinkedHashMap<>();
        for(var row:jdbc.queryForList("""
                SELECT a.*,e.node_id,e.wave,r.provider_repository_id
                FROM artifact a JOIN node_execution e ON e.id=a.execution_id
                JOIN role_task t ON t.id=a.task_id AND t.kind='coordinator'
                LEFT JOIN repository r ON r.id=a.repository_id
                WHERE a.run_id=:run ORDER BY a.created_at,a.id
                """,args)) {
            Map<String,Object> artifact=new LinkedHashMap<>();
            artifact.put("id",row.get("id")); artifact.put("kind",row.get("kind")); artifact.put("runId",row.get("run_id"));
            artifact.put("nodeId",row.get("node_id")); artifact.put("wave",row.get("wave"));
            artifact.put("attemptId",row.get("attempt_id")); artifact.put("requirementRevision",row.get("requirement_revision"));
            artifact.put("mode",row.get("mode")); artifact.put("title",row.get("title")); artifact.put("sourceRef",row.get("source_ref"));
            artifact.put("createdAt",((Timestamp)row.get("created_at")).toInstant().toString());
            if(row.get("commit_id")!=null) artifact.put("commit",row.get("commit_id"));
            if(row.get("provider_repository_id")!=null) artifact.put("repositoryId",row.get("provider_repository_id"));
            if(row.get("work_branch")!=null) artifact.put("workBranch",row.get("work_branch"));
            if(row.get("content_digest") instanceof byte[] bytes) artifact.put("contentDigest","sha256:"+HexFormat.of().formatHex(bytes));
            grouped.computeIfAbsent((UUID)row.get("execution_id"),key->new ArrayList<>()).add(artifact);
        }
        return grouped;
    }

    private static String message(String code) {
        String agentMessage=AgentRunStatus.message(code);
        return agentMessage==null?GitStatusMessages.message(code):agentMessage;
    }

    private List<Map<String,Object>> roles(MapSqlParameterSource args,String order) {
        return jdbc.query("""
                SELECT a.role_key,w.agent_id,w.agent_version,w.role,w.ordinal,v.display_name
                FROM workflow_role w JOIN agent_definition a ON a.id=w.agent_id
                JOIN agent_version v ON v.agent_id=w.agent_id AND v.version=w.agent_version
                WHERE w.workflow_id=:workflow AND w.workflow_version=:version AND w.node_id=:node
                ORDER BY CASE WHEN w.role='coordinator' THEN 0 ELSE 1 END,w.ordinal
                """,args,(rs,index)->{
            Map<String,Object> role=new LinkedHashMap<>();
            role.put("roleId",rs.getString("role_key")); role.put("agentId",rs.getObject("agent_id",UUID.class));
            role.put("agentVersion",rs.getLong("agent_version")); role.put("displayName",rs.getString("display_name"));
            boolean coordinator=rs.getString("role").equals("coordinator");
            role.put("kind",coordinator?"coordinator":"agent");
            role.put("sequence",!coordinator && "serial".equals(order)?rs.getInt("ordinal"):null);
            return role;
        });
    }

}
