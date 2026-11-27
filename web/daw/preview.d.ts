// Types for preview.js (plain JS, shared by /daw.html and the song's DAW tab).
export interface DawSong { bpm: number; bars: number; mode?: string; tracks: { name: string; instrument: string; mute?: boolean; solo?: boolean; sample?: unknown; [k: string]: unknown }[]; [k: string]: unknown }
export interface PreviewTrack { name: string; instrument: string; muted: boolean; sampled: boolean; silent: boolean }
export interface PreviewNote { track: number; pitch: number; start: number; length: number; velocity: number; time: number; dur: number; instrument: string; silent: boolean }
export interface Preview { bpm: number; beats: number; seconds: number; low: number; high: number; tracks: PreviewTrack[]; notes: PreviewNote[] }
export function previewOf(song: DawSong): Preview;
export function notesPerTrack(song: DawSong): { pitch: number; start: number; length: number; velocity: number }[][];
export function due(notes: PreviewNote[], from: number, to: number): PreviewNote[];
export function midiOf(song: DawSong): Uint8Array;
export function songFromMidi(bytes: Uint8Array | ArrayBuffer): DawSong;
export function textToSong(text: string): DawSong;
export function songToText(song: DawSong): string;
export function createSynth(ctx: BaseAudioContext): { playNote(n: { instrument: string; pitch: number; time: number; length: number; velocity: number }, dest: AudioNode): unknown };
