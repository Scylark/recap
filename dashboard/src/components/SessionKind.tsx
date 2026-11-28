// Small icons for the Sessions list: what kind of visit it was, and whether it has a recording.
import type { SessionRow } from '../lib/types';

const SVG = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 } as const;

export function WebIcon() {
  return (
    <svg {...SVG} aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M1.75 5.75h12.5" />
      <circle cx="3.9" cy="4.25" r="0.4" fill="currentColor" stroke="none" />
      <circle cx="5.4" cy="4.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <svg {...SVG} aria-hidden="true">
      <rect x="4.25" y="1.25" width="7.5" height="13.5" rx="1.75" />
      <path d="M7 12.25h2" />
    </svg>
  );
}

export function RecordingIcon() {
  return (
    <svg {...SVG} stroke="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M6.5 5.2v5.6L11 8z" fill="var(--panel)" />
    </svg>
  );
}

export function kindLabel(platform: string | null): string {
  if (platform === 'web') return 'Web visit';
  if (platform === 'ios') return 'iOS app session';
  if (platform === 'android') return 'Android app session';
  return 'App session';
}

export function recordingLabel(platform: string | null): string {
  return platform === 'web' ? 'Has a page recording' : 'Has a screen recording';
}

/** The two icons for one row. `known` is false on databases that can't tell which sessions are recorded yet. */
export function SessionKind({ session, known = true }: { session: SessionRow; known?: boolean }) {
  const kind = kindLabel(session.platform);
  const recorded = known && !!session.has_recording;
  return (
    <span className="session-kind" aria-label={recorded ? `${kind}, ${recordingLabel(session.platform).toLowerCase()}` : kind}>
      <span className="kind-icon" title={kind}>
        {session.platform === 'web' ? <WebIcon /> : <PhoneIcon />}
      </span>
      <span className={recorded ? 'rec-icon' : 'rec-icon none'} title={recorded ? recordingLabel(session.platform) : 'No recording'}>
        {recorded ? <RecordingIcon /> : null}
      </span>
    </span>
  );
}
