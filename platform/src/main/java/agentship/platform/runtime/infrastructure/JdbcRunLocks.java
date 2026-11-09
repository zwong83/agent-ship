package agentship.platform.runtime.infrastructure;

import agentship.platform.runtime.api.ArchiveRunAccess;
import agentship.platform.runtime.application.port.RunLocks;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcRunLocks implements RunLocks, ArchiveRunAccess {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcRunLocks(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public UUID requirementId(UUID run) {
        var requirements = jdbc.query("SELECT requirement_id FROM run WHERE id=:run", Map.of("run", run),
                (rs, row) -> rs.getObject(1, UUID.class));
        return requirements.isEmpty() ? null : requirements.getFirst();
    }

    @Override
    public Map<String, Object> lock(UUID run, UUID requirement, boolean skipLocked) {
        var config = jdbc.queryForList("SELECT id FROM configuration WHERE id=:id FOR UPDATE"
                + (skipLocked ? " SKIP LOCKED" : ""), Map.of("id", requirement));
        if (config.isEmpty()) return null;
        return jdbc.queryForMap("""
                SELECT r.*,c.owner_id AS current_owner,p.display_name AS repository_name,p.provider AS repository_provider,
                    p.provider_repository_id,p.default_branch AS repository_default_branch
                FROM run r JOIN configuration c ON c.id=r.requirement_id LEFT JOIN repository p ON p.id=r.repository_id
                WHERE r.id=:id FOR UPDATE OF r
                """, Map.of("id", run));
    }

    @Override
    public Run lockArchiveRun(UUID run) {
        UUID requirement = requirementId(run);
        return requirement == null ? null : archiveRun(lock(run, requirement, false));
    }

    @Override
    public Run tryLockArchiveRun(UUID run, UUID requirement) {
        return archiveRun(lock(run, requirement, true));
    }

    @Override
    public boolean matchesFinalArtifact(UUID run, UUID artifact, String commit) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM artifact a JOIN role_task t ON t.id=a.task_id AND t.kind='coordinator'
                    JOIN node_execution e ON e.id=a.execution_id AND e.state='complete'
                    JOIN task_attempt q ON q.attempt_id=a.attempt_id AND q.task_id=t.id AND q.state='succeeded'
                    WHERE (a.run_id,a.id,a.commit_id)=(:run,:artifact,:commit) AND a.content_digest IS NOT NULL
                    AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE (x.run_id,x.node_id)=(e.run_id,e.node_id)))
                """, Map.of("run", run, "artifact", artifact, "commit", commit), Boolean.class));
    }

    @Override
    public void archiveChanged(UUID run) {
        jdbc.update("UPDATE run SET state_version=state_version+1 WHERE id=:run", Map.of("run", run));
    }

    private static Run archiveRun(Map<String, Object> row) {
        if (row == null) return null;
        return new Run((UUID) row.get("id"), (UUID) row.get("requirement_id"), (UUID) row.get("device_id"),
                (UUID) row.get("current_owner"), (UUID) row.get("initiator_id"), (String) row.get("state"),
                (String) row.get("mode"), (String) row.get("repository_name"),
                (String) row.get("provider_repository_id"), (String) row.get("base_commit"));
    }
}
