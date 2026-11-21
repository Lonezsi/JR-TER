# The JR!TER library file

A library leaves JR!TER, and comes back in, as one `.zip`. The same file is what a guest
library (kept in your browser) turns into when you make an account, what Settings ›
Library › Take a copy hands you, and what Settings › Library › Bring a library in reads.
Nothing in it needs JR!TER to be read: it is JSON and plain text.

## What is in the zip

```
README.txt                 what this is and how it is laid out (this, shortened)
library.json               every row the library keeps, table by table (the source of truth)
settings.json              your settings
songs/<title>/words.md     each song's current words, as you typed them
songs/<title>/song.txt     the song in plain text: renders, arrangement, the sound
audio/<digest>.<ext>       the audio and pictures, named by the SHA-256 of their bytes
                           (present when the copy was taken "with audio"; a guest library
                           always includes it)
```

`songs/` is for people. It is written from `library.json` and never read back: edit the
words there and they are yours to paste in, but an import only reads `library.json`.

## library.json

```json
{
  "format": "jriter-library",
  "version": 2,
  "about": "Every row this library keeps, table by table. ...",
  "taken_at": 1795103038.5,
  "library": "JR!TER",
  "tables": { "songs": [ {...}, ... ], "versions": [ ... ], ... },
  "left_out": { "migrations": "why", ... }
}
```

- `format` and `version` say what this is. A file without them is version 1 (the export
  before 4.1), which has the same `tables` and is read the same way.
- `tables` holds one list of rows per table. The columns are the ones listed in
  `jriter/modules/export.py` `TAKEN`. Ids are the library's own; an import gives every
  row a new id and rewrites every reference (song_id, sheet_id, album_id, playlist_id,
  render_id, version_id, current_version_id) to match.
- Audio and artwork are referred to by `digest` + `ext`. On import a row whose bytes are
  neither in the zip's `audio/` nor already in the library is skipped and counted as
  missing.

## Tables an import reads

songs, song_titles, versions, renders, lyric_sheets, lyric_revisions, albums,
album_songs, playlists, playlist_items, artwork, sound_presets, arrangements, vocal_takes.

Never imported, whatever the file says: auth_tokens, guest_edits, sync_folders,
youtube_posts, orarend_notes, orarend_pages (they belong to the machine or account that
made them).

## Import

`POST /api/import` with the zip as the request body. Signed in only. It adds to the
library, it never replaces or deletes. The answer says what came in:

```json
{ "songs": 12, "albums": 2, "playlists": 1, "renders": 30, "lyrics": 14, "missing_audio": 0 }
```
