package agentship.platform.archive.infrastructure;

import agentship.platform.archive.application.port.ArchiveStore;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.SqlArrayValue;
import org.springframework.stereotype.Repository;

@Repository
class JdbcArchiveStore implements ArchiveStore {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcArchiveStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean approve(UUID artifact, UUID run, UUID device, UUID actor, Instant retryApproval) {
        return jdbc.update("""
                INSERT INTO artifact_archive(artifact_id,run_id,device_id,approved_by)
                VALUES(:artifact,:run,:device,:actor)
                ON CONFLICT(artifact_id) DO UPDATE SET state='queued',approved_by=:actor,
                    approved_at=statement_timestamp(),available_at=statement_timestamp(),reason_code=NULL,epoch=NULL,lease_until=NULL
                WHERE artifact_archive.state='failed' AND artifact_archive.export_commit IS NULL AND
                    artifact_archive.approved_at=CAST(:retryAt AS timestamptz) AND
                    artifact_archive.reason_code IN ('ARCHIVE_SOURCE_UNAVAILABLE','ARCHIVE_TARGET_UNAVAILABLE','ARCHIVE_GRANT_REQUIRED')
                """, new MapSqlParameterSource("artifact", artifact).addValue("run", run).addValue("device", device)
                .addValue("actor", actor).addValue("retryAt", retryApproval == null ? null : retryApproval.toString())) == 1;
    }

    @Override
    public void auditApproval(UUID artifact, UUID run, UUID actor, String requestId) {
        jdbc.update("""
                INSERT INTO audit_event(id,request_id,actor_account_id,run_id,target_kind,target_id,action,outcome)
                VALUES(:id,:request,:actor,:run,'artifact',:artifact,'approve_archive','accepted')
                """, Map.of("id", UUID.randomUUID(), "request", requestId, "actor", actor, "run", run, "artifact", artifact));
    }

    @Override
    public Entry read(UUID artifact) {
        return jdbc.queryForObject("SELECT * FROM artifact_archive WHERE artifact_id=:artifact",
                Map.of("artifact", artifact), JdbcArchiveStore::entry);
    }

    @Override
    public List<Entry> readVisible(UUID run, Set<UUID> visibleArtifacts) {
        if (visibleArtifacts.isEmpty()) return List.of();
        return jdbc.query("SELECT * FROM artifact_archive WHERE run_id=:run AND artifact_id=ANY(:artifacts)",
                Map.of("run", run, "artifacts", new SqlArrayValue("uuid", visibleArtifacts.toArray(UUID[]::new))),
                JdbcArchiveStore::entry);
    }

    @Override
    public List<Candidate> candidates(UUID device) {
        return jdbc.query("""
                SELECT a.artifact_id,a.run_id,r.requirement_id FROM artifact_archive a JOIN run r ON r.id=a.run_id
                WHERE a.device_id=:device AND ((a.state IN ('queued','unknown') AND a.available_at<=statement_timestamp())
                    OR a.state='leased' AND a.lease_until<=statement_timestamp())
                ORDER BY a.available_at,a.artifact_id LIMIT 8
                """, Map.of("device", device), (rs, row) -> new Candidate(rs.getObject("artifact_id", UUID.class),
                rs.getObject("run_id", UUID.class), rs.getObject("requirement_id", UUID.class)));
    }

    @Override
    public Source lockSource(UUID artifact, UUID device) {
        var rows = jdbc.query("""
                SELECT a.*,p.commit_id,p.source_ref,p.content_digest FROM artifact_archive a JOIN artifact p ON p.id=a.artifact_id
                WHERE a.artifact_id=:artifact AND a.device_id=:device AND
                    ((a.state IN ('queued','unknown') AND a.available_at<=statement_timestamp())
                    OR a.state='leased' AND a.lease_until<=statement_timestamp()) FOR UPDATE OF a
                """, Map.of("artifact", artifact, "device", device),
                (rs, row) -> new Source(entry(rs, row), rs.getString("commit_id"), rs.getString("source_ref"),
                        rs.getBytes("content_digest")));
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Override
    public Lease lease(UUID artifact) {
        return jdbc.queryForObject("""
                UPDATE artifact_archive SET state='leased',epoch=nextval('task_lease_epoch'),
                    lease_until=statement_timestamp()+interval '75 seconds' WHERE artifact_id=:artifact
                RETURNING epoch,lease_until
                """, Map.of("artifact", artifact),
                (rs, row) -> new Lease(rs.getLong("epoch"), instant(rs.getTimestamp("lease_until"))));
    }

    @Override
    public UUID ownedRun(UUID artifact, UUID device) {
        var rows = jdbc.query("SELECT run_id FROM artifact_archive WHERE artifact_id=:artifact AND device_id=:device",
                Map.of("artifact", artifact, "device", device), (rs, row) -> rs.getObject(1, UUID.class));
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Override
    public Entry lockOwned(UUID artifact, UUID device) {
        return jdbc.queryForObject("SELECT * FROM artifact_archive WHERE artifact_id=:artifact AND device_id=:device FOR UPDATE",
                Map.of("artifact", artifact, "device", device), JdbcArchiveStore::entry);
    }

    @Override
    public void pinCommit(UUID artifact, String commit) {
        jdbc.update("UPDATE artifact_archive SET export_commit=:commit WHERE artifact_id=:artifact",
                Map.of("commit", commit, "artifact", artifact));
    }

    @Override
    public void failed(UUID artifact, String reason) {
        jdbc.update("UPDATE artifact_archive SET state='failed',reason_code=:reason WHERE artifact_id=:artifact",
                Map.of("reason", reason, "artifact", artifact));
    }

    @Override
    public void unknown(UUID artifact) {
        jdbc.update("""
                UPDATE artifact_archive SET state='unknown',reason_code='ARCHIVE_RESULT_UNKNOWN',
                    available_at=statement_timestamp()+interval '30 seconds' WHERE artifact_id=:artifact
                """, Map.of("artifact", artifact));
    }

    @Override
    public void succeeded(UUID artifact) {
        jdbc.update("""
                UPDATE artifact_archive SET state='succeeded',reason_code=NULL,confirmed_at=statement_timestamp()
                WHERE artifact_id=:artifact
                """, Map.of("artifact", artifact));
    }

    private static Entry entry(ResultSet rs, int row) throws SQLException {
        return new Entry(rs.getObject("artifact_id", UUID.class), rs.getObject("run_id", UUID.class),
                rs.getObject("approved_by", UUID.class), instant(rs.getTimestamp("approved_at")),
                rs.getString("state"), rs.getObject("epoch", Long.class), instant(rs.getTimestamp("lease_until")),
                rs.getString("export_commit"), rs.getString("reason_code"));
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }
}
