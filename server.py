#!/usr/bin/env python3
"""Start JR!TER.

    python server.py              the library at http://127.0.0.1:7900
    python server.py --port 8080  somewhere else
    python server.py --open       and open a browser at it

Standard library only, so there is nothing to install and nothing to keep in step.
"""
import sys
import argparse
import threading
import webbrowser

from jriter import config, http, registry, db, accounts, who


def main(argv=None):
    parser = argparse.ArgumentParser(description="JR!TER, a personal music workspace")
    parser.add_argument("--host", default=config.HOST)
    parser.add_argument("--port", type=int, default=config.PORT)
    parser.add_argument("--open", action="store_true", help="open a browser once it is up")
    args = parser.parse_args(argv)

    # Before anything opens the database or reads a setting.
    #
    # This project used to be called J-ong, and a library made under that name keeps its
    # data under that name: a database file, and a library name written into
    # settings.json the first time anything was saved. Both are carried across here.
    #
    # It has to be before the bind, not after, even though after would mean only the
    # process that won the port could touch the library. http.serve loads the modules,
    # which creates the schema, which makes sqlite build an empty jriter.db: run this
    # afterwards and it finds a database already at the new name, declines, and the real
    # one sits beside it for ever holding every song. Two copies starting at once are
    # safe anyway, because the second one finds the move already done, or fails the move
    # and refuses to start rather than carrying on with nothing.
    try:
        if config.adopt_old_database():
            print("  moved     the old jong.db to jriter.db")
        # And then, once, the single library becomes account 1.
        #
        # Same reasoning as the rename above and the same refusal to catch anything: a
        # half moved library is worse than a server that will not start and says why. It
        # is a no op on every run after the first, and on a library that never had a
        # password there is nothing to move it to.
        from jriter.modules import auth
        landed = accounts.adopt_single_library(auth._read())
        if landed:
            where = ", ".join(landed["moved"]) or "nothing to move"
            if landed["account"]:
                print("  accounts  your library is now account %d (%s)"
                      % (landed["account"], where))
            else:
                # Moved, but no account made: nothing to make one from. Said out loud
                # because "your files are in a new place and there is nobody to own them"
                # is exactly the state somebody would want to know they are in.
                print("  accounts  your library moved into accounts/1 (%s)" % where)
                print("            no password was set, so no account was made. Set one "
                      "and it becomes yours.")
            if landed.get("tokens"):
                print("            %d machine credential(s) carried across"
                      % landed["tokens"])
    except OSError as e:
        # Refusing to start beats starting empty. Carrying on means sqlite makes a fresh
        # library under the new name, the guard inside then keeps this from ever running
        # again, and the songs sit in a file nothing opens any more.
        print("JR!TER could not move the old library across: %s" % e)
        print("  Something still has it open. Stop that and start again.")
        return 1
    # As the owner, and only if there is one.
    #
    # This reads and rewrites a settings.json, which since accounts is a per account file,
    # so it needs to know whose. The owner's, because this is about a library that predates
    # accounts entirely and that library is the one that became account 1. A server that has
    # never been set up has no settings to rename and nothing to do.
    if accounts.count():
        with who.acting_as(accounts.OWNER):
            config.adopt_old_name()

    try:
        server = http.serve(args.host, args.port)
    except OSError as e:
        # Almost always a copy that is already running. Saying so beats a stack trace,
        # and beats starting a second server that fights the first for requests.
        print("JR!TER could not take port %d: %s" % (args.port, e))
        print("Something is already serving it. Stop that first, or use --port.")
        return 1
    where = "http://%s:%d" % (args.host, args.port)

    print("JR!TER %s" % __import__("jriter").__version__)
    print("  library   %s" % where)
    print("  data      %s" % config.DATA)
    print("  modules   %s" % ", ".join(registry.enabled()))
    broken = registry.failures()
    for name, detail in broken.items():
        # A module that failed to load is named out loud. Silently serving a smaller app
        # than the config asked for is how you lose a feature without noticing.
        print("  FAILED    %s" % name)
        print("            " + detail.strip().splitlines()[-1])
    if registry.has("auth"):
        from jriter.modules import auth
        if auth.has_password():
            print("  sign in    a password is set")
        else:
            # Printed rather than chosen here. The first password is the owner's to
            # pick, and this code is what stops a stranger picking it first.
            #
            # Only to a terminal somebody is looking at. On the host this process is
            # started by a scheduled task that redirects everything into
            # data/host-jriter-out.log, which nothing rotates, so printing the code there
            # put a working credential into a file inside the directory a backup copies,
            # and left it there long after it had been spent. It is already written to
            # setup-code.txt, which is deleted the moment a password is chosen, so there
            # is somewhere to read it that tidies up after itself.
            code = auth.setup_code()
            print("\n  No password is set on this library yet.")
            print("  Open %s/login and use the one time setup code." % where)
            if sys.stdout.isatty():
                print("\n      %s\n" % code)
            else:
                print("  It is in %s, which goes when a password is chosen."
                      % auth.SETUP_PATH)
            print("  It stops working the moment a password is chosen.")

    print("\nCtrl-C to stop.")

    if args.open:
        webbrowser.open(where)
    # Fold the write-ahead log back in every half minute.
    #
    # A commit under synchronous=NORMAL is not fsynced, so what makes it durable is the
    # checkpoint, and nothing was doing one. The host kills this process outright
    # whenever two health probes miss, which makes a hard kill the ordinary way it dies
    # rather than the exceptional one. Thirty seconds is the most work that can cost.
    stop = threading.Event()

    def keep_flushing():
        while not stop.wait(30):
            try:
                db.checkpoint()
            except Exception:
                pass          # a busy database is not a reason to take the server down

    threading.Thread(target=keep_flushing, name="checkpoint", daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        stop.set()
        server.server_close()
        # This is the one moment nothing else is running, so every library's log is
        # emptied rather than merely folded back in. shut_down rather than close: close
        # is this thread's connections, and this thread has served no requests.
        db.shut_down()
    return 0


if __name__ == "__main__":
    sys.exit(main())
