"""Does the built interface at least parse.

The old version of this file traced function scopes across thirty-odd concatenated scripts,
because one mangled edit took the whole bundle down. The interface is TypeScript now,
type-checked by `npm run check` and bundled as ES modules, so that whole class of mistake is
caught at build time and the scope tracing has no equivalent here.

What is left is the one thing a committed bundle can still get wrong: being stale or
half-written. Parse every built script with a real engine, and make sure the page loads the
ones it names.
"""
import os
import re
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(HERE, "web")
ASSETS = os.path.join(WEB, "assets")

NODE = shutil.which("node")


def built():
    return [n for n in sorted(os.listdir(ASSETS)) if n.endswith(".js")]


@pytest.mark.skipif(not NODE, reason="no node on this machine to parse with")
@pytest.mark.parametrize("name", built())
def test_the_built_script_parses(name, tmp_path):
    """Copied to .mjs because the bundle is an ES module and node decides by extension.

    Skipped rather than failed where there is no engine to ask: a test that needs a tool is
    for running where the tool is.
    """
    copy = tmp_path / (name + ".mjs")
    shutil.copyfile(os.path.join(ASSETS, name), copy)
    done = subprocess.run([NODE, "--check", str(copy)], capture_output=True, text=True)
    assert done.returncode == 0, "%s does not parse:\n%s" % (name, done.stderr)


def test_the_page_loads_a_bundle_that_exists():
    """index.html names hashed files, so a rebuild that was not committed whole leaves the
    page pointing at something that is not there."""
    page = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
    named = re.findall(r'(?:src|href)="/(assets/[^"]+)"', page)
    assert any(n.endswith(".js") for n in named), "the page loads no script"
    assert any(n.endswith(".css") for n in named), "the page loads no stylesheet"
    for n in named:
        assert os.path.isfile(os.path.join(WEB, n)), "index.html names %s, which is not built" % n
