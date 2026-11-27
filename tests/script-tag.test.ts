import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoInit, findRecapScript, isRecapScript, readScriptConfig, rrwebNextTo } from '../src/script-tag';
import { Recap } from '../src/index';
import { getLabelMode } from '../src/privacy/sanitize';
import { setDefaultRrwebSrc } from '../src/remote/remote';

function tag(src: string | null, data: Record<string, string> = {}): HTMLScriptElement {
  const s = document.createElement('script');
  if (src) s.setAttribute('src', src);
  for (const [k, v] of Object.entries(data)) s.dataset[k] = v;
  return s;
}

afterEach(() => {
  Recap.destroy();
  document.head.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setDefaultRrwebSrc(null);
  sessionStorage.clear();
});

describe("finding Recap's script tag", () => {
  it("doesn't mistake Google's reCAPTCHA (or other scripts with 'recap' in the name) for Recap", () => {
    expect(isRecapScript(tag('https://www.gstatic.com/recaptcha/releases/abc/recaptcha__en.js'))).toBe(false);
    expect(isRecapScript(tag('https://www.google.com/recaptcha/api.js'))).toBe(false);
    expect(isRecapScript(tag('/js/recap_analytics.js'))).toBe(false);
  });

  it("recognises Recap's own files, the package on a CDN, and data-recap", () => {
    expect(isRecapScript(tag('/src/vendor/recap/recap.min.js'))).toBe(true);
    expect(isRecapScript(tag('/vendor/recap.min.js?v=3'))).toBe(true);
    expect(isRecapScript(tag('https://cdn.jsdelivr.net/npm/recap-ux@1.2.0/dist/recap.min.js'))).toBe(true);
    expect(isRecapScript(tag('https://unpkg.com/recap-ux@1.2.0'))).toBe(true);
    expect(isRecapScript(tag('/assets/analytics.3f2a.js', { recap: '' }))).toBe(true);
  });

  it('picks the Recap tag even when reCAPTCHA comes first', () => {
    document.head.append(tag('https://www.gstatic.com/recaptcha/releases/abc/recaptcha__en.js'), tag('/recap.min.js', { appId: 'mine' }));
    expect(findRecapScript()?.dataset['appId']).toBe('mine');
  });

  it('finds nothing on a page without Recap', () => {
    document.head.append(tag('https://www.google.com/recaptcha/api.js'));
    expect(findRecapScript()).toBeNull();
  });
});

describe('script tag settings', () => {
  it('reads the panel, label, consent and recording settings', () => {
    const config = readScriptConfig(
      tag('/recap.min.js', {
        panel: 'false',
        shortcut: 'false',
        labels: 'attributes',
        requireConsent: 'true',
        recordings: 'true',
        maskText: 'true',
        supabaseUrl: 'https://x.supabase.co',
        supabaseKey: 'sb_publishable_x',
      }),
    );
    expect(config).toMatchObject({
      panel: false,
      shortcut: false,
      labels: 'attributes',
      requireConsent: true,
      recordings: { maskText: true },
      supabase: { url: 'https://x.supabase.co', anonKey: 'sb_publishable_x' },
    });
    expect(readScriptConfig(tag('/recap.min.js', { recordings: 'true', maskText: '.ride' })).recordings).toEqual({ maskText: '.ride' });
    expect(readScriptConfig(tag('/recap.min.js', { labels: 'everything' })).labels).toBeUndefined();
  });

  it('starts Recap with the tag settings', () => {
    document.head.append(tag('/recap.min.js', { labels: 'none', touchTrigger: 'false' }));
    autoInit();
    expect(Recap.isRecording()).toBe(true);
    expect(getLabelMode()).toBe('none');
  });

  it('with data-auto-init="false", waits for the page to call init(), then uses the tag settings under it', () => {
    document.head.append(tag('/recap.min.js', { autoInit: 'false', labels: 'none', touchTrigger: 'false' }));
    autoInit();
    expect(Recap.isRecording()).toBe(false);
    Recap.init({ screenName: (p) => p });
    expect(Recap.isRecording()).toBe(true);
    expect(getLabelMode()).toBe('none');
  });
});

describe('live-site attributes', () => {
  it('reads the gate settings', () => {
    const config = readScriptConfig(
      tag('/recap.min.js', {
        hosts: 'example.com, *.example.com ,',
        excludePaths: '/account,/admin',
        respectGpc: 'false',
        allowInFrames: '',
        panel: 'true',
      }),
    );
    expect(config).toMatchObject({
      hosts: ['example.com', '*.example.com'],
      excludePaths: ['/account', '/admin'],
      respectGPC: false,
      allowInFrames: true,
      panel: true,
    });
    expect(readScriptConfig(tag('/recap.min.js', { allowInFrames: 'false', respectGpc: 'true' }))).toMatchObject({
      allowInFrames: false,
      respectGPC: true,
    });
    const none = readScriptConfig(tag('/recap.min.js'));
    for (const k of ['hosts', 'excludePaths', 'respectGPC', 'allowInFrames', 'panel']) expect(none).not.toHaveProperty(k);
  });

  it('reads the recording settings', () => {
    const config = readScriptConfig(
      tag('/recap.min.js', {
        recordings: 'true',
        recordSample: '0.25',
        recordCanvas: '',
        recordingsSrc: 'https://cdn.example.test/recap-rrweb.min.js',
        recordingsIntegrity: 'sha384-abc',
      }),
    );
    expect(config.recordings).toEqual({
      sampleRate: 0.25,
      canvas: true,
      src: 'https://cdn.example.test/recap-rrweb.min.js',
      integrity: 'sha384-abc',
    });
    const rec = (d: Record<string, string>) => readScriptConfig(tag('/recap.min.js', { recordings: 'true', ...d })).recordings;
    expect(rec({ recordSample: '7' })).toEqual({ sampleRate: 1 });
    expect(rec({ recordSample: '-1' })).toEqual({ sampleRate: 0 });
    expect(rec({ recordSample: 'lots' })).toBe(true);
    expect(rec({ recordCanvas: '4' })).toEqual({ canvas: 4 });
    expect(rec({ recordCanvas: 'false' })).toBe(true);
    // The recording attributes only count with data-recordings="true".
    expect(readScriptConfig(tag('/recap.min.js', { recordSample: '0.5' })).recordings).toBeUndefined();
  });
});

describe("rrweb's recorder next to the script", () => {
  it('is in the same folder as recap.min.js', () => {
    expect(rrwebNextTo(tag('https://cdn.jsdelivr.net/gh/Scylark/recap@v1.3.0/dist/recap.min.js'))).toBe(
      'https://cdn.jsdelivr.net/gh/Scylark/recap@v1.3.0/dist/recap-rrweb.min.js',
    );
    expect(rrwebNextTo(tag('/vendor/recap.min.js?v=3'))).toBe(`${location.origin}/vendor/recap-rrweb.min.js`);
  });

  it("is in the package's dist folder when the tag loads the package root", () => {
    expect(rrwebNextTo(tag('https://unpkg.com/recap-ux@1.3.0'))).toBe('https://unpkg.com/recap-ux@1.3.0/dist/recap-rrweb.min.js');
  });

  it('is unknown for an inline script', () => {
    expect(rrwebNextTo(tag(null))).toBeNull();
    expect(rrwebNextTo(null)).toBeNull();
  });

  it('is loaded from there for a tab sampled in, with nothing but data-recordings="true"', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 }) as Response));
    document.head.append(
      tag('https://cdn.jsdelivr.net/gh/Scylark/recap@v1.3.0/dist/recap.min.js', {
        supabaseUrl: 'https://x.supabase.co',
        supabaseKey: 'sb_publishable_x',
        recordings: 'true',
      }),
    );
    autoInit();
    expect(Recap.status().reason).toBe('running');
    const loaded = Array.from(document.querySelectorAll('script')).map((s) => s.src);
    expect(loaded).toContain('https://cdn.jsdelivr.net/gh/Scylark/recap@v1.3.0/dist/recap-rrweb.min.js');
  });

  it('is not loaded when the tag sets data-record-sample="0"', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 }) as Response));
    document.head.append(
      tag('https://cdn.jsdelivr.net/gh/Scylark/recap@v1.3.1/dist/recap.min.js', {
        supabaseUrl: 'https://x.supabase.co',
        supabaseKey: 'sb_publishable_x',
        recordings: 'true',
        recordSample: '0',
      }),
    );
    autoInit();
    expect(Array.from(document.querySelectorAll('script')).filter((s) => s.src.includes('recap-rrweb'))).toHaveLength(0);
  });

  it('data-hosts keeps the tag from starting anywhere else', () => {
    document.head.append(tag('/recap.min.js', { hosts: 'example.com' }));
    autoInit();
    expect(Recap.status().reason).toBe('host-not-listed');
  });
});
