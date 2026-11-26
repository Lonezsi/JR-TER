/* The few things in Settings that are asked for from more than one place: a row on the
 * screen and a line in the command palette. One definition each. */
import { api, post, attempt } from "$lib/api";
import { plural } from "$lib/util";
import { sheet } from "$lib/dialog.svelte";
import { toast } from "$lib/toast.svelte";

export async function signOut() {
  // Caught, not reported: the point is to end up at the door, and that happens either way.
  await post("/api/auth/logout").catch(() => null);
  location.href = "/login";
}

export async function changePassword() {
  const said = await sheet<{ current: string; next: string }>({
    title: "Change password",
    sub: "Anything you like. Every signed in device is signed out when it changes; "
       + "this one stays in.",
    confirm: "Change it",
    fields: [
      { name: "current", label: "Current password", type: "password", required: true,
        autocomplete: "current-password" },
      { name: "next", label: "New password", type: "password", required: true,
        autocomplete: "new-password",
        hint: "Any password is accepted, however short. Guessing is limited to a few tries "
            + "before that address has to wait, which is what makes a short one safe enough." },
    ],
  });
  if (!said) return;
  const done = await attempt(() => post("/api/auth/password", { current: said.current, new: said.next }));
  if (done) toast("Password changed. Other devices will have to sign in again.");
}

/* A tab rather than fetch and a blob URL. The zip is built on a temporary file on the
 * server so a big library is never held twice in memory, and reading it into the page to
 * make a blob would undo that on the machine with less of it. The browser streams it to
 * disk and the server names it. */
/** The library as a file (docs/library-format.md). With audio is the whole thing; without,
 *  the words and every setting, and a note on where the audio lives. */
export function takeCopy(withAudio = false) {
  window.open(withAudio ? "/api/export?audio=1" : "/api/export", "_blank", "noopener");
}

/** Add a library file to this library: picks a .zip, sends it, says what came in. */
export function bringIn(onDone?: () => void) {
  const pick = document.createElement("input");
  pick.type = "file"; pick.accept = ".zip,application/zip";
  pick.onchange = async () => {
    const file = pick.files?.[0];
    if (!file) return;
    const said = await attempt(() => api("/api/import", { method: "POST", body: file, headers: { "Content-Type": "application/zip" } }));
    if (!said) return;
    const parts = [plural(said.songs, "song"), said.albums ? plural(said.albums, "album") : "", said.playlists ? plural(said.playlists, "playlist") : ""].filter(Boolean);
    toast(`Brought in ${parts.join(", ")}.${said.missing_audio ? ` ${plural(said.missing_audio, "render")} had no audio in the file, so they stayed out.` : ""}`);
    onDone?.();
  };
  pick.click();
}
