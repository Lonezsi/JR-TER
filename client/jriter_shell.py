#!/usr/bin/env python3
"""The right click menu.

Five entries, all written under HKEY_CURRENT_USER:

    an audio file   Upload to JR!TER
    an .flp         Render and send to JR!TER
    a folder        Upload every sound file in here
    a folder        Render every FL project in here
    a folder        Watch this folder

The two folder verbs are not the same thing and the labels have to say so. "Upload every
sound file in here" is a one off: it sends what is in there now and forgets the folder.
"Watch this folder" is the standing arrangement, where a task picks up whatever lands in
it from then on. Having only the second one meant the only way to send a folder you had
already filled was to watch it for ever.

HKCU rather than HKLM on purpose. Per user keys need no administrator, they are visible
in one place, and removing them takes the integration away completely. Nothing here
writes to the machine wide hive or touches file associations: opening a .mp3 still opens
whatever opened it before.

Standard library only, and a no op anywhere that is not Windows.
"""
import os
import sys

KEY_ROOT = r"Software\Classes"
AUDIO_EXT = (".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus")

# name, where it hangs, the label, and the argument Windows substitutes
ENTRIES = [
    ("JriterUpload", [r"SystemFileAssociations\%s\shell" % ext for ext in AUDIO_EXT],
     "Upload to JR!TER", "push-file", "%1"),
    ("JriterRenderFlp", [r"SystemFileAssociations\.flp\shell"],
     "Render and send to JR!TER", "render", "%1"),
    ("JriterPushFolder", [r"Directory\shell", r"Directory\Background\shell"],
     "Upload every sound file in here", "push-folder", "%V"),
    ("JriterRenderFolder", [r"Directory\shell", r"Directory\Background\shell"],
     "Render every FL project in here", "render", "%V"),
    ("JriterWatchFolder", [r"Directory\shell"],
     "Watch this folder with JR!TER", "add", "%V"),
]

# What these were called before the rename, and where they hung.
#
# remove() walks these too, and install() sweeps them first. Without that a rename would
# leave up to eleven orphaned entries in the right click menu for ever: still there,
# still firing, pointing at a client script that no longer exists, and nothing left in
# the world that knows their names to take them away.
LEGACY = [
    ("JongUpload", [r"SystemFileAssociations\%s\shell" % ext for ext in AUDIO_EXT]),
    ("JongRenderFlp", [r"SystemFileAssociations\.flp\shell"]),
    ("JongRenderFolder", [r"Directory\shell", r"Directory\Background\shell"]),
    ("JongPushFolder", [r"Directory\shell", r"Directory\Background\shell"]),
    ("JongWatchFolder", [r"Directory\shell"]),
]


def _drop(winreg, name, parents):
    """Take one entry away wherever it hangs. Missing is the ordinary case."""
    gone = []
    for parent in parents:
        base = "%s\\%s\\%s" % (KEY_ROOT, parent, name)
        for path in (base + r"\command", base):
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)
            except OSError:
                pass
        gone.append(parent)
    return gone


def _winreg():
    if os.name != "nt":
        return None
    try:
        import winreg
        return winreg
    except ImportError:
        return None


def _icon():
    """The mark, for the menu entries to wear.

    It was sys.executable, which puts the Python logo next to every entry: correct about
    what runs and wrong about what it is. Windows wants a file that actually holds an icon
    resource, so this is web/favicon.ico out of the checkout, and it falls back to the old
    answer rather than writing a path to a file that is not there.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    ico = os.path.join(os.path.dirname(here), "web", "favicon.ico")
    return ico if os.path.isfile(ico) else sys.executable


def _runner():
    """How to start the client from a shell entry.

    py.exe when it is there, because it survives Python being upgraded underneath the
    registry entry. A bare python.exe path stops working the day the interpreter moves.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    client = os.path.join(here, "jriter_client.py")
    launcher = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "py.exe")
    if os.path.isfile(launcher):
        return '"%s" -3 "%s"' % (launcher, client)
    return '"%s" "%s"' % (sys.executable, client)


def command_line(runner, command, argument, keep_open=True):
    """The exact string that goes in the registry, so something other than Windows can ask.

    It used to be built in the middle of the registry write, which meant the only way to
    see one was to install the menu and read it back, and that is a thing nobody does
    casually. Every entry here had been broken since it was written and the way it was
    found was a person right clicking a wav.

    The console stays open on purpose: this is the only place the answers to "is this a
    new render of X?" can be given.

    /s is the whole reason any of these work. Without it the wrapper doubled every quote
    and added a pair of its own, and cmd only strips an outer pair under conditions that
    line did not meet, so py.exe was handed a command line whose quotes did not pair up
    and answered "Cannot launch PythonCore 3.13 because no executable name is available".
    Which reads like a broken Python install and is nothing of the kind.

    /s says: take the first and last quote off and treat the rest literally. No escaping,
    no doubling, and a path with a space keeps its own quotes.
    """
    line = '%s %s "%s"' % (runner, command, argument)
    if keep_open:
        line = 'cmd /s /c "%s & pause"' % line
    return line


def install(keep_open=True):
    """Add the entries. Returns a list of what was written."""
    winreg = _winreg()
    if not winreg:
        return []
    runner = _runner()
    # Anything the old name left behind goes first, or installing on a machine that had
    # the previous version leaves both sets in the menu at once.
    for name, parents in LEGACY:
        _drop(winreg, name, parents)
    written = []
    for name, parents, label, command, argument in ENTRIES:
        for parent in parents:
            base = "%s\\%s\\%s" % (KEY_ROOT, parent, name)
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base) as key:
                winreg.SetValueEx(key, "", 0, winreg.REG_SZ, label)
                winreg.SetValueEx(key, "Icon", 0, winreg.REG_SZ, _icon())
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + r"\command") as key:
                winreg.SetValueEx(key, "", 0, winreg.REG_SZ,
                                  command_line(runner, command, argument, keep_open))
            written.append(base)
    return written


def remove():
    """Take them all away again."""
    winreg = _winreg()
    if not winreg:
        return []
    gone = []
    # The old names first, so "shell remove" means take away everything this tool has
    # ever written rather than everything it would write today.
    for name, parents in LEGACY:
        _drop(winreg, name, parents)
    for name, parents, _, _, _ in ENTRIES:
        for parent in parents:
            base = "%s\\%s\\%s" % (KEY_ROOT, parent, name)
            for path in (base + r"\command", base):
                try:
                    winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)
                except OSError:
                    continue
            gone.append(base)
    return gone


def installed():
    """Which entries are actually present, so the answer is read rather than assumed."""
    winreg = _winreg()
    if not winreg:
        return []
    present = []
    for name, parents, label, _, _ in ENTRIES:
        for parent in parents:
            base = "%s\\%s\\%s\\command" % (KEY_ROOT, parent, name)
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, base) as key:
                    present.append((parent, label, winreg.QueryValueEx(key, "")[0]))
            except OSError:
                pass
    return present


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if os.name != "nt":
        print("The right click menu is a Windows thing; nothing to do here.")
        sys.exit(0)
    if action == "install":
        written = install()
        print("Added %d entries:" % len(written))
        for path in written:
            print("  HKCU\\" + path)
        print("\nRight click an mp3, an flp, or a folder.")
    elif action == "remove":
        remove()
        print("Removed. Right click menus are back to how they were.")
    else:
        rows = installed()
        if not rows:
            print("Not installed. Run: python jriter_shell.py install")
        for parent, label, command in rows:
            print("  %-46s %s" % (parent, label))
