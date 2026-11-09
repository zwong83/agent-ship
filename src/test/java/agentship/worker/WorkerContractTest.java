package agentship.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WorkerContractTest {
    private static final String RUN = "c21e19f0-5eb2-443a-9de6-aae868050106";
    private static final String JOB = "dbb7561c-5b0a-4c39-b764-a69f6d32f861";
    private static final String TOKEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";
    private static final WorkerProtocol.Device DEVICE = new WorkerProtocol.Device(RUN, TOKEN, "demo");
    private static final Clock FIXED_CLOCK = Clock.fixed(Instant.ofEpochMilli(1_700_000_000_000L), ZoneOffset.UTC);

    @TempDir
    Path stateDirectory;

    @Test
    void deviceProofIsLoopbackAndOnlyAvailableToPairedOrigin() throws Exception {
        String origin = "http://127.0.0.1:4173";
        try (DeviceBridge bridge = new DeviceBridge(origin, DEVICE, 0, FIXED_CLOCK)) {
            bridge.start();
            var client = HttpClient.newHttpClient();
            var address = URI.create("http://127.0.0.1:" + bridge.port() + "/proof");
            var denied = client.send(HttpRequest.newBuilder(address)
                .header("Origin", "http://127.0.0.1:4174").GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(403, denied.statusCode());
            assertFalse(denied.headers().firstValue("Access-Control-Allow-Origin").isPresent());
            var allowed = client.send(HttpRequest.newBuilder(address)
                .header("Origin", origin).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, allowed.statusCode());
            assertEquals(origin, allowed.headers().firstValue("Access-Control-Allow-Origin").orElseThrow());
            JsonNode proof = WorkerProtocol.JSON.readTree(allowed.body());
            assertEquals(RUN, proof.path("deviceId").asText());
            assertEquals(FIXED_CLOCK.millis(), proof.path("issuedAt").asLong());
            assertEquals("b9cc44f8c1bf7ec3b2848a08690ebaeab34b937066a11cd36a5950121c00eb1fe",
                proof.path("signature").asText());
            assertFalse(allowed.body().contains(TOKEN));
        }
    }

    @Test
    void demoTaskReplaysJournaledResultWhenLeaseChanges() throws Exception {
        var payload = WorkerProtocol.object();
        payload.put("title", "恢复验证");
        payload.putObject("role").put("name", "测试").put("prompt", "[demo:question]");
        payload.putObject("node").put("name", "检查").put("type", "work");
        var firstJob = new WorkerProtocol.Job(JOB, "agent", "old-lease", 1, payload);
        List<JsonNode> results = new ArrayList<>();

        try (var first = new WorkerRuntime(DEVICE, stateDirectory, 2, scripted(firstJob, results))) {
            first.pollOnce();
            first.drain();
        }
        assertEquals("question", results.getFirst().path("type").asText());
        assertEquals("old-lease", results.getFirst().path("lease").asText());

        var resumedPayload = payload.deepCopy().put("input", "This would change the result if rerun.");
        var resumedJob = new WorkerProtocol.Job(JOB, "agent", "new-lease", 1, resumedPayload);
        try (var resumed = new WorkerRuntime(DEVICE, stateDirectory, 2, scripted(resumedJob, results))) {
            resumed.pollOnce();
            resumed.drain();
        }
        assertEquals(2, results.size());
        assertEquals("new-lease", results.getLast().path("lease").asText());
        assertEquals(results.getFirst().path("result"), results.getLast().path("result"));
        assertEquals("question", results.getLast().path("type").asText());
    }

    @Test
    void publicationReconcilesSavedRemoteRunBeforeDispatchingAgain() throws Exception {
        var payload = WorkerProtocol.object().put("repo", "owner/example");
        payload.putObject("node").put("workflow", "release.yml").put("target", "pilot");
        payload.putObject("git").put("branch", "feature/example");
        var command = new ArrayList<List<String>>();
        var provider = new GitProvider((directory, args) -> {
            command.add(args);
            if (args.subList(1, 3).equals(List.of("workflow", "run"))) {
                return "https://github.com/owner/example/actions/runs/123";
            }
            return """
                {"status":"completed","conclusion":"success","headBranch":"feature/example",
                 "url":"https://github.com/owner/example/actions/runs/123"}
                """;
        }, FIXED_CLOCK);
        List<JsonNode> checkpoints = new ArrayList<>();
        var first = provider.deploy(payload, stateDirectory, checkpoints::add);
        payload.set("checkpoint", checkpoints.getLast().path("checkpoint"));
        var second = provider.deploy(payload, stateDirectory, ignored -> {});

        assertEquals(first, second);
        assertEquals("codex", second.path("mode").asText());
        assertEquals(List.of(List.of("workflow", "run"), List.of("run", "view"), List.of("run", "view")),
            command.stream().map(args -> args.subList(1, 3)).toList());
    }

    @Test
    void publishingRejectsCredentialPathsBeforeAnyGitMutation() throws Exception {
        var payload = WorkerProtocol.object();
        payload.putObject("node").put("name", "Build");
        payload.putObject("git").put("branch", "feature/example");
        var command = new ArrayList<String>();
        var provider = new GitProvider((directory, args) -> {
            command.add(args.get(1));
            return switch (args.get(1)) {
                case "status" -> "?? config/.env.local";
                case "diff" -> "";
                case "ls-files" -> "config/.env.local\0";
                default -> throw new AssertionError(args);
            };
        }, FIXED_CLOCK);
        assertThrows(WorkerProtocol.Failure.class, () -> provider.publishCode(payload, stateDirectory));
        assertEquals(List.of("status", "diff", "ls-files"), command);
    }

    @Test
    void sharedPlatformOriginRequiresHttpsAndRejectsCredentials() {
        assertEquals(URI.create("https://agentship.example"), WorkerMain.platformOrigin("https://agentship.example/"));
        assertThrows(WorkerProtocol.Failure.class, () -> WorkerMain.platformOrigin("http://agentship.example"));
        assertThrows(WorkerProtocol.Failure.class, () -> WorkerMain.platformOrigin("https://x@agentship.example"));
    }

    private WorkerProtocol.Platform scripted(WorkerProtocol.Job job, List<JsonNode> results) {
        return (path, body, token) -> {
            assertEquals(TOKEN, token);
            if (path.equals("/api/worker/poll")) {
                assertEquals(2, body.path("limit").asInt());
                assertTrue(body.path("active").isArray());
                var response = WorkerProtocol.object();
                response.putArray("jobs").add(WorkerProtocol.JSON.valueToTree(job));
                response.putArray("updates");
                return response;
            }
            assertEquals("/api/worker/jobs/" + JOB + "/event", path);
            assertNotNull(body.path("result"));
            results.add(body);
            return WorkerProtocol.object().put("accepted", true);
        };
    }
}
