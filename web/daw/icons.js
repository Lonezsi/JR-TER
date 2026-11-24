// icons.js: the DAW's one icon set. Drawn, not typed: a text glyph sits at a height that changes
// with the font, a stroke in a viewBox is where its coordinates say.
//
//   icon(name, size = 16) -> "<svg ...>" (aria-hidden; the button around it carries the label)
//
// The paths are JR!TER's own (ui/src/ui/Icon.svelte on the rebuild branch): a 24 grid, 1.8 stroke,
// round caps. A value starting with "f:" is filled instead of stroked. The few the app has no
// icon for (roll, code, eraser, pointer, help, folder-plus) are drawn on the same grid. Add new
// ones here; never inline a one-off SVG or a text symbol in a view.
const PATHS = {
  play: "f:M8 5.2v13.6a.8.8 0 0 0 1.2.7l11.2-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z",
  stop: "f:M7.5 6h9A1.5 1.5 0 0 1 18 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 16.5v-9A1.5 1.5 0 0 1 7.5 6z",
  repeat: "M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1",
  library: "M5 4.5v15M9.5 4.5v15M14 5.5l4.5 13.5",
  timeline: "M3.5 6.5h7v4h-7zM12.5 6.5h8v4h-8zM3.5 13.5h4v4h-4zM9.5 13.5h11v4h-11z",
  songs: "M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
  grid: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  eq: "M5 4v6M5 14v6M12 4v2M12 10v10M19 4v9M19 17v3M3 12h4M10 8h4M17 15h4",
  folder: "M3.5 7a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z",
  "folder-plus": "M3.5 7a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM12 10.5v5M9.5 13h5",
  wave: "M3 12h1.5M7 8v8M10.5 4.5v15M14 7.5v9M17.5 10v4M21 12h-1",
  mic: "M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21",
  album: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  edit: "M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5zM14.5 6l3 3",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 11.6a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7M10 11v5.5M14 11v5.5",
  plus: "M12 5.6v12.8M5.6 12h12.8",
  minus: "M5.6 12h12.8",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  check: "M5 12.5l4.5 4.5L19 7.5",
  more: "f:M6 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM18 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z",
  undo: "M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H9M4.5 9.5L8.5 5.5M4.5 9.5l4 4",
  upload: "M12 15V4M7.5 8.5L12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  download: "M12 4v11M7.5 10.5L12 15l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  doc: "M7 3.5h7l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM14 3.5V8h4.5M8.5 12.5h7M8.5 16h7",
  drag: "f:M9 5.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM15 5.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM9 10.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM15 10.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM9 16a1.4 1.4 0 1 0 0 2.8A1.4 1.4 0 0 0 9 16zM15 16a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z",
  "chev-left": "M14.5 6l-6 6 6 6",
  "chev-right": "M9.5 6l6 6-6 6",
  "zoom-in": "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16 16l4.5 4.5M8.2 11h5.6M11 8.2v5.6",
  "zoom-out": "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16 16l4.5 4.5M8.2 11h5.6",
  sidebar: "M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM9.5 4.5v15",
  // Drawn here, on the same grid:
  roll: "M3.5 5h17M3.5 19h17M5 9h6M10 12.5h7M14 16h5",
  code: "M8.5 7l-5 5 5 5M15.5 7l5 5-5 5M13.5 5l-3 14",
  eraser: "M8.5 19.5h11M4.8 14.8l9-9a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8l-7.7 7.7a2 2 0 0 1-1.4.6H9.4a2 2 0 0 1-1.4-.6l-3.2-3.2a.6.6 0 0 1 0-.9zM9.5 10l5.5 5.5",
  pointer: "M6 3.5l12.5 7.2-5.6 1.4 3.4 6.4-2.4 1.3-3.4-6.4L6 17.5z",
  help: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9.6 9.4a2.5 2.5 0 0 1 4.8 1c0 1.8-2.4 2.2-2.4 3.8M12 17.2h.01",
};

export function icon(name, size = 16) {
  const raw = PATHS[name] || PATHS.help, filled = raw.startsWith("f:");
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" ` +
    (filled ? `fill="currentColor" stroke="none"` : `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`) +
    `><path d="${filled ? raw.slice(2) : raw}"/></svg>`;
}
