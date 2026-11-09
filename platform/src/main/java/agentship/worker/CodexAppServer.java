package agentship.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

final class CodexAppServer implements AutoCloseable {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_LINE = 1024 * 1024;
    private static final JsonNode CLOSED = JSON.nullNode();
    private static final Map<String,Object> OUTPUT_SCHEMA = Map.of(
            "type", "object", "additionalProperties", false,
            "properties", Map.of(
                    "status", Map.of("type", "string", "enum", List.of("complete", "question", "failure")),
                    "artifact", Map.of("type", "string"),
                    "question", Map.of("type", "string"),
                    "reply", Map.of("type", "string"),
                    "verdict", Map.of("type", "string", "enum", List.of("none", "pass", "repair"))),
            "required", List.of("status", "artifact", "question", "reply", "verdict"));
    private final Process process;
    private final Thread reader;
    private final BlockingQueue<JsonNode> messages = new ArrayBlockingQueue<>(128);
    private final AgentWorkspace.Guard guard;
    private final Path cwd;
    private final boolean writable;
    private long requestId;
    private String threadId;
    private String observedTurnId;
    private JsonNode completedTurn;
    private String finalText;
    private String question;

    CodexAppServer(Path cwd, boolean writable, AgentWorkspace.Guard guard) throws IOException {
        this.cwd = cwd;
        this.writable = writable;
        this.guard = guard;
        ProcessBuilder builder = new ProcessBuilder("codex", "-c", "shell_environment_policy.inherit=none",
                "app-server", "--listen", "stdio://").directory(cwd.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD);
        builder.environment().keySet().removeIf(key -> key.startsWith("AGENTSHIP_") || key.startsWith("GIT_")
                || key.equals("SSH_AUTH_SOCK") || key.equals("GH_TOKEN") || key.equals("GITHUB_TOKEN"));
        process = builder.start();
        reader = Thread.startVirtualThread(this::read);
    }

    void initialize() throws Exception {
        initialize(false);
    }

    void initialize(boolean experimental) throws Exception {
        request("initialize", Map.of("clientInfo", Map.of("name", "agentship", "title", "AgentShip", "version", "0.1.0"),
                "capabilities", Map.of("experimentalApi", experimental)));
        write(Map.of("method", "initialized", "params", Map.of()));
    }

    String startThread() throws Exception {
        JsonNode result = request("thread/start", Map.of("cwd", cwd.toString(), "sandbox", writable ? "workspace-write" : "read-only",
                "approvalPolicy", "never", "ephemeral", false));
        return threadId = id(result.path("thread").path("id"));
    }

    void resumeThread(String thread) throws Exception {
        threadId = thread;
        JsonNode result = request("thread/resume", Map.of("threadId", thread, "cwd", cwd.toString(),
                "sandbox", writable ? "workspace-write" : "read-only", "approvalPolicy", "never", "excludeTurns", true));
        if (!thread.equals(id(result.path("thread").path("id")))) throw new IOException("Unexpected Codex thread");
    }

    String startTurn(String operation, String prompt, String skillRef) throws Exception {
        List<Map<String,String>> input = new ArrayList<>();
        input.add(Map.of("type", "text", "text", prompt));
        if (!skillRef.isBlank()) {
            JsonNode found = request("skills/list", Map.of("cwds", List.of(cwd.toString())));
            for (JsonNode item : found.path("data")) {
                for (JsonNode skill : item.path("skills")) {
                    String name = skill.path("name").asText();
                    String path = skill.path("path").asText();
                    if (skill.path("enabled").asBoolean(true) && !path.isBlank() && (name.equals(skillRef) || path.equals(skillRef))) {
                        input.add(Map.of("type", "skill", "name", name, "path", path));
                        break;
                    }
                }
                if (input.size() > 1) break;
            }
            if (input.size() == 1) throw new IOException("Configured Codex skill unavailable");
        }
        Map<String,Object> sandbox = writable
                ? Map.of("type", "workspaceWrite", "writableRoots", List.of(cwd.toString()), "networkAccess", false,
                         "excludeSlashTmp", true, "excludeTmpdirEnvVar", true)
                : Map.of("type", "readOnly", "networkAccess", false);
        JsonNode result = request("turn/start", Map.of("threadId", threadId, "input", input, "cwd", cwd.toString(),
                "clientUserMessageId", operation, "approvalPolicy", "never", "sandboxPolicy", sandbox, "outputSchema", OUTPUT_SCHEMA));
        String started = id(result.path("turn").path("id"));
        if (observedTurnId != null && !started.equals(observedTurnId)) throw new IOException("Unexpected Codex turn");
        return observedTurnId = started;
    }

    String recoverTurn(String expectedTurn, String operation, boolean continuation) throws Exception {
        JsonNode turns = readTurns();
        JsonNode turn = null;
        for (JsonNode candidate : turns) {
            boolean matches = continuation ? hasInput(candidate, operation)
                    : expectedTurn != null ? expectedTurn.equals(candidate.path("id").asText()) : turns.size() == 1;
            if (!matches) continue;
            if (turn != null) throw new IOException("Original Codex turn is ambiguous");
            turn = candidate;
        }
        if (turn == null) throw new IOException("Original Codex turn cannot be confirmed");
        String actual = id(turn.path("id"));
        if (expectedTurn != null && !expectedTurn.equals(actual)) throw new IOException("Unexpected Codex turn");
        observedTurnId = actual;
        turn.path("items").forEach(this::item);
        if (!"inProgress".equals(turn.path("status").asText())) completedTurn = turn;
        return actual;
    }

    void steer(String turn, String inputId, String text) throws Exception {
        JsonNode response = request("turn/steer", Map.of("threadId", threadId, "expectedTurnId", turn,
                "clientUserMessageId", inputId, "input", List.of(Map.of("type", "text", "text", text))));
        if (!turn.equals(id(response.path("turnId")))) throw new IOException("Unexpected Codex steer acknowledgement");
    }

    boolean receivedInput(String turn, String inputId) throws Exception {
        for (JsonNode candidate : readTurns()) {
            if (turn.equals(candidate.path("id").asText()) && hasInput(candidate, inputId)) return true;
        }
        return false;
    }

    private JsonNode readTurns() throws Exception {
        JsonNode thread = request("thread/read", Map.of("threadId", threadId, "includeTurns", true)).path("thread");
        if (!threadId.equals(id(thread.path("id")))) throw new IOException("Unexpected Codex thread");
        return thread.path("turns");
    }

    private static boolean hasInput(JsonNode turn, String clientId) {
        if (clientId == null) return false;
        for (JsonNode item : turn.path("items")) {
            if ("userMessage".equals(item.path("type").asText()) && clientId.equals(item.path("clientId").asText())) return true;
        }
        return false;
    }

    @FunctionalInterface
    interface WhileActive { void handle() throws Exception; }

    Result awaitTurn(String turnId, WhileActive inbox) throws Exception {
        long deadline = System.nanoTime() + Duration.ofMinutes(30).toNanos();
        while (completedTurn == null && question == null) {
            guard.check();
            if (System.nanoTime() >= deadline) throw new IOException("Codex turn timed out");
            JsonNode message = messages.poll(300, TimeUnit.MILLISECONDS);
            if (message == CLOSED) throw new IOException("Codex process disconnected");
            if (message != null) accept(message);
            if (completedTurn == null && question == null) inbox.handle();
        }
        if (question != null) return new Result("question", "", question, "none");
        if (!turnId.equals(id(completedTurn.path("id"))) || !"completed".equals(completedTurn.path("status").asText())) {
            throw new IOException("Codex turn did not complete");
        }
        completedTurn.path("items").forEach(this::item);
        if (finalText == null || finalText.length() > 128_000) throw new IOException("Codex result missing");
        JsonNode result = JSON.readTree(finalText);
        String status = result.path("status").asText();
        String artifact = result.path("artifact").asText();
        String userQuestion = result.path("question").asText();
        String verdict = result.path("verdict").asText();
        String reply = result.path("reply").asText();
        if (!List.of("complete", "question", "failure").contains(status)
                || !List.of("none", "pass", "repair").contains(verdict)
                || ("question".equals(status) && (userQuestion.isBlank() || userQuestion.length() > 4_000))) {
            throw new IOException("Invalid Codex result");
        }
        if (reply.length() > 4_000 || reply.indexOf(0) >= 0) throw new IOException("Invalid Codex reply");
        return new Result(status, artifact, userQuestion, verdict, reply);
    }

    private JsonNode request(String method, Object params) throws Exception {
        return request(method, params, Duration.ofSeconds(30));
    }

    private JsonNode request(String method, Object params, Duration timeout) throws Exception {
        long id = ++requestId;
        long deadline = System.nanoTime() + timeout.toNanos();
        write(Map.of("id", id, "method", method, "params", params));
        for (;;) {
            JsonNode message = next(deadline);
            if (!message.has("method") && message.path("id").isIntegralNumber() && message.path("id").asLong() == id) {
                if (message.has("error") || !message.has("result")) throw new IOException("Codex request failed");
                return message.get("result");
            }
            accept(message);
        }
    }

    JsonNode executeCheck(List<String> command, Map<String,String> environment) throws Exception {
        return request("command/exec", Map.of("command", command, "cwd", cwd.toString(), "env", environment,
                "timeoutMs", 120_000, "outputBytesCap", 65_536,
                "sandboxPolicy", Map.of("type", "workspaceWrite", "writableRoots", List.of(cwd.toString()),
                        "networkAccess", false, "excludeSlashTmp", true, "excludeTmpdirEnvVar", true)), Duration.ofSeconds(130));
    }

    private JsonNode next(long deadline) throws Exception {
        while (System.nanoTime() < deadline) {
            guard.check();
            JsonNode message = messages.poll(300, TimeUnit.MILLISECONDS);
            if (message == CLOSED) throw new IOException("Codex process disconnected");
            if (message != null) return message;
        }
        throw new IOException("Codex request timed out");
    }

    private void accept(JsonNode message) throws Exception {
        String method = message.path("method").asText();
        JsonNode params = message.path("params");
        if (message.hasNonNull("id") && !method.isBlank()) {
            if ("item/tool/requestUserInput".equals(method) && threadId != null && threadId.equals(params.path("threadId").asText())) {
                List<String> questions = new ArrayList<>();
                for (JsonNode input : params.path("questions")) {
                    String text = input.path("question").asText();
                    if (!text.isBlank()) questions.add(text);
                }
                String text = String.join("\n", questions);
                if (!text.isBlank() && text.length() <= 4_000) question = text;
            }
            write(Map.of("id", message.get("id"), "error", Map.of("code", -32601, "message", "AgentShip requires explicit user input")));
            return;
        }
        if (threadId == null || !threadId.equals(params.path("threadId").asText())) return;
        switch (method) {
            case "turn/started" -> observedTurnId = id(params.path("turn").path("id"));
            case "item/completed" -> {
                if (observedTurnId == null || observedTurnId.equals(params.path("turnId").asText())) item(params.path("item"));
            }
            case "turn/completed" -> {
                if (observedTurnId == null || observedTurnId.equals(params.path("turn").path("id").asText())) completedTurn = params.path("turn");
            }
            default -> { }
        }
    }

    private void item(JsonNode item) {
        if ("agentMessage".equals(item.path("type").asText())) finalText = item.path("text").asText();
    }

    private void read() {
        try (var input = new BufferedInputStream(process.getInputStream())) {
            ByteArrayOutputStream line = new ByteArrayOutputStream();
            for (int value; (value = input.read()) != -1;) {
                if (value == '\n') {
                    if (line.size() > 0) messages.put(JSON.readTree(line.toByteArray()));
                    line.reset();
                } else {
                    if (line.size() >= MAX_LINE) throw new IOException("Codex message exceeds limit");
                    line.write(value);
                }
            }
        } catch (Exception ignored) {
            // Protocol and process errors are surfaced as bounded, sanitized task failures.
        } finally {
            if (!messages.offer(CLOSED)) {
                messages.clear();
                messages.offer(CLOSED);
            }
        }
    }

    private void write(Object message) throws Exception {
        guard.check();
        byte[] bytes = JSON.writeValueAsBytes(message);
        if (bytes.length > MAX_LINE) throw new IOException("Codex request exceeds limit");
        FutureTask<Void> send = new FutureTask<>(() -> {
            process.getOutputStream().write(bytes);
            process.getOutputStream().write('\n');
            process.getOutputStream().flush();
            return null;
        });
        Thread.startVirtualThread(send);
        try {
            send.get(5, TimeUnit.SECONDS);
        } catch (ExecutionException | TimeoutException unavailable) {
            throw new IOException("Codex request delivery unavailable");
        } finally {
            send.cancel(true);
        }
    }

    private static String id(JsonNode value) throws IOException {
        String text = value.asText();
        if (!text.matches("[A-Za-z0-9_-]{1,160}")) throw new IOException("Invalid Codex identifier");
        return text;
    }

    @Override public void close() {
        process.descendants().forEach(ProcessHandle::destroyForcibly);
        if (process.isAlive()) process.destroyForcibly();
        reader.interrupt();
    }

    record Result(String status, String artifact, String question, String verdict, String reply) {
        Result(String status, String artifact, String question, String verdict) { this(status, artifact, question, verdict, ""); }
    }
}
