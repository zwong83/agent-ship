package agentship.platform.runtime.infrastructure;

import agentship.platform.runtime.application.port.GitPreparationQuery;
import agentship.platform.runtime.application.query.GitStatusMessages;
import agentship.platform.runtime.domain.GitPlan;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class JdbcGitPreparationView implements GitPreparationQuery {
    private final NamedParameterJdbcTemplate jdbc;
    JdbcGitPreparationView(NamedParameterJdbcTemplate jdbc) { this.jdbc=jdbc; }
    @Override
    public Map<String,Object> read(Map<String,Object> run) {
        var tasks=jdbc.queryForList("""
                SELECT t.id,t.current_attempt,a.state,a.reason_code FROM role_task t JOIN task_attempt a ON a.task_id=t.id
                AND a.attempt_number=t.current_attempt WHERE t.run_id=:run AND t.kind='git'
                """,Map.of("run",run.get("id")));
        if(tasks.isEmpty()) return null;
        var task=tasks.getFirst();
        String state=switch((String)task.get("state")) {
            case "queued"->"queued"; case "succeeded"->"ready"; case "needs_attention","failed","canceled"->"needs_attention"; default->"preparing";
        };
        Map<String,Object> view=new LinkedHashMap<>();
        view.put("state",state); view.put("mode",run.get("mode")); view.put("taskId",task.get("id")); view.put("attemptNumber",task.get("current_attempt"));
        String reason=(String)task.get("reason_code");
        if(reason!=null) { view.put("reasonCode",reason); view.put("message",GitStatusMessages.message(reason)); }
        List<Map<String,Object>> steps=new ArrayList<>();
        for(var planned:GitPlan.operations(run)) {
            var rows=jdbc.queryForList("""
                    SELECT o.*, (SELECT max(e.observed_at) FROM operation_evidence e WHERE e.operation_id=o.id) AS observed_at
                    FROM external_operation o WHERE o.operation_key=:key
                    """,Map.of("key",planned.operationKey()));
            Map<String,Object> step=new LinkedHashMap<>();
            step.put("operationKey",planned.operationKey()); step.put("effect",planned.effect()); step.put("targetId",planned.targetId());
            step.put("state",rows.isEmpty()?"intended":rows.getFirst().get("state"));
            if(!rows.isEmpty()) {
                var operation=rows.getFirst();
                if(operation.get("provider_result_id")!=null) step.put("providerResultId",operation.get("provider_result_id"));
                if(operation.get("observed_at")!=null) step.put("observedAt",((Timestamp)operation.get("observed_at")).toInstant().toString());
            }
            steps.add(step);
        }
        view.put("steps",steps); return view;
    }
}
