"""Does the front end's JavaScript actually hold together.

Written after "sharing fails" turned out to be a ReferenceError: `async function share()`
was declared inside wireTitle, and the Share button, which is wired up in wireHero, called
`share()`. Declarations hoist to the top of their own scope and no further, so pressing the
button raised "share is not defined" from the day it was added. Five hundred and fifty
three tests passed the whole time, because every one of them reads the source as text.

These two do not. One parses every file with a real JavaScript engine, and the other looks
for that exact shape: a function called from outside the function it belongs to. Neither is
a substitute for running the app, but between them they would have caught this one and the
several broken files a mangled edit has produced in this repo before now.
"""
import io
import os
import re
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(HERE, "web", "js")

NODE = shutil.which("node")


def sources():
    return [n for n in sorted(os.listdir(JS)) if n.endswith(".js")]


# ── does it parse ────────────────────────────────────────────────────────────

@pytest.mark.skipif(not NODE, reason="no node on this machine to parse with")
@pytest.mark.parametrize("name", sources())
def test_the_file_parses(name):
    """A syntax error in any of these takes the whole bundle down, because they are
    concatenated into one script: one bad file and nothing on the page works at all.

    Skipped rather than failed where there is no engine to ask. The point of a test that
    needs a tool is to run where the tool is, not to fail everywhere it is not.
    """
    done = subprocess.run([NODE, "--check", os.path.join(JS, name)],
                          capture_output=True, text=True)
    assert done.returncode == 0, "%s does not parse:\n%s" % (name, done.stderr)


# ── is everything it calls actually in reach ─────────────────────────────────

DECL = re.compile(r"^(\s*)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(")
CALL = re.compile(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(")


ENDS_A_VALUE = ")]}"


def _is_pattern(last):
    """Is a slash here the start of a regex rather than a division.

    The one thing a scanner cannot decide without context. What comes before settles it:
    a name, a number or a closing bracket means there is a value to divide, so the slash
    is division. After anything else, or at the start, it opens a pattern.
    """
    if last is None:
        return True
    return not (last.isalnum() or last in "_$" or last in ENDS_A_VALUE)


def _bare(source):
    """The source with its comments and its string and template text taken out.

    A scanner rather than a set of regexes, because of one thing a regex cannot do here:
    a template literal's `${...}` holes are code, and the code in them can open another
    template. Matching backtick pairs with a pattern gets that wrong on the first nested
    one and stays wrong for the rest of the file. The version of this that did deleted so
    much of the song view that there was nothing left to check, and passed.

    What comes out keeps every brace that belongs to code, so depth still counts, and
    keeps the expressions inside template holes, because a call written in one is a real
    call. What goes is comment bodies and the literal text of strings.
    """
    out = []
    state = "code"
    holes = []               # brace depth inside each open ${...}, innermost last
    last = None              # previous significant character, for the slash question
    klass = False            # inside a regex's [...]
    i = 0
    n = len(source)
    while i < n:
        c = source[i]
        two = source[i:i + 2]

        if state == "code":
            if two == "//":
                state = "line-comment"
                i += 2
                continue
            if two == "/*":
                state = "block-comment"
                i += 2
                continue
            if c in "\"'":
                state = "quote"
                quote = c
                out.append(c)
                i += 1
                continue
            if c == "`":
                state = "template"
                out.append("`")
                i += 1
                continue
            if c == "/" and _is_pattern(last):
                state = "regex"
                i += 1
                continue
            if not c.isspace():
                last = c
            if holes:
                # Inside a ${...}: track braces so the closing one is recognised.
                if c == "{":
                    holes[-1] += 1
                elif c == "}":
                    if holes[-1] == 0:
                        holes.pop()
                        state = "template"
                        out.append("}")
                        i += 1
                        continue
                    holes[-1] -= 1
            out.append(c)
            i += 1
            continue

        if state == "line-comment":
            if c == "\n":
                state = "code"
                out.append("\n")
            i += 1
            continue

        if state == "block-comment":
            if two == "*/":
                state = "code"
                i += 2
            else:
                # Newlines are kept so line numbers and brace depth stay in step.
                if c == "\n":
                    out.append("\n")
                i += 1
            continue

        if state == "quote":
            if c == "\\":
                i += 2
                continue
            if c == quote:
                state = "code"
                out.append(c)
            i += 1
            continue

        if state == "regex":
            if c == "\\":
                i += 2
                continue
            if c == "[":
                klass = True
            elif c == "]":
                klass = False
            elif c == "/" and not klass:
                state = "code"
                last = "/"
                # The flags are identifier characters; none of them matter here.
            elif c == "\n":
                # A regex cannot span lines, so a newline means the guess was wrong and
                # that slash was a division after all. Give up on the state, not the line.
                state = "code"
                out.append("\n")
            i += 1
            continue

        if state == "template":
            if c == "\\":
                i += 2
                continue
            if two == "${":
                holes.append(0)
                state = "code"
                out.append("${")
                i += 2
                continue
            if c == "`":
                state = "code"
                out.append("`")
                i += 1
                continue
            if c == "\n":
                out.append("\n")
            i += 1
            continue

    return "".join(out)


def _tagged(source):
    """Every line with its brace depth and the top level function it sits in."""
    out = []
    depth = 0
    top = None
    for line in source.split("\n"):
        found = DECL.match(line)
        if depth == 0 and found and not found.group(1):
            top = found.group(2)
        out.append((line, depth, top))
        depth += line.count("{") - line.count("}")
        if depth <= 0:
            top = None
            depth = max(0, depth)
    return out


@pytest.mark.parametrize("name", sources())
def test_no_function_is_called_from_outside_the_one_it_lives_in(name):
    """The Share bug, exactly.

    Only `function NAME(` declarations nested inside another top level function, and only
    bare `NAME(` calls: anything reached through a dot, a string or a property belongs to
    somebody else and is none of this test's business. Narrow on purpose, because a scope
    checker that guesses is a scope checker people switch off.
    """
    bare = _bare(io.open(os.path.join(JS, name), encoding="utf-8").read())

    # Before trusting a word of it: the stripper has to have kept its place.
    #
    # This is here because the first version of this test passed on the file with the bug
    # in it. Its regexes mis-paired the backticks in a template holding another template,
    # threw away most of the song view, found no functions in what was left and had
    # nothing to complain about. A stripper that loses the thread does not raise; it
    # quietly returns a shorter string, and every assertion after it is about nothing.
    #
    # Balanced braces are the cheap proof that every state opened and closed where it
    # should have. It is not a parse, but nothing that has lost its place can balance.
    assert bare.count("{") == bare.count("}"), (
        "%s: the stripper came out %+d braces off, so it lost track of a string, comment,"
        " template or regex somewhere. Fix that before trusting this test: unbalanced"
        " means the scope check below is reading the wrong text."
        % (name, bare.count("{") - bare.count("}")))

    tagged = _tagged(bare)

    owner = {}
    for line, depth, top in tagged:
        found = DECL.match(line)
        if found and depth > 0 and top:
            owner[found.group(2)] = top

    for line, depth, top in tagged:
        if DECL.match(line):
            continue
        for called in CALL.findall(line):
            holder = owner.get(called)
            assert not (holder and holder != top), (
                "%s: %s() is declared inside %s and called from %s, which cannot see it:"
                "\n    %s" % (name, called, holder, top or "the top level", line.strip()))
