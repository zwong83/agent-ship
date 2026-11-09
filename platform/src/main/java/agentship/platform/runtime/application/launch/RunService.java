package agentship.platform.runtime.application.launch;

import agentship.platform.device.api.RunDevices;
import agentship.platform.identity.api.BrowserSessions;
import agentship.platform.runtime.api.RunDetailsQuery;
import agentship.platform.runtime.application.port.GitStartGrants;
import agentship.platform.runtime.application.query.RunReadModel;
import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RunService implements RunDetailsQuery {
    private final NamedParameterJdbcTemplate jdbc;
    private final RunDevices devices;
    private final BrowserSessions sessions;
    private final ObjectMapper mapper;
    private final RunReadModel read;
    private final GitStartGrants gitGrants;

    RunService(NamedParameterJdbcTemplate jdbc, RunDevices devices, ObjectMapper mapper, RunReadModel read,
               GitStartGrants gitGrants, BrowserSessions sessions) {
        this.jdbc=jdbc; this.devices=devices; this.mapper=mapper; this.read=read; this.gitGrants=gitGrants;
        this.sessions = sessions;
    }

    @Transactional
    public Map<String,Object> start(Actor actor, JsonNode body, String key, String origin, String requestId) {
        RunStart command=RunStart.parse(body);
        if (key.isBlank() || key.length()>200 || key.indexOf(0)>=0) throw ApiProblem.invalid();
        session(actor);
        byte[] digest=fingerprint(command);
        var receiptArgs=new MapSqlParameterSource().addValue("actor",actor.id()).addValue("key",key).addValue("digest",digest);
        int reserved=jdbc.update("""
                INSERT INTO command_receipt(actor_kind,actor_account_id,scope,request_key,request_digest)
                VALUES('account',:actor,'run:start',:key,:digest)
                ON CONFLICT(actor_kind,actor_id,scope,request_key) DO NOTHING
                """,receiptArgs);
        if (reserved==0) {
            var receipt=jdbc.queryForMap("""
                    SELECT request_digest,result_id FROM command_receipt
                    WHERE actor_kind='account' AND actor_id=:actor AND scope='run:start' AND request_key=:key
                    """,receiptArgs);
            if (!MessageDigest.isEqual(digest,(byte[])receipt.get("request_digest"))) {
                throw new ApiProblem(409,"IDEMPOTENCY_CONFLICT","同一提交标识不能用于不同的启动内容");
            }
            // A lost response can be retried after its challenge was consumed, but revoked start rights never revive.
            lockRequirement(actor,command.requirementId());
            session(actor);
            return receipt((UUID)receipt.get("result_id"));
        }
        var requirement=lockRequirement(actor,command.requirementId());
        if (((Number)requirement.get("version")).longValue()!=command.requirementVersion()) stale();
        lockWorkflow(actor,command);
        recheckAgents(actor,command);
        validateRequirement(requirement,command);
        session(actor);
        var binding=devices.consumeProof(actor,command.deviceProof(),origin);
        UUID run=UUID.randomUUID();
        var args=new MapSqlParameterSource(requirement).addValue("id",run).addValue("actor",actor.id())
                .addValue("requirement",command.requirementId()).addValue("requirementVersion",command.requirementVersion())
                .addValue("workflow",command.workflowId()).addValue("workflowVersion",command.workflowVersion())
                .addValue("device",binding.id()).addValue("mode",binding.mode()).addValue("type",command.workType())
                .addValue("namespace",command.githubNamespace()).addValue("task",UUID.randomUUID()).addValue("attempt",UUID.randomUUID());
        jdbc.update("""
                INSERT INTO run(id,project_id,requirement_id,workflow_id,workflow_version,initiator_id,device_id,mode,
                    work_type,github_namespace,state,current_revision,state_version,repository_id,reason_code)
                VALUES(:id,:project_id,:requirement,:workflow,:workflowVersion,:actor,:device,:mode,:type,:namespace,
                    'queued',1,1,:repository_id,'GIT_PREPARATION_PENDING')
                """,args);
        jdbc.update("""
                INSERT INTO run_requirement_revision(run_id,revision,requirement_version,title,description,recorded_by)
                VALUES(:id,1,:requirementVersion,:name,:description,:actor)
                """,args);
        var nodes=jdbc.query("SELECT node_id FROM workflow_node WHERE workflow_id=:workflow AND workflow_version=:workflowVersion",
                args,(rs,row)->rs.getObject("node_id",UUID.class));
        for (UUID node:nodes) {
            jdbc.update("""
                    INSERT INTO node_execution(id,run_id,workflow_id,workflow_version,node_id,wave,requirement_revision,state)
                    VALUES(:execution,:id,:workflow,:workflowVersion,:node,1,1,'blocked')
                    """,args.addValue("execution",UUID.randomUUID()).addValue("node",node));
        }
        jdbc.update("""
                INSERT INTO role_task(id,run_id,device_id,kind,requirement_revision,current_attempt)
                VALUES(:task,:id,:device,'git',1,1)
                """,args);
        jdbc.update("""
                INSERT INTO task_attempt(task_id,attempt_number,attempt_id,device_id,state,available_at)
                VALUES(:task,1,:attempt,:device,'queued',statement_timestamp())
                """,args);
        jdbc.update("""
                UPDATE command_receipt SET result_kind='run',result_id=:run,accepted_at=statement_timestamp()
                WHERE actor_kind='account' AND actor_id=:actor AND scope='run:start' AND request_key=:key
                """,receiptArgs.addValue("run",run));
        jdbc.update("""
                INSERT INTO audit_event(id,request_id,actor_account_id,run_id,target_kind,target_id,action,outcome)
                VALUES(:audit,:request,:actor,:id,'run',:id,'started','accepted')
                """,args.addValue("audit",UUID.randomUUID()).addValue("request",requestId));
        gitGrants.grant(run,actor.id());
        return receipt(run);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Map<String,Object> list(Actor actor,UUID project,String query,String cursor,Integer pageSize) {
        session(actor);
        return read.list(actor,project,query,cursor,pageSize);
    }

    @Override
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Details detail(Actor actor,UUID id) {
        session(actor);
        return read.detail(actor,id);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Map<String,Object> events(Actor actor,UUID id,String cursor,Integer pageSize) {
        session(actor);
        return read.events(actor,id,cursor,pageSize);
    }

    private Map<String,Object> lockRequirement(Actor actor,UUID requirement) {
        var rows=jdbc.queryForList("""
                SELECT r.*,c.version,c.owner_id FROM requirement r JOIN configuration c ON c.id=r.id
                WHERE r.id=:id FOR UPDATE OF c,r
                """,Map.of("id",requirement));
        if(rows.isEmpty()) throw new ApiProblem(404,"NOT_FOUND","需求不存在或没有访问权限");
        var value=rows.getFirst();
        if(!actor.id().equals(value.get("owner_id"))) {
            Boolean deputy=jdbc.queryForObject("""
                    SELECT EXISTS(SELECT 1 FROM configuration_deputy WHERE configuration_id=:id
                    AND account_id=:actor AND revoked_at IS NULL)
                    """,Map.of("id",requirement,"actor",actor.id()),Boolean.class);
            if(!Boolean.TRUE.equals(deputy)) throw new ApiProblem(404,"NOT_FOUND","需求不存在或没有访问权限");
            throw new ApiProblem(403,"FORBIDDEN","只有当前需求主负责人可以启动运行");
        }
        return value;
    }

    private void lockWorkflow(Actor actor,RunStart command) {
        var args=Map.of("workflow",command.workflowId(),"actor",actor.id());
        var rows=jdbc.queryForList("SELECT id FROM configuration WHERE id=:workflow AND kind='workflow' FOR UPDATE",args);
        if(rows.isEmpty() || !Boolean.TRUE.equals(jdbc.queryForObject("SELECT configuration_can_use(:workflow,:actor)",args,Boolean.class))) {
            throw new ApiProblem(403,"FORBIDDEN","所选流程不可使用，请重新选择");
        }
        Long version=jdbc.queryForObject("SELECT max(version) FROM workflow_version WHERE workflow_id=:workflow AND sealed_at IS NOT NULL",args,Long.class);
        if(version==null || version!=command.workflowVersion()) stale();
        Integer publications=jdbc.queryForObject("SELECT count(*) FROM workflow_node WHERE workflow_id=:workflow AND workflow_version=:version AND kind='publish'",
                Map.of("workflow",command.workflowId(),"version",command.workflowVersion()),Integer.class);
        if(publications!=null && publications>0) throw new ApiProblem(409,"ACTION_NOT_ALLOWED","开发环境暂不支持正式发布流程");
    }

    private void recheckAgents(Actor actor,RunStart command) {
        var args=Map.of("workflow",command.workflowId(),"version",command.workflowVersion(),"actor",actor.id());
        var agents=jdbc.query("""
                SELECT DISTINCT a.agent_config_id FROM workflow_role w JOIN agent_definition a ON a.id=w.agent_id
                WHERE w.workflow_id=:workflow AND w.workflow_version=:version ORDER BY a.agent_config_id
                """,args,(rs,row)->rs.getObject("agent_config_id",UUID.class));
        for(UUID agent:agents) {
            if(agent==null) throw new ApiProblem(403,"AGENT_UNAVAILABLE","流程中有不可使用的 Agent，请调整流程后重试");
            var access=Map.of("id",agent,"actor",actor.id());
            jdbc.queryForList("SELECT id FROM configuration WHERE id=:id FOR UPDATE",access);
            if(!Boolean.TRUE.equals(jdbc.queryForObject("SELECT configuration_can_use(:id,:actor)",access,Boolean.class))) {
                throw new ApiProblem(403,"AGENT_UNAVAILABLE","流程中有不可使用的 Agent，请调整流程后重试");
            }
        }
    }

    private void validateRequirement(Map<String,Object> requirement,RunStart command) {
        boolean linked=requirement.get("repository_id")!=null;
        if(!linked && (!command.workType().equals("feature") || command.githubNamespace()==null)) {
            throw new ApiProblem(400,"INVALID_REQUEST","新需求固定为新功能，并需要填写 GitHub 用户名或组织名");
        }
        if(linked && command.githubNamespace()!=null) throw new ApiProblem(400,"INVALID_REQUEST","已有仓库的需求会沿用关联仓库，请移除 GitHub 命名空间");
        String description=(String)requirement.get("description");
        if(description==null || description.isBlank()) {
            Boolean deferred=jdbc.queryForObject("""
                    SELECT EXISTS(SELECT 1 FROM workflow_node WHERE workflow_id=:workflow AND workflow_version=:version AND purpose='requirement')
                    """,Map.of("workflow",command.workflowId(),"version",command.workflowVersion()),Boolean.class);
            if(!Boolean.TRUE.equals(deferred)) throw new ApiProblem(400,"REQUIREMENT_DESCRIPTION_REQUIRED","该流程没有需求阶段，请先补充需求说明再启动");
        }
    }

    private void session(Actor actor) {
        sessions.requireActive(actor.id(), actor.sessionId());
    }
    private static Map<String,Object> receipt(UUID run) { return Map.of("runId",run,"state","queued","version",1); }
    private static void stale() { throw new ApiProblem(409,"VERSION_CONFLICT","需求或流程已更新，请刷新后重新启动"); }

    private byte[] fingerprint(RunStart command) {
        try { return MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(canonical(mapper.valueToTree(command)))); }
        catch(java.security.GeneralSecurityException|com.fasterxml.jackson.core.JsonProcessingException failure) { throw new IllegalStateException(failure); }
    }
    private static Object canonical(JsonNode node) {
        if(node.isObject()) {
            Map<String,Object> values=new TreeMap<>();
            node.fields().forEachRemaining(field->values.put(field.getKey(),canonical(field.getValue())));
            return values;
        }
        if(node.isArray()) { List<Object> values=new ArrayList<>(); node.forEach(item->values.add(canonical(item))); return values; }
        return node;
    }
}
