#!/usr/bin/env bash
# Put JR!TER on this machine, in one line (Mac and Linux; Windows has install.ps1).
#
#     curl -fsSL https://raw.githubusercontent.com/Lonezsi/JR-TER/main/install.sh | bash
#
# It checks for Python 3, fetches the code, adds a `jriter` command, sets the library to
# start on its own (a systemd user service on Linux, a launch agent on a Mac), starts it,
# and shows you the one-time setup code you sign in with. Run it again later and it
# updates in place: the data directory, where your music lives, is never touched.
#
# Options, as environment variables (a script piped into bash can't take arguments):
#
#     JRITER_DIR       where to put it        (default: ~/.local/share/jriter)
#     JRITER_BRANCH    which branch to take   (default: main)
#     JRITER_PORT      which port to serve on (default: 7900)
#     JRITER_HOST      what to listen on      (default: 127.0.0.1; 0.0.0.0 for your network)
#     JRITER_NOSTART   set to 1 to install without starting it
#     JRITER_TAILSCALE set to 1 to set up Tailscale without asking, 0 to never ask
#
# Tailscale is optional. Without it JR!TER works on this machine, and on your home network
# if you say so; with it, your own devices can reach it from anywhere.
#
# Nothing here needs sudo, and nothing here picks a password.

set -euo pipefail

REPO="Lonezsi/JR-TER"
BRANCH="${JRITER_BRANCH:-main}"
DIR="${JRITER_DIR:-$HOME/.local/share/jriter}"
PORT="${JRITER_PORT:-7900}"
HOST="${JRITER_HOST:-127.0.0.1}"

say()  { printf '  %s\n' "$*"; }
step() { printf '\n\033[36m%s\033[0m\n' "$*"; }
warn() { printf '  \033[33m%s\033[0m\n' "$*"; }
die()  { printf '\n  \033[31m%s\033[0m\n\n' "$*"; exit 1; }

step "Python"
PY="$(command -v python3 || true)"
[ -n "$PY" ] || die "JR!TER needs Python 3.10 or newer. Install it (python.org, or your package manager) and run this again."
"$PY" - <<'EOF' || die "JR!TER needs Python 3.10 or newer; this one is older. Install a newer one and run this again."
import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)
EOF
say "$("$PY" --version) at $PY"

step "The code"
mkdir -p "$DIR"
if command -v git >/dev/null 2>&1; then
  if [ -d "$DIR/.git" ]; then
    git -C "$DIR" fetch --quiet origin "$BRANCH"
    git -C "$DIR" checkout --quiet "$BRANCH"
    git -C "$DIR" reset --quiet --hard "origin/$BRANCH"
    say "updated $DIR"
  elif [ -z "$(ls -A "$DIR" 2>/dev/null | grep -v '^data$' || true)" ]; then
    tmp="$(mktemp -d)"
    git clone --quiet --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$tmp/src"
    cp -R "$tmp/src/." "$DIR/"
    rm -rf "$tmp"
    say "fetched into $DIR"
  else
    warn "$DIR has files but isn't a git checkout; updating from the archive instead."
    NOGIT=1
  fi
else
  NOGIT=1
fi
if [ "${NOGIT:-0}" = "1" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$tmp"
  src="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  # Everything but data/: that's your library and it stays exactly as it is.
  (cd "$src" && find . -mindepth 1 -maxdepth 1 ! -name data -exec cp -R {} "$DIR/" \;)
  rm -rf "$tmp"
  say "unpacked into $DIR"
fi
mkdir -p "$DIR/data"

step "The jriter command"
BIN="$HOME/.local/bin"
mkdir -p "$BIN"
cat > "$BIN/jriter" <<EOF
#!/usr/bin/env bash
# Starts the JR!TER library from $DIR. Installed by install.sh; run that again to update.
cd "$DIR" && JRITER_PORT="\${JRITER_PORT:-$PORT}" JRITER_HOST="\${JRITER_HOST:-$HOST}" exec "$PY" server.py "\$@"
EOF
chmod +x "$BIN/jriter"
say "$BIN/jriter"
case ":$PATH:" in *":$BIN:"*) ;; *) warn "$BIN isn't on your PATH yet; add it to use 'jriter' from anywhere." ;; esac

step "Starting on its own"
OS="$(uname -s)"
if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  UNIT="$HOME/.config/systemd/user/jriter.service"
  mkdir -p "$(dirname "$UNIT")"
  cat > "$UNIT" <<EOF
[Unit]
Description=JR!TER, a music library
After=network-online.target

[Service]
ExecStart=$BIN/jriter
Restart=on-failure

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  if [ "${JRITER_NOSTART:-0}" != "1" ]; then
    systemctl --user enable --now jriter.service >/dev/null
    systemctl --user restart jriter.service
  else
    systemctl --user enable jriter.service >/dev/null
  fi
  say "a systemd user service (systemctl --user status jriter)"
  say "to keep it running while you're logged out: loginctl enable-linger \$USER"
elif [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/net.jriter.server.plist"
  mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>net.jriter.server</string>
  <key>ProgramArguments</key><array><string>$BIN/jriter</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/jriter.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/jriter.log</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  [ "${JRITER_NOSTART:-0}" = "1" ] || launchctl load "$PLIST"
  say "a launch agent (it starts when you log in; log in ~/Library/Logs/jriter.log)"
else
  warn "No systemd user session here, so it won't start on its own. Start it with: jriter"
  if [ "${JRITER_NOSTART:-0}" != "1" ]; then
    nohup "$BIN/jriter" >"$DIR/data/jriter.log" 2>&1 &
    say "started for now (log in $DIR/data/jriter.log)"
  fi
fi

# Two optional questions, asked only when somebody is at a keyboard (a piped install reads
# them from the terminal, not from the script). Both can be answered later by running this
# again; the environment variables answer them without asking.
ask() {  # ask "question" -> 0 for yes
  [ -r /dev/tty ] || return 1
  printf '  %s [y/N] ' "$1" > /dev/tty
  read -r answer < /dev/tty || return 1
  case "$answer" in [yY]*) return 0 ;; *) return 1 ;; esac
}
if [ -z "${JRITER_HOST:-}" ] && ask "Open it to the other devices on your home network too?"; then
  HOST="0.0.0.0"
  sed -i.bak "s/JRITER_HOST:-127.0.0.1/JRITER_HOST:-0.0.0.0/" "$BIN/jriter" && rm -f "$BIN/jriter.bak"
  if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then systemctl --user restart jriter.service 2>/dev/null || true; fi
  if [ "$OS" = "Darwin" ]; then launchctl unload "$HOME/Library/LaunchAgents/net.jriter.server.plist" 2>/dev/null; launchctl load "$HOME/Library/LaunchAgents/net.jriter.server.plist" 2>/dev/null || true; fi
  say "listening on your network as well"
fi
if [ "${JRITER_TAILSCALE:-}" = "1" ] || { [ -z "${JRITER_TAILSCALE:-}" ] && ask "Reach it from anywhere with Tailscale (optional, free)?"; }; then
  if command -v tailscale >/dev/null 2>&1; then
    # Only your own devices (your tailnet) can open this address; nothing is public.
    tailscale serve --bg "$PORT" >/dev/null 2>&1 && say "Tailscale: open it from your devices at https://$(hostname)/ (see: tailscale serve status)" \
      || warn "Tailscale is installed but 'tailscale serve' didn't work. Sign in to Tailscale first, then run: tailscale serve --bg $PORT"
  else
    warn "Tailscale isn't installed. Get it at https://tailscale.com/download, sign in, then run: tailscale serve --bg $PORT"
  fi
fi

step "Signing in"
ADDR="http://127.0.0.1:$PORT"
[ "$HOST" = "127.0.0.1" ] || ADDR="http://$(hostname):$PORT"
if [ "${JRITER_NOSTART:-0}" != "1" ]; then
  for _ in $(seq 1 30); do
    curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
    sleep 1
  done
fi
CODE_FILE="$DIR/data/setup-code.txt"
if [ -f "$CODE_FILE" ]; then
  say "Open $ADDR/login and choose your password with this one-time code:"
  printf '\n      \033[1m%s\033[0m\n\n' "$(cat "$CODE_FILE")"
  say "It stops working the moment a password is chosen."
else
  say "Open $ADDR and sign in."
fi
say "Coming from a guest library? Settings, Library, Bring a library in, and pick the copy you took."
say "It's your own JR!TER with its own accounts: invite people from Settings, People."
echo
