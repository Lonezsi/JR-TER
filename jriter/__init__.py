"""JR!TER: a personal music workspace where the object is a song, not a file."""

from .devlog import ENTRIES

#: The version is the top of the devlog, not a number of its own.
#:
#: Two places to edit on a release is one place to forget, and it is never the number
#: that gets forgotten. Written this way round, the release note is the release.
__version__ = ENTRIES[0]["version"]
