package agentship.worker;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/** Exports only a confirmed final tree with the original repository commit as its parent. */
final class ArchiveWorker implements AutoCloseable {
    private static final String ENDPOINT = "/api/worker/archive/";
    private static final int OUTPUT_LIMIT = 262_144;
    private static final Pattern SOURCE = Pattern.compile(
            "local-git:([0-9a-f-]{36})/([0-9a-f-]{36})/([0-9a-f-]{36})@([0-9a-f]{40}|[0-9a-f]{64}):(.+)");
    private final Path state;
    private final GitProvider provider;
    private final GitWorker.PlatformApi api;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();

    ArchiveWorker(Path state, GitProvider provider, GitWorker.PlatformApi api) {
        this.state = state;
        this.provider = provider;
        this.api = api;
    }

    void tick() {
        if (executor.isShutdown() || !busy.compareAndSet(false, true)) return;
        try {
            executor.submit(() -> {
                try {
                    JsonNode data = api.post(ENDPOINT + "poll", Map.of(), null).get("job");
                    if (data != null) process(new Job(data));
                } catch (Exception ignored) {
                    // The platform keeps the scoped lease and write intent for recovery.
                } finally { busy.set(false); }
            });
        } catch (java.util.concurrent.RejectedExecutionException stopped) {
            busy.set(false);
        }
    }

    private void process(Job job) throws Exception {
        String export = job.data().path("exportCommit").asText();
        boolean mayHaveWritten = !export.isBlank();
        try {
            String remote;
            try { remote = target(job); }
            catch (Exception unavailable) {
                report(job, mayHaveWritten ? "unknown" : "failed", "ARCHIVE_TARGET_UNAVAILABLE", null);
                return;
            }
            if (mayHaveWritten) {
                reconcile(job, remote, export);
                return;
            }
            Path workspace = source(job);
            export = snapshot(job, workspace);
            Path transport = transport(job, workspace, export);
            mayHaveWritten = true;
            JsonNode permission = api.post(ENDPOINT + "authorize", Map.of("artifactId", job.id(), "epoch", job.epoch(), "exportCommit", export), null);
            if ("dispatch".equals(permission.path("decision").asText())) {
                Instant expires = Instant.parse(permission.path("expiresAt").asText());
                String prior = observed(job, remote);
                if (!prior.isEmpty()) {
                    if (!prior.equals(export)) throw new RefConflict();
                } else {
                    if (!expires.isAfter(Instant.now())) { report(job, "unknown", "ARCHIVE_RESULT_UNKNOWN", null); return; }
                    // Git rejects existing tags without a force refspec.
                    git(job, transport, 20, remote, "push", "--porcelain", remote, export + ":" + job.ref());
                }
            }
            reconcile(job, remote, export);
        } catch (RefConflict conflict) {
            report(job, "failed", "ARCHIVE_TAG_CONFLICT", null);
        } catch (PrivateFile privateFile) {
            report(job, "failed", "ARCHIVE_PRIVATE_FILE", null);
        } catch (PlatformRejection rejection) {
            if (rejection.status == 403) report(job, "failed", "ARCHIVE_GRANT_REQUIRED", null);
        } catch (Exception unavailable) {
            // A failed push response is not proof that the tag was not created.
            if (mayHaveWritten) report(job, "unknown", "ARCHIVE_RESULT_UNKNOWN", null);
            else report(job, "failed", "ARCHIVE_SOURCE_UNAVAILABLE", null);
        }
    }

    private void reconcile(Job job, String remote, String export) throws Exception {
        String observed = observed(job, remote);
        if (observed.equals(export)) report(job, "succeeded", null, export);
        else if (observed.isEmpty()) report(job, "unknown", "ARCHIVE_RESULT_UNKNOWN", null);
        else throw new RefConflict();
    }

    private String target(Job job) throws Exception {
        String name = job.data().path("repositoryName").asText();
        var repository = provider.findRepository(name, uuid(job.data().path("requirementId").asText()), false);
        if (repository == null || !repository.repositoryId().equals(job.data().path("repositoryId").asText())) throw new IOException("Archive repository mismatch");
        if (provider instanceof LocalGitProvider local && "demo".equals(job.data().path("mode").asText())) return local.path(name).toString();
        if (provider instanceof GitHubProvider github && "codex".equals(job.data().path("mode").asText())) return github.fetchUrl(name);
        throw new IOException("Archive provider mismatch");
    }

    private Path source(Job job) throws Exception {
        var data = job.data();
        var match = SOURCE.matcher(data.path("sourceRef").asText());
        if (!match.matches() || !job.run().equals(match.group(1)) || !job.sourceCommit().equals(match.group(4))) throw new IOException("Invalid archive source");
        String task = uuid(match.group(2));
        String attempt = uuid(match.group(3));
        String report = ".agentship-results/" + attempt + "/result.md";
        if (!report.equals(match.group(5))) throw new IOException("Invalid archive report path");
        Path workspace = state;
        for (String part : List.of("agent-jobs", job.run(), task, attempt, "workspace", ".git")) {
            workspace = workspace.resolve(part);
            if (!Files.isDirectory(workspace, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Archive source missing");
        }
        workspace = workspace.getParent();
        byte[] content = git(job, workspace, 6, null, "show", job.sourceCommit() + ":" + report);
        String digest = "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        if (content.length == 0 || !digest.equals(data.path("contentDigest").asText())) throw new IOException("Archive source mismatch");
        return workspace;
    }

    private String snapshot(Job job, Path workspace) throws Exception {
        git(job, workspace, 6, null, "merge-base", "--is-ancestor", job.base(), job.sourceCommit());
        String changed = new String(git(job, workspace, 8, null, "diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv",
                job.base(), job.sourceCommit(), "--"), StandardCharsets.UTF_8);
        for (String path : changed.split("\u0000")) if (!path.isEmpty() && forbidden(path)) throw new PrivateFile();
        String tree = sha(text(git(job, workspace, 6, null, "rev-parse", "--verify", job.sourceCommit() + "^{tree}")));
        return sha(text(git(job, workspace, 6, null, "commit-tree", tree, "-p", job.base(), "-m",
                "AgentShip delivery " + job.id() + " from " + job.sourceCommit())));
    }

    private Path transport(Job job, Path workspace, String export) throws Exception {
        Path directory = AgentWorkspace.directory(AgentWorkspace.directory(state, "archive-git"), job.id());
        if (!Files.isRegularFile(directory.resolve("HEAD"), LinkOption.NOFOLLOW_LINKS)) {
            git(job, directory, 6, null, "init", "--bare", "--template=");
        }
        git(job, directory, 12, null, "fetch", "--no-tags", workspace.toString(), export);
        if (!export.equals(text(git(job, directory, 6, null, "rev-parse", "--verify", "FETCH_HEAD")))) throw new IOException("Archive transport mismatch");
        return directory;
    }

    private static boolean forbidden(String path) {
        if (path.startsWith(".agentship-results/")) return !path.matches("\\.agentship-results/[0-9a-f-]{36}/result\\.md");
        for (String part : path.toLowerCase(Locale.ROOT).split("/")) {
            if (part.startsWith(".env") || List.of(".agentship", ".ssh", ".aws", ".npmrc", ".gitmodules", "logs", "node_modules",
                    "credentials.json", "secrets.json", "secrets.yml", "secrets.yaml").contains(part) ||
                    part.matches(".*\\.(log|pem|key|p12|sqlite|db)$")) return true;
        }
        return false;
    }

    private String observed(Job job, String remote) throws Exception {
        String result = text(git(job, state, 10, remote, "ls-remote", "--refs", remote, job.ref()));
        if (result.isEmpty()) return "";
        String[] fields = result.split("\\s+");
        if (fields.length != 2 || !fields[1].equals(job.ref())) throw new IOException("Archive ref result mismatch");
        return sha(fields[0]);
    }

    private void report(Job job, String state, String reason, String observed) throws Exception {
        Map<String,Object> result = new java.util.LinkedHashMap<>();
        result.put("artifactId", job.id()); result.put("epoch", job.epoch()); result.put("state", state);
        if (reason != null) result.put("reasonCode", reason);
        if (observed != null) { result.put("observedCommit", observed); result.put("ref", job.ref()); }
        api.post(ENDPOINT + "result", result, null);
    }

    private byte[] git(Job job, Path directory, int seconds, String remote, String... args) throws Exception {
        if (!job.deadline().isAfter(Instant.now()) || Thread.currentThread().isInterrupted()) throw new IOException("Archive lease expired");
        List<String> command = new ArrayList<>(List.of("git", "-C", directory.toString(), "-c", "core.hooksPath=/dev/null", "-c",
                "commit.gpgSign=false", "-c", "credential.helper=", "-c", "http.followRedirects=false", "-c", "protocol.ext.allow=never"));
        command.addAll(List.of(args));
        ProcessBuilder builder = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD);
        var env = builder.environment();
        env.keySet().removeIf(key -> key.startsWith("GIT_") || key.equals("SSH_AUTH_SOCK"));
        env.put("GIT_CONFIG_GLOBAL", "/dev/null"); env.put("GIT_CONFIG_SYSTEM", "/dev/null"); env.put("GIT_CONFIG_NOSYSTEM", "1");
        env.put("GIT_TERMINAL_PROMPT", "0"); env.put("GIT_NO_REPLACE_OBJECTS", "1");
        env.put("GIT_CEILING_DIRECTORIES", directory.toAbsolutePath().getParent().toString());
        env.put("GIT_AUTHOR_NAME", "AgentShip"); env.put("GIT_COMMITTER_NAME", "AgentShip");
        env.put("GIT_AUTHOR_EMAIL", "agentship@example.invalid"); env.put("GIT_COMMITTER_EMAIL", "agentship@example.invalid");
        String date = job.approved().getEpochSecond() + " +0000";
        env.put("GIT_AUTHOR_DATE", date); env.put("GIT_COMMITTER_DATE", date);
        String token = env.remove("AGENTSHIP_GITHUB_TOKEN");
        if (token != null && remote != null && remote.startsWith("https://github.com/")) {
            env.put("GIT_CONFIG_COUNT", "1"); env.put("GIT_CONFIG_KEY_0", "http.https://github.com/.extraHeader");
            env.put("GIT_CONFIG_VALUE_0", "Authorization: Basic " + Base64.getEncoder().encodeToString(("x-access-token:" + token).getBytes(StandardCharsets.UTF_8)));
        }
        Process process = builder.start();
        FutureTask<byte[]> read = new FutureTask<>(() -> process.getInputStream().readNBytes(OUTPUT_LIMIT + 1));
        Thread.startVirtualThread(read);
        try {
            process.getOutputStream().close();
            if (!process.waitFor(seconds, TimeUnit.SECONDS) || process.exitValue() != 0) throw new IOException("Archive Git command failed");
            byte[] output = read.get(1, TimeUnit.SECONDS);
            if (output.length > OUTPUT_LIMIT) throw new IOException("Archive output exceeds limit");
            return output;
        } finally {
            if (process.isAlive()) { process.descendants().forEach(ProcessHandle::destroyForcibly); process.destroyForcibly(); }
            read.cancel(true);
        }
    }

    private static String text(byte[] bytes) { return new String(bytes, StandardCharsets.UTF_8).strip(); }
    private static String uuid(String value) { return UUID.fromString(value).toString(); }
    private static String sha(String value) throws IOException {
        if (!value.matches("[0-9a-f]{40}|[0-9a-f]{64}")) throw new IOException("Invalid archive commit");
        return value;
    }
    private record Job(JsonNode data, String id, String run, long epoch, String ref, String base, String sourceCommit,
            Instant deadline, Instant approved) {
        Job(JsonNode data) throws IOException {
            this(data, uuid(data.path("artifactId").asText()), uuid(data.path("runId").asText()), data.path("epoch").asLong(),
                    data.path("ref").asText(), sha(data.path("baseCommit").asText()), sha(data.path("sourceCommit").asText()),
                    Instant.parse(data.path("deadlineAt").asText()), Instant.parse(data.path("approvedAt").asText()));
            if (epoch < 1 || !ref.equals("refs/tags/agentship/" + run + "/" + id)) throw new IOException("Invalid archive scope");
        }
    }
    private static final class RefConflict extends IOException {}
    private static final class PrivateFile extends IOException {}
    @Override public void close() { executor.shutdownNow(); }
}
