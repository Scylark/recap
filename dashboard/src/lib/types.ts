export interface SessionRow {
  id: string;
  app_id: string;
  started_at: string;
  last_seen_at: string;
  user_id: string | null;
  /** Random install id from the SDK; null for sessions from SDK versions before 0.2. */
  anonymous_id?: string | null;
  platform: string | null;
  os_version: string | null;
  device_model: string | null;
  app_version: string | null;
  locale: string | null;
  screen_width: number | null;
  screen_height: number | null;
  sdk_version: string | null;
  event_count: number;
  tap_count: number;
  screen_count: number;
  first_screen: string | null;
  last_screen: string | null;
  /** Bytes of app replay pictures and web page recording. Missing before the storage and recording limits migrations. */
  replay_bytes?: number;
  dom_bytes?: number;
  /** True when the session has a recording (app replay pictures or a web page recording). */
  has_recording?: boolean;
}

export type EventType = 'screen' | 'tap' | 'scroll' | 'app_state' | 'custom';

export interface EventRow {
  id: number;
  session_id: string;
  type: EventType;
  t_ms: number;
  at: string;
  screen: string | null;
  data: Record<string, unknown>;
}

export interface ScreenStat {
  screen: string;
  views: number;
  taps: number;
  sessions: number;
  exits: number;
}

export interface Member {
  email: string;
  role: 'viewer' | 'admin';
  created_at: string;
}

export interface TapPoint {
  nx: number;
  ny: number;
}
