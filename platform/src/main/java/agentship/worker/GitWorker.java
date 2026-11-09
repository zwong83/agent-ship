package agentship.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** One durable Git job at a time; heartbeat ownership stays in WorkerMain. */
final class GitWorker implements AutoCloseable {
    @FunctionalInterface interface PlatformApi { JsonNode post(String path,Object body,String key) throws Exception; }
    private static final ObjectMapper JSON=new ObjectMapper();
    private final Path directory;
    private final GitProvider provider;
    private final PlatformApi api;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private Job active;
    private volatile boolean halted;

    GitWorker(Path state,GitProvider provider,PlatformApi api) throws IOException {
        directory=state.resolve("git-jobs");this.provider=provider;this.api=api;
        Files.createDirectories(directory,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
        if(Files.isSymbolicLink(directory))throw new IOException("Invalid journal directory");
    }
    synchronized int availableSlots(){return active==null&&!halted?1:0;}
    synchronized List<Map<String,Object>> activeLeases(){return active==null?List.of():List.of(active.lease());}
    synchronized void receive(JsonNode response) throws Exception {
        if(active!=null) {
            boolean renewed=false;
            for(JsonNode lease:response.path("renewed"))if(active.task.equals(lease.path("taskId").asText()) && active.epoch==lease.path("epoch").asLong()) {
                active.deadline=Instant.parse(lease.path("deadlineAt").asText());renewed=true;
            }
            if(!renewed)active.fenced=true;
        }
        if(active==null&&!halted)for(JsonNode dispatch:response.path("jobs")) {
            if(!"git".equals(dispatch.path("kind").asText()) && !"reconcile".equals(dispatch.path("kind").asText()))continue;
            Job job=new Job(dispatch);active=job;
            executor.submit(()->run(job));break;
        }
    }
    private void run(Job job) {
        try {
            Journal journal=new Journal(directory.resolve(job.task+".json"),job);
            while(!job.fenced && Instant.now().isBefore(job.deadline) && !Thread.currentThread().isInterrupted()) {
                try {
                    journal.flush(job);
                    if(journal.finished())break;
                    execute(job,journal);break;
                } catch(PlatformRejection rejection) {
                    if(rejection.fenced()){job.fenced=true;break;}
                    if(journal.pending()){halted=true;break;}
                    journal.enqueue(job,"failure",Map.of("reasonCode","GIT_AUTHORIZATION_REJECTED",
                            "message","平台已拒绝当前 Git 操作，请检查运行权限。","retryable",false));
                    try {journal.flush(job);}catch(PlatformRejection invalidReport){halted=true;}
                    break;
                } catch(GitProvider.Failure failure) {
                    Map<String,Object> result=new LinkedHashMap<>();result.put("reasonCode",failure.code);
                    result.put("message",failure.unknown?"外部操作结果尚未确认，系统将核对原操作。":"Git 准备未完成，请检查仓库和访问权限。");
                    result.put("retryable",failure.unknown);
                    JsonNode operation=journal.lastOperation();
                    if(operation!=null)result.put("external",evidence(operation,failure.unknown?"unknown":"confirmed_failure",null,null,null));
                    journal.enqueue(job,"failure",result);journal.flush(job);break;
                } catch(Exception unavailable) {
                    // Retain exact outbox and intent. Retry platform delivery or readback, never a blind write.
                    try { Thread.sleep(1000); }catch(InterruptedException interrupted){Thread.currentThread().interrupt();break;}
                }
            }
        } catch(Exception ignored) { /* A failed journal cannot authorize writes; the server lease will expire. */ }
        finally { synchronized(this){if(active==job)active=null;} }
    }
    private void execute(Job job,Journal journal)throws Exception {
        JsonNode input=job.input, plan=input.path("gitPlan");
        String name=plan.path("repositoryName").asText(), requirement=UUID.fromString(input.path("requirementId").asText()).toString();
        boolean create=plan.path("createRepository").asBoolean();
        JsonNode repoOp=create?operation(input,"create_repository"):null;
        JsonNode repoGrant=repoOp==null?null:authorize(job,journal,repoOp);
        GitProvider.Repository repo=readRepository(name,requirement,create,repoOp!=null&&journal.unresolvedIntent(repoOp));
        if(create) {
            if(repo==null) {
                JsonNode grant=repoGrant;
                if(!canDispatch(grant,journal,repoOp))throw new GitProvider.Failure("GIT_RESULT_UNKNOWN",true);
                journal.intent(repoOp,null);
                try {provider.createRepository(name,requirement,()->guard(job,grant));}catch(GitProvider.Failure uncertain) {
                    if(!uncertain.unknown || uncertain.code.equals("LEASE_EXPIRED") || uncertain.code.equals("EXTERNAL_AUTHORIZATION_EXPIRED"))throw uncertain;
                    repo=readRepository(name,requirement,true,true);
                    if(repo==null)throw new GitProvider.Failure("GIT_RESULT_UNKNOWN",true);
                }
                repo=readRepository(name,requirement,true,true);
                if(repo==null)throw new GitProvider.Failure("GIT_RESULT_UNKNOWN",true);
            } else if(!journal.attempted(repoOp) && "intended".equals(repoOp.path("state").asText("intended"))) {
                // A matching marker alone is insufficient to adopt an unrelated pre-existing repository.
                if("dispatch".equals(repoGrant.path("decision").asText()))throw new GitProvider.Failure("REPOSITORY_CONFLICT",false);
            }
            report(job,journal,repoOp,repo,null,null);
        } else {
            if(repo==null)throw new GitProvider.Failure("REPOSITORY_UNAVAILABLE",false);
            JsonNode expected=input.path("repository");
            if(!expected.path("repositoryId").asText().equals(repo.repositoryId()) || !expected.path("provider").asText().equals(repo.provider()))
                throw new GitProvider.Failure("REPOSITORY_CONFLICT",false);
        }
        String defaultCommit=provider.reference(repo,repo.defaultBranch());
        if(defaultCommit==null)throw new GitProvider.Failure("REPOSITORY_EMPTY",false);
        String baseBranch=plan.path("ensureDev").asBoolean()?"dev":repo.defaultBranch();
        if(plan.path("ensureDev").asBoolean())ensureReference(job,journal,operation(input,"create_base_branch"),repo,"dev",defaultCommit,true);
        String baseCommit=provider.reference(repo,baseBranch);
        if(baseCommit==null)throw new GitProvider.Failure("BASE_BRANCH_UNAVAILABLE",false);
        JsonNode workOp=operation(input,"create_work_branch");String workBranch=plan.path("workBranch").asText();
        String pinned=journal.expected(workOp);
        if(pinned!=null)baseCommit=pinned;
        ensureReference(job,journal,workOp,repo,workBranch,baseCommit,false);
        Map<String,Object> git=Map.of("repository",repo.view(),"baseBranch",baseBranch,"workBranch",workBranch,"baseCommit",baseCommit,"headCommit",baseCommit);
        journal.enqueue(job,"complete",Map.of("artifacts",List.of(),"external",evidence(workOp,"confirmed_success",repo,baseCommit,git)));
        journal.flush(job);
    }
    private void ensureReference(Job job,Journal journal,JsonNode operation,GitProvider.Repository repo,String branch,String commit,boolean reuseExisting)throws Exception {
        JsonNode grant=authorize(job,journal,operation);
        String observed=readReference(repo,branch,journal.unresolvedIntent(operation));
        String expected=journal.expected(operation);
        if(observed==null) {
            if(!canDispatch(grant,journal,operation))throw new GitProvider.Failure("GIT_RESULT_UNKNOWN",true);
            journal.intent(operation,commit);
            try {provider.createReference(repo,branch,commit,()->guard(job,grant));}catch(GitProvider.Failure uncertain) {
                if(!uncertain.unknown || uncertain.code.equals("LEASE_EXPIRED") || uncertain.code.equals("EXTERNAL_AUTHORIZATION_EXPIRED"))throw uncertain;
                observed=readReference(repo,branch,true);
                if(observed==null)throw new GitProvider.Failure("GIT_RESULT_UNKNOWN",true);
            }
            observed=readReference(repo,branch,true);
            if(observed==null)throw new GitProvider.Failure("GIT_RESULT_UNKNOWN",true);
        }
        if((expected!=null && !expected.equals(observed)) || (!reuseExisting && !commit.equals(observed)))
            throw new GitProvider.Failure("BRANCH_CONFLICT",false);
        String base=operation.path("effect").asText().equals("create_base_branch")?repo.defaultBranch():
                (job.input.path("gitPlan").path("ensureDev").asBoolean()?"dev":repo.defaultBranch());
        report(job,journal,operation,repo,observed,Map.of("repository",repo.view(),"baseBranch",base,
                "workBranch",branch,"baseCommit",observed,"headCommit",observed));
    }
    private GitProvider.Repository readRepository(String name,String requirement,boolean marker,boolean uncertain)throws Exception {
        try {
            for(int attempt=0;;attempt++) {
                GitProvider.Repository found=provider.findRepository(name,requirement,marker);
                if(found!=null || !uncertain || attempt==2)return found;
                Thread.sleep(200);
            }
        }catch(Exception failure){if(uncertain)throw new GitProvider.Failure("GIT_RESULT_UNKNOWN",true);throw failure;}
    }
    private String readReference(GitProvider.Repository repo,String branch,boolean uncertain)throws Exception {
        try {
            for(int attempt=0;;attempt++) {
                String found=provider.reference(repo,branch);
                if(found!=null || !uncertain || attempt==2)return found;
                Thread.sleep(200);
            }
        }catch(Exception failure){if(uncertain)throw new GitProvider.Failure("GIT_RESULT_UNKNOWN",true);throw failure;}
    }
    private void report(Job job,Journal journal,JsonNode operation,GitProvider.Repository repo,String commit,Map<String,Object> git)throws Exception {
        journal.enqueue(job,"progress",Map.of("external",evidence(operation,"confirmed_success",repo,commit,git)));
        journal.flush(job);
    }
    private JsonNode authorize(Job job,Journal journal,JsonNode operation)throws Exception {
        job.check();
        Map<String,Object> body=new LinkedHashMap<>(job.lease());
        for(String field:List.of("operationKey","effect","targetId"))body.put(field,operation.path(field).asText());
        JsonNode grant=api.post("/api/worker/jobs/"+job.task+"/authorize-external",body,UUID.randomUUID().toString());
        journal.current(operation);
        return grant;
    }
    private boolean canDispatch(JsonNode grant,Journal journal,JsonNode operation) {
        return "dispatch".equals(grant.path("decision").asText()) && !journal.attempted(operation);
    }
    private static void guard(Job job,JsonNode grant)throws Exception {
        job.check();
        if(!"dispatch".equals(grant.path("decision").asText()) || !Instant.parse(grant.path("expiresAt").asText()).isAfter(Instant.now()))
            throw new GitProvider.Failure("EXTERNAL_AUTHORIZATION_EXPIRED",true);
    }
    private static JsonNode operation(JsonNode input,String effect)throws GitProvider.Failure {
        for(JsonNode operation:input.path("gitOperations"))if(effect.equals(operation.path("effect").asText()))return operation;
        throw new GitProvider.Failure("INVALID_GIT_PLAN",false);
    }
    private static Map<String,Object> evidence(JsonNode operation,String outcome,GitProvider.Repository repo,String commit,Map<String,Object> git) {
        Map<String,Object> evidence=new LinkedHashMap<>();
        evidence.put("operationKey",operation.path("operationKey").asText());evidence.put("kind",operation.path("effect").asText().equals("create_repository")?"repository":"branch");
        evidence.put("outcome",outcome);evidence.put("observedAt",Instant.now().toString());evidence.put("targetId",operation.path("targetId").asText());
        if(repo!=null){evidence.put("repository",repo.view());evidence.put("providerResultId",commit==null?repo.repositoryId():commit);}
        if(commit!=null)evidence.put("artifactVersion",commit);
        if(git!=null)evidence.put("git",git);
        return evidence;
    }
    @Override public synchronized void close(){if(active!=null)active.fenced=true;executor.shutdownNow();}
    private static final class Job {
        final String task,attempt;final long epoch;final JsonNode input;volatile Instant deadline;volatile boolean fenced;
        Job(JsonNode value){task=UUID.fromString(value.path("taskId").asText()).toString();attempt=UUID.fromString(value.path("attemptId").asText()).toString();epoch=value.path("epoch").asLong();input=value.path("input");deadline=Instant.parse(value.path("deadlineAt").asText());if(epoch<1)throw new IllegalArgumentException();}
        Map<String,Object> lease(){return Map.of("taskId",task,"attemptId",attempt,"epoch",epoch);}
        void check()throws GitProvider.Failure{if(fenced||Thread.currentThread().isInterrupted()||!deadline.isAfter(Instant.now()))throw new GitProvider.Failure("LEASE_EXPIRED",true);}
    }
    private final class Journal {
        final Path path;final ObjectNode data;
        Journal(Path path,Job job)throws Exception {
            this.path=path;
            if(Files.isSymbolicLink(path))throw new IOException("Invalid journal");
            data=Files.exists(path)?(ObjectNode)JSON.readTree(Files.readAllBytes(path)):JSON.createObjectNode();
            if(data.path("epoch").asLong()!=job.epoch || !data.path("attemptId").asText().equals(job.attempt)) {
                data.put("epoch",job.epoch);data.put("attemptId",job.attempt);data.put("sequence",0);data.remove("outbox");data.remove("finished");save();
            }
        }
        boolean finished(){return data.path("finished").asBoolean();}
        boolean pending(){return data.has("outbox");}
        JsonNode lastOperation(){return data.get("lastOperation");}
        boolean attempted(JsonNode operation){return data.path("intents").has(operation.path("operationKey").asText());}
        boolean unresolvedIntent(JsonNode operation){return attempted(operation)&&!data.path("resolved").path(operation.path("operationKey").asText()).asBoolean();}
        String expected(JsonNode operation){JsonNode value=data.path("intents").path(operation.path("operationKey").asText());return value.isTextual()&&!value.asText().isEmpty()?value.asText():null;}
        void current(JsonNode operation)throws Exception {
            String key=operation.path("operationKey").asText();
            if(data.path("resolved").path(key).asBoolean() || operation.path("state").asText().equals("succeeded"))data.remove("lastOperation");
            else data.set("lastOperation",operation);
            save();
        }
        void intent(JsonNode operation,String expected)throws Exception {
            data.withObject("intents").put(operation.path("operationKey").asText(),expected==null?"":expected);
            data.set("lastOperation",operation);save();
        }
        void enqueue(Job job,String type,Object result)throws Exception {
            if(data.has("outbox"))throw new IOException("Pending event must be delivered first");
            long sequence=data.path("sequence").asLong()+1;data.put("sequence",sequence);
            data.set("outbox",JSON.valueToTree(Map.of("key",UUID.randomUUID().toString(),"body",Map.of("type",type,"attemptId",job.attempt,"epoch",job.epoch,"sequence",sequence,"result",result))));save();
        }
        void flush(Job job)throws Exception {
            JsonNode outbox=data.get("outbox");if(outbox==null)return;job.check();
            api.post("/api/worker/jobs/"+job.task+"/event",outbox.get("body"),outbox.path("key").asText());
            JsonNode external=outbox.path("body").path("result").path("external");
            if(external.path("outcome").asText().equals("confirmed_success")) {
                String key=external.path("operationKey").asText();data.withObject("resolved").put(key,true);
                if(data.path("lastOperation").path("operationKey").asText().equals(key))data.remove("lastOperation");
            }
            if(List.of("complete","failure").contains(outbox.path("body").path("type").asText()))data.put("finished",true);
            data.remove("outbox");save();
        }
        void save()throws Exception {
            Path temporary=Files.createTempFile(directory,"journal-",".tmp",PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            try {
                Files.write(temporary,JSON.writeValueAsBytes(data));
                try(FileChannel channel=FileChannel.open(temporary,StandardOpenOption.WRITE)){channel.force(true);}
                Files.move(temporary,path,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            }finally{Files.deleteIfExists(temporary);}
        }
    }
}
