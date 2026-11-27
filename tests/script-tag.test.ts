import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoInit, findRecapScript, isRecapScript, readScriptConfig } from '../src/script-tag';
import { Recap } from '../src/index';
import { getLabelMode } from '../src/privacy/sanitize';

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
