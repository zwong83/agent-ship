package agentship.worker;

final class PlatformRejection extends Exception {
    final int status;
    final String code;
    PlatformRejection(int status,String code) {
        super("Platform rejected worker operation");this.status=status;
        this.code=code!=null&&code.matches("[A-Z_]{1,80}")?code:"PLATFORM_REJECTED";
    }
    boolean fenced(){return status==401 || code.contains("LEASE") || code.equals("STALE_ATTEMPT") || code.equals("DEVICE_REVOKED");}
}
