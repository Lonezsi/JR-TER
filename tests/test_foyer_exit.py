"""The way out of the app: Foyer is a site, not a route.

The phone gesture that used to offer it (hold the rail out past its stop, press an arrow)
went with the old interface, which is why that file is gone. What is worth keeping is the
decision under it: leaving for Foyer has to be a real navigation to a path on this origin.
A hash would be handled by this app's own router and land on nothing.
"""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, "ui", "src")


def read(*parts):
    return open(os.path.join(SRC, *parts), encoding="utf-8").read()


def test_foyer_is_a_path_on_this_origin_not_a_route_in_the_app():
    found = re.search(r'export const FOYER = "([^"]*)";', read("lib", "app.svelte.ts"))
    assert found, "FOYER is gone, so nothing knows where the front door is"
    assert found.group(1).startswith("/") and "#" not in found.group(1), (
        "FOYER is %r. The tunnel puts every site on one hostname, so it is a root-relative"
        " path, and a hash would be handled by this app's router." % found.group(1))


def test_the_sidebar_has_a_real_link_out_for_a_machine_with_a_pointer():
    """A real anchor with a real href, which works before any script has run, and which is
    not an in-app link."""
    sidebar = read("shell", "Sidebar.svelte")
    found = re.search(r"<a\b[^>]*href=\{FOYER\}[^>]*>\s*Foyer\s*</a>", sidebar)
    assert found, "there is no link to Foyer in the sidebar"
    assert "data-link" not in found.group(0), "the link is claimed by the app's own router"


def test_the_palette_leaves_the_app_rather_than_navigating_inside_it():
    shell = read("shell", "Shell.svelte")
    found = re.search(r'id: "app\.foyer".*?run: \(\) => \{([^}]*)\}', shell)
    assert found, "the palette has no way back to Foyer"
    assert "location.assign(" in found.group(1)
    assert "location.hash" not in found.group(1) and "go(" not in found.group(1)
