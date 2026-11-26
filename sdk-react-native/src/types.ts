// Recap for React Native: shared types.
// The core has no dependency on React Native, so it can be unit tested in Node.

export type RecapPlatform = 'ios' | 'android' | 'web' | 'windows' | 'macos' | 'other';

export interface DeviceInfo {
  platform: RecapPlatform;
  osVersion: string | null;
  model: string | null;
  appVersion: string | null;
  screenWidth: number;
  screenHeight: number;
  locale: string | null;
}

export type RecapEventType = 'screen' | 'tap' | 'scroll' | 'app_state' | 'custom';

export interface RecapEvent {
  type: RecapEventType;
  /** Milliseconds since the session started. */
  t: number;
  /** Wall clock time, ISO 8601. */
  at: string;
  /** Screen the user was on when the event happened. */
  screen: string | null;
  data: Record<string, unknown>;
}

export interface SessionInfo {
  id: string;
  startedAt: string;
  userId: string | null;
  device: DeviceInfo;
}

export interface IngestBatch {
  appId: string;
  sdkVersion: string;
  session: SessionInfo;
  events: RecapEvent[];
}

/** Where batches go. Supabase and plain HTTP transports are built in; write your own for anything else. */
export interface Transport {
  send(batch: IngestBatch): Promise<void>;
}

/** Async key/value storage. Pass @react-native-async-storage/async-storage, MMKV or similar. */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface RecapConfig {
  /** A short name for this app, e.g. "my-shop-ios". Lets one database hold several apps. */
  appId: string;

  /** Send sessions to the Recap tables in your own Supabase project. */
  supabase?: { url: string; anonKey: string };
  /** Or POST batches as JSON to any endpoint you run. */
  endpoint?: { url: string; headers?: Record<string, string> };
  /** Or supply your own transport. Takes priority over supabase and endpoint. */
  transport?: Transport;

  /** Share of sessions to record, 0 to 1. Default 1 (every session). */
  sampleRate?: number;
  /** When true, nothing is recorded until optIn() is called. Default false. */
  requireConsent?: boolean;
  /** Persists the offline queue and consent choice. Without it the queue lives in memory only. */
  storage?: StorageAdapter;

  /** How often queued events are sent. Default 10 000 ms. */
  flushIntervalMs?: number;
  /** Max events per request. Default 50. */
  maxBatchSize?: number;
  /** Max events kept while offline; oldest are dropped first. Default 1 000. */
  maxQueueSize?: number;
  /** A session ends after this long in the background. Default 30 minutes. */
  sessionTimeoutMs?: number;

  /** Your app's version string, shown in the dashboard. */
  appVersion?: string;
  /** Log what Recap is doing to the console. */
  debug?: boolean;
}

export interface TapInput {
  x: number;
  y: number;
  label?: string | null;
}
