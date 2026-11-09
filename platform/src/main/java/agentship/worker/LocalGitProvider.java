package agentship.worker;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.LinkOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Real local Git refs, isolated from users' repositories and Git configuration. */
final class LocalGitProvider implements GitProvider {
    private final Path root;
    LocalGitProvider(Path state) throws IOException {
        root=state.resolve("repositories");
        Files.createDirectories(root,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
        if(Files.isSymbolicLink(root)) throw new IOException("Invalid repository directory");
    }
    Path path(String name) throws Exception {
        String key=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(name.getBytes(StandardCharsets.UTF_8)));
        return root.resolve(key+".git");
    }
    public Repository findRepository(String name,String requirementId,boolean requireMarker) throws Exception {
        Path path=path(name);
        if(!Files.exists(path,LinkOption.NOFOLLOW_LINKS)) return null;
        if(Files.isSymbolicLink(path) || !Files.isDirectory(path)) throw new Failure("REPOSITORY_CONFLICT",false);
        String marker=git(path,List.of("config","--local","--get","agentship.requirement"),null,false).trim();
        if(!marker.equals(requirementId)) throw new Failure("REPOSITORY_CONFLICT",false);
        String branch=git(path,List.of("symbolic-ref","--short","HEAD"),null,true).trim();
        return new Repository("demo","demo:"+name,name,branch);
    }
    public void createRepository(String name,String requirementId,WriteGuard guard) throws Exception {
        Path path=path(name);
        if(Files.exists(path,LinkOption.NOFOLLOW_LINKS)) throw new Failure("REPOSITORY_CONFLICT",false);
        guard.check();
        Files.createDirectory(path,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
        git(path,List.of("init","--bare","--initial-branch=main",path.toString()),null,true);
        git(path,List.of("config","--local","agentship.requirement",requirementId),null,true);
        String tree=git(path,List.of("mktree"),"",true).trim();
        String commit=git(path,List.of("commit-tree",tree,"-m","AgentShip development repository"),"",true).trim();
        git(path,List.of("update-ref","refs/heads/main",commit,"0000000000000000000000000000000000000000"),null,true);
    }
    public String reference(Repository repository,String branch) throws Exception {
        validateBranch(branch);
        String commit=git(path(repository.displayName()),List.of("rev-parse","--verify","refs/heads/"+branch),null,false).trim();
        return commit.matches("[0-9a-f]{40,64}")?commit:null;
    }
    public void createReference(Repository repository,String branch,String commit,WriteGuard guard) throws Exception {
        validateBranch(branch);
        if(!commit.matches("[0-9a-f]{40,64}")) throw new Failure("INVALID_GIT_EVIDENCE",false);
        guard.check();
        git(path(repository.displayName()),List.of("update-ref","refs/heads/"+branch,commit,"0".repeat(commit.length())),null,true);
    }
    static void validateBranch(String branch) throws Failure {
        if(branch==null || branch.isBlank() || branch.length()>240 || branch.startsWith("-") || branch.startsWith("/")
                || branch.endsWith("/") || branch.endsWith(".") || branch.contains("..") || branch.contains("@{")
                || branch.contains("//") || branch.matches(".*[\\x00-\\x20~^:?*\\[\\]\\\\].*") || branch.endsWith(".lock"))
            throw new Failure("INVALID_GIT_REFERENCE",false);
    }
    private String git(Path repository,List<String> arguments,String input,boolean required) throws Exception {
        List<String> command=new ArrayList<>(List.of("git","--git-dir",repository.toString())); command.addAll(arguments);
        ProcessBuilder builder=new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD);
        var env=builder.environment();
        env.keySet().removeIf(key -> key.startsWith("GIT_"));
        env.put("GIT_CONFIG_GLOBAL","/dev/null"); env.put("GIT_CONFIG_SYSTEM","/dev/null"); env.put("GIT_CONFIG_NOSYSTEM","1");
        env.put("GIT_TERMINAL_PROMPT","0");env.put("GIT_AUTHOR_NAME","AgentShip");env.put("GIT_COMMITTER_NAME","AgentShip");
        env.put("GIT_AUTHOR_EMAIL","agentship@example.invalid");env.put("GIT_COMMITTER_EMAIL","agentship@example.invalid");
        Process process=builder.start();
        try {
            if(input!=null) process.getOutputStream().write(input.getBytes(StandardCharsets.UTF_8));
            process.getOutputStream().close();
            if(!process.waitFor(8,TimeUnit.SECONDS)) { process.destroyForcibly(); throw new Failure("GIT_TIMEOUT",true); }
            byte[] output=process.getInputStream().readNBytes(8192);
            if(required && process.exitValue()!=0) throw new Failure("GIT_OPERATION_FAILED",false);
            return process.exitValue()==0?new String(output,StandardCharsets.UTF_8):"";
        } finally { if(process.isAlive()) process.destroyForcibly(); }
    }
}
