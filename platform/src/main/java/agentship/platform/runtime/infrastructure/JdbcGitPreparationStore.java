package agentship.platform.runtime.infrastructure;

import agentship.platform.runtime.application.port.GitPreparationStore;
import agentship.platform.runtime.domain.GitPlan;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcGitPreparationStore implements GitPreparationStore {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcGitPreparationStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Operation ensure(UUID requirement, UUID run, String mode, GitPlan.Operation planned) {
        var args = new MapSqlParameterSource("id", UUID.randomUUID()).addValue("key", planned.operationKey())
                .addValue("requirement", requirement).addValue("run", run).addValue("mode", mode)
                .addValue("effect", planned.effect()).addValue("target", planned.targetId());
        jdbc.update("""
                INSERT INTO external_operation(id,operation_key,requirement_id,run_id,provider,mode,effect,target_key,state)
                VALUES(:id,:key,:requirement,:run,'github',:mode,:effect,:target,'intended') ON CONFLICT DO NOTHING
                """, args);
        return jdbc.queryForObject("SELECT * FROM external_operation WHERE operation_key=:key FOR UPDATE",
                args, (rs, row) -> new Operation(rs.getObject("id", UUID.class), rs.getString("operation_key"),
                        rs.getString("effect"), rs.getString("target_key"), rs.getString("state"), rs.getString("provider_result_id")));
    }

    @Override
    public UUID operationId(String key) {
        return jdbc.queryForObject("SELECT id FROM external_operation WHERE operation_key=:key", Map.of("key", key), UUID.class);
    }

    @Override
    public Instant grantDeadline(UUID run, String effect, String target, UUID owner) {
        var grants = jdbc.query("""
                SELECT expires_at FROM run_external_grant WHERE run_id=:run AND effect=:effect AND target_key=:target
                AND revoked_at IS NULL AND expires_at>statement_timestamp() AND approved_by=:owner
                """, Map.of("run", run, "effect", effect, "target", target, "owner", owner),
                (rs, row) -> rs.getTimestamp("expires_at").toInstant());
        return grants.isEmpty() ? null : grants.getFirst();
    }

    @Override
    public void associateTask(UUID operation, UUID task) {
        jdbc.update("INSERT INTO external_operation_task(operation_id,task_id) VALUES(:operation,:task) ON CONFLICT DO NOTHING",
                Map.of("operation", operation, "task", task));
    }

    @Override
    public void dispatch(UUID operation, UUID task, long epoch, Instant deadline) {
        jdbc.update("""
                UPDATE external_operation SET state='dispatching',last_authorized_task_id=:task,last_authorized_epoch=:epoch,
                    authorization_deadline=:deadline WHERE id=:id
                """, Map.of("task", task, "epoch", epoch, "deadline", Timestamp.from(deadline), "id", operation));
    }

    @Override
    public boolean scopedToTask(UUID operation, UUID task) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM external_operation_task WHERE operation_id=:id AND task_id=:task)",
                Map.of("id", operation, "task", task), Boolean.class));
    }

    @Override
    public List<UUID> successfulRepositories(UUID operation) {
        return jdbc.query("SELECT repository_id FROM operation_evidence WHERE operation_id=:id AND outcome='confirmed_success'",
                Map.of("id", operation), (rs, row) -> rs.getObject("repository_id", UUID.class));
    }

    @Override
    public Observation confirmedObservation(UUID operation) {
        return jdbc.queryForObject("""
                SELECT * FROM operation_evidence WHERE operation_id=:id AND outcome='confirmed_success'
                ORDER BY recorded_at DESC,id LIMIT 1
                """, Map.of("id", operation), JdbcGitPreparationStore::observation);
    }

    @Override
    public Observation observe(UUID operation, UUID task, String target, Instant at, String providerResult, Observation value) {
        UUID evidence = UUID.randomUUID();
        var args = new MapSqlParameterSource("id", evidence).addValue("operation", operation).addValue("task", task)
                .addValue("outcome", value.outcome()).addValue("result", providerResult).addValue("repository", value.repository())
                .addValue("branch", value.branch()).addValue("commit", value.commit()).addValue("target", target)
                .addValue("observed", Timestamp.from(at));
        jdbc.update("""
                INSERT INTO operation_evidence(id,operation_id,source_task_id,outcome,provider_result_id,repository_id,
                    observed_branch,observed_commit,observed_target,observed_at)
                VALUES(:id,:operation,:task,:outcome,:result,:repository,:branch,:commit,:target,:observed)
                """, args);
        String next = switch (value.outcome()) {
            case "confirmed_success" -> "succeeded";
            case "confirmed_failure" -> "failed";
            default -> "unknown";
        };
        jdbc.update("UPDATE external_operation SET state=:state,provider_result_id=coalesce(:result,provider_result_id) WHERE id=:operation",
                args.addValue("state", next));
        return value;
    }

    @Override
    public void markUnknown(UUID operation) {
        jdbc.update("UPDATE external_operation SET state='unknown' WHERE id=:id", Map.of("id", operation));
    }

    @Override
    public GitPreparationStore.Repository ensureRepository(String provider, String providerId, String name, String branch) {
        var args = Map.of("id", UUID.randomUUID(), "provider", provider, "remote", providerId, "name", name, "branch", branch);
        jdbc.update("""
                INSERT INTO repository(id,provider,provider_repository_id,display_name,default_branch) VALUES(:id,:provider,:remote,:name,:branch)
                ON CONFLICT(provider,provider_repository_id) DO NOTHING
                """, args);
        return jdbc.queryForObject("SELECT * FROM repository WHERE provider=:provider AND provider_repository_id=:remote",
                args, JdbcGitPreparationStore::repository);
    }

    @Override
    public GitPreparationStore.Repository repository(UUID id) {
        return jdbc.queryForObject("SELECT * FROM repository WHERE id=:id",
                Map.of("id", id), JdbcGitPreparationStore::repository);
    }

    @Override
    public void defaultBranch(UUID repository, String branch) {
        jdbc.update("UPDATE repository SET default_branch=:branch WHERE id=:id",
                Map.of("id", repository, "branch", branch));
    }

    @Override
    public void completeRun(UUID run, UUID repository, String base, String branch, String commit, String defaultBranch) {
        jdbc.update("""
                UPDATE run SET repository_id=:repository,base_branch=:base,work_branch=:work,base_commit=:commit,
                    git_default_branch=:defaultBranch,state='waiting',reason_code='AGENT_EXECUTION_PENDING',state_version=state_version+1 WHERE id=:run
                """, Map.of("repository", repository, "base", base, "work", branch, "commit", commit,
                "defaultBranch", defaultBranch, "run", run));
    }

    @Override
    public void markPreparing(UUID run) {
        jdbc.update("UPDATE run SET state='preparing',reason_code='GIT_PREPARATION_PENDING',state_version=state_version+1 WHERE id=:run",
                Map.of("run", run));
    }

    @Override
    public Map<String, Object> revision(UUID run, Object revision) {
        return jdbc.queryForMap("SELECT * FROM run_requirement_revision WHERE run_id=:run AND revision=:revision",
                Map.of("run", run, "revision", revision));
    }

    private static Observation observation(ResultSet rs, int row) throws SQLException {
        return new Observation(rs.getString("outcome"), rs.getObject("repository_id", UUID.class),
                rs.getString("observed_branch"), rs.getString("observed_commit"));
    }

    private static GitPreparationStore.Repository repository(ResultSet rs, int row) throws SQLException {
        return new GitPreparationStore.Repository(rs.getObject("id", UUID.class), rs.getString("display_name"),
                rs.getString("provider"), rs.getString("provider_repository_id"));
    }
}
