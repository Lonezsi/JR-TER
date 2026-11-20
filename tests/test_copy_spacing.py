"""Two sentences never run into each other: "3 renders.Hold one for more."

A sentence that ends right before a {#if} or a <span> that starts the next one loses its
space, because Svelte trims whitespace at the edges of a block. The space goes in as
{" "} before the block instead, and this keeps it that way.
"""
import os
import re

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui", "src")
GLUED = re.compile(r"[.!?](\{#if [^}]*\}|<span\b[^>]*>)[A-Z]")


def test_no_sentence_is_glued_to_the_next():
    found = []
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            if name.endswith(".svelte"):
                text = open(os.path.join(base, name), encoding="utf-8").read()
                found += [f"{name}: {m.group(0)}" for m in GLUED.finditer(text)]
    assert not found, found
