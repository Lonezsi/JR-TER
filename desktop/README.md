# JR!TER desktop

The PC side of JR!TER, with no Python: a tray app that watches your render folders and sends new
renders to the library, starts FL Studio's render, and adds the right-click menu. Java 21, packaged
by `jpackage` into a folder with its own runtime (nothing else to install on the PC).

Two programs in one folder:

- `JRITER.exe` - the tray app (no console). Watches the folders every few minutes and puts new audio
  in the library's **Renders** list. Menu: Open library, Check now, Pause, Open log, Quit.
  `--minimised` starts it with no window (that is what start-at-logon uses).
- `jriter-cli.exe` - the commands, same names as the old Python client:

```
jriter-cli server http://127.0.0.1:7900     where the library is
jriter-cli login [--handle H] [--name N]    password once; keeps an upload-only token
jriter-cli add "C:\Users\you\Music\Renders" watch a folder
jriter-cli scan | push [--yes] | watch [--once]
jriter-cli push-file FILE | push-folder FOLDER
jriter-cli render X.flp|FOLDER              FL Studio renders, the audio goes to Renders
jriter-cli plugins X.flp|FOLDER [--json] [--vst-folder DIR]    which VSTs and FL plugins a project uses, VSTs not installed here marked
jriter-cli release ALBUM_ID [--folder DIR]   Claude Code on a RouteNote release card from /release.html (docs/ROUTENOTE.md)
jriter-cli url jriter://release/ID           the same, from the link; `shell install` registers it
jriter-cli flpath "C:\...\FL64.exe"
jriter-cli shell install|remove             right-click menu (HKCU only)
jriter-cli autostart on|off                 start the tray at logon
```

Settings are the same `%APPDATA%\jriter\client.json` the Python client used (or the file named by
`JRITER_CLIENT_CONFIG`); the log is `watch.log` beside it. Unknown keys in the file are kept.

## Build

    powershell -File desktop\build.ps1      # needs JDK 21 (jpackage) and Maven; JRITER_JDK to point at it

Gives `desktop\target\dist\JRITER\` and `desktop\target\JRITER-0.1.0-win.zip`. Unzip anywhere.
`python tools/check_desktop.py` drives the built `jriter-cli.exe` against the Spring server on a
scratch data folder.

## Notes

- Why Java and not Tauri (as `docs/REWORK.md` first said): no Rust or MSVC on the build machine.
- The Java HTTP client cannot put non-ASCII bytes in a header, so a file name like `Józsi dal.wav`
  goes as ASCII plus `X-Filename-Enc` (percent-encoded UTF-8); the Spring server reads that one first.
  The old Python server ignores it and would show `?` for such names.
- The token still lives in `client.json`; the Windows credential store is a later job.
- `update`/`install`/`uninstall` from the Python client are gone: a new build replaces the app.
- `client/` stays until the app has been used on the owner's PC.
