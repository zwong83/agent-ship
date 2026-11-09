package agentship.platform.runtime.application.collaboration;

import agentship.platform.identity.Tokens;
import agentship.platform.identity.api.BrowserSessions;
import agentship.platform.runtime.application.execution.NodeScheduler;
import agentship.platform.runtime.application.execution.RepairCycle;
import agentship.platform.runtime.application.port.ChatOperatorStore;
import agentship.platform.runtime.application.port.ChatOperatorStore.Command;
import agentship.platform.runtime.application.port.ChatOperatorStore.Lease;
import agentship.platform.runtime.application.port.ChatOperatorStore.LeaseKey;
import agentship.platform.runtime.application.port.ChatView;
import agentship.platform.runtime.application.port.RunLocks;
import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import agentship.platform.web.RequestFields;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RunOperatorService {
    private final ChatOperatorStore store;
    private final BrowserSessions sessions;
    private final ObjectMapper mapper;
    private final RunLocks locks;
    private final RepairCycle repair;
    private final NodeScheduler scheduler;
    private final RunChatActions chatActions;
    private final ChatView chatView;

    RunOperatorService(ChatOperatorStore store, BrowserSessions sessions, ObjectMapper mapper, RunLocks locks,
                       RepairCycle repair, NodeScheduler scheduler, RunChatActions chatActions, ChatView chatView) {
        this.store = store;
        this.sessions = sessions;
        this.mapper = mapper;
        this.locks = locks;
        this.repair = repair;
        this.scheduler = scheduler;
        this.chatActions = chatActions;
        this.chatView = chatView;
    }

    @Transactional
    public Map<String, Object> lease(Actor actor, UUID run, JsonNode body, String sessionToken) {
        lockRun(run);
        requireChat(actor, run);
        String action = RequestFields.text(body, "action", 20);
        UUID tab = RequestFields.id(body, "tabId");
        var lease = leaseKey(actor, run, tab);
        if ("acquire".equals(action)) {
            var acquired = store.acquire(lease);
            if (acquired == null) {
                String holder = store.holderName(run);
                Map<String, Object> details = holder == null ? Map.of() : Map.of("holderName", holder);
                throw new ApiProblem(409, "CHAT_OCCUPIED", "运行操作页正在由其他标签页使用。", details);
            }
            return leaseView(actor, run, tab, sessionToken, acquired);
        }
        if (!Set.of("heartbeat", "release").contains(action)) throw ApiProblem.invalid();
        long epoch = verifyProof(actor, run, tab, body, sessionToken);
        if ("release".equals(action)) {
            if (!store.release(lease, epoch)) throw staleLease();
            return Map.of("accepted", true);
        }
        var renewed = store.renew(lease, epoch);
        if (renewed == null) throw staleLease();
        return leaseView(actor, run, tab, sessionToken, renewed);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String, Object> targets(Actor actor, UUID run) {
        requireChat(actor, run);
        return Map.of("targets", store.targets(run));
    }

    @Transactional
    public Map<String, Object> action(Actor actor, UUID run, JsonNode body, String key, String sessionToken, String requestId) {
        var locked = lockRun(run);
        requireChat(actor, run);
        String action = RequestFields.text(body, "action", 30);
        UUID tab = RequestFields.id(body, "tabId");
        long epoch = verifyProof(actor, run, tab, body, sessionToken);
        var lease = leaseKey(actor, run, tab);
        store.lockLease(run);
        requireActiveLease(lease, epoch);
        if (!Set.of("repair", "recheck", "stop").contains(action)) {
            var command = command(actor, run, "chat-action", key, body);
            UUID prior = store.reserve(command);
            if (prior != null) return receipt(prior, true);
            var outcome = chatActions.apply(actor, run, locked, action, body);
            if (outcome.advance()) scheduler.advance(lockRun(run));
            return accept(command, outcome.target(), outcome.kind(), action, requestId);
        }
        UUID check = RequestFields.id(body, "targetId");
        long expectedWave = RequestFields.number(body, "wave", 1, Integer.MAX_VALUE);
        var command = command(actor, run, "repair-action", key, body);
        UUID prior = store.reserve(command);
        if (prior != null) return receipt(prior, true);
        Long wave = store.checkWave(run, check);
        if (wave == null || wave != expectedWave) {
            throw RequestFields.conflict("CHECK_WAVE_CONFLICT", "检查轮次已更新，请刷新后再处理。");
        }
        switch (action) {
            case "repair" -> repair.manualRepair(locked, check, actor.id());
            case "recheck" -> repair.manualRecheck(locked, check);
            case "stop" -> repair.stop(locked, check);
            default -> throw ApiProblem.invalid();
        }
        if (!"stop".equals(action)) scheduler.advance(locked);
        return accept(command, check, "check", action, requestId);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String, Object> chat(Actor actor, UUID run, UUID tab, long epoch, String proof, String sessionToken,
                                   String cursor, Integer pageSize) {
        requireChat(actor, run);
        if (epoch < 1 || !Tokens.valid(proof) || !Tokens.equal(credential(actor, run, tab, epoch, sessionToken), proof)) throw staleLease();
        requireActiveLease(leaseKey(actor, run, tab), epoch);
        return chatView.read(actor, run, proof, cursor, pageSize);
    }

    private void requireActiveLease(LeaseKey lease, long epoch) {
        if (!store.hasActiveLease(lease, epoch)) throw staleLease();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String, Object> access(Actor actor, UUID run) {
        requireInitiator(actor, run);
        return Map.of("guests", store.guests(run));
    }

    @Transactional
    public Map<String, Object> changeAccess(Actor actor, UUID run, JsonNode body, String key, String requestId) {
        var locked = lockRun(run);
        requireInitiator(actor, run);
        String action = RequestFields.text(body, "action", 20);
        if (!Set.of("grant", "revoke").contains(action)) throw ApiProblem.invalid();
        var command = command(actor, run, "chat-access", key, body);
        UUID prior = store.reserve(command);
        if (prior != null) return receipt(prior, true);
        UUID target;
        if ("grant".equals(action)) {
            String username = RequestFields.text(body, "username", 100);
            if (!username.matches("[A-Za-z0-9_-]{1,100}")) throw ApiProblem.invalid();
            target = store.activeAccount(username.toLowerCase(Locale.ROOT));
            if (target == null) throw new ApiProblem(404, "NOT_FOUND", "没有找到已激活的用户名。");
            boolean deputy = store.isDeputy((UUID) locked.get("requirement_id"), target);
            if (actor.id().equals(target) || deputy) {
                throw RequestFields.conflict("CHAT_ACCESS_NOT_ALLOWED", "发起人和需求副负责人无需或不可添加为访客。");
            }
            store.grant(run, target, actor.id());
        } else {
            target = RequestFields.id(body, "userId");
            store.revoke(run, target);
        }
        return accept(command, target, "chat_access", action, requestId);
    }

    private Map<String, Object> lockRun(UUID run) {
        UUID requirement = locks.requirementId(run);
        if (requirement == null) throw inaccessible();
        return locks.lock(run, requirement, false);
    }

    private void requireChat(Actor actor, UUID run) {
        sessions.requireActive(actor.id(), actor.sessionId());
        if (!store.canChat(run, actor.id())) throw inaccessible();
    }

    private void requireInitiator(Actor actor, UUID run) {
        sessions.requireActive(actor.id(), actor.sessionId());
        if (!store.isInitiator(run, actor.id())) throw inaccessible();
    }

    private static LeaseKey leaseKey(Actor actor, UUID run, UUID tab) {
        return new LeaseKey(run, actor.id(), actor.sessionId(), tab);
    }

    private static String credential(Actor actor, UUID run, UUID tab, long epoch, String sessionToken) {
        if (!Tokens.valid(sessionToken)) throw ApiProblem.unauthenticated();
        String context = "agentship-run-operator-v1\n" + run + "\n" + actor.id() + "\n" + actor.sessionId() + "\n" + tab + "\n" + epoch;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(Tokens.hmac(sessionToken.getBytes(StandardCharsets.UTF_8), context));
    }

    private static Map<String, Object> leaseView(Actor actor, UUID run, UUID tab, String sessionToken, Lease lease) {
        return Map.of("tabId", tab, "epoch", lease.epoch(), "credential", credential(actor, run, tab, lease.epoch(), sessionToken),
                "heartbeatDueAt", lease.heartbeatDue().toString(), "graceSeconds", 300);
    }

    private static long verifyProof(Actor actor, UUID run, UUID tab, JsonNode body, String sessionToken) {
        long epoch = RequestFields.number(body, "epoch", 1, Long.MAX_VALUE);
        String proof = RequestFields.text(body, "leaseCredential", 100);
        if (!Tokens.equal(credential(actor, run, tab, epoch, sessionToken), proof)) throw staleLease();
        return epoch;
    }

    private Command command(Actor actor, UUID run, String kind, String key, JsonNode body) {
        if (key == null || key.isBlank() || key.length() > 200 || key.indexOf(0) >= 0) throw ApiProblem.invalid();
        return new Command(run, actor.id(), kind + ":" + run, key, RequestFields.digest(mapper, body));
    }

    private Map<String, Object> accept(Command command, UUID target, String kind, String action, String requestId) {
        UUID id = UUID.randomUUID();
        store.accept(command, id, target, kind, action, requestId);
        return receipt(id, false);
    }

    private static Map<String, Object> receipt(UUID id, boolean duplicate) {
        return Map.of("accepted", true, "duplicate", duplicate, "receiptId", id);
    }

    private static ApiProblem inaccessible() {
        return new ApiProblem(404, "NOT_FOUND", "运行不存在或没有操作页访问权限。");
    }

    private static ApiProblem staleLease() {
        return RequestFields.conflict("CHAT_LEASE_LOST", "当前标签页的操作权已失效，请重新进入。");
    }
}
