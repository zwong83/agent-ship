package agentship.platform.runtime.infrastructure;

import agentship.platform.runtime.application.port.WorkerReceipts;
import agentship.platform.web.ApiProblem;
import agentship.platform.web.RequestFields;
import java.security.MessageDigest;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcWorkerReceipts implements WorkerReceipts {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcWorkerReceipts(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public UUID reserve(UUID device, String scope, String key, byte[] digest) {
        if(key==null || key.isBlank() || key.length()>200 || key.indexOf(0)>=0) throw ApiProblem.invalid();
        var args=new MapSqlParameterSource().addValue("device",device).addValue("scope",scope).addValue("key",key).addValue("digest",digest);
        int inserted=jdbc.update("""
                INSERT INTO command_receipt(actor_kind,actor_device_id,scope,request_key,request_digest)
                VALUES('device',:device,:scope,:key,:digest) ON CONFLICT(actor_kind,actor_id,scope,request_key) DO NOTHING
                """,args);
        if(inserted==1) return null;
        var receipt=jdbc.queryForMap("SELECT request_digest,result_id FROM command_receipt WHERE actor_kind='device' AND actor_id=:device AND scope=:scope AND request_key=:key",args);
        if(!MessageDigest.isEqual(digest,(byte[])receipt.get("request_digest"))) throw RequestFields.conflict("IDEMPOTENCY_CONFLICT","同一请求标识不能用于不同的任务内容");
        return (UUID)receipt.get("result_id");
    }
    @Override
    public void finish(UUID device, String scope, String key, String kind, UUID result) {
        jdbc.update("""
                UPDATE command_receipt SET result_kind=:kind,result_id=:result,accepted_at=statement_timestamp()
                WHERE actor_kind='device' AND actor_id=:device AND scope=:scope AND request_key=:key
                """,Map.of("kind",kind,"result",result,"device",device,"scope",scope,"key",key));
    }
}
