package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** /api/update/*: a port of jriter/modules/updater.py's routes. See Updater for the work. */
@RestController
public class UpdaterController {
    private final Updater updater;
    private final Accounts accounts;

    public UpdaterController(Updater updater, Accounts accounts) {
        this.updater = updater;
        this.accounts = accounts;
    }

    /** Pulling code and stopping the server are the machine owner's. */
    private void ownerOnly(HttpServletRequest req, String what) {
        if (accounts.count() == 0) return;
        Long who = Door.who(req);
        if (who == null || who != Accounts.OWNER || Api.guest(req) != 0)
            throw new ApiError("Only the owner of this library can " + what + ".", 403);
    }

    @GetMapping("/api/update/check")
    public Map<String, Object> check() {
        return updater.check();
    }

    @PostMapping("/api/update/apply")
    public Map<String, Object> apply(HttpServletRequest req) {
        ownerOnly(req, "update it");
        return updater.apply();
    }

    @PostMapping("/api/update/now")
    public Map<String, Object> now(HttpServletRequest req) {
        ownerOnly(req, "update it");
        return updater.updateNow();
    }

    @PostMapping("/api/update/restart")
    public Map<String, Object> restart(HttpServletRequest req) {
        ownerOnly(req, "restart the server");
        return updater.restart();
    }
}
