"""Every dropdown is the app's own (ui/Dropdown.svelte, which opens the app's menu), never
the browser's native <select>.

The native list looked like a different app on every phone and desktop: "input output
dropdowns in renders aren't my custom dropdown menu, same issue in release". This keeps a
native one from coming back anywhere in the interface.
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "ui", "src")


def test_no_native_select_anywhere():
    found = []
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            if not name.endswith(".svelte"):
                continue
            path = os.path.join(base, name)
            text = open(path, encoding="utf-8").read()
            # Comments may name the element; markup may not use it.
            text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
            if re.search(r"<select\b", text):
                found.append(os.path.relpath(path, SRC))
    assert not found, f"native <select> in {found}: use $ui/Dropdown.svelte"


def test_dropdown_opens_the_app_menu():
    text = open(os.path.join(SRC, "ui", "Dropdown.svelte"), encoding="utf-8").read()
    assert "showMenu(" in text
