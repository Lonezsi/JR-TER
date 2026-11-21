package dev.jriter.desktop;

import com.sun.jna.Library;
import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.Structure;
import com.sun.jna.ptr.PointerByReference;
import com.sun.jna.win32.W32APIOptions;
import com.sun.jna.win32.W32APITypeMapper;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;

/** Windows Credential Manager (generic credentials). Every call fails soft: empty or false. */
public final class Secrets {
    private Secrets() {}

    private static final int GENERIC = 1;
    private static final int PERSIST_LOCAL_MACHINE = 2;

    @Structure.FieldOrder({"Flags", "Type", "TargetName", "Comment", "LastWritten", "CredentialBlobSize",
        "CredentialBlob", "Persist", "AttributeCount", "Attributes", "TargetAlias", "UserName"})
    public static class Cred extends Structure {
        public int Flags;
        public int Type;
        public String TargetName;
        public String Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public Pointer CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public Pointer Attributes;
        public String TargetAlias;
        public String UserName;
        public Cred() { super(W32APITypeMapper.UNICODE); }
        public Cred(Pointer p) { super(p, Structure.ALIGN_DEFAULT, W32APITypeMapper.UNICODE); read(); }
    }

    interface Advapi extends Library {
        boolean CredReadW(String target, int type, int flags, PointerByReference out);
        boolean CredWriteW(Cred c, int flags);
        boolean CredDeleteW(String target, int type, int flags);
        void CredFree(Pointer p);
    }

    private static Advapi api;

    private static synchronized Advapi api() {
        if (api == null) {
            try {
                if (System.getProperty("os.name", "").startsWith("Windows"))
                    api = Native.load("Advapi32", Advapi.class, W32APIOptions.UNICODE_OPTIONS);
            } catch (Throwable t) { api = null; }
        }
        return api;
    }

    public static boolean available() { return api() != null; }

    public static Optional<String> get(String target) {
        try {
            Advapi a = api();
            if (a == null) return Optional.empty();
            PointerByReference ref = new PointerByReference();
            if (!a.CredReadW(target, GENERIC, 0, ref)) return Optional.empty();
            try {
                Cred c = new Cred(ref.getValue());
                byte[] b = c.CredentialBlob == null ? new byte[0] : c.CredentialBlob.getByteArray(0, c.CredentialBlobSize);
                return Optional.of(new String(b, StandardCharsets.UTF_8));
            } finally { a.CredFree(ref.getValue()); }
        } catch (Throwable t) { return Optional.empty(); }
    }

    public static boolean put(String target, String secret) {
        try {
            Advapi a = api();
            if (a == null) return false;
            byte[] b = secret.getBytes(StandardCharsets.UTF_8);
            Memory m = new Memory(Math.max(1, b.length));
            m.write(0, b, 0, b.length);
            Cred c = new Cred();
            c.Type = GENERIC;
            c.TargetName = target;
            c.UserName = "jriter-cli";
            c.Persist = PERSIST_LOCAL_MACHINE;
            c.CredentialBlobSize = b.length;
            c.CredentialBlob = m;
            return a.CredWriteW(c, 0);
        } catch (Throwable t) { return false; }
    }

    public static void delete(String target) {
        try { Advapi a = api(); if (a != null) a.CredDeleteW(target, GENERIC, 0); }
        catch (Throwable ignored) { }
    }
}
