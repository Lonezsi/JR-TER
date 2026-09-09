"""Does the right click menu actually start anything.

Written after "Upload to JR!TER" on a wav answered

    Cannot launch PythonCore 3.13 because no executable name is available

which reads like a broken Python and was nothing of the kind: py -3 resolved fine from
every other place on the machine. The line written to the registry doubled every quote and
then wrapped the result in another pair, and cmd only strips an outer pair under conditions
that line did not meet, so what reached py.exe was a command line whose quotes did not pair
up. Every entry in that menu had been broken since the day it was added, on every machine.

The second test runs the line rather than reading it, because the broken one reads
perfectly well. Nothing short of handing it to cmd tells you anything.
"""
import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "client"))

import jriter_shell


def test_the_line_does_not_double_its_quotes():
    """The specific mistake, named, so a future escape does not creep back in.

    Doubling was an attempt to escape the inner quotes for the outer pair that cmd needs.
    /s removes the need entirely: everything between the first and last quote is taken
    literally, so the inner quotes stay ordinary quotes.
    """
    line = jriter_shell.command_line(r'"C:\Windows\py.exe" -3 "C:\x\c.py"',
                                     "push-file", "%1")

    assert line.startswith('cmd /s /c "') and line.endswith('"'), (
        "the wrapper is missing /s or its outer pair, so cmd will not strip the outer"
        " quotes and py.exe gets a line whose quotes do not pair up:\n    %s" % line)

    # What cmd takes literally is everything between the outer pair. The quote sitting
    # right after `cmd /s /c ` is that outer one against the exe path's own quote, and it
    # belongs there; only doubling *inside* is the fault.
    inner = line[len('cmd /s /c "'):-1]
    assert '""' not in inner, (
        "the command doubles its quotes:\n    %s\nTogether with the outer pair, that is"
        " the exact form py.exe cannot parse." % line)


@pytest.mark.skipif(os.name != "nt", reason="cmd.exe quoting is a Windows question")
def test_the_menu_entry_actually_starts_the_client():
    """Run what the registry would hold. The broken version read fine and never ran.

    --help in place of a real file, so this asks whether the client starts, which is the
    only thing that was ever wrong, and uploads nothing.

    keep_open stays on, and that is not incidental: the whole fault lives in the wrapper
    that pause is part of, so a version of this test that turned it off proved the client
    could start and nothing else. It passed with the bug back in. The line is run exactly
    as the registry holds it, wrapper and all, because that is the only string Windows
    ever sees. pause reads a key from a console this has not got, so it returns at once.
    """
    line = jriter_shell.command_line(jriter_shell._runner(), "push-file", "--help")
    done = subprocess.run(line, capture_output=True, text=True,
                          stdin=subprocess.DEVNULL)
    both = (done.stdout or "") + (done.stderr or "")

    assert "Cannot launch" not in both, (
        "the menu entry cannot start Python:\n    %s\n%s" % (line, both.strip()))
    assert done.returncode == 0, (
        "the menu entry exited %d:\n    %s\n%s" % (done.returncode, line, both.strip()))
    assert "push-file" in both, (
        "something ran, but it was not the client:\n    %s\n%s" % (line, both.strip()))
