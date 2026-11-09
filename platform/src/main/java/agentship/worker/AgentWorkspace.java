package agentship.worker;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

final class AgentWorkspace {
    private static final int MAX_ARTIFACT = 64 * 1024;
    private static final Pattern COMMIT = Pattern.compile("[0-9a-f]{40}|[0-9a-f]{64}");
    private static final Pattern REF = Pattern.compile(
            "local-git:([0-9a-f-]{36})/([0-9a-f-]{36})/([0-9a-f-]{36})@([0-9a-f]{40}|[0-9a-f]{64}):(.+)");
    private final Path jobs;
    private final Path directory;
    private final String run;
    private final String task;
    private final String attempt;
    private final JsonNode input;
    private final GitProvider provider;
    private final Guard guard;

    @FunctionalInterface
    interface Guard {
        void check() throws IOException;
    }

    AgentWorkspace(Path jobs, String run, String task, String attempt, JsonNode input,
                   GitProvider provider, Guard guard) throws IOException {
        this.jobs = jobs;
        this.run = run;
        this.task = task;
        this.attempt = attempt;
        this.input = input;
        this.provider = provider;
        this.guard = guard;
        directory = directory(directory(directory(directory(jobs, run), task), attempt), "workspace");
    }

    static Path directory(Path parent, String name) throws IOException {
        Path child = parent.resolve(name);
        Files.createDirectories(child, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
        if (!Files.isDirectory(child, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Invalid workspace");
        return child;
    }

    Path path() { return directory; }
    Path mavenCache() { return jobs.getParent().resolve("maven-repository"); }

    boolean cleanTrackedCandidate(String candidate) throws Exception {
        return matchesCheckCandidate(candidate) && candidate.equals(revision()) && !merging()
                && git(directory, "status", "--porcelain", "--untracked-files=no", "--ignore-submodules=none").length == 0;
    }

    String revision() throws Exception {
        return commit(text(git(directory, "rev-parse", "--verify", "HEAD")));
    }

    boolean matchesCheckCandidate(String revision) {
        JsonNode candidate = input.path("checkCandidate");
        String version = candidate.path("version").asText();
        if (!COMMIT.matcher(revision).matches() || !revision.equals(candidate.path("commit").asText())) return false;
        JsonNode upstream = input.path("upstreamArtifacts");
        if (upstream.isEmpty()) {
            JsonNode git = input.path("git");
            String repoId = git.path("repository").path("repositoryId").asText();
            return !repoId.isBlank() && revision.equals(git.path("baseCommit").asText())
                    && version.equals("git:" + repoId + "@" + revision);
        }
        for (JsonNode artifact : upstream) {
            if (revision.equals(artifact.path("commit").asText()) && version.equals(artifact.path("sourceRef").asText())) {
                return true;
            }
        }
        return false;
    }

    String checkGitDiff(String candidate) throws Exception {
        if (!matchesCheckCandidate(candidate) || !revision().equals(candidate)) return "unresolved";
        String base = commit(input.path("git").path("baseCommit").asText());
        GitResult result = runGit(directory, "-c", "core.whitespace=blank-at-eol,blank-at-eof,space-before-tab",
                "diff", "--check", "--no-ext-diff", "--no-textconv", "--no-color", base, candidate,
                "--", ".", ":(exclude).agentship-results/**");
        return switch (result.exitCode()) {
            case 0 -> result.output().length == 0 ? "pass" : "unresolved";
            case 2 -> result.output().length > 0 ? "repair" : "unresolved";
            default -> "unresolved";
        };
    }

    void prepare(boolean coordinator, boolean writable) throws Exception {
        JsonNode git = input.path("git");
        JsonNode repo = git.path("repository");
        String name = repo.path("displayName").asText();
        String branch = git.path("workBranch").asText();
        LocalGitProvider.validateBranch(branch);
        String base = commit(git.path("baseCommit").asText());
        if (Files.exists(directory.resolve(".git"), LinkOption.NOFOLLOW_LINKS)) {
            if (!Files.isDirectory(directory.resolve(".git"), LinkOption.NOFOLLOW_LINKS)) throw new IOException("Invalid workspace metadata");
        } else {
            git(directory, "init", "--template=");
        }
        if (provider instanceof LocalGitProvider local && repo.path("provider").asText().equals("demo")) {
            Path source = local.path(name);
            if (!Files.isDirectory(source, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Repository unavailable");
            git(directory, "fetch", "--no-tags", source.toString(), base);
        } else if (provider instanceof GitHubProvider github && repo.path("provider").asText().equals("github")) {
            String requirement = UUID.fromString(input.path("requirementId").asText()).toString();
            GitProvider.Repository verified = github.findRepository(name, requirement, false);
            if (verified == null || !verified.repositoryId().equals(repo.path("repositoryId").asText())) {
                throw new IOException("Repository identity mismatch");
            }
            git(directory, "fetch", "--no-tags", github.fetchUrl(name), base);
        } else {
            throw new IOException("Repository mode mismatch");
        }
        if (!base.equals(text(git(directory, "rev-parse", "--verify", "FETCH_HEAD")))) throw new IOException("Commit mismatch");
        git(directory, "checkout", "--detach", base);
        try {
            mergeInputs(coordinator);
        } catch (ArtifactConflict conflict) {
            if (!coordinator || !writable || !textConflicts()) throw conflict;
        }
    }

    private void mergeInputs(boolean coordinator) throws Exception {
        merge(input.path("upstreamArtifacts"));
        if (coordinator && !"check".equals(input.path("node").path("type").asText())) {
            merge(input.path("siblingArtifacts"));
        }
    }

    private void merge(JsonNode references) throws Exception {
        for (JsonNode reference : references) {
            Artifact source = resolve(reference);
            git(directory, "fetch", "--no-tags", source.repository().toString(), source.commit());
            try {
                git(directory, "merge", "--no-edit", source.commit());
            } catch (IOException failure) {
                if (Files.exists(directory.resolve(".git/MERGE_HEAD"), LinkOption.NOFOLLOW_LINKS)) throw new ArtifactConflict();
                throw failure;
            }
        }
    }

    String context() throws Exception {
        StringBuilder context = new StringBuilder();
        int count = input.path("upstreamArtifacts").size() + input.path("siblingArtifacts").size();
        int excerptLimit = 80_000 / Math.max(1, count);
        for (String field : List.of("upstreamArtifacts", "siblingArtifacts")) {
            context.append("\n").append(field).append(":\n");
            for (JsonNode reference : input.path(field)) {
                Artifact source = resolve(reference);
                String content = new String(source.content(), StandardCharsets.UTF_8);
                context.append(source.path()).append("\n");
                if (content.length() > excerptLimit) {
                    context.append(content, 0, excerptLimit).append("\n[Report excerpt. Read its full file in the checkout when available.]\n");
                } else {
                    context.append(content).append("\n");
                }
            }
        }
        return context.toString();
    }

    String conflictInstructions() throws Exception {
        if (!merging()) return "";
        return "Git found text conflicts. Resolve all conflict markers in these files and retain the intended changes: "
                + String.join(", ", conflictPaths()) + ". If you cannot reconcile them safely, ask for help.";
    }

    Map<String,Object> archive(String artifact, boolean coordinator, boolean includeChanges) throws Exception {
        byte[] content = artifact.getBytes(StandardCharsets.UTF_8);
        if (artifact.isBlank() || content.length > MAX_ARTIFACT) throw new IOException("Invalid artifact");
        if (merging()) {
            if (!coordinator || !includeChanges) throw new ArtifactConflict();
            resolveTextConflicts();
            mergeInputs(true);
        }
        Path reports = directory(directory(directory, ".agentship-results"), attempt);
        Path report = reports.resolve("result.md");
        if (Files.exists(report, LinkOption.NOFOLLOW_LINKS)) {
            if (!Files.isRegularFile(report, LinkOption.NOFOLLOW_LINKS) || Files.size(report) > MAX_ARTIFACT
                    || !MessageDigest.isEqual(Files.readAllBytes(report), content)) {
                throw new IOException("Result path already exists");
            }
        } else {
            Files.write(report, content, StandardOpenOption.CREATE_NEW);
        }
        String relative = artifactPath(attempt);
        if (includeChanges) git(directory, "add", "--all");
        git(directory, "add", "--force", "--", relative);
        String blob = text(git(directory, "rev-parse", "--verify", ":" + relative));
        String tree = text(git(directory, "write-tree"));
        String previous = revision();
        String previousTree = text(git(directory, "rev-parse", "--verify", "HEAD^{tree}"));
        String archived = previous;
        if (!tree.equals(previousTree)) {
            archived = commit(text(git(directory, "commit-tree", tree, "-p", previous, "-m", "AgentShip role result " + attempt)));
            git(directory, "update-ref", "HEAD", archived, previous);
        }
        if (!blob.equals(text(git(directory, "rev-parse", "--verify", archived + ":" + relative)))
                || !MessageDigest.isEqual(content, git(directory, "show", archived + ":" + relative))) {
            throw new IOException("Archived content mismatch");
        }
        JsonNode git = input.path("git");
        return Map.of("kind", coordinator ? "product" : "other", "title", coordinator ? "节点最终产物" : "Agent 产物",
                "sourceRef", "local-git:" + run + "/" + task + "/" + attempt + "@" + archived + ":" + relative,
                "contentDigest", digest(content), "commit", archived, "workBranch", git.path("workBranch").asText(),
                "repositoryId", git.path("repository").path("repositoryId").asText());
    }

    private Artifact resolve(JsonNode reference) throws Exception {
        var match = REF.matcher(reference.path("sourceRef").asText());
        if (!match.matches() || !run.equals(match.group(1))) throw new IOException("Invalid artifact scope");
        String sourceTask = UUID.fromString(match.group(2)).toString();
        String sourceAttempt = UUID.fromString(match.group(3)).toString();
        String sourceCommit = commit(match.group(4));
        String sourcePath = artifactPath(sourceAttempt);
        if (!sourcePath.equals(match.group(5)) || !sourceCommit.equals(reference.path("commit").asText())) {
            throw new IOException("Artifact reference mismatch");
        }
        Path source = jobs.resolve(run).resolve(sourceTask).resolve(sourceAttempt).resolve("workspace");
        for (Path p = source; !p.equals(jobs); p = p.getParent()) {
            if (!Files.isDirectory(p, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Local artifact unavailable");
        }
        if (!Files.isDirectory(source.resolve(".git"), LinkOption.NOFOLLOW_LINKS)) throw new IOException("Invalid artifact repository");
        byte[] content = git(source, "show", sourceCommit + ":" + sourcePath);
        if (content.length > MAX_ARTIFACT || !digest(content).equals(reference.path("contentDigest").asText())) {
            throw new IOException("Artifact digest mismatch");
        }
        return new Artifact(source, sourceCommit, sourcePath, content);
    }

    private boolean merging() { return Files.isRegularFile(directory.resolve(".git/MERGE_HEAD"), LinkOption.NOFOLLOW_LINKS); }

    private List<String> conflictPaths() throws Exception {
        String paths = new String(git(directory, "diff", "--name-only", "--diff-filter=U", "-z"), StandardCharsets.UTF_8);
        return paths.isEmpty() ? List.of() : List.of(paths.split("\u0000"));
    }

    private boolean textConflicts() throws Exception {
        List<String> paths = conflictPaths();
        if (paths.isEmpty()) return false;
        for (String path : paths) {
            if (!hasMarkers(conflictContent(path))) return false;
        }
        return true;
    }

    private void resolveTextConflicts() throws Exception {
        List<String> paths = conflictPaths();
        if (paths.isEmpty()) throw new ArtifactConflict();
        for (String path : paths) {
            if (hasMarkers(conflictContent(path))) throw new ArtifactConflict();
        }
        for (String path : paths) git(directory, "add", "--", path);
        git(directory, "commit", "--no-edit");
    }

    private String conflictContent(String relative) throws IOException {
        Path file = directory.resolve(relative).normalize();
        if (!file.startsWith(directory) || file.equals(directory)) throw new ArtifactConflict();
        for (Path parent = file.getParent(); !parent.equals(directory); parent = parent.getParent()) {
            if (!Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS)) throw new ArtifactConflict();
        }
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > MAX_ARTIFACT) throw new ArtifactConflict();
        return Files.readString(file);
    }

    private static boolean hasMarkers(String content) {
        return content.lines().anyMatch(line -> line.startsWith("<<<<<<< ") || line.equals("=======") || line.startsWith(">>>>>>> "));
    }

    private byte[] git(Path repository, String... arguments) throws Exception {
        GitResult result = runGit(repository, arguments);
        if (result.exitCode() != 0) throw new IOException("Git workspace operation failed");
        return result.output();
    }

    private GitResult runGit(Path repository, String... arguments) throws Exception {
        guard.check();
        List<String> command = new ArrayList<>(List.of("git", "-C", repository.toString(), "-c", "core.hooksPath=/dev/null",
                "-c", "core.fsmonitor=false", "-c", "protocol.ext.allow=never", "-c", "http.followRedirects=false", "-c", "credential.helper="));
        command.addAll(List.of(arguments));
        ProcessBuilder builder = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD);
        Map<String,String> env = builder.environment();
        env.keySet().removeIf(key -> key.startsWith("GIT_"));
        env.put("GIT_CONFIG_GLOBAL", "/dev/null");
        env.put("GIT_CONFIG_NOSYSTEM", "1");
        env.put("GIT_ATTR_NOSYSTEM", "1");
        env.put("GIT_TERMINAL_PROMPT", "0");
        env.put("GIT_AUTHOR_NAME", "AgentShip");
        env.put("GIT_COMMITTER_NAME", "AgentShip");
        env.put("GIT_AUTHOR_EMAIL", "agentship@example.invalid");
        env.put("GIT_COMMITTER_EMAIL", "agentship@example.invalid");
        String token = env.remove("AGENTSHIP_GITHUB_TOKEN");
        // Only the fetch subprocess receives credentials. The repository config remains credential-free.
        if (token != null && List.of(arguments).stream().anyMatch(a -> a.startsWith("https://github.com/"))) {
            env.put("GIT_CONFIG_COUNT", "1");
            env.put("GIT_CONFIG_KEY_0", "http.https://github.com/.extraHeader");
            String basic = java.util.Base64.getEncoder().encodeToString(("x-access-token:" + token).getBytes(StandardCharsets.UTF_8));
            env.put("GIT_CONFIG_VALUE_0", "Authorization: Basic " + basic);
        }
        Process process = builder.start();
        FutureTask<byte[]> read = new FutureTask<>(() -> process.getInputStream().readNBytes(MAX_ARTIFACT + 1));
        Thread.startVirtualThread(read);
        try {
            process.getOutputStream().close();
            long deadline = System.nanoTime() + Duration.ofMinutes(2).toNanos();
            while (!process.waitFor(500, TimeUnit.MILLISECONDS)) {
                guard.check();
                if (read.isDone() && read.get().length > MAX_ARTIFACT) throw new IOException("Git workspace output exceeds limit");
                if (System.nanoTime() >= deadline) throw new IOException("Git workspace deadline exceeded");
            }
            byte[] output = read.get(2, TimeUnit.SECONDS);
            if (output.length > MAX_ARTIFACT) throw new IOException("Git workspace output exceeds limit");
            return new GitResult(process.exitValue(), output);
        } catch (ExecutionException unreadable) {
            throw new IOException("Git workspace output unavailable");
        } finally {
            if (process.isAlive()) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
            }
            read.cancel(true);
        }
    }

    private static String artifactPath(String attempt) { return ".agentship-results/" + attempt + "/result.md"; }
    private static String text(byte[] bytes) { return new String(bytes, StandardCharsets.UTF_8).strip(); }
    private static String commit(String commit) throws IOException {
        if (!COMMIT.matcher(commit).matches()) throw new IOException("Invalid commit");
        return commit;
    }
    private static String digest(byte[] content) throws Exception {
        return "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
    }
    private record Artifact(Path repository, String commit, String path, byte[] content) {}
    private record GitResult(int exitCode, byte[] output) {}
    static final class ArtifactConflict extends IOException {}
}
