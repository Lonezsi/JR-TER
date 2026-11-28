package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

/** CONDOM 8: a server fault tells anyone but the owner one plain sentence and a reference. */
class ServerErrorsTest {
    static final String SECRET = "C:/secret/path";
    final Problems problems = new Problems();
    final Errors errors = new Errors(problems);

    MockHttpServletRequest req(long who, long guest) {
        MockHttpServletRequest r = new MockHttpServletRequest("GET", "/api/x");
        r.setAttribute(Door.WHO, who);
        if (guest != 0) r.setAttribute(Api.GUEST, guest);
        return r;
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> body(ResponseEntity<Object> r) { return (Map<String, Object>) r.getBody(); }

    @Test
    void otherAccountGetsPlainSentenceAndMatchingRef() {
        ResponseEntity<Object> r = errors.other(new IllegalStateException(SECRET + " broke"), req(2, 0));
        assertEquals(500, r.getStatusCode().value());
        Map<String, Object> b = body(r);
        assertEquals(Errors.PLAIN, b.get("error"));
        assertEquals(problems.recent(1).get(0).get("ref"), b.get("ref"));
        assertTrue(String.valueOf(problems.recent(1).get(0).get("message")).contains(SECRET));
    }

    @Test
    void ownerKeepsDetail() {
        Map<String, Object> b = body(errors.other(new IllegalStateException(SECRET + " broke"), req(Accounts.OWNER, 0)));
        assertTrue(b.get("error").toString().contains("IllegalStateException"));
        assertTrue(b.get("error").toString().contains(SECRET));
        assertNotNull(b.get("ref"));
    }

    @Test
    void ownerThroughAShareIsNotTheOwner() {
        Map<String, Object> b = body(errors.other(new IllegalStateException(SECRET), req(Accounts.OWNER, 2)));
        assertEquals(Errors.PLAIN, b.get("error"));
    }

    @Test
    void fiveHundredApiErrorsArePlainToOthers() {
        ApiError e = new ApiError("could not write " + SECRET + ": denied", 502);
        ResponseEntity<Object> r = errors.api(e, req(2, 0));
        assertEquals(502, r.getStatusCode().value());
        assertEquals(Errors.PLAIN, body(r).get("error"));
        assertEquals(problems.recent(1).get(0).get("ref"), body(r).get("ref"));
        Map<String, Object> o = body(errors.api(e, req(Accounts.OWNER, 0)));
        assertTrue(o.get("error").toString().contains(SECRET));
    }

    @Test
    void clientErrorsStayAsTheyWere() {
        Map<String, Object> b = body(errors.api(new ApiError("bad name", 400), req(2, 0)));
        assertEquals("bad name", b.get("error"));
        assertNull(b.get("ref"));
        assertTrue(problems.recent(5).isEmpty());
    }

    @Test
    void faultLogIsOwnerOnly() {
        problems.record("/x", new RuntimeException("boom"), "GET");
        CoreController ctl = new CoreController(null, null, problems, null, null, null, null, null, null, null, null);
        assertEquals(403, assertThrows(ApiError.class, () -> ctl.errors(req(2, 0))).status);
        assertEquals(403, assertThrows(ApiError.class, () -> ctl.forgetErrors(req(2, 0))).status);
        assertEquals(403, assertThrows(ApiError.class, () -> ctl.errors(req(Accounts.OWNER, 2))).status);
        assertNotNull(((Map<?, ?>) ctl.errors(req(Accounts.OWNER, 0))).get("errors"));
    }
}
