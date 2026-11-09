package agentship.worker;

import agentship.protocol.device.DeviceProofCodec;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Local proof bridge and opt-in execution on the initiating computer. */
public final class WorkerMain {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int BODY_LIMIT = 16_384;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final Settings settings;
    private State state;
    private PrivateKey proofKey;
    private volatile Instant lastPoll;
    private long budgetWindow;
    private int budgetCount;
    private GitWorker gitWorker;
    private AgentWorker agentWorker;
    private ArchiveWorker archiveWorker;
    private volatile String probedCodexStatus="unknown";
    private long lastCodexProbe;

    private WorkerMain(Settings settings) { this.settings = settings; }

    public static void main(String[] args) {
        try { new WorkerMain(Settings.parse(args)).run(); }
        catch (Exception error) {
            // Never print exception content: HTTP errors and state may contain credentials.
            System.err.println("本机程序未能启动。请检查平台地址、配对码、状态目录权限和端口是否已占用。");
            System.exit(1);
        }
    }

    private void run() throws Exception {
        Path directory = settings.directory;
        if (Files.isSymbolicLink(directory)) throw new IOException("Symbolic state directory");
        Files.createDirectories(directory,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
        if (!Files.getPosixFilePermissions(directory).equals(PosixFilePermissions.fromString("rwx------")))
            throw new IOException("State directory permissions must be private");
        Path lockPath = directory.resolve("worker.lock");
        if (Files.isSymbolicLink(lockPath)) throw new IOException("Symbolic lock");
        try (FileChannel channel = FileChannel.open(lockPath,java.util.Set.of(StandardOpenOption.CREATE,StandardOpenOption.WRITE),
                PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
             FileLock lock = channel.tryLock()) {
            if (lock == null) throw new IOException("Worker already running");
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1",settings.port),0);
            ScheduledExecutorService heartbeat = Executors.newSingleThreadScheduledExecutor();
            try {
                state = readOrPair();
                if (!state.mode.equals(settings.mode) || (settings.provider.equals("github") && !state.mode.equals("codex"))) throw new IOException("Device mode cannot be changed");
                if (settings.executeGit) {
                    GitProvider provider=settings.provider.equals("github")?new GitHubProvider(System.getenv("AGENTSHIP_GITHUB_TOKEN")):new LocalGitProvider(settings.directory);
                    GitWorker.PlatformApi api = (path,body,key) -> post(path,body,state.token,key);
                    gitWorker=new GitWorker(settings.directory,provider,api);
                    if (settings.executeAgents) {
                        agentWorker = new AgentWorker(settings.directory, provider, api, state.mode.equals("demo"));
                        archiveWorker = new ArchiveWorker(settings.directory, provider, api);
                    }
                }
                proofKey = KeyFactory.getInstance("Ed25519").generatePrivate(new PKCS8EncodedKeySpec(DeviceProofCodec.decode(state.privateKey)));
                server.createContext("/",this::handle);
                server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
                server.start();
                heartbeat.scheduleWithFixedDelay(this::poll,0,10,TimeUnit.SECONDS);
                Runtime.getRuntime().addShutdownHook(new Thread(() -> { heartbeat.shutdownNow(); closeWorkers(); server.stop(0); }));
                System.out.println("AgentShip 本机程序已启动，仅监听 http://127.0.0.1:" + settings.port
                        + "。Git 准备：" + settings.executeGit + "，Agent 执行：" + settings.executeAgents + "。");
                new CountDownLatch(1).await();
            } finally { heartbeat.shutdownNow(); closeWorkers(); server.stop(0); }
        }
    }

    private void closeWorkers() {
        if (gitWorker != null) gitWorker.close();
        if (agentWorker != null) agentWorker.close();
        if (archiveWorker != null) archiveWorker.close();
    }

    private State readOrPair() throws Exception {
        Path path = settings.directory.resolve("device-state.json");
        if (Files.exists(path,LinkOption.NOFOLLOW_LINKS)) {
            if (Files.isSymbolicLink(path) || !Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS)
                    || Files.size(path) > BODY_LIMIT || !Files.getPosixFilePermissions(path).equals(PosixFilePermissions.fromString("rw-------")))
                throw new IOException("Invalid state file");
            State saved = JSON.readValue(Files.readAllBytes(path),State.class);
            if (!settings.origin.equals(saved.origin) || settings.pairCode != null) throw new IOException("State already paired");
            UUID.fromString(saved.deviceId);
            return saved;
        }
        if (settings.pairCode == null) throw new IOException("Pairing code required");
        var keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        JsonNode paired = post("/api/worker/pair",Map.of("code",settings.pairCode,"name",settings.name,
                "mode",settings.mode,"protocolVersion","1","proofPublicKey",DeviceProofCodec.encode(keys.getPublic().getEncoded())),null);
        State saved = new State(settings.origin,paired.path("deviceId").asText(),paired.path("token").asText(),
                DeviceProofCodec.encode(keys.getPrivate().getEncoded()),settings.name,settings.mode);
        UUID.fromString(saved.deviceId);
        if (saved.token.isBlank()) throw new IOException("Invalid pair response");
        Path temporary = Files.createTempFile(settings.directory,"device-state-",".tmp",
                PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        try {
            Files.write(temporary,JSON.writeValueAsBytes(saved),StandardOpenOption.TRUNCATE_EXISTING);
            Files.move(temporary,path,StandardCopyOption.ATOMIC_MOVE);
        } finally { Files.deleteIfExists(temporary); }
        return saved;
    }

    private void poll() {
        try {
            probeCodex();
            List<Map<String,Object>> gitLeases = gitWorker == null ? List.of() : gitWorker.activeLeases();
            List<Map<String,Object>> leases = new java.util.ArrayList<>(gitLeases);
            int slots = gitWorker == null ? 0 : gitWorker.availableSlots();
            Map<String,Object> poll = new HashMap<>();
            if (agentWorker != null) {
                leases.addAll(agentWorker.activeLeases());
                slots = Math.max(0, Math.min(agentWorker.availableSlots(), 4 - leases.size()));
                poll.put("acceptsAgentJobs", true);
            }
            poll.put("protocolVersion", "1");
            poll.put("availableSlots", slots);
            poll.put("active", leases);
            poll.put("codexStatus", codexStatus());
            JsonNode result=post("/api/worker/poll",poll,state.token);
            lastPoll = Instant.now();
            if(gitWorker!=null)gitWorker.receive(result);
            if(agentWorker!=null)agentWorker.receive(result);
            if(archiveWorker!=null)archiveWorker.tick();
        } catch (Exception ignored) { /* Presence expires naturally; next poll retries without logging credentials. */ }
    }

    private JsonNode post(String path, Object body, String token) throws Exception {return post(path,body,token,null);}
    private JsonNode post(String path, Object body, String token,String key) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(settings.origin + path)).timeout(Duration.ofSeconds(8))
                .header("Content-Type","application/json").header("Origin",settings.origin)
                .POST(HttpRequest.BodyPublishers.ofByteArray(JSON.writeValueAsBytes(body)));
        if(key!=null)request.header("Idempotency-Key",key);
        if (token != null) request.header("Authorization","Bearer " + token);
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);
        var response = client.send(request.build(),HttpResponse.BodyHandlers.ofInputStream());
        try (var stream = response.body()) {
            byte[] bytes = BoundedHttp.read(stream,1_048_576,deadline);
            int status=response.statusCode();
            if (List.of(400,401,403,404,409,422).contains(status)) {
                String code=null;
                try {code=JSON.readTree(bytes).path("error").path("code").asText();}catch(IOException ignored){}
                throw new PlatformRejection(status,code);
            }
            if (status < 200 || status >= 300 || bytes.length > 1_048_576)throw new IOException("Platform request unavailable");
            return JSON.readTree(bytes);
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            String origin = exchange.getRequestHeaders().getFirst("Origin");
            String host = exchange.getRequestHeaders().getFirst("Host");
            if (!settings.origin.equals(origin) || !("127.0.0.1:" + settings.port).equals(host)) {
                send(exchange,403,Map.of("error",Map.of("code","FORBIDDEN","message","请求来源不匹配。"))); return;
            }
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin",settings.origin);
            exchange.getResponseHeaders().set("Vary","Origin");
            exchange.getResponseHeaders().set("Cache-Control","no-store");
            exchange.getResponseHeaders().set("X-Content-Type-Options","nosniff");
            String path = exchange.getRequestURI().getPath();
            if (!(path.equals("/proof") || path.equals("/status")) || exchange.getRequestURI().getRawQuery() != null) {
                send(exchange,404,Map.of("error",Map.of("code","NOT_FOUND"))); return;
            }
            if (exchange.getRequestMethod().equals("OPTIONS")) {
                String requested = exchange.getRequestHeaders().getFirst("Access-Control-Request-Method");
                String headers = exchange.getRequestHeaders().getFirst("Access-Control-Request-Headers");
                if (!(path.equals("/proof") ? "POST" : "GET").equals(requested)
                        || (headers != null && !headers.equalsIgnoreCase("content-type"))) {
                    send(exchange,403,Map.of("error",Map.of("code","FORBIDDEN"))); return;
                }
                exchange.getResponseHeaders().set("Access-Control-Allow-Methods",path.equals("/proof") ? "POST" : "GET");
                exchange.getResponseHeaders().set("Access-Control-Allow-Headers","Content-Type");
                exchange.getResponseHeaders().set("Access-Control-Allow-Private-Network","true");
                exchange.sendResponseHeaders(204,-1); return;
            }
            if (!budget()) { send(exchange,429,Map.of("error",Map.of("code","TOO_MANY_REQUESTS"))); return; }
            if (path.equals("/status") && exchange.getRequestMethod().equals("GET")) {
                send(exchange,200,Map.of("deviceId",state.deviceId,"name",state.name,"mode",state.mode,
                        "connectivity",online() ? "online" : "offline","codexStatus",codexStatus())); return;
            }
            if (!path.equals("/proof") || !exchange.getRequestMethod().equals("POST")) {
                send(exchange,405,Map.of("error",Map.of("code","METHOD_NOT_ALLOWED"))); return;
            }
            if (!online()) { send(exchange,503,Map.of("error",Map.of("code","DEVICE_OFFLINE","message","本机程序正在等待平台连接。"))); return; }
            String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
            if (contentType == null || !contentType.split(";")[0].trim().equalsIgnoreCase("application/json")) {
                send(exchange,400,Map.of("error",Map.of("code","INVALID_REQUEST"))); return;
            }
            byte[] bytes = exchange.getRequestBody().readNBytes(BODY_LIMIT + 1);
            if (bytes.length > BODY_LIMIT) { send(exchange,413,Map.of("error",Map.of("code","INVALID_REQUEST"))); return; }
            try {
                JsonNode challenge = JSON.readTree(bytes);
                UUID id = UUID.fromString(challenge.path("challengeId").asText());
                String nonce = challenge.path("nonce").asText();
                if (DeviceProofCodec.decode(nonce).length < 16) throw new IllegalArgumentException();
                Instant expiry = Instant.parse(challenge.path("expiresAt").asText());
                if (!expiry.isAfter(Instant.now()) || expiry.isAfter(Instant.now().plusSeconds(180))) throw new IllegalArgumentException();
                String signature = DeviceProofCodec.sign(proofKey,DeviceProofCodec.message(UUID.fromString(state.deviceId),id,nonce,settings.origin));
                send(exchange,200,Map.of("deviceId",state.deviceId,"challengeId",id,"signature",signature));
            } catch (Exception error) { send(exchange,400,Map.of("error",Map.of("code","INVALID_REQUEST","message","设备挑战无效或已过期。"))); }
        }
    }

    private synchronized boolean budget() {
        long window = System.currentTimeMillis() / 60_000;
        if (window != budgetWindow) { budgetWindow = window; budgetCount = 0; }
        return ++budgetCount <= 120;
    }
    private boolean online() { return lastPoll != null && lastPoll.isAfter(Instant.now().minusSeconds(30)); }
    private String codexStatus() { return state.mode.equals("demo") ? "not_required" : probedCodexStatus; }
    private void probeCodex() {
        if(!state.mode.equals("codex") || System.currentTimeMillis()-lastCodexProbe<60_000)return;
        lastCodexProbe=System.currentTimeMillis();
        try {
            Process process=new ProcessBuilder("codex","--version").redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            boolean done=process.waitFor(5,TimeUnit.SECONDS);
            probedCodexStatus=done&&process.exitValue()==0?"available":"unavailable";
            if(!done)process.destroyForcibly();
        }catch(Exception unavailable){probedCodexStatus="unavailable";}
    }
    private static void send(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = JSON.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");
        exchange.sendResponseHeaders(status,bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    public record State(String origin, String deviceId, String token, String privateKey, String name, String mode) {}
    private record Settings(String origin, Path directory, String pairCode, int port, String name, String mode,
                            boolean executeGit, boolean executeAgents, String provider) {
        static Settings parse(String[] arguments) {
            Map<String,String> values = new HashMap<>();
            for (int i=0;i<arguments.length;i++) {
                if (arguments[i].equals("--worker")) continue;
                if (List.of("--execute-git", "--execute-agents").contains(arguments[i])) {
                    if (values.put(arguments[i], "true") != null) throw new IllegalArgumentException();
                    continue;
                }
                String key = arguments[i];
                if (!List.of("--platform","--state-dir","--pair-code","--port","--name","--mode","--git-provider").contains(key)
                        || i+1 >= arguments.length || values.put(key,arguments[++i]) != null) throw new IllegalArgumentException();
            }
            String origin = DeviceProofCodec.normalizeOrigin(values.getOrDefault("--platform","http://127.0.0.1:4173"));
            URI uri = URI.create(origin);
            if ("http".equals(uri.getScheme()) && !List.of("127.0.0.1","localhost","[::1]").contains(uri.getHost()))
                throw new IllegalArgumentException("Platform origins outside loopback require HTTPS");
            if (!values.containsKey("--state-dir")) throw new IllegalArgumentException("An explicit state directory is required");
            int port = Integer.parseInt(values.getOrDefault("--port","4781"));
            String mode = values.getOrDefault("--mode","demo"), name = values.getOrDefault("--name","我的电脑");
            if (port < 1024 || port > 65535 || name.isBlank() || name.length() > 120 || !List.of("demo","codex").contains(mode)) throw new IllegalArgumentException();
            boolean executeGit=values.containsKey("--execute-git");
            boolean executeAgents=values.containsKey("--execute-agents");
            if (executeAgents && !executeGit) throw new IllegalArgumentException();
            String provider=values.getOrDefault("--git-provider",mode.equals("demo")?"demo":"github");
            if(!List.of("demo","github").contains(provider) || (executeGit && !provider.equals(mode.equals("demo")?"demo":"github")))throw new IllegalArgumentException();
            return new Settings(origin,Path.of(values.get("--state-dir")).toAbsolutePath().normalize(),values.get("--pair-code"),port,name,mode,executeGit,executeAgents,provider);
        }
    }
}
