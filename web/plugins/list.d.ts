// Types for list.js (plain JS, shared by /plugins.html and the song's Plugins tab).
export interface Plugin { name: string; vendor?: string; kind: string; uses?: number; installed?: boolean | null }
export interface PluginVersion { id: number | string; n?: number; label?: string | null; plugins?: Plugin[]; [key: string]: unknown }
export function withPlugins<V extends { plugins?: unknown }>(versions: V[] | null | undefined): V[];
export function pickVersion<V extends { id: number | string; plugins?: unknown }>(versions: V[] | null | undefined, currentId?: number | string | null, wantedId?: number | string | null): V | null;
export function groups(plugins: Plugin[] | null | undefined): { title: string; items: Plugin[] }[];
export function summary(plugins: Plugin[] | null | undefined): string;
