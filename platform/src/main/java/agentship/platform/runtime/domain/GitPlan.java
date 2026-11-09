package agentship.platform.runtime.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Deterministic scopes shared by startup grants, dispatch and evidence validation. */
public final class GitPlan {
    private GitPlan() {}
    public record Operation(String operationKey,String effect,String targetId) {}

    public static String repository(Map<String,Object> run) {
        return run.get("github_namespace")!=null ? run.get("github_namespace")+"/agentship-"+run.get("requirement_id") : (String)run.get("repository_name");
    }
    public static String workBranch(Map<String,Object> run) { return run.get("work_type")+"/"+run.get("id"); }
    public static List<Operation> operations(Map<String,Object> run) {
        String repo=repository(run), prefix="git:"+run.get("mode")+":";
        List<Operation> operations=new ArrayList<>();
        if(run.get("github_namespace")!=null) operations.add(new Operation(prefix+"requirement:"+run.get("requirement_id")+":repository","create_repository",repo));
        if(!"hotfix".equals(run.get("work_type"))) operations.add(new Operation(prefix+"run:"+run.get("id")+":base","create_base_branch",repo+"#refs/heads/dev"));
        operations.add(new Operation(prefix+"run:"+run.get("id")+":work","create_work_branch",repo+"#refs/heads/"+workBranch(run)));
        return operations;
    }
    public static Map<String,Object> projection(Map<String,Object> run) {
        boolean create=run.get("github_namespace")!=null, hotfix="hotfix".equals(run.get("work_type"));
        Map<String,Object> value=new LinkedHashMap<>();
        value.put("provider","github"); value.put("repositoryName",repository(run)); value.put("createRepository",create);
        value.put("defaultBranch",run.get("git_default_branch")); value.put("baseSource",hotfix?"repository_default":"dev");
        value.put("baseBranch",hotfix?run.get("git_default_branch"):"dev"); value.put("ensureDev",!hotfix);
        value.put("workBranch",workBranch(run)); value.put("visibility",create?"public":null);
        return value;
    }
}
