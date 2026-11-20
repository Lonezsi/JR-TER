/* The shapes the server sends. Loose where the server is loose: a module that is
 * switched off simply leaves its fields out, so most of them are optional. */

export interface Settings {
  library_name: string;
  accent: string;
  adaptive: boolean;
  artwork_ground: boolean;
  /** How the Words tab shows rhymes (Settings, per account). */
  lyrics_view?: { marks: boolean; highlight: boolean; structure: boolean; warnings: boolean; spellcheck: boolean };
  auto_update: boolean;
  sync_interval_minutes: number;
  dust: number;
  glass_edge: number;
  dither: number;
  ffmpeg_path: string;
  [key: string]: unknown;
}

export interface ServerState {
  name: string;
  version: string;
  modules: string[];
  failed: Record<string, string>;
  settings: Settings;
  summary: {
    auth?: { who?: { id?: number; name?: string; handle?: string } | null; is_owner?: boolean; [k: string]: unknown };
    appearance?: { custom_font?: boolean; font_format?: string; uploaded_at?: number };
    updater?: { commit?: string; [k: string]: unknown };
    [module: string]: any;
  };
}

export interface Song {
  id: number;
  title: string;
  created_at?: number;
  updated_at?: number;
  version_count?: number;
  latest_version?: number;
  latest_version_id?: number | null;
  duration?: number;
  artwork_id?: number | null;
  /** A ready cover address, for a song that is not in this library (a share). */
  art?: string | null;
  kind?: "song" | "render";
  [key: string]: unknown;
}

export interface Version {
  id: number | string;
  n?: number;
  song_id?: number;
  duration?: number;
  label?: string | null;
  note?: string | null;
  filename?: string;
  size?: number;
  created_at?: number;
  kind?: "version" | "render";
  /** Its own address, when the server decides which file a share means. */
  url?: string | null;
  [key: string]: unknown;
}

export interface Band {
  id: string | number;
  type: BiquadFilterType;
  freq: number;
  gain: number;
  q: number;
  on: boolean;
}

export interface LimiterSettings {
  on: boolean;
  threshold?: number;
  ceiling?: number;
  release?: number;
  attack?: number;
}

/** An effect in a preset's rack (lib/audio/rack). Its numbers sit beside these, by key. */
export type UnitKind = "eq" | "comp" | "drive" | "delay" | "reverb" | "width" | "gain" | "limiter";
export interface RackUnit {
  id: string;
  kind: UnitKind;
  on: boolean;
  [key: string]: unknown;
}

export interface SoundData {
  bands: Band[];
  limiter: LimiterSettings;
  gain: number;
  bypass: boolean;
  /** The effects, in order. Absent on a preset from before the rack, which is read as
   *  its equaliser and its limiter (rackOf). */
  rack?: RackUnit[];
  /** 2 once the limiter and the output gain live in the rack as effects of their own;
   *  `limiter` and `gain` above are then left neutral. */
  rack_v?: number;
}

export interface Preset {
  id: number;
  name: string;
  is_current?: boolean;
  data: SoundData;
  [key: string]: unknown;
}

export interface Render {
  id: number;
  name?: string;
  filename?: string;
  duration?: number;
  size?: number;
  created_at?: number;
  shape?: number[];
  trouble?: string | null;
  song_id?: number | null;
  url?: string | null;
  art?: string | null;
  kind?: "render";
  [key: string]: unknown;
}

export interface Album {
  id: number;
  title: string;
  year?: number | null;
  has_cover?: boolean;
  song_count?: number;
  songs?: Song[];
  [key: string]: unknown;
}

export interface Playlist {
  id: number;
  title: string;
  count?: number;
  album_id?: number | null;
  /** Its first songs' covers, drawn fanned out behind it (PlaylistArt). */
  behind?: { title: string; artwork_id: number | null }[];
  [key: string]: unknown;
}
