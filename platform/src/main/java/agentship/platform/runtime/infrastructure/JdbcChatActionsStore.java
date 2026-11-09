package agentship.platform.runtime.infrastructure;

import agentship.platform.catalog.api.RequirementEdits.Content;
import agentship.platform.runtime.application.port.ChatActionsStore;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcChatActionsStore implements ChatActionsStore {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcChatActionsStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean send(NodeTarget node, UUID actor, String role, String text, UUID message) {
        var args = args(node).addValue("actor", actor).addValue("role", role).addValue("text", text)
                .addValue("message", message).addValue("inbox", UUID.randomUUID());
        var destinations = jdbc.queryForList("""
                WITH destination AS (
                    SELECT t.id,t.run_id,a.session_ref
                    FROM node_execution e JOIN role_task t ON t.execution_id=e.id
                    JOIN task_attempt a ON (a.task_id,a.attempt_number)=(t.id,t.current_attempt)
                    JOIN agent_definition d ON d.id=t.agent_id
                    WHERE e.run_id=:run AND e.node_id=:node AND e.wave=:wave
                      AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE (x.run_id,x.node_id)=(e.run_id,e.node_id))
                      AND e.state IN ('running','waiting_reply','needs_attention') AND task_route_is_open(e.run_id,e.node_id)
                      AND t.kind IN ('agent','coordinator') AND a.state IN ('queued','leased','running','waiting_reply')
                      AND a.session_ref IS NOT NULL
                      AND (CAST(:role AS text) IS NULL AND t.kind='coordinator' OR d.role_key=:role)
                ), sent AS (
                    INSERT INTO chat_message(id,run_id,message_type,actor_account_id,target_task_id,body)
                    SELECT :message,run_id,'message',:actor,id,:text FROM destination
                    RETURNING id,run_id,target_task_id,body
                )
                INSERT INTO agent_inbox(id,run_id,task_id,session_ref,kind,payload,delivery_state)
                SELECT :inbox,s.run_id,s.target_task_id,d.session_ref,'message',
                    jsonb_build_object('chatMessageId',s.id,'text',s.body),'pending'
                FROM sent s JOIN destination d ON d.id=s.target_task_id RETURNING id
                """, args);
        return destinations.size() == 1;
    }

    @Override
    public boolean resolve(UUID run, UUID question, UUID actor, boolean reply, String text) {
        var args = new MapSqlParameterSource("run", run).addValue("question", question).addValue("actor", actor)
                .addValue("action", reply ? "reply" : "cancel").addValue("answer", reply ? text : null)
                .addValue("kind", reply ? "answer" : "continue_without_answer").addValue("text", text)
                .addValue("inbox", UUID.randomUUID());
        var changed = jdbc.queryForList("""
                WITH eligible AS (
                    SELECT q.*,t.execution_id FROM agent_question q JOIN role_task t ON t.id=q.task_id
                    JOIN task_attempt a ON (a.task_id,a.attempt_number,a.attempt_id)=(t.id,t.current_attempt,q.attempt_id)
                    WHERE q.id=:question AND q.run_id=:run AND a.state='waiting_reply'
                        AND a.session_ref=q.session_ref AND task_route_is_open(t.run_id,t.node_id)
                ), resolved AS (
                    INSERT INTO question_resolution(question_id,actor_id,action,answer)
                    SELECT id,:actor,:action,:answer FROM eligible ON CONFLICT(question_id) DO NOTHING RETURNING question_id
                ), queued AS (
                    INSERT INTO agent_inbox(id,run_id,task_id,session_ref,kind,question_id,payload,delivery_state)
                    SELECT :inbox,q.run_id,q.task_id,q.session_ref,:kind,q.id,jsonb_build_object('text',CAST(:text AS text)),'pending'
                    FROM eligible q JOIN resolved r ON r.question_id=q.id RETURNING task_id
                ), resumed AS (
                    UPDATE task_attempt a SET state='queued',reason_code=NULL,available_at=statement_timestamp(),
                        lease_epoch=NULL,lease_deadline=NULL
                    FROM eligible q JOIN queued i ON i.task_id=q.task_id WHERE a.attempt_id=q.attempt_id RETURNING q.execution_id
                )
                UPDATE node_execution e SET state='running' FROM resumed r WHERE e.id=r.execution_id RETURNING e.id
                """, args);
        return changed.size() == 1;
    }

    @Override
    public Map<String, Object> failedRole(UUID run, UUID task) {
        var roles = jdbc.queryForList(FAILED_ROLES + " AND t.id=:task", Map.of("run", run, "task", task));
        return roles.size() == 1 ? roles.getFirst() : null;
    }

    @Override
    public void retryRole(UUID task, long attemptNumber, UUID nextAttempt) {
        var args = Map.of("task", task, "current", attemptNumber, "attempt", nextAttempt);
        jdbc.update("""
                UPDATE agent_inbox i SET delivery_state='unknown' FROM task_attempt a
                WHERE i.task_id=:task AND a.task_id=i.task_id AND a.attempt_number=:current
                    AND i.session_ref=a.session_ref AND i.delivery_state='pending'
                """, args);
        jdbc.update("UPDATE role_task SET current_attempt=current_attempt+1 WHERE id=:task", args);
        jdbc.update("""
                INSERT INTO task_attempt(task_id,attempt_number,attempt_id,device_id,state,available_at)
                SELECT id,current_attempt,:attempt,device_id,'queued',statement_timestamp() FROM role_task WHERE id=:task
                """, args);
    }

    @Override
    public void skipRole(UUID task, long attemptNumber, UUID actor) {
        var args = Map.of("task", task, "current", attemptNumber, "actor", actor);
        jdbc.update("""
                UPDATE task_attempt SET disposition='skipped',disposed_by=:actor,disposed_at=statement_timestamp()
                WHERE task_id=:task AND attempt_number=:current
                """, args);
    }

    @Override
    public void resumeExecution(UUID execution) {
        jdbc.update("UPDATE node_execution SET state='running' WHERE id=:execution", Map.of("execution", execution));
    }

    @Override
    public Map<String, Object> activeRequirement(NodeTarget node) {
        var rows = jdbc.queryForList(ACTIVE_BRD + " AND e.node_id=:node AND e.wave=:wave", args(node));
        return rows.size() == 1 ? rows.getFirst() : null;
    }

    @Override
    public Content proposal(Revision revision, UUID proposal) {
        var args = args(revision).addValue("proposal", proposal);
        var proposals = jdbc.queryForList("""
                SELECT proposed_title,proposed_name_key,proposed_description FROM requirement_change
                WHERE id=:proposal AND run_id=:run AND execution_id=:execution AND state='pending'
                    AND based_on_revision=:revision AND based_on_requirement_version=:source
                """, args);
        if (proposals.size() != 1) return null;
        var row = proposals.getFirst();
        return new Content((String) row.get("proposed_title"), (String) row.get("proposed_name_key"),
                (String) row.get("proposed_description"));
    }

    @Override
    public void addProposal(Revision revision, UUID proposal, Content content) {
        var args = args(revision).addValue("proposal", proposal).addValue("title", content.title())
                .addValue("nameKey", content.nameKey()).addValue("description", content.description());
        jdbc.update("""
                INSERT INTO requirement_change(id,run_id,execution_id,proposed_by,based_on_revision,based_on_requirement_version,
                    proposed_title,proposed_name_key,proposed_description,state)
                VALUES(:proposal,:run,:execution,:actor,:revision,:source,:title,:nameKey,:description,'pending')
                """, args);
    }

    @Override
    public void confirmProposal(Revision revision, UUID proposal) {
        var args = args(revision).addValue("proposal", proposal);
        jdbc.update("""
                UPDATE requirement_change SET state='confirmed',confirmed_by=:actor,confirmed_at=statement_timestamp(),
                    effective_revision=:next WHERE id=:proposal
                """, args);
    }

    @Override
    public void recordRevision(Revision revision, Content content) {
        var args = args(revision).addValue("title", content.title()).addValue("description", content.description());
        jdbc.update("""
                INSERT INTO run_requirement_revision(run_id,revision,requirement_version,title,description,recorded_by)
                SELECT :run,:next,version,:title,:description,:actor FROM configuration WHERE id=:requirement
                """, args);
        jdbc.update("UPDATE run SET current_revision=:next,state_version=state_version+1 WHERE id=:run", args);
        // If the coordinator already supplied the output but awaited a missing description, the entered description unblocks it.
        if (content.description() != null) jdbc.update("""
                UPDATE node_execution e SET state='complete' WHERE e.id=:execution AND e.state='needs_attention'
                  AND EXISTS(SELECT 1 FROM role_task t JOIN task_attempt a ON (a.task_id,a.attempt_number)=(t.id,t.current_attempt)
                    JOIN artifact f ON f.attempt_id=a.attempt_id
                    WHERE t.execution_id=e.id AND t.kind='coordinator' AND a.state='succeeded')
                """, args);
    }

    @Override
    public void rejectStaleProposals(Revision revision) {
        jdbc.update("UPDATE requirement_change SET state='rejected' WHERE run_id=:run AND state='pending' AND based_on_revision<:next",
                args(revision));
    }

    @Override
    public boolean canRerun(NodeTarget node) {
        return jdbc.queryForList(RERUN_TARGETS + " AND e.node_id=:node AND e.wave=:wave", args(node)).size() == 1;
    }

    @Override
    public void rerun(NodeTarget node) {
        var args = args(node).addValue("id", UUID.randomUUID());
        jdbc.update(RERUN_GRAPH + """
                UPDATE node_execution e SET state='blocked' FROM descendants d
                WHERE d.source=:node AND d.target=e.node_id AND e.run_id=:run AND e.state='ready' AND e.started_at IS NULL
                """, args);
        jdbc.update("""
                INSERT INTO node_execution(id,run_id,workflow_id,workflow_version,node_id,wave,requirement_revision,state)
                SELECT :id,id,workflow_id,workflow_version,:node,CAST(:wave AS integer)+1,current_revision,'blocked'
                FROM run WHERE id=:run
                """, args);
    }

    private static MapSqlParameterSource args(NodeTarget node) {
        return new MapSqlParameterSource("run", node.run()).addValue("node", node.node()).addValue("wave", node.wave());
    }

    private static MapSqlParameterSource args(Revision revision) {
        return args(revision.node()).addValue("actor", revision.actor()).addValue("requirement", revision.requirement())
                .addValue("revision", revision.revision()).addValue("source", revision.sourceVersion())
                .addValue("execution", revision.execution()).addValue("next", revision.next());
    }

    static final String FAILED_ROLES = """
            SELECT t.id,t.execution_id,t.kind,t.node_id,e.wave,t.current_attempt,a.attempt_id,a.reason_code,v.display_name
            FROM role_task t JOIN task_attempt a ON (a.task_id,a.attempt_number)=(t.id,t.current_attempt)
            JOIN node_execution e ON e.id=t.execution_id JOIN run r ON r.id=t.run_id
            JOIN agent_version v ON (v.agent_id,v.version)=(t.agent_id,t.agent_version)
            WHERE t.run_id=:run AND r.finished_at IS NULL AND a.state='failed' AND a.disposition IS NULL
              AND e.state IN ('running','waiting_reply','needs_attention') AND task_route_is_open(t.run_id,t.node_id)
              AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE (x.run_id,x.node_id)=(e.run_id,e.node_id))
            """;

    static final String ACTIVE_BRD = """
            SELECT e.id AS execution_id,e.node_id,e.wave,n.name,r.current_revision,c.version AS source_version,
                c.owner_id,v.title,v.description,q.name AS source_title,q.name_key AS source_name_key
            FROM node_execution e JOIN run r ON r.id=e.run_id JOIN configuration c ON c.id=r.requirement_id
            JOIN requirement q ON q.id=r.requirement_id
            JOIN workflow_node n ON (n.workflow_id,n.workflow_version,n.node_id)=(e.workflow_id,e.workflow_version,e.node_id)
            JOIN run_requirement_revision v ON (v.run_id,v.revision)=(r.id,r.current_revision)
            WHERE e.run_id=:run AND r.finished_at IS NULL AND n.kind='work' AND n.purpose='requirement'
              AND e.state IN ('running','waiting_reply','needs_attention') AND task_route_is_open(e.run_id,e.node_id)
              AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE (x.run_id,x.node_id)=(e.run_id,e.node_id))
            """;

    private static final String RERUN_GRAPH = """
            WITH RECURSIVE workflow_edges(source,target) AS (
                SELECT d.prerequisite_node_id,d.node_id FROM workflow_dependency d JOIN run r
                    ON (d.workflow_id,d.workflow_version)=(r.workflow_id,r.workflow_version) WHERE r.id=:run
                UNION
                SELECT d.check_node_id,d.node_id FROM workflow_route_node d JOIN run r
                    ON (d.workflow_id,d.workflow_version)=(r.workflow_id,r.workflow_version) WHERE r.id=:run
            ), descendants(source,target) AS (
                SELECT source,target FROM workflow_edges
                UNION SELECT d.source,e.target FROM descendants d JOIN workflow_edges e ON e.source=d.target
            )
            """;

    static final String RERUN_TARGETS = RERUN_GRAPH + """
            SELECT e.node_id,e.wave,n.name FROM node_execution e JOIN run r ON r.id=e.run_id
            JOIN workflow_node n ON (n.workflow_id,n.workflow_version,n.node_id)=(e.workflow_id,e.workflow_version,e.node_id)
            WHERE e.run_id=:run AND r.finished_at IS NULL AND e.state='complete' AND n.kind='work'
              AND e.requirement_revision<r.current_revision AND task_route_is_open(e.run_id,e.node_id)
              AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE (x.run_id,x.node_id)=(e.run_id,e.node_id))
              AND NOT EXISTS(SELECT 1 FROM descendants d JOIN node_execution child ON child.run_id=e.run_id AND child.node_id=d.target
                  JOIN workflow_node w ON (w.workflow_id,w.workflow_version,w.node_id)=(child.workflow_id,child.workflow_version,child.node_id)
                  WHERE d.source=e.node_id AND child.started_at IS NOT NULL
                    AND (w.kind='check' OR child.state NOT IN ('complete','skipped')))
            """;
}
