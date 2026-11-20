/* What the settings routes send. Kept beside the screen that reads them: nothing else in
 * the app asks for any of these. */

export interface Person {
  id: number;
  handle: string;
  name: string;
  is_owner?: boolean;
  created_at?: number;
}

export interface Invite {
  id: number;
  note?: string;
  created_at?: number;
  expires_at?: number;
  used?: boolean;
  expired?: boolean;
  used_by_handle?: string;
}

export interface MachineToken {
  id: number;
  name?: string | null;
  scope?: string;
  created_at?: number;
  last_used?: number | null;
}

export interface GoogleAccount {
  id: string;
  name: string;
  channel?: string | null;
  has_avatar?: boolean;
  connected_at?: number;
}
export interface GoogleState { accounts: GoogleAccount[]; chosen: string | null; connected?: boolean }

export interface Release {
  version: string;
  date?: string;
  name?: string;
  title?: string;
  notes?: string[];
}

export interface UpdateCheck {
  checked?: boolean;
  local?: string;
  remote?: string;
  message?: string;
  date?: string;
  update_available?: boolean;
  can_update?: boolean;
  dirty?: boolean;
  why?: string;
  repo?: string;
  branch?: string;
}

export interface Health {
  ok: boolean;
  uptime?: number;
  degraded?: string[];
  problems?: number;
}

export interface Problem {
  ref: string;
  at: number;
  where?: string;
  method?: string;
  kind?: string;
  message?: string;
  traceback?: string;
}

export interface FontInfo {
  custom_font?: boolean;
  font_name?: string;
  font_format?: string;
  uploaded_at?: number;
}

export interface ErasePlan {
  library: string;
  goes: { path: string; bytes: number; how: string }[];
}

export interface FfmpegState {
  found: boolean;
  path?: string;
  version?: string;
  why?: string;
  can_install?: boolean;
  install_why?: string;
  install_size?: number;
  install_version?: string;
}
