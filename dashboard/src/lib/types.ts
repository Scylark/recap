export interface SessionRow {
  id: string;
  app_id: string;
  started_at: string;
  last_seen_at: string;
  user_id: string | null;
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
