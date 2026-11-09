package agentship.worker;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Runs the opt-in Maven check against a clean, pinned local candidate. */
final class MavenCandidateCheck {
    private static final String SETTINGS = "<settings><offline>true</offline></settings>\n";
    private static final Pattern SUMMARY = Pattern.compile(
            "^\\[(?:INFO|WARNING|ERROR)] Tests run: ([0-9]{1,9}), Failures: ([0-9]{1,9}), Errors: ([0-9]{1,9}), Skipped: ([0-9]{1,9})[ \\t]*\\r?$",
            Pattern.MULTILINE);

    record Result(String outcome, String detail) {}

    Result run(AgentWorkspace workspace, String candidate, AgentWorkspace.Guard guard) throws Exception {
        Path directory = workspace.path();
        Path cache = workspace.mavenCache();
        if (!workspace.cleanTrackedCandidate(candidate) || !Files.isRegularFile(directory.resolve("pom.xml"), LinkOption.NOFOLLOW_LINKS)) {
            return unresolved("受检提交或 Maven 项目无法核对。");
        }
        if (!Files.isDirectory(cache, LinkOption.NOFOLLOW_LINKS)) return unresolved("本机尚未准备 Maven 离线依赖缓存。");
        Path options = directory.resolve(".mvn");
        if (Files.isSymbolicLink(options) || List.of("maven.config", "jvm.config", "extensions.xml").stream()
                .anyMatch(name -> Files.exists(options.resolve(name), LinkOption.NOFOLLOW_LINKS))) {
            return unresolved("仓库包含会覆盖受控 Maven 配置的启动选项。");
        }
        Path settings = settings(directory.getParent());
        List<String> command = List.of("mvn", "-o", "-B", "--no-transfer-progress", "-s", settings.toString(),
                "-gs", settings.toString(), "-Dmaven.repo.local=" + cache, "-Dstyle.color=never", "-DskipTests=false",
                "-Dmaven.test.skip=false", "-DfailIfNoTests=true", "test");
        Map<String,String> environment = new LinkedHashMap<>();
        for (String inherited : List.of("MAVEN_ARGS", "MAVEN_OPTS", "MAVEN_CONFIG", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS",
                "_JAVA_OPTIONS", "SSH_AUTH_SOCK", "GH_TOKEN", "GITHUB_TOKEN")) environment.put(inherited, null);
        environment.put("MAVEN_SKIP_RC", "1");
        JsonNode execution;
        try (CodexAppServer codex = new CodexAppServer(directory, true, guard)) {
            codex.initialize(true);
            execution = codex.executeCheck(command, environment);
        }
        if (!workspace.cleanTrackedCandidate(candidate)) return unresolved("测试期间受检工作区发生了变化。");
        return classify(execution);
    }

    private static Path settings(Path parent) throws IOException {
        Path path = parent.resolve("maven-isolated-settings.xml");
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
            Files.createFile(path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            Files.writeString(path, SETTINGS, StandardOpenOption.WRITE);
        }
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) != SETTINGS.length()
                || !SETTINGS.equals(Files.readString(path))) throw new IOException("Invalid generated Maven settings");
        return path;
    }

    private static Result classify(JsonNode execution) {
        if (!execution.path("exitCode").isIntegralNumber()) return unresolved("Maven 未返回可核对的退出状态。");
        String stdout = execution.path("stdout").asText().replaceAll("\\u001b\\[[0-9;]*m", "");
        if (stdout.length() > 65_536) return unresolved("Maven 输出超出核对范围。");
        var counts = SUMMARY.matcher(stdout);
        long tests = 0, failures = 0, errors = 0, skipped = 0;
        while (counts.find()) {
            long groupTests = Long.parseLong(counts.group(1)), groupFailures = Long.parseLong(counts.group(2));
            long groupErrors = Long.parseLong(counts.group(3)), groupSkipped = Long.parseLong(counts.group(4));
            if (groupFailures + groupErrors + groupSkipped > groupTests) return unresolved("Maven 测试统计不一致。");
            tests += groupTests;
            failures += groupFailures;
            errors += groupErrors;
            skipped += groupSkipped;
        }
        if (tests <= skipped) return unresolved("没有可核对的已执行测试。");
        String detail = "执行 " + (tests - skipped) + " 项，失败 " + failures + " 项，错误 " + errors + " 项，跳过 " + skipped + " 项。";
        int exit = execution.path("exitCode").asInt();
        if (exit == 0 && failures + errors == 0 && stdout.contains("[INFO] BUILD SUCCESS")) return new Result("pass", detail);
        if (exit == 1 && failures + errors > 0 && stdout.contains("[INFO] BUILD FAILURE")) return new Result("repair", detail);
        return unresolved("Maven 执行结果无法核对为通过或测试失败。");
    }

    static Result unresolved(String detail) { return new Result("unresolved", detail); }
}
