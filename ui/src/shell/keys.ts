/* The keyboard, in one table.
 *
 * The same table draws the shortcuts sheet (press ?) and documents what is bound, so the
 * list a person reads cannot drift from what the keys do. Keys that belong to one screen
 * (the lyric deck's arrows, the compositor's Backspace) are bound by that screen and
 * listed here so the sheet is complete.
 */
export interface KeyDoc { keys: string[]; what: string; where?: string }

export const KEYS: { group: string; rows: KeyDoc[] }[] = [
  { group: "Anywhere", rows: [
    { keys: ["Ctrl", "K"], what: "search everything, run any command" },
    { keys: ["/"], what: "the same, one key" },
    { keys: ["?"], what: "show this" },
    { keys: ["Esc"], what: "close whatever is open" },
    { keys: ["["], what: "put the sidebar away, or bring it back" },
    { keys: ["G", "L"], what: "go to the library" },
    { keys: ["G", "I"], what: "go to the inbox" },
    { keys: ["G", "S"], what: "go to settings" },
    { keys: ["G", "P"], what: "go to the song that is playing" },
    { keys: ["N"], what: "new song" },
  ] },
  { group: "Moving around", rows: [
    { keys: ["J", "K"], what: "down and up a list" },
    { keys: ["L"], what: "open the row you're on (Enter too)" },
    { keys: ["H"], what: "up a level (or back)" },
    { keys: ["G", "G"], what: "to the top" },
    { keys: ["Shift", "G"], what: "to the bottom" },
  ] },
  { group: "Player", rows: [
    { keys: ["Space"], what: "play or pause" },
    { keys: ["X"], what: "swap A and B" },
    { keys: ["Shift", "←", "→"], what: "previous or next song" },
    { keys: ["←", "→"], what: "back or forward five seconds" },
    { keys: ["0", "…", "9"], what: "jump to that tenth of the song" },
    { keys: ["M"], what: "mute" },
    { keys: ["Q"], what: "the queue, and what is in A and B" },
    { keys: ["R"], what: "repeat: off, this one, the whole list" },
  ] },
  { group: "On a song", rows: [
    { keys: ["1", "…", "5"], what: "switch tab (with Alt)", where: "song" },
    { keys: ["←", "→"], what: "page between sets of lyrics, when the deck has focus", where: "song" },
    { keys: ["Backspace"], what: "remove the selected section, in the timeline", where: "song" },
  ] },
  { group: "In a list", rows: [
    { keys: ["↑", "↓"], what: "move through the rows" },
    { keys: ["↵"], what: "open" },
    { keys: ["Space"], what: "play the row" },
    { keys: ["Menu"], what: "the row's menu (also right click, or Shift+F10)" },
  ] },
];
