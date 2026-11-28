// Session ID generation — sessionStorage UUID, no cookies, no fingerprinting.

const SESSION_KEY = 'recap-session-id';
const NAME_KEY = 'recap-session-name';

function generateUUID(): string {
  // Use crypto.randomUUID() if available (modern browsers), else fallback
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: manual UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let _sessionId: string | null = null;
/** _sessionId is the one kept in sessionStorage (or storage is unavailable): no need to look again. */
let _kept = false;
/** Whether the id may be written to sessionStorage now. index.ts says no until consent is given. */
let _mayKeep: () => boolean = () => true;
let _sessionName: string | null = null;

/**
 * Decide when the session id may be kept in sessionStorage. Until `mayKeep()` says yes (with
 * requireConsent, before Recap.optIn(); after Recap.optOut()), getSessionId() returns an id for
 * this page only and writes nothing.
 * @internal
 */
export function setSessionKeeping(mayKeep: (() => boolean) | null): void {
  _mayKeep = mayKeep ?? (() => true);
}

export function getSessionId(): string {
  if (_sessionId && _kept) return _sessionId;

  if (!_mayKeep()) {
    // Not allowed to keep anything yet: an id for this page only, never written to storage.
    if (!_sessionId) _sessionId = generateUUID();
    return _sessionId;
  }

  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      _sessionId = stored;
    } else {
      if (!_sessionId) _sessionId = generateUUID();
      sessionStorage.setItem(SESSION_KEY, _sessionId);
    }
  } catch {
    // sessionStorage unavailable (e.g. some private browsing modes)
    // Generate a per-page-load UUID — tracking works, just no cross-page linking
    console.warn('[Recap] sessionStorage unavailable — session ID will reset on each page load');
    if (!_sessionId) _sessionId = generateUUID();
  }
  _kept = true;

  return _sessionId;
}

/**
 * Forget this tab's session id (the visitor opted out): the next getSessionId() makes a new one,
 * so a later opt-in starts a new session instead of continuing the old one.
 */
export function resetSessionId(): void {
  _sessionId = null;
  _kept = false;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage blocked: nothing was kept
  }
}

export function setSessionName(name: string): void {
  _sessionName = name;
  try {
    sessionStorage.setItem(NAME_KEY, name);
  } catch {
    // ignore
  }
}

export function getSessionName(): string | null {
  if (_sessionName) return _sessionName;
  try {
    _sessionName = sessionStorage.getItem(NAME_KEY);
  } catch {
    // ignore
  }
  return _sessionName;
}

export function getTimestamp(): number {
  try {
    return performance.now();
  } catch {
    return Date.now();
  }
}

export function getSessionStart(): number {
  // We store session start as a module-level var so all timestamps are relative to it
  return _sessionStart;
}

const _sessionStart = getTimestamp();
