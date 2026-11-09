package agentship.platform.runtime.application.gitprep;

import agentship.platform.catalog.api.RequirementRepositories;
import agentship.platform.runtime.application.port.GitPreparationStore;
import agentship.platform.runtime.application.port.GitPreparationStore.Observation;
import agentship.platform.runtime.application.port.GitPreparationStore.Operation;
import agentship.platform.runtime.application.port.WorkerTaskStore.TaskContext;
import agentship.platform.runtime.domain.GitPlan;
import agentship.platform.web.ApiProblem;
import agentship.platform.web.RequestFields;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class GitOperations {
    private static final Set<String> SAFE_FAILURES=Set.of("GIT_AUTH_REQUIRED","GIT_PERMISSION_DENIED","GIT_TARGET_CONFLICT",
            "GIT_PROVIDER_UNAVAILABLE","GIT_PREPARATION_FAILED","EXTERNAL_GRANT_REQUIRED","GIT_EVIDENCE_MISMATCH",
            "GIT_REPOSITORY_EMPTY","GIT_NAMESPACE_UNAVAILABLE","GIT_BASE_BRANCH_UNAVAILABLE");
    private final GitPreparationStore store;
    private final RequirementRepositories requirements;
    private final ObjectMapper mapper;

    GitOperations(GitPreparationStore store, RequirementRepositories requirements, ObjectMapper mapper) {
        this.store = store;
        this.requirements = requirements;
        this.mapper = mapper;
    }

    public List<Operation> ensure(TaskContext context) {
        List<Operation> values = new ArrayList<>();
        for (var planned : GitPlan.operations(context.run())) {
            UUID requirement = (UUID) context.run().get("requirement_id");
            UUID run = "create_repository".equals(planned.effect()) ? null : context.runId();
            var operation = store.ensure(requirement, run, (String) context.run().get("mode"), planned);
            if(!planned.targetId().equals(operation.target())) throw RequestFields.conflict("GIT_TARGET_CONFLICT","同一需求的仓库位置与已保存的操作不一致，请人工确认");
            values.add(operation);
        }
        return values;
    }
    public List<Map<String,Object>> dispatchOperations(TaskContext context) {
        List<Map<String,Object>> values=new ArrayList<>();
        for(var operation:ensure(context)) {
            Map<String,Object> value=new LinkedHashMap<>();
            value.put("operationKey",operation.key()); value.put("effect",operation.effect());
            value.put("targetId",operation.target()); value.put("state",operation.state());
            if(operation.providerResult()!=null) value.put("providerResultId",operation.providerResult());
            values.add(value);
        }
        return values;
    }
    public Map<String,Object> authorize(TaskContext context,JsonNode body) {
        String operationKey=RequestFields.text(body,"operationKey",300),effect=RequestFields.text(body,"effect",40),target=RequestFields.text(body,"targetId",500);
        var operation=find(context,operationKey);
        if(!effect.equals(operation.effect()) || !target.equals(operation.target())) throw new ApiProblem(403,"EXTERNAL_SCOPE_DENIED","外部操作超出本次运行确认的范围");
        String state=operation.state();
        String decision;
        Instant deadline=Instant.now().plusSeconds(30);
        if(state.equals("intended")) {
            UUID owner = (UUID) context.run().get("current_owner");
            Instant grantDeadline = store.grantDeadline(context.runId(), effect, target, owner);
            if (!context.run().get("initiator_id").equals(owner) || grantDeadline == null) {
                throw new ApiProblem(403,"EXTERNAL_GRANT_REQUIRED","本次 Git 操作授权已失效，需要主负责人重新确认");
            }
            if(grantDeadline.isBefore(deadline)) deadline=grantDeadline;
            decision="dispatch";
        } else if(state.equals("succeeded")) decision="already_succeeded";
        else if(Set.of("dispatching","unknown").contains(state)) decision="reconcile";
        else throw RequestFields.conflict("EXTERNAL_OPERATION_FAILED","该外部操作已确认失败，需要人工处理");
        Instant lease=((Timestamp)context.attempt().get("lease_deadline")).toInstant();
        if(lease.isBefore(deadline)) deadline=lease;
        store.associateTask(operation.id(), context.task());
        if ("dispatch".equals(decision)) store.dispatch(operation.id(), context.task(), context.epoch(), deadline);
        return Map.of("operationKey",operationKey,"effect",effect,"expiresAt",deadline.toString(),"decision",decision);
    }

    public Observation observation(TaskContext context,JsonNode evidence) {
        String key=RequestFields.text(evidence,"operationKey",300),outcome=RequestFields.text(evidence,"outcome",30);
        if(!Set.of("confirmed_success","confirmed_failure","unknown").contains(outcome)) throw ApiProblem.invalid();
        var operation=find(context,key);
        String effect=operation.effect(),target=operation.target();
        if(!target.equals(RequestFields.text(evidence,"targetId",500)) ||
                !(effect.equals("create_repository")?"repository":"branch").equals(RequestFields.text(evidence,"kind",30))) {
            throw new ApiProblem(403,"EXTERNAL_SCOPE_DENIED","Git 结果与任务目标不一致");
        }
        Instant observed=RequestFields.instant(evidence,"observedAt");
        if(observed.isAfter(Instant.now().plusSeconds(300))) throw ApiProblem.invalid();
        if (!store.scopedToTask(operation.id(), context.task()) || operation.state().equals("intended")) throw new ApiProblem(403,"EXTERNAL_SCOPE_DENIED","尚未为当前任务记录此 Git 操作");
        String result=evidence.hasNonNull("providerResultId")?RequestFields.text(evidence,"providerResultId",500):null;
        UUID repository=null;
        String branch=null,commit=null;
        if(outcome.equals("confirmed_success")) {
            if(result==null) throw ApiProblem.invalid();
            JsonNode repo=evidence.get("repository");
            validateRepository(context,repo);
            if(!effect.equals("create_repository")) {
                JsonNode git=evidence.get("git");
                if(git==null || !git.isObject() || !repo.equals(git.get("repository"))) throw ApiProblem.invalid();
                branch=RequestFields.text(git,"workBranch",250);
                if(!target.equals(GitPlan.repository(context.run())+"#refs/heads/"+branch)) throw RequestFields.conflict("GIT_EVIDENCE_MISMATCH","分支证据不符合计划");
                String expectedBase=effect.equals("create_base_branch") || context.run().get("work_type").equals("hotfix")
                        ?RequestFields.text(repo,"defaultBranch",200):"dev";
                if(!expectedBase.equals(RequestFields.text(git,"baseBranch",200))) throw RequestFields.conflict("GIT_EVIDENCE_MISMATCH","基础分支证据不符合计划");
                commit=RequestFields.text(git,"baseCommit",64);
                if(!commit.matches("[0-9a-fA-F]{40}|[0-9a-fA-F]{64}")) throw ApiProblem.invalid();
                if(!result.equals(commit) || (git.hasNonNull("headCommit") && !commit.equals(RequestFields.text(git,"headCommit",64)))) {
                    throw RequestFields.conflict("GIT_EVIDENCE_MISMATCH","分支提交证据不一致");
                }
            }
            if(effect.equals("create_repository") && !result.equals(RequestFields.text(repo,"repositoryId",200))) {
                throw RequestFields.conflict("GIT_EVIDENCE_MISMATCH","仓库提供方标识不一致");
            }
            repository=repository(repo);
            for(var preceding:ensure(context)) {
                if(preceding.state().equals("succeeded")) {
                    var identities = store.successfulRepositories(preceding.id());
                    if (identities.stream().anyMatch(identity -> !repositoryIdentityEquals(identity, repo))) {
                        throw RequestFields.conflict("GIT_EVIDENCE_MISMATCH","各 Git 步骤必须对应同一个仓库标识");
                    }
                }
            }
        }
        if(operation.state().equals("succeeded")) {
            var prior = store.confirmedObservation(operation.id());
            if (!outcome.equals("confirmed_success") || !java.util.Objects.equals(repository, prior.repository())
                    || !java.util.Objects.equals(branch, prior.branch()) || !java.util.Objects.equals(commit, prior.commit())) {
                throw RequestFields.conflict("GIT_EVIDENCE_MISMATCH","已确认的 Git 结果不能被不同结果覆盖");
            }
            return prior;
        }
        if(operation.state().equals("failed")) throw RequestFields.conflict("EXTERNAL_OPERATION_FAILED","该 Git 操作已确认失败");
        var recorded = store.observe(operation.id(), context.task(), target, observed, result,
                new Observation(outcome, repository, branch, commit));
        if (outcome.equals("confirmed_success") && effect.equals("create_repository") && context.run().get("mode").equals("codex")) {
            requirements.associate((UUID) context.run().get("requirement_id"), repository);
        }
        return recorded;
    }

    public void complete(TaskContext context,JsonNode evidence) {
        var finalEvidence=observation(context,evidence);
        if(!"confirmed_success".equals(finalEvidence.outcome())) throw RequestFields.conflict("GIT_EVIDENCE_REQUIRED","需要已验证的 Git 成功证据才能完成准备");
        var operations=ensure(context);
        if(operations.stream().anyMatch(op->!op.state().equals("succeeded"))) throw RequestFields.conflict("GIT_EVIDENCE_REQUIRED","所有 Git 准备步骤都需要成功证据");
        if(!GitPlan.workBranch(context.run()).equals(finalEvidence.branch())) throw RequestFields.conflict("GIT_EVIDENCE_MISMATCH","完成结果必须对应本次运行的工作分支");
        JsonNode git=evidence.get("git"),repo=evidence.get("repository");
        store.completeRun(context.runId(), finalEvidence.repository(), RequestFields.text(git, "baseBranch", 200),
                RequestFields.text(git, "workBranch", 250), RequestFields.text(git, "baseCommit", 64),
                RequestFields.text(repo, "defaultBranch", 200));
    }

    private Operation find(TaskContext context,String key) {
        return ensure(context).stream().filter(op->key.equals(op.key())).findFirst()
                .orElseThrow(()->new ApiProblem(403,"EXTERNAL_SCOPE_DENIED","外部操作不属于当前 Git 任务"));
    }
    private void validateRepository(TaskContext context,JsonNode repo) {
        String provider=context.run().get("mode").equals("demo")?"demo":"github";
        if(repo==null || !provider.equals(RequestFields.text(repo,"provider",20)) || !GitPlan.repository(context.run()).equalsIgnoreCase(RequestFields.text(repo,"displayName",300))) {
            throw RequestFields.conflict("GIT_EVIDENCE_MISMATCH","仓库证据不符合运行模式或目标位置");
        }
        String id=RequestFields.text(repo,"repositoryId",200),branch=RequestFields.text(repo,"defaultBranch",200);
        if(provider.equals("github") && !id.matches("[0-9]{1,30}")) throw ApiProblem.invalid();
        if(!branch.matches("[A-Za-z0-9][A-Za-z0-9._/-]{0,199}") || branch.contains("..") || branch.contains("//") || branch.endsWith("/") || branch.endsWith(".") || branch.endsWith(".lock")) throw ApiProblem.invalid();
        if(context.run().get("github_namespace")==null && provider.equals("github") && !id.equals(context.run().get("provider_repository_id"))) {
            throw RequestFields.conflict("GIT_EVIDENCE_MISMATCH","仓库标识与需求关联的仓库不一致");
        }
    }
    private boolean repositoryIdentityEquals(UUID id, JsonNode repo) {
        if (id == null) return false;
        var actual = store.repository(id);
        return actual.provider().equals(RequestFields.text(repo, "provider", 20))
                && actual.providerId().equals(RequestFields.text(repo, "repositoryId", 200));
    }

    private UUID repository(JsonNode repo) {
        String provider = RequestFields.text(repo, "provider", 20);
        String remote = RequestFields.text(repo, "repositoryId", 200);
        String name = RequestFields.text(repo, "displayName", 300);
        String branch = RequestFields.text(repo, "defaultBranch", 200);
        var existing = store.ensureRepository(provider, remote, name, branch);
        if (!existing.name().equalsIgnoreCase(name)) {
            throw RequestFields.conflict("GIT_EVIDENCE_MISMATCH", "仓库标识已对应其他仓库位置");
        }
        store.defaultBranch(existing.id(), branch);
        return existing.id();
    }

    public UUID operationId(String key) {
        return store.operationId(key);
    }

    public String failureReason(TaskContext context,JsonNode result) {
        String supplied=RequestFields.text(result,"reasonCode",100);
        RequestFields.text(result,"message",4000);
        if(!result.path("retryable").isBoolean()) throw ApiProblem.invalid();
        if(result.has("external")) observation(context,result.get("external"));
        var operationsNow=ensure(context);
        boolean unknown=operationsNow.stream().anyMatch(operation->Set.of("dispatching","unknown").contains(operation.state()));
        if(unknown) {
            for(var operation:operationsNow) if(operation.state().equals("dispatching")) {
                store.markUnknown(operation.id());
            }
        }
        String mapped=switch(supplied) {
            case "GITHUB_ACCESS_DENIED"->"GIT_PERMISSION_DENIED";
            case "REPOSITORY_CONFLICT","BRANCH_CONFLICT"->"GIT_TARGET_CONFLICT";
            case "REPOSITORY_EMPTY"->"GIT_REPOSITORY_EMPTY";
            case "GITHUB_NAMESPACE_UNAVAILABLE"->"GIT_NAMESPACE_UNAVAILABLE";
            case "BASE_BRANCH_UNAVAILABLE"->"GIT_BASE_BRANCH_UNAVAILABLE";
            case "GITHUB_OPERATION_FAILED","GITHUB_RESULT_UNKNOWN","GITHUB_RESPONSE_INVALID","REPOSITORY_UNAVAILABLE"->"GIT_PROVIDER_UNAVAILABLE";
            case "GIT_AUTHORIZATION_REJECTED"->"EXTERNAL_GRANT_REQUIRED";
            default->SAFE_FAILURES.contains(supplied)?supplied:"GIT_PREPARATION_FAILED";
        };
        return unknown ? "GIT_OUTCOME_UNKNOWN" : mapped;
    }

    public Map<String,Object> dispatch(TaskContext context,long epoch,Instant deadline) {
        store.markPreparing(context.runId());
        var revision = store.revision(context.runId(), context.run().get("current_revision"));
        Map<String,Object> input=new LinkedHashMap<>();
        input.put("workType",context.run().get("work_type")); input.put("requirementRevision",context.run().get("current_revision"));
        input.put("requirementName",revision.get("title")); if(revision.get("description")!=null) input.put("requirementDescription",revision.get("description"));
        input.put("workflowVersion",context.run().get("workflow_version")); input.put("upstreamArtifacts",List.of());
        input.put("projectId",context.run().get("project_id")); input.put("requirementId",context.run().get("requirement_id"));
        input.put("gitPlan",GitPlan.projection(context.run())); input.put("gitOperations",dispatchOperations(context));
        if(context.run().get("github_namespace")!=null) input.put("githubNamespace",context.run().get("github_namespace"));
        if(context.run().get("repository_id")!=null) {
            Map<String,Object> repo=new LinkedHashMap<>(); repo.put("provider",context.run().get("repository_provider"));
            repo.put("repositoryId",context.run().get("provider_repository_id")); repo.put("displayName",context.run().get("repository_name"));
            if(context.run().get("repository_default_branch")!=null) repo.put("defaultBranch",context.run().get("repository_default_branch"));
            input.put("repository",repo);
        }
        Map<String,Object> job=new LinkedHashMap<>();
        job.put("taskId",context.task()); job.put("attemptId",context.attempt().get("attempt_id")); job.put("epoch",epoch);
        job.put("runId",context.runId()); job.put("kind","git"); job.put("deadlineAt",deadline.toString()); job.put("input",input);
        if(context.attempt().get("checkpoint")!=null) {
            try { job.put("checkpoint",mapper.readTree(context.attempt().get("checkpoint").toString())); }
            catch(com.fasterxml.jackson.core.JsonProcessingException invalid) { throw new IllegalStateException(invalid); }
        }
        return job;
    }
}
