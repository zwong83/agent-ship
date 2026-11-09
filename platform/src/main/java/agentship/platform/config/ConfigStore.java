package agentship.platform.config;

import agentship.platform.web.Actor;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class ConfigStore {
    private static final String READ_OBJECTS = """
            SELECT c.id,c.kind,c.owner_id,c.version,
                   coalesce(r.name,w.name,g.name) AS name,
                   lower(coalesce(r.name,w.name,g.name)) AS sort_name,
                   r.project_id,r.description AS requirement_description,
                   repo.provider,repo.provider_repository_id,repo.display_name AS repository_name,
                   def.id AS agent_id,def.role_key,
                   av.display_name AS agent_display_name,lower(av.display_name) AS agent_sort_name,
                   av.instruction,av.skill_ref,
                   (SELECT max(wv.version) FROM workflow_version wv WHERE wv.workflow_id=c.id AND wv.sealed_at IS NOT NULL) AS workflow_version,
                   EXISTS (SELECT 1 FROM configuration_deputy d
                           WHERE d.configuration_id=c.id AND d.account_id=:actor
                             AND d.revoked_at IS NULL) AS deputy,
                   EXISTS (SELECT 1 FROM configuration_deputy d
                           WHERE d.configuration_id=c.id AND d.account_id=:actor
                             AND d.revoked_at IS NOT NULL) AS former_deputy
            FROM configuration c
            LEFT JOIN requirement r ON r.id=c.id
            LEFT JOIN workflow w ON w.id=c.id
            LEFT JOIN agent_config g ON g.id=c.id
            LEFT JOIN repository repo ON repo.id=r.repository_id
            LEFT JOIN agent_definition def ON def.agent_config_id=g.id
            LEFT JOIN LATERAL (
                SELECT display_name,instruction,skill_ref
                FROM agent_version WHERE agent_id=def.id ORDER BY version DESC LIMIT 1
            ) av ON true
            """;
    private static final String ACTIVE_RELATIONSHIP = """
            (c.owner_id=:actor OR EXISTS (
                SELECT 1 FROM configuration_deputy d
                WHERE d.configuration_id=c.id AND d.account_id=:actor AND d.revoked_at IS NULL
            ))
            """;

    private final NamedParameterJdbcTemplate jdbc;

    ConfigStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    record Header(UUID id, UUID owner, long version) {}
    record Row(UUID id, UUID owner, long version, String name, String sortName, UUID project,
               String description, String provider, String repositoryId, String repositoryName,
               UUID agentId, String roleKey, String agentName, String agentSortName, String instruction, String skillRef,
               boolean deputy, boolean formerDeputy, Long workflowVersion) {}
    record Identity(UUID id, String displayName, String username) {}
    record Project(UUID id, String name, String sortName) {}
    record Receipt(byte[] digest, String resultKind, UUID resultId, boolean fresh) {}

    private static final RowMapper<Row> OBJECT = (rs, row) -> new Row(
            id(rs,"id"), id(rs,"owner_id"), rs.getLong("version"), rs.getString("name"),
            rs.getString("sort_name"), id(rs,"project_id"), rs.getString("requirement_description"),
            rs.getString("provider"), rs.getString("provider_repository_id"), rs.getString("repository_name"),
            id(rs,"agent_id"), rs.getString("role_key"), rs.getString("agent_display_name"), rs.getString("agent_sort_name"),
            rs.getString("instruction"), rs.getString("skill_ref"), rs.getBoolean("deputy"),
            rs.getBoolean("former_deputy"),rs.getObject("workflow_version",Long.class));
    private static final RowMapper<Identity> USER = (rs, row) ->
            new Identity(id(rs,"id"),rs.getString("display_name"),rs.getString("username"));

    boolean currentSession(Actor actor) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT active_browser_session(:actor,:session)",
                args(actor.id()).addValue("session",actor.sessionId()), Boolean.class));
    }

    Optional<Row> get(ConfigService.Kind kind, UUID objectId, UUID actor) {
        return one(READ_OBJECTS + " WHERE c.id=:id AND c.kind=:kind",
                objectArgs(kind, objectId, actor), OBJECT);
    }

    Optional<Header> lock(ConfigService.Kind kind, UUID objectId, UUID actor) {
        return one("""
                SELECT id,owner_id,version FROM configuration
                WHERE id=:id AND kind=:kind FOR UPDATE
                """,objectArgs(kind, objectId, actor),
                (rs,row) -> new Header(id(rs,"id"),id(rs,"owner_id"),rs.getLong("version")));
    }

    List<Row> list(ConfigService.Kind kind, UUID actor, UUID project, String needle,
                   ConfigCursor.Position after, int count, boolean ownerOnly, boolean catalog, boolean usableFlow) {
        String name = catalog ? "lower(av.display_name)" : "lower(coalesce(r.name,w.name,g.name))";
        String orderingId = catalog ? "def.id" : "c.id";
        StringBuilder sql = new StringBuilder(READ_OBJECTS).append(" WHERE c.kind=:kind AND ");
        sql.append(ownerOnly ? "c.owner_id=:actor" : ACTIVE_RELATIONSHIP);
        MapSqlParameterSource params = args(actor).addValue("kind",kind.database).addValue("needle",needle)
                .addValue("count",count);
        if (project != null) {
            sql.append(" AND r.project_id=:project");
            params.addValue("project",project);
        }
        if (catalog) {
            sql.append(" AND def.id IS NOT NULL AND av.display_name IS NOT NULL");
        }
        if (usableFlow) {
            sql.append(" AND EXISTS (SELECT 1 FROM workflow_version wv WHERE wv.workflow_id=c.id AND wv.sealed_at IS NOT NULL)");
        }
        sql.append(" AND strpos(").append(name).append(",:needle)>0");
        if (after != null) {
            sql.append(" AND (").append(name).append(',').append(orderingId)
                    .append(") > (:afterName,:afterId)");
            params.addValue("afterName",after.name()).addValue("afterId",after.id());
        }
        sql.append(" ORDER BY ").append(name).append(',').append(orderingId).append(" LIMIT :count");
        return jdbc.query(sql.toString(),params,OBJECT);
    }

    boolean projectPermission(UUID project, UUID actor, String capability) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM project_permission
                 WHERE project_id=:project AND account_id=:actor AND capability=:capability
                   AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>statement_timestamp()))
                """,args(actor).addValue("project",project).addValue("capability",capability), Boolean.class));
    }

    List<Project> projects(UUID actor, String needle, ConfigCursor.Position after, int count) {
        String sql = """
                SELECT p.id,p.name,lower(p.name) AS sort_name FROM project p
                WHERE EXISTS (
                    SELECT 1 FROM project_permission pp
                    WHERE pp.project_id=p.id AND pp.account_id=:actor AND pp.capability='view_project'
                      AND pp.revoked_at IS NULL AND (pp.expires_at IS NULL OR pp.expires_at>statement_timestamp())
                ) AND strpos(lower(p.name),:needle)>0
                """;
        MapSqlParameterSource params = args(actor).addValue("needle",needle).addValue("count",count);
        if (after != null) {
            sql += " AND (lower(p.name),p.id) > (:afterName,:afterId)";
            params.addValue("afterName",after.name()).addValue("afterId",after.id());
        }
        return jdbc.query(sql + " ORDER BY lower(p.name),p.id LIMIT :count",params,
                (rs,row) -> new Project(id(rs,"id"),rs.getString("name"),rs.getString("sort_name")));
    }

    Identity owner(UUID id) {
        return jdbc.queryForObject("SELECT id,display_name,username FROM account WHERE id=:id",
                new MapSqlParameterSource("id",id),USER);
    }

    List<Identity> deputies(UUID id) {
        return jdbc.query("""
                SELECT a.id,a.display_name,a.username FROM configuration_deputy d
                JOIN account a ON a.id=d.account_id
                WHERE d.configuration_id=:id AND d.revoked_at IS NULL
                ORDER BY a.username_key,a.id
                """,new MapSqlParameterSource("id",id),USER);
    }

    Optional<Identity> activeAccount(String username) {
        return one("""
                SELECT id,display_name,username FROM account WHERE username_key=:username AND status='active'
                """,new MapSqlParameterSource("username",username),USER);
    }

    void lockName(String key) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))",
                new MapSqlParameterSource("key",key),rs -> null);
    }

    Optional<Header> requirementName(String key) {
        return one("""
                SELECT c.id,c.owner_id,c.version FROM requirement r
                JOIN configuration c ON c.id=r.id WHERE r.name_key=:key
                """,new MapSqlParameterSource("key",key),
                (rs,row) -> new Header(id(rs,"id"),id(rs,"owner_id"),rs.getLong("version")));
    }

    void createBase(ConfigService.Kind kind, UUID id, UUID actor) {
        jdbc.update("""
                INSERT INTO configuration(id,kind,owner_id,version) VALUES (:id,:kind,:actor,1)
                """,objectArgs(kind,id,actor));
    }

    void createRequirement(UUID id, UUID project, String name, String key, String description) {
        jdbc.update("""
                INSERT INTO requirement(id,project_id,name,name_key,description)
                VALUES (:id,:project,:name,:nameKey,:description)
                """,new MapSqlParameterSource("id",id).addValue("project",project).addValue("name",name)
                .addValue("nameKey",key).addValue("description",description));
    }

    void updateRequirement(UUID id, String name, String key, String description) {
        jdbc.update("""
                UPDATE requirement SET name=:name,name_key=:nameKey,description=:description WHERE id=:id
                """,new MapSqlParameterSource("id",id).addValue("name",name)
                .addValue("nameKey",key).addValue("description",description));
    }

    void createFlow(UUID id, String name) {
        jdbc.update("INSERT INTO workflow(id,name) VALUES (:id,:name)",Map.of("id",id,"name",name));
    }

    void renameFlow(UUID id, String name) {
        jdbc.update("UPDATE workflow SET name=:name WHERE id=:id",Map.of("id",id,"name",name));
    }

    void createAgent(UUID id, String name, String roleKey) {
        jdbc.update("INSERT INTO agent_config(id,name) VALUES (:id,:name)",Map.of("id",id,"name",name));
        jdbc.update("""
                INSERT INTO agent_definition(id,role_key,source,agent_config_id)
                VALUES (:id,:roleKey,'configured',:id)
                """,Map.of("id",id,"roleKey",roleKey));
    }

    boolean roleKeyExists(String roleKey) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM agent_definition WHERE role_key=:roleKey)",
                Map.of("roleKey",roleKey),Boolean.class));
    }

    void writeAgentVersion(UUID id, String name, String instruction, String skillRef) {
        jdbc.update("UPDATE agent_config SET name=:name WHERE id=:id",Map.of("id",id,"name",name));
        jdbc.update("""
                INSERT INTO agent_version(agent_id,version,display_name,instruction,skill_ref)
                SELECT :id,coalesce(max(version),0)+1,:name,:instruction,:skillRef
                FROM agent_version WHERE agent_id=:id
                """,new MapSqlParameterSource("id",id).addValue("name",name)
                .addValue("instruction",instruction).addValue("skillRef",skillRef));
    }

    void bumpVersion(UUID id) {
        jdbc.update("""
                UPDATE configuration SET version=version+1,updated_at=statement_timestamp() WHERE id=:id
                """,Map.of("id",id));
    }

    void addDeputy(UUID object, UUID target, UUID owner) {
        jdbc.update("""
                INSERT INTO configuration_deputy(configuration_id,account_id,granted_by)
                VALUES (:object,:target,:owner)
                ON CONFLICT(configuration_id,account_id) DO UPDATE
                SET granted_by=excluded.granted_by,granted_at=statement_timestamp(),revoked_at=NULL
                """,Map.of("object",object,"target",target,"owner",owner));
        bumpVersion(object);
    }

    boolean removeDeputy(UUID object, UUID target) {
        int removed = jdbc.update("""
                UPDATE configuration_deputy SET revoked_at=statement_timestamp()
                WHERE configuration_id=:object AND account_id=:target AND revoked_at IS NULL
                """,Map.of("object",object,"target",target));
        if (removed == 0) {
            return false;
        }
        bumpVersion(object);
        return true;
    }

    void transfer(UUID object, UUID from, UUID to) {
        jdbc.update("""
                UPDATE configuration
                SET owner_id=:to,version=version+1,updated_at=statement_timestamp() WHERE id=:object
                """,Map.of("object",object,"to",to));
        jdbc.update("""
                UPDATE configuration_deputy SET revoked_at=statement_timestamp()
                WHERE configuration_id=:object AND account_id IN (:from,:to) AND revoked_at IS NULL
                """,Map.of("object",object,"from",from,"to",to));
    }

    Receipt reserve(UUID actor, String scope, String key, byte[] digest) {
        MapSqlParameterSource params = args(actor).addValue("scope",scope).addValue("key",key)
                .addValue("digest",digest);
        int inserted = jdbc.update("""
                INSERT INTO command_receipt(actor_kind,actor_account_id,scope,request_key,request_digest)
                VALUES ('account',:actor,:scope,:key,:digest)
                ON CONFLICT (actor_kind,actor_id,scope,request_key) DO NOTHING
                """,params);
        if (inserted == 1) {
            return new Receipt(digest,null,null,true);
        }
        return jdbc.queryForObject("""
                SELECT request_digest,result_kind,result_id FROM command_receipt
                WHERE actor_kind='account' AND actor_id=:actor AND scope=:scope AND request_key=:key
                """,params,(rs,row) -> new Receipt(rs.getBytes("request_digest"),rs.getString("result_kind"),
                id(rs,"result_id"),false));
    }

    void finish(UUID actor, String scope, String key, String resultKind, UUID resultId) {
        jdbc.update("""
                UPDATE command_receipt SET accepted_at=statement_timestamp(),result_kind=:kind,result_id=:result
                WHERE actor_kind='account' AND actor_id=:actor AND scope=:scope AND request_key=:key
                """,Map.of("actor",actor,"scope",scope,"key",key,"kind",resultKind,"result",resultId));
    }

    void audit(UUID actor, UUID object, ConfigService.Kind kind, String action, String requestId) {
        jdbc.update("""
                INSERT INTO audit_event(id,request_id,actor_account_id,target_kind,target_id,action,outcome)
                VALUES (:id,:request,:actor,:kind,:object,:action,'accepted')
                """,Map.of("id",UUID.randomUUID(),"request",requestId,"actor",actor,
                "kind",kind.database,"object",object,"action",action));
    }

    private static MapSqlParameterSource args(UUID actor) {
        return new MapSqlParameterSource("actor",actor);
    }

    private static MapSqlParameterSource objectArgs(ConfigService.Kind kind, UUID id, UUID actor) {
        return args(actor).addValue("kind",kind.database).addValue("id",id);
    }

    private static UUID id(ResultSet rs, String name) throws SQLException {
        return rs.getObject(name, UUID.class);
    }

    private <T> Optional<T> one(String sql, MapSqlParameterSource params, RowMapper<T> mapper) {
        return jdbc.query(sql,params,mapper).stream().findFirst();
    }
}
