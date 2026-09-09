"""Does the update task get told to catch up a run it missed.

The task goes in through schtasks /Create, which takes Windows' defaults for the two
settings that decide what happens when its moment passes:

    DisallowStartIfOnBatteries  True     do not start on battery
    StartWhenAvailable          False    and do not catch up afterwards

Together those mean a run missed on battery is dropped rather than delayed. A laptop
unplugged overnight never updates, and nothing says so: a task that skipped and a task
that succeeded look identical from outside, which is the same silence the upload token had.

Seen on the machine this was found on, not reasoned about. One run exited 0x800710E0,
"the operator or administrator has refused the request", which is what that condition
returns, and the next exited 0 because the laptop happened to be plugged in.

Neither setting is reachable from schtasks, so the client asks PowerShell. This test hands
it a fake subprocess and reads the command it built, rather than registering a task on
whatever machine the suite is running on.
"""
import os
import sys

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "client"))

import jriter_client


class _Fake(object):
    """Stands in for subprocess.run and keeps what it was asked to do."""

    def __init__(self, code=0):
        self.calls = []
        self.code = code

    def __call__(self, command, **kw):
        self.calls.append(command)

        class Done(object):
            returncode = self.code
            stdout = ""
            stderr = ""
        return Done()


def test_the_update_task_is_told_to_run_late_rather_than_not_at_all(monkeypatch):
    """The three settings, by name, in the command the client actually builds."""
    fake = _Fake()
    monkeypatch.setattr(jriter_client.subprocess, "run", fake)

    assert jriter_client.catch_up("JRITER update") is True
    assert len(fake.calls) == 1, "expected one call, got %d" % len(fake.calls)

    command = fake.calls[0]
    assert command[0] == "powershell", \
        "schtasks cannot set these, so it has to be PowerShell: %r" % (command[:2],)
    script = " ".join(command)

    assert "JRITER update" in script, "the task name did not reach the command"
    for setting, wanted in (("DisallowStartIfOnBatteries", "$false"),
                            ("StopIfGoingOnBatteries", "$false"),
                            ("StartWhenAvailable", "$true")):
        assert ("%s = %s" % (setting, wanted)) in script, (
            "%s is not set to %s, so a run missed on battery is still dropped rather"
            " than delayed:\n    %s" % (setting, wanted, script))


def test_a_machine_that_refuses_the_change_still_installs(monkeypatch):
    """Best effort on purpose.

    Running on the conditions schtasks gives is the behaviour this has always had, so a
    machine that will not allow the change is worth a line and not a stopped install.
    """
    fake = _Fake(code=1)
    monkeypatch.setattr(jriter_client.subprocess, "run", fake)
    assert jriter_client.catch_up("JRITER update") is False


def test_a_task_name_with_a_quote_in_it_cannot_break_out_of_the_script():
    """The name goes into a single quoted PowerShell string, so a quote has to be doubled.

    Nothing names a task like this today. It is one line of escaping against the day
    something builds a name out of something else, and after spending this morning on a
    quoting bug it is not the corner to leave open.
    """
    calls = []

    class Grab(object):
        returncode = 0
        stdout = stderr = ""

    def fake(command, **kw):
        calls.append(command)
        return Grab()

    real = jriter_client.subprocess.run
    jriter_client.subprocess.run = fake
    try:
        jriter_client.catch_up("it's a task")
    finally:
        jriter_client.subprocess.run = real

    script = " ".join(calls[0])
    assert "it''s a task" in script, \
        "a quote in the name was not doubled, so it ends the string early: %s" % script
