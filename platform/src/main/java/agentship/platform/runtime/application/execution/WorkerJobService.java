package agentship.platform.runtime.application.execution;

import agentship.platform.device.api.WorkerDevices;
import agentship.platform.runtime.application.gitprep.GitOperations;
import agentship.platform.runtime.application.port.WorkerReceipts;
import agentship.platform.runtime.application.port.WorkerTaskStore;
import agentship.platform.runtime.application.port.WorkerTaskStore.TaskContext;
import agentship.platform.web.ApiProblem;
import agentship.platform.web.RequestFields;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkerJobService {
    private final ObjectMapper mapper;
    private final WorkerTaskStore tasks;
    private final WorkerReceipts receipts;
    private final WorkerDevices devices;
    private final GitOperations operations;
    private final NodeScheduler scheduler;
    private final AgentJobTasks agentTasks;
    public WorkerJobService(ObjectMapper mapper, WorkerTaskStore tasks, WorkerReceipts receipts, WorkerDevices devices,GitOperations operations,NodeScheduler scheduler,AgentJobTasks agentTasks) {
        this.mapper = mapper; this.tasks = tasks; this.receipts = receipts; this.devices = devices; this.operations=operations; this.scheduler=scheduler; this.agentTasks=agentTasks;
    }

    @Transactional
    public Map<String,Object> poll(String authorization,JsonNode body) {
        var device=devices.authenticate(authorization);
        if(!"1".equals(RequestFields.text(body,"protocolVersion",8))) throw RequestFields.conflict("PROTOCOL_MISMATCH","请更新本机程序");
        String status=RequestFields.text(body,"codexStatus",20);
        if(!Set.of("available","unavailable","unknown","not_required").contains(status)
                || device.mode().equals("demo")!=status.equals("not_required")) throw ApiProblem.invalid();
        int slots=(int)RequestFields.number(body,"availableSlots",0,4);
        if(body.has("acceptsAgentJobs") && !body.path("acceptsAgentJobs").isBoolean()) throw ApiProblem.invalid();
        boolean acceptsAgents=body.path("acceptsAgentJobs").asBoolean();
        boolean available=!device.mode().equals("codex") || status.equals("available");
        JsonNode active=body.get("active");
        if(active==null || !active.isArray() || active.size()>32) throw ApiProblem.invalid();
        Map<UUID,JsonNode> renewals=new LinkedHashMap<>();
        for(var lease:active) {
            UUID id=RequestFields.id(lease,"taskId"); RequestFields.id(lease,"attemptId"); RequestFields.number(lease,"epoch",1,Long.MAX_VALUE);
            if(renewals.put(id,lease)!=null) throw ApiProblem.invalid();
        }
        if(acceptsAgents && slots>0 && available) scheduler.initialize(device);
        List<Map<String,Object>> renewed=new ArrayList<>(),jobs=new ArrayList<>(),inbox=new ArrayList<>();
        Map<UUID, WorkerTaskStore.Candidate> ordered = new LinkedHashMap<>();
        for (var candidate : tasks.candidates(device.id(), acceptsAgents)) ordered.put(candidate.id(), candidate);
        for (UUID task : renewals.keySet()) {
            var candidate = tasks.renewal(device.id(), task, acceptsAgents);
            if (candidate != null) ordered.put(task, candidate);
        }
        boolean gitOccupied = acceptsAgents && renewals.keySet().stream().anyMatch(task -> {
            var candidate = ordered.get(task);
            return candidate != null && candidate.isGit();
        });
        var sorted = ordered.values().stream()
                .sorted(Comparator.comparing((WorkerTaskStore.Candidate task) -> task.requirement().toString())
                        .thenComparing(task -> task.run().toString())
                        .thenComparingInt(WorkerTaskStore.Candidate::stage)
                        .thenComparingInt(WorkerTaskStore.Candidate::node)
                        .thenComparingInt(WorkerTaskStore.Candidate::role)
                        .thenComparing(task -> task.id().toString())).toList();
        for(var candidate:sorted) {
            UUID task=candidate.id();
            if(!renewals.containsKey(task) && (jobs.size()>=slots || !available || gitOccupied && candidate.isGit())) continue;
            var context=tasks.lock(device.id(),task,true);
            if(context==null) continue;
            if(renewals.containsKey(task)) {
                try {
                    fence(context,renewals.get(task));
                    Instant deadline=Instant.now().plusSeconds(60);
                    tasks.renew(context, deadline);
                    renewed.add(Map.of("taskId",task,"epoch",context.epoch(),"deadlineAt",deadline.toString()));
                    if(!context.isGit()) inbox.addAll(agentTasks.inbox(context));
                } catch(ApiProblem stale) {
                    if(!stale.code().equals("STALE_LEASE")) throw stale;
                }
                continue;
            }
            if(!claimable(context) || !context.isGit() && !agentTasks.claimable(context)) continue;
            if(context.isGit()) {
                try { operations.ensure(context); }
                catch(ApiProblem conflict) {
                    if(!conflict.code().equals("GIT_TARGET_CONFLICT")) throw conflict;
                    tasks.attention(context,"GIT_TARGET_CONFLICT"); continue;
                }
            }
            long epoch = tasks.nextEpoch();
            Instant deadline = Instant.now().plusSeconds(60);
            tasks.lease(context, epoch, deadline);
            if(context.isGit()) {
                jobs.add(operations.dispatch(context, epoch, deadline));
                gitOccupied=acceptsAgents;
            } else {
                jobs.add(agentTasks.dispatch(context,epoch,deadline));
                inbox.addAll(agentTasks.inbox(context));
            }
        }
        // Heartbeats take the device write lock only after configuration/run/task locks.
        devices.heartbeat(device.id(), status);
        return Map.of("jobs",jobs,"renewed",renewed,"inbox",inbox,"pollAfterMillis",10_000);
    }

    @Transactional
    public Map<String,Object> authorize(String authorization,UUID task,String key,JsonNode body) {
        var context=tasks.lock(devices.authenticate(authorization).id(),task,false);
        if(!context.isGit()) throw new ApiProblem(403,"EXTERNAL_SCOPE_DENIED","当前任务不允许 Git 外部写入");
        if(!task.equals(RequestFields.id(body,"taskId"))) throw ApiProblem.invalid();
        fence(context,body);
        String scope="git:authorize:"+task;
        UUID prior=reserve(context,scope,key,body);
        var result=operations.authorize(context,body);
        if(prior==null) receipts.finish(context.deviceId(),scope,key,"external_operation",operations.operationId(RequestFields.text(body,"operationKey",300)));
        return result;
    }

    @Transactional
    public Map<String,Object> event(String authorization,UUID task,String key,JsonNode body) {
        var context=tasks.lock(devices.authenticate(authorization).id(),task,false);
        String scope=(context.isGit()?"git:event:":"agent:event:")+task;
        UUID prior=reserve(context,scope,key,body);
        if(prior!=null) return Map.of("accepted",true,"duplicate",true,"receiptId",prior);
        fence(context,body);
        long sequence=RequestFields.number(body,"sequence",1,Long.MAX_VALUE);
        if(sequence!=((Number)context.attempt().get("last_event_sequence")).longValue()+1) throw RequestFields.conflict("EVENT_SEQUENCE_GAP","任务事件必须按顺序提交");
        String type=RequestFields.text(body,"type",30);
        JsonNode result=body.get("result");
        if(result==null || !result.isObject() || !Set.of("progress","complete","failure","question","message").contains(type)) throw ApiProblem.invalid();
        UUID receipt=UUID.randomUUID();
        tasks.recordEvent(context, receipt, sequence, type, key);
        if(!context.isGit()) {
            agentTasks.event(context,type,result,receipt);
        } else if(type.equals("progress")) {
            if(result.has("external")) operations.observation(context,result.get("external"));
            String checkpoint=RequestFields.json(mapper,result);
            if(checkpoint.length()>32_768) throw ApiProblem.invalid();
            tasks.saveGitProgress(context, checkpoint);
        } else if(type.equals("complete")) {
            if(!result.path("artifacts").isArray() || !result.path("artifacts").isEmpty() || !result.has("external")) throw ApiProblem.invalid();
            operations.complete(context,result.get("external"));
            tasks.succeed(context);
        } else if(type.equals("failure")) {
            tasks.attention(context, operations.failureReason(context, result));
        } else throw ApiProblem.invalid();
        tasks.eventAccepted(context, sequence);
        receipts.finish(context.deviceId(),scope,key,"task_event",receipt);
        return Map.of("accepted",true,"duplicate",false,"receiptId",receipt);
    }

    private static void fence(TaskContext context, JsonNode body) {
        if (!RequestFields.id(body, "attemptId").equals(context.attempt().get("attempt_id"))
                || context.attempt().get("lease_epoch") == null || RequestFields.number(body, "epoch", 1, Long.MAX_VALUE) != context.epoch()
                || !Set.of("leased", "running").contains(context.attempt().get("state"))
                || !((Timestamp) context.attempt().get("lease_deadline")).toInstant().isAfter(Instant.now())
                || context.run().get("finished_at") != null) {
            throw RequestFields.conflict("STALE_LEASE", "任务租约已失效，请重新领取任务");
        }
    }

    private UUID reserve(TaskContext context, String scope, String key, JsonNode body) {
        if (key == null || key.isBlank() || key.length() > 200 || key.indexOf(0) >= 0) throw ApiProblem.invalid();
        return receipts.reserve(context.deviceId(), scope, key, RequestFields.digest(mapper, body));
    }

    private boolean claimable(TaskContext context) {
        String state=(String)context.attempt().get("state");
        if(context.run().get("finished_at")!=null) return false;
        if(state.equals("queued")) return !((Timestamp)context.attempt().get("available_at")).toInstant().isAfter(Instant.now());
        if(Set.of("leased","running").contains(state)) return !((Timestamp)context.attempt().get("lease_deadline")).toInstant().isAfter(Instant.now());
        return state.equals("needs_attention") && "GIT_OUTCOME_UNKNOWN".equals(context.attempt().get("reason_code"))
                && !((Timestamp)context.attempt().get("available_at")).toInstant().isAfter(Instant.now());
    }
}
