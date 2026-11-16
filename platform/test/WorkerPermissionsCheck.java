import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.UUID;

/** Checks the actual worker sandbox decision, including already-dispatched legacy jobs. */
public class WorkerPermissionsCheck {
    public static void main(String[] args) throws Exception {
        var mapper = new ObjectMapper();
        var jobClass = Class.forName("agentship.worker.AgentWorker$Job");
        var constructor = jobClass.getDeclaredConstructor(JsonNode.class);
        var writable = jobClass.getDeclaredMethod("writable");
        constructor.setAccessible(true);
        writable.setAccessible(true);
        int cases = 0;
        for (String role : new String[]{"coordinator", "agent"}) {
            for (String type : new String[]{"work", "check"}) {
                for (String purpose : new String[]{"requirement", "frontend", "backend", "repair", "test", "other"}) {
                    for (String permission : new String[]{"read_only", "write", "invalid", "absent"}) {
                        var dispatch = mapper.createObjectNode();
                        for (String id : new String[]{"taskId", "attemptId", "runId"}) dispatch.put(id, UUID.randomUUID().toString());
                        dispatch.put("epoch", 1).put("wave", 1).put("kind", role).put("deadlineAt", Instant.now().plusSeconds(60).toString());
                        var input = dispatch.putObject("input");
                        input.putObject("node").put("type", type).put("purpose", purpose);
                        if (!permission.equals("absent")) input.putObject("permissions").put("workspaceAccess", permission);
                        boolean expected = permission.equals("write");
                        if (permission.equals("absent")) expected = role.equals("coordinator") || java.util.Set.of("frontend", "backend", "repair").contains(purpose);
                        if (role.equals("coordinator") && type.equals("check")) expected = false;
                        boolean actual = (boolean) writable.invoke(constructor.newInstance(dispatch));
                        if (actual != expected) throw new AssertionError(role + "/" + type + "/" + purpose + "/" + permission);
                        cases++;
                    }
                }
            }
        }
        System.out.println("PASS " + cases + " worker permission cases: explicit overrides, fail-closed invalid access, check safety and legacy jobs");
    }
}
