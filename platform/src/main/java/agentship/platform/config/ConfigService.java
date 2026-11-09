package agentship.platform.config;

import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
class ConfigService {
    private static final Pattern USERNAME = Pattern.compile("[A-Za-z0-9_-]{1,100}");
    private static final Set<String> PURPOSES = Set.of("view","edit","start","use");

    enum Kind {
        REQUIREMENT("requirements","requirement"),
        FLOW("flows","workflow"),
        AGENT("agents","agent");

        final String wire;
        final String database;

        Kind(String wire, String database) {
            this.wire = wire;
            this.database = database;
        }

        static Kind fromPath(String wire) {
            for (Kind value : values()) {
                if (value.wire.equals(wire)) {
                    return value;
                }
            }
            throw invalid("配置类型无效");
        }
    }

    record Page<T>(List<T> items, String nextCursor) {}
    record OwnershipReceipt(boolean accepted, boolean duplicate, UUID receiptId) {}
    record AgentChoice(UUID id, String name, String availability, String description) {}
    private record Draft(String name, long version, UUID project, String description,
                         String roleKey, String skillRef,
                         @JsonInclude(JsonInclude.Include.NON_NULL) WorkflowGraph workflow) {}
    private record OwnerCommand(String action, long version, String username, UUID userId) {}

    private final ConfigStore store;
    private final ConfigCursor cursor;
    private final ObjectMapper mapper;
    private final WorkflowStore workflows;

    ConfigService(ConfigStore store, ConfigCursor cursor, ObjectMapper mapper, WorkflowStore workflows) {
        this.store = store;
        this.cursor = cursor;
        this.mapper = mapper;
        this.workflows = workflows;
    }

    @Transactional(readOnly = true)
    public Page<Map<String,Object>> listProjects(Actor actor, String query, String token, Integer pageSize) {
        String needle = search(query);
        String scope = scope(actor.id(),"projects",needle);
        int size = boundedSize(pageSize,false);
        List<ConfigStore.Project> projects = store.projects(actor.id(),needle,cursor.decode(token,scope),size+1);
        return page(projects,size,scope,
                project -> Map.of("id",project.id(),"name",project.name()),
                project -> new ConfigCursor.Position(project.sortName(),project.id()));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page<Map<String,Object>> list(Actor actor, Kind kind, UUID project, String query, String purpose,
                                         UUID requirement, String token, Integer pageSize) {
        if (!PURPOSES.contains(purpose) || ("start".equals(purpose) && kind != Kind.REQUIREMENT)
                || ("use".equals(purpose) && kind != Kind.FLOW)
                || (requirement != null && !"use".equals(purpose)) || (project != null && kind != Kind.REQUIREMENT)) {
            throw invalid("配置类型与查询用途不匹配");
        }
        if ("use".equals(purpose)) {
            if (requirement == null) {
                throw invalid("请选择需要启动的需求");
            }
            ConfigStore.Row context = visible(Kind.REQUIREMENT,requirement,actor.id(),false);
            if (!context.owner().equals(actor.id())) {
                throw forbidden();
            }
        }
        if (project != null && !store.projectPermission(project,actor.id(),"view_project")) {
            throw notFound();
        }
        String needle = search(query);
        String scope = scope(actor.id(),kind.wire,purpose,project,requirement,needle);
        int size = boundedSize(pageSize,false);
        List<ConfigStore.Row> rows = store.list(kind,actor.id(),project,needle,cursor.decode(token,scope),
                size+1,"start".equals(purpose),false,"use".equals(purpose));
        return page(rows,size,scope,row -> summary(kind,row,actor.id()),
                row -> new ConfigCursor.Position(row.sortName(),row.id()));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page<AgentChoice> catalog(Actor actor, UUID flow, String query, String token, Integer pageSize) {
        if (flow != null) {
            visible(Kind.FLOW,flow,actor.id(),false);
        }
        String needle = search(query);
        String scope = scope(actor.id(),"agent-catalog",flow,needle);
        int size = boundedSize(pageSize,true);
        List<ConfigStore.Row> rows = store.list(Kind.AGENT,actor.id(),null,needle,cursor.decode(token,scope),
                size+1,false,true,false);
        return page(rows,size,scope,
                row -> new AgentChoice(row.agentId(),row.agentName(),"unknown",row.instruction()),
                row -> new ConfigCursor.Position(row.agentSortName(),row.agentId()));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String,Object> detail(Actor actor, Kind kind, UUID id) {
        ConfigStore.Row row = visible(kind,id,actor.id(),false);
        return projectDetail(kind,row,actor.id());
    }

    @Transactional
    public Map<String,Object> create(Actor actor, Kind kind, String requestKey, JsonNode body, String requestId) {
        requireCurrentSession(actor);
        Draft draft = draft(kind,body,false);
        String scope = "configuration:create:" + kind.wire;
        ConfigStore.Receipt receipt = reserve(actor,scope,requestKey,draft);
        if (!receipt.fresh()) {
            lock(kind,receipt.resultId(),actor);
            return detail(actor,kind,receipt.resultId());
        }
        UUID id = UUID.randomUUID();
        switch (kind) {
            case REQUIREMENT -> {
                if (!store.projectPermission(draft.project(),actor.id(),"create_requirement")) {
                    throw forbidden();
                }
                String key = nameKey(draft.name());
                requireUniqueRequirement(key,null,actor.id());
                store.createBase(kind,id,actor.id());
                store.createRequirement(id,draft.project(),draft.name(),key,draft.description());
            }
            case FLOW -> {
                store.createBase(kind,id,actor.id());
                store.createFlow(id,draft.name());
                workflows.save(id,draft.workflow(),actor);
            }
            case AGENT -> {
                store.lockName("agent:" + draft.roleKey());
                if (store.roleKeyExists(draft.roleKey())) {
                    throw new ApiProblem(409,"NAME_UNAVAILABLE","该角色标识不可用");
                }
                store.createBase(kind,id,actor.id());
                store.createAgent(id,draft.name(),draft.roleKey());
                store.writeAgentVersion(id,draft.name(),draft.description(),draft.skillRef());
            }
        }
        store.finish(actor.id(),scope,requestKey,"configuration",id);
        store.audit(actor.id(),id,kind,"create",requestId);
        return detail(actor,kind,id);
    }

    @Transactional
    public Map<String,Object> update(Actor actor, Kind kind, UUID id, String requestKey, JsonNode body, String requestId) {
        Draft draft = draft(kind,body,true);
        ConfigStore.Header header = lock(kind,id,actor);
        ConfigStore.Row current = visible(kind,id,actor.id(),true);
        String scope = "configuration:update:" + kind.wire + ":" + id;
        if (!reserve(actor,scope,requestKey,draft).fresh()) {
            return projectDetail(kind,current,actor.id());
        }
        requireVersion(header,draft.version());
        switch (kind) {
            case REQUIREMENT -> {
                if (!draft.project().equals(current.project())) {
                    throw invalid("已有需求的项目不可更改");
                }
                String key = nameKey(draft.name());
                requireUniqueRequirement(key,id,actor.id());
                store.updateRequirement(id,draft.name(),key,draft.description());
            }
            case FLOW -> {
                store.renameFlow(id,draft.name());
                workflows.save(id,draft.workflow(),actor);
            }
            case AGENT -> {
                if (!draft.roleKey().equals(current.roleKey())) {
                    throw invalid("已有 Agent 的角色标识不可更改");
                }
                store.writeAgentVersion(current.agentId(),draft.name(),draft.description(),draft.skillRef());
            }
        }
        store.bumpVersion(id);
        store.finish(actor.id(),scope,requestKey,"configuration",id);
        store.audit(actor.id(),id,kind,"update",requestId);
        return detail(actor,kind,id);
    }

    @Transactional
    public OwnershipReceipt changeOwner(Actor actor, Kind kind, UUID id, String requestKey, JsonNode body, String requestId) {
        OwnerCommand command = ownershipCommand(body);
        ConfigStore.Header header = lock(kind,id,actor);
        String scope = "configuration:ownership:" + kind.wire + ":" + id;
        boolean currentOwner = header.owner().equals(actor.id());
        if (!currentOwner && !"transfer".equals(command.action())) {
            denyOwnership(kind,id,actor.id());
        }
        ConfigStore.Receipt prior = reserve(actor,scope,requestKey,command);
        if (!prior.fresh()) {
            if (!currentOwner && !"transfer".equals(prior.resultKind())) {
                denyOwnership(kind,id,actor.id());
            }
            return new OwnershipReceipt(true,true,prior.resultId());
        }
        if (!currentOwner) {
            denyOwnership(kind,id,actor.id());
        }
        requireVersion(header,command.version());
        if ("remove_deputy".equals(command.action())) {
            if (!store.removeDeputy(id,command.userId())) {
                throw memberUnavailable();
            }
        } else {
            UUID target = store.activeAccount(command.username()).map(ConfigStore.Identity::id)
                    .filter(value -> !value.equals(actor.id())).orElseThrow(ConfigService::memberUnavailable);
            if ("transfer".equals(command.action())) {
                store.transfer(id,actor.id(),target);
            } else {
                store.addDeputy(id,target,actor.id());
            }
        }
        UUID receiptId = UUID.randomUUID();
        store.finish(actor.id(),scope,requestKey,command.action(),receiptId);
        store.audit(actor.id(),id,kind,command.action(),requestId);
        return new OwnershipReceipt(true,false,receiptId);
    }

    private <T,R> Page<R> page(List<T> rows, int size, String scope, Function<T,R> projection,
                               Function<T,ConfigCursor.Position> position) {
        List<T> shown = rows.size() > size ? rows.subList(0,size) : rows;
        String next = rows.size() > size ? cursor.encode(scope,position.apply(shown.getLast())) : null;
        return new Page<>(shown.stream().map(projection).toList(),next);
    }

    private ConfigStore.Header lock(Kind kind, UUID id, Actor actor) {
        ConfigStore.Header header = store.lock(kind,id,actor.id()).orElseThrow(ConfigService::notFound);
        requireCurrentSession(actor);
        return header;
    }

    private void requireCurrentSession(Actor actor) {
        if (!store.currentSession(actor)) {
            throw new ApiProblem(401,"UNAUTHENTICATED","请重新登录");
        }
    }

    private ConfigStore.Row visible(Kind kind, UUID id, UUID actor, boolean edit) {
        ConfigStore.Row row = store.get(kind,id,actor).orElseThrow(ConfigService::notFound);
        if (row.owner().equals(actor) || row.deputy()) {
            return row;
        }
        if (edit && row.formerDeputy()) {
            throw new ApiProblem(403,"ACCESS_REVOKED","你已被移除，无法继续编辑此配置");
        }
        throw notFound();
    }

    private void denyOwnership(Kind kind, UUID id, UUID actor) {
        visible(kind,id,actor,false);
        throw forbidden();
    }

    private void requireUniqueRequirement(String key, UUID except, UUID actor) {
        store.lockName("requirement:" + key);
        store.requirementName(key).filter(row -> !row.id().equals(except)).ifPresent(row -> {
            if (row.owner().equals(actor)) {
                throw new ApiProblem(409,"REQUIREMENT_EXISTS","请选择已有的同名需求",
                        Map.of("existingRequirementId",row.id()));
            }
            throw new ApiProblem(409,"NAME_UNAVAILABLE","该名称不可用，请换一个名称");
        });
    }

    private ConfigStore.Receipt reserve(Actor actor, String scope, String key, Object payload) {
        if (key == null || key.isBlank() || key.length() > 200 || key.indexOf(0) >= 0) {
            throw invalid("请求标识无效");
        }
        byte[] digest = digest(payload);
        ConfigStore.Receipt receipt = store.reserve(actor.id(),scope,key,digest);
        if (!MessageDigest.isEqual(digest,receipt.digest()) || (!receipt.fresh() && receipt.resultId() == null)) {
            throw new ApiProblem(409,"IDEMPOTENCY_CONFLICT","此请求标识已用于不同请求");
        }
        return receipt;
    }

    private byte[] digest(Object payload) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(payload));
        } catch (NoSuchAlgorithmException | JsonProcessingException failure) {
            throw new IllegalStateException("Cannot fingerprint configuration command",failure);
        }
    }

    private Map<String,Object> projectDetail(Kind kind, ConfigStore.Row row, UUID actor) {
        Map<String,Object> result = summary(kind,row,actor);
        result.put("owner",store.owner(row.owner()));
        result.put("deputies",store.deputies(row.id()));
        Map<String,Object> data = new LinkedHashMap<>();
        switch (kind) {
            case REQUIREMENT -> {
                data.put("projectId",row.project());
                data.put("description",row.description());
            }
            case FLOW -> data.put("stages",workflows.read(row.id(),row.workflowVersion()).stages());
            case AGENT -> {
                data.put("roleKey",row.roleKey());
                data.put("description",row.instruction());
                if (row.skillRef() != null) {
                    data.put("skillRef",row.skillRef());
                }
            }
        }
        result.put("data",data);
        return result;
    }

    private Map<String,Object> summary(Kind kind, ConfigStore.Row row, UUID actor) {
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("id",row.id());
        result.put("kind",kind.wire);
        result.put("name",row.name());
        result.put("version",row.version());
        if (kind == Kind.FLOW) {
            result.put("workflowVersion",row.workflowVersion());
        }
        if (kind == Kind.REQUIREMENT) {
            result.put("projectId",row.project());
            result.put("repository",row.repositoryId() == null ? null : Map.of(
                    "provider",row.provider(),"repositoryId",row.repositoryId(),"displayName",row.repositoryName()));
        }
        List<String> actions = new ArrayList<>(List.of("view","edit"));
        if (row.owner().equals(actor)) {
            actions.add("manage_members");
            if (kind == Kind.REQUIREMENT) {
                actions.add("start");
            }
        }
        if (kind == Kind.AGENT || (kind == Kind.FLOW && row.workflowVersion() != null)) {
            actions.add("use");
        }
        result.put("allowedActions",actions);
        return result;
    }

    private static Draft draft(Kind kind, JsonNode body, boolean update) {
        if (!body.isObject() || !body.path("data").isObject()) {
            throw invalid("配置数据无效");
        }
        long version = update ? version(body) : 0;
        String name = string(body.get("name"),120,true,"名称");
        JsonNode data = body.path("data");
        return switch (kind) {
            case REQUIREMENT -> {
                if (!data.has("description")) {
                    throw invalid("请提供需求描述字段");
                }
                yield new Draft(name,version,uuid(data.get("projectId"),"项目"),
                        optional(data.get("description"),16000,"需求描述"),null,null,null);
            }
            case FLOW -> {
                yield new Draft(name,version,null,null,null,null,WorkflowGraph.parse(data));
            }
            case AGENT -> {
                if (!data.hasNonNull("description")) {
                    throw invalid("请提供 Agent 说明");
                }
                yield new Draft(name,version,null,string(data.get("description"),8000,false,"Agent 说明"),
                        string(data.get("roleKey"),150,true,"角色标识"),optional(data.get("skillRef"),150,"Skill"),null);
            }
        };
    }

    private static OwnerCommand ownershipCommand(JsonNode body) {
        if (!body.isObject()) {
            throw invalid("负责人请求无效");
        }
        long version = version(body);
        String action = body.path("action").asText();
        return switch (action) {
            case "add_deputy","transfer" -> {
                JsonNode username = body.path("username");
                if (body.size() != 3 || !username.isTextual() || !USERNAME.matcher(username.textValue()).matches()) {
                    throw invalid("请输入完整用户名");
                }
                yield new OwnerCommand(action,version,username.textValue().toLowerCase(Locale.ROOT),null);
            }
            case "remove_deputy" -> {
                if (body.size() != 3) {
                    throw invalid("副负责人请求无效");
                }
                yield new OwnerCommand(action,version,null,uuid(body.get("userId"),"副负责人"));
            }
            default -> throw invalid("负责人操作无效");
        };
    }

    private static long version(JsonNode body) {
        JsonNode version = body.path("expectedVersion");
        if (!version.isIntegralNumber() || !version.canConvertToLong() || version.longValue() < 1) {
            throw invalid("配置版本无效");
        }
        return version.longValue();
    }

    private static void requireVersion(ConfigStore.Header header, long version) {
        if (version != header.version()) {
            throw new ApiProblem(409,"STALE_VERSION","配置已更新，请刷新后再提交",
                    Map.of("currentVersion",header.version()));
        }
    }

    private static String optional(JsonNode value, int max, String label) {
        return value == null || value.isNull() ? null : string(value,max,false,label);
    }

    private static String string(JsonNode value, int max, boolean trim, String label) {
        if (value == null || !value.isTextual()) {
            throw invalid(label + "无效");
        }
        String text = trim ? value.textValue().strip() : value.textValue();
        if ((trim && text.isBlank()) || text.codePointCount(0,text.length()) > max || text.indexOf(0) >= 0) {
            throw invalid(label + "无效");
        }
        return text;
    }

    private static UUID uuid(JsonNode value, String label) {
        try {
            if (value == null || !value.isTextual()) {
                throw invalid(label + "无效");
            }
            UUID id = UUID.fromString(value.textValue());
            if (!id.toString().equalsIgnoreCase(value.textValue())) {
                throw invalid(label + "无效");
            }
            return id;
        } catch (IllegalArgumentException invalidId) {
            throw invalid(label + "无效");
        }
    }

    private static String search(String query) {
        if (query == null) {
            return "";
        }
        String normalized = query.strip().toLowerCase(Locale.ROOT);
        if (normalized.length() > 200 || normalized.indexOf(0) >= 0) {
            throw invalid("搜索词无效");
        }
        return normalized;
    }

    private static String nameKey(String name) {
        String key = Normalizer.normalize(name,Normalizer.Form.NFKC).strip().toLowerCase(Locale.ROOT);
        if (key.isBlank()) {
            throw invalid("名称无效");
        }
        return key;
    }

    private static String scope(Object... parts) {
        StringBuilder scope = new StringBuilder();
        for (Object part : parts) {
            String value = part == null ? "" : part.toString();
            scope.append(value.length()).append(':').append(value);
        }
        return scope.toString();
    }

    private static int boundedSize(Integer size, boolean strict) {
        if (size == null) {
            return 25;
        }
        if (size < 1 || (strict && size > 100)) {
            throw invalid("分页大小无效");
        }
        return Math.min(size,100);
    }

    private static ApiProblem invalid(String message) {
        return new ApiProblem(400,"INVALID_REQUEST",message);
    }

    private static ApiProblem forbidden() {
        return new ApiProblem(403,"FORBIDDEN","当前账号没有此操作权限");
    }

    private static ApiProblem notFound() {
        return new ApiProblem(404,"NOT_FOUND","配置不存在或不可访问");
    }

    private static ApiProblem memberUnavailable() {
        return new ApiProblem(404,"MEMBER_UNAVAILABLE","该用户不可用");
    }
}
