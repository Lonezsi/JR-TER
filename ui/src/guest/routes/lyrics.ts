/* jriter/modules/lyrics.py, in the browser: sets of words, each with its own history. */
import { rows, byId, insert, update, remove, where, now, type Row } from "../lib";
import { GuestError, need, type Routes } from "../http";
import { getSong, touch } from "./songs";
import { burySheet } from "./grave";

function getSheet(id: unknown): Row {
  const row = byId("lyric_sheets", id);
  if (!row) throw new GuestError(`no lyric alternative with id ${id}`, 404);
  return row;
}

export function nameFrom(text: string, fallback: string) {
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^#+/, "").trim();
    if (line) return line.slice(0, 80);
  }
  return fallback;
}

const plainName = (sheet: Row) => `v${(Number(sheet.position) || 0) + 1}`;

export const latest = (sheetId: number) =>
  where("lyric_revisions", (r) => r.sheet_id === sheetId).reduce<Row | null>((m, r) => (!m || r.id > m.id ? r : m), null);

function withText(sheet: Row): Row {
  const rev = latest(sheet.id);
  return {
    ...sheet,
    text: rev ? rev.text : "",
    revision_id: rev ? rev.id : null,
    updated_at: rev ? rev.created_at : sheet.created_at,
    revisions: where("lyric_revisions", (r) => r.sheet_id === sheet.id).length,
  };
}

export const routes: Routes = {
  "GET /api/songs/<id>/lyrics": (req) => {
    const song = getSong(req.params.id);
    return { lyrics: where("lyric_sheets", (s) => s.song_id === song.id)
      .sort((a, b) => a.position - b.position || a.id - b.id).map(withText) };
  },
  "POST /api/songs/<id>/lyrics": async (req) => {
    const song = getSong(req.params.id);
    const data = await req.json();
    const existing = where("lyric_sheets", (s) => s.song_id === song.id);
    let name = String(data.name || "").trim() || `v${existing.length + 1}`;
    const top = existing.reduce((m, s) => Math.max(m, s.position), -1);
    const sheet = insert("lyric_sheets", {
      song_id: song.id, name, position: top + 1, is_current: existing.length ? 0 : 1, created_at: now(),
    });
    if (data.text) {
      insert("lyric_revisions", { sheet_id: sheet.id, text: data.text, created_at: now() });
      name = nameFrom(data.text, name);
      update(sheet, { name });
    }
    touch(song.id);
    return { sheet: withText(sheet) };
  },
  "PUT /api/lyrics/<id>/text": async (req) => {
    const sheet = getSheet(req.params.id);
    const data = await req.json();
    if (!("text" in data)) throw new GuestError("text is required");
    const text = String(data.text || "");
    const cur = latest(sheet.id);
    if (cur && cur.text === text) return { sheet: withText(sheet), saved: false, message: "Nothing changed, so no new revision was kept." };
    insert("lyric_revisions", { sheet_id: sheet.id, text, created_at: now() });
    update(sheet, { name: nameFrom(text, plainName(sheet)) });
    touch(sheet.song_id);
    return { sheet: withText(sheet), saved: true };
  },
  "PATCH /api/lyrics/<id>": async (req) => {
    const sheet = getSheet(req.params.id);
    const data = await req.json();
    if ("name" in data) update(sheet, { name: need(data, "name") });
    return { sheet: withText(sheet) };
  },
  "POST /api/lyrics/<id>/current": (req) => {
    const sheet = getSheet(req.params.id);
    for (const s of rows("lyric_sheets")) if (s.song_id === sheet.song_id && s.is_current) update(s, { is_current: 0 });
    update(sheet, { is_current: 1 });
    touch(sheet.song_id);
    return { sheet: withText(sheet) };
  },
  "GET /api/lyrics/<id>/history": (req) => {
    const sheet = getSheet(req.params.id);
    return { revisions: where("lyric_revisions", (r) => r.sheet_id === sheet.id).sort((a, b) => b.id - a.id)
      .map((r) => ({ id: r.id, created_at: r.created_at, length: [...String(r.text)].length })) };
  },
  "POST /api/lyrics/<id>/restore": async (req) => {
    const sheet = getSheet(req.params.id);
    const id = Number((await req.json()).revision_id);
    const old = rows("lyric_revisions").find((r) => r.id === id && r.sheet_id === sheet.id);
    if (!old) throw new GuestError("that revision is not part of this alternative", 404);
    const cur = latest(sheet.id);
    if (cur && cur.text === old.text) return { sheet: withText(sheet), saved: false, message: "That text is already the current one." };
    insert("lyric_revisions", { sheet_id: sheet.id, text: old.text, created_at: now() });
    update(sheet, { name: nameFrom(old.text, plainName(sheet)) });
    touch(sheet.song_id);
    return { sheet: withText(sheet), saved: true };
  },
  "DELETE /api/lyrics/<id>": (req) => {
    const sheet = getSheet(req.params.id);
    burySheet(sheet.id);
    remove("lyric_revisions", (r) => r.sheet_id !== sheet.id);
    remove("lyric_sheets", (s) => s.id !== sheet.id);
    if (sheet.is_current) {
      const other = where("lyric_sheets", (s) => s.song_id === sheet.song_id).sort((a, b) => a.position - b.position)[0];
      if (other) update(other, { is_current: 1 });
    }
    return { deleted: sheet.id };
  },
  "GET /api/lyric-revisions/<id>": (req) => {
    const row = byId("lyric_revisions", req.params.id);
    if (!row) throw new GuestError(`no revision with id ${req.params.id}`, 404);
    return { revision: row };
  },
};

export const summary = () => ({ alternatives: rows("lyric_sheets").length });
