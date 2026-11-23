package agentship.platform.config;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.lang.reflect.Proxy;
import jakarta.servlet.http.HttpServletRequest;

/** Filesystem fixtures exercise discovery without reading the developer's library. */
public final class LocalSkillCatalogCheck {
    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]);
        Path first = root.resolve("first"), second = root.resolve("second");
        write(first, "library/agents/architecture", "name: architecture-agent\ndescription: >-\n  Design backend\n  architecture.");
        write(first, "library/skills/api", "name: api-standard\ndescription: 'API: contracts'");
        write(second, "duplicate", "name: architecture-agent\ndescription: Wrong duplicate");
        write(first, "invalid", "name: [not, a, string]\ndescription: Invalid");
        write(first, "tag", "name: unsafe\ndescription: !!java.net.URL 'https://example.com'");
        write(first, "duplicate-key", "name: duplicate\nname: other\ndescription: Invalid");
        write(first, "huge", "name: enormous\ndescription: " + "x".repeat(40000));
        write(first, "references/ignored", "name: hidden-agent\ndescription: Ignore reference examples");
        var catalog = new LocalSkillCatalog(true, List.of(first, second));
        var result = catalog.read(true);
        check(result.status().equals("available") && result.items().size() == 2, "Discovery and deduplication");
        check(result.skipped() == 4 && !result.truncated(), "Malformed YAML and bounded reads");
        var agent = result.items().getFirst();
        check(agent.kind().equals("agent") && agent.description().equals("Design backend architecture."), "Agent classification and folded YAML");
        check(result.items().get(1).description().equals("API: contracts"), "Quoted YAML");
        check(!result.toString().contains("PRIVATE BODY") && !result.toString().contains(root.toString()), "No body or filesystem path exposed");
        check(catalog.read(false).items().isEmpty(), "Remote requests disabled");
        check(new LocalSkillCatalog(false, List.of(first)).read(true).status().equals("unavailable"), "Feature disabled by default");
        check(new LocalSkillCatalog(true, List.of(root.resolve("missing"))).read(true).items().isEmpty(), "Missing library");
        var controller = new LocalSkillController(catalog);
        check(controller.list(request("127.0.0.1", null)).items().size() == 2, "Direct IPv4 loopback");
        check(controller.list(request("::1", null)).items().size() == 2, "Direct IPv6 loopback");
        check(controller.list(request("192.0.2.1", null)).items().isEmpty(), "Remote address blocked");
        check(controller.list(request("127.0.0.1", "Forwarded")).items().isEmpty(), "Forwarded proxy blocked");
        check(controller.list(request("127.0.0.1", "X-Forwarded-For")).items().isEmpty(), "Forwarded-for proxy blocked");
        System.out.println("PASS local catalog: nested discovery, grouping, YAML, deduplication, bounds, metadata-only output and access gates");
    }

    private static HttpServletRequest request(String address, String proxyHeader) {
        return (HttpServletRequest) Proxy.newProxyInstance(HttpServletRequest.class.getClassLoader(),
                new Class<?>[]{HttpServletRequest.class}, (proxy, method, args) -> switch (method.getName()) {
                    case "getRemoteAddr" -> address;
                    case "getHeader" -> args[0].equals(proxyHeader) ? "for=192.0.2.1" : null;
                    default -> throw new AssertionError("Unexpected request method " + method.getName());
                });
    }

    private static void write(Path root, String folder, String metadata) throws Exception {
        Path directory = Files.createDirectories(root.resolve(folder));
        Files.writeString(directory.resolve("SKILL.md"), "---\n" + metadata + "\n---\nPRIVATE BODY");
    }

    private static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
    }
}
