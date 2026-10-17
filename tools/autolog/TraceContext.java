package ulug;

public final class TraceContext {
    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();
    public static String get() {
        String v = CURRENT.get();
        if (v == null) {
            v = java.util.UUID.randomUUID().toString().substring(0,8);
            CURRENT.set(v);
        }
        return v;
    }
}
