package agentship.platform.config;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/** Reads bounded, descriptive metadata only; never executes or returns skill bodies. */
@Service
final class LocalSkillCatalog {
    record Entry(String name, String description, String kind, String source) {}
    record Catalog(String status, String source, List<Entry> items, int skipped, boolean truncated) {}
    private static final int MAX_ENTRIES = 1000;
    private static final int MAX_VISITS = 20000;
    private static final int MAX_HEADER = 32768;
    private final boolean enabled;
    private final List<Path> roots;

    @Autowired
    LocalSkillCatalog(@Value("${agentship.local-catalog-enabled:false}") boolean enabled) {
        this(enabled, defaultRoots());
    }

    LocalSkillCatalog(boolean enabled, List<Path> roots) {
        this.enabled = enabled;
        this.roots = List.copyOf(roots);
    }

    private static List<Path> defaultRoots() {
        Path home = Path.of(System.getProperty("user.home"));
        String codexHome = System.getenv("CODEX_HOME");
        Path codex = codexHome == null || codexHome.isBlank() ? home.resolve(".codex") : Path.of(codexHome);
        return List.of(home.resolve(".agents/skills"), codex.resolve("skills"));
    }

    Catalog read(boolean localRequest) {
        if (!enabled || !localRequest) return new Catalog("unavailable", "AgentShip computer", List.of(), 0, false);
        var scan = new Scan();
        for (int index = 0; index < roots.size() && !scan.truncated; index++) {
            Path root = roots.get(index);
            if (!Files.isDirectory(root) || Files.isSymbolicLink(root)) continue;
            String source = index == 0 ? "User agent skills" : "Codex skills";
            try {
                Files.walkFileTree(root, java.util.Set.of(), 8, new SimpleFileVisitor<>() {
                    @Override public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                        if (++scan.visits > MAX_VISITS) { scan.truncated = true; return FileVisitResult.TERMINATE; }
                        String name = dir.getFileName().toString();
                        return java.util.Set.of(".git", "node_modules", "references", "scripts", "assets").contains(name)
                                ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
                    }
                    @Override public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                        if (++scan.visits > MAX_VISITS || scan.entries.size() >= MAX_ENTRIES) {
                            scan.truncated = true;
                            return FileVisitResult.TERMINATE;
                        }
                        if (attrs.isRegularFile() && file.getFileName().toString().equals("SKILL.md")) {
                            try {
                                Entry entry = parse(file, source);
                                if (entry == null) scan.skipped++;
                                else scan.entries.putIfAbsent(entry.name(), entry);
                            } catch (IOException | RuntimeException invalid) { scan.skipped++; }
                        }
                        return FileVisitResult.CONTINUE;
                    }
                    @Override public FileVisitResult visitFileFailed(Path file, IOException error) {
                        scan.skipped++;
                        return FileVisitResult.CONTINUE;
                    }
                });
            } catch (IOException | SecurityException unavailable) { scan.skipped++; }
        }
        var items = new ArrayList<>(scan.entries.values());
        items.sort(Comparator.comparing(Entry::kind).thenComparing(Entry::name, String.CASE_INSENSITIVE_ORDER));
        return new Catalog("available", "AgentShip computer", List.copyOf(items), scan.skipped, scan.truncated);
    }

    private static Entry parse(Path file, String source) throws IOException {
        // Limit reads even if a malformed file has a single enormous line.
        String text;
        try (BufferedReader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            char[] prefix = new char[MAX_HEADER];
            int length = 0, read;
            while (length < prefix.length && (read = reader.read(prefix, length, prefix.length - length)) != -1) length += read;
            text = new String(prefix, 0, length).replace("\r\n", "\n");
        }
        if (text.startsWith("\ufeff")) text = text.substring(1);
        if (!text.startsWith("---\n")) return null;
        int end = text.indexOf("\n---", 4);
        if (end < 0 || (end + 4 < text.length() && text.charAt(end + 4) != '\n')) return null;
        var options = new LoaderOptions();
        options.setAllowDuplicateKeys(false);
        options.setMaxAliasesForCollections(0);
        options.setNestingDepthLimit(10);
        options.setCodePointLimit(MAX_HEADER);
        Object raw = new Yaml(new SafeConstructor(options)).load(text.substring(4, end));
        if (!(raw instanceof Map<?, ?> data) || !(data.get("name") instanceof String name)
                || !(data.get("description") instanceof String description)) return null;
        name = name.strip();
        description = description.strip();
        if (name.isEmpty() || name.length() > 150 || name.chars().anyMatch(Character::isISOControl)
                || description.isEmpty()) return null;
        if (description.length() > 2000) description = description.substring(0, 1997) + "...";
        return new Entry(name, description, name.endsWith("-agent") ? "agent" : "skill", source);
    }

    private static final class Scan {
        final Map<String, Entry> entries = new LinkedHashMap<>();
        int visits;
        int skipped;
        boolean truncated;
    }
}
