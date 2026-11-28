// Page recordings with the real rrweb 2.2.2 recorder (under jsdom): what reaches the database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { record } from 'rrweb';
import { RemoteSink, type RemoteConfig, type RemoteRecordingOptions, type RrwebRecord } from '../../src/remote/remote';

const base: RemoteConfig = { appId: 'web-shop', supabase: { url: 'https://x.supabase.co', anonKey: 'sb_publishable_abc' } };
const nav = { sessionId: 's', timestamp: 0, url: '/', viewport: { width: 400, height: 800 }, type: 'navigation', from: '', to: '/', method: 'pushState' } as const;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Record the page with real rrweb, run `act`, and return every recording event that was uploaded. */
async function recorded(
  page: { head?: string; body: string },
  act?: () => void,
  opts: { config?: Partial<RemoteConfig>; recordings?: RemoteRecordingOptions } = {},
): Promise<{ events: unknown[]; json: string; record: ReturnType<typeof vi.fn> }> {
  document.head.innerHTML = page.head ?? '';
  document.body.innerHTML = page.body;
  const bodies: { url: string; payload: { events?: unknown[] } }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    bodies.push({ url, ...JSON.parse(String(init.body)) });
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch;
  const spy = vi.fn(record as unknown as RrwebRecord);
  const sink = new RemoteSink(
    { ...base, ...opts.config, recordings: { record: spy as unknown as RrwebRecord, ...opts.recordings } },
    fetchFn,
  );
  sink.start();
  act?.();
  await tick(10); // rrweb reports mutations from a MutationObserver
  sink.handle(nav);
  await sink.flush();
  sink.stop();
  await tick();
  const events = bodies.filter((b) => b.url.endsWith('recap_dom')).flatMap((b) => b.payload.events ?? []);
  return { events, json: JSON.stringify(events), record: spy };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, '', '/reset-password?token=XYZ123#access_token=HASH456');
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('page addresses inside recordings', () => {
  const page = {
    body: `
      <a href="#main">Skip to content</a>
      <a href="?page=2">Next page</a>
      <a href="/orders?id=987">Order</a>
      <img src="/img/avatar.png?sig=SIGNED1" srcset="/img/a.png?sig=SIGNED2 1x, /img/b.png?sig=SIGNED3 2x">
      <img src="https://cdn.other.test/photo.jpg?w=200">
      <img src="/_next/image?url=%2Fphoto.jpg&w=640&q=75">
      <div style="background: url('/bg.png?sig=SIGNED4')">x</div>
      <form action="?token=XYZ123"></form>
      <svg><use href="#icon"></use></svg>`,
  };

  it('never carry the query or hash of the current page, or of other same-origin addresses', async () => {
    const { json } = await recorded(page, () => {
      const a = document.createElement('a');
      a.href = '#later';
      document.body.appendChild(a);
      document.querySelector('a')!.setAttribute('href', '#changed');
    });
    expect(json).toContain('http://localhost:3000/reset-password');
    for (const secret of ['XYZ123', 'HASH456', 'SIGNED', 'page=2', 'id=987', '#main', '#later', '#changed']) {
      expect(json, secret).not.toContain(secret);
    }
    expect(json).toContain('http://localhost:3000/img/a.png 1x, http://localhost:3000/img/b.png 2x');
    expect(json).toContain('http://localhost:3000/orders"');
  });

  it('leave other sites, in-page SVG references and image-optimiser sizes alone', async () => {
    const { json } = await recorded(page);
    expect(json).toContain('https://cdn.other.test/photo.jpg?w=200');
    expect(json).toContain('"href":"#icon"');
    expect(json).toContain('http://localhost:3000/_next/image?url=%2Fphoto.jpg&w=640&q=75');
  });

  it('keep the query (never the hash) with stripQueryParams: false', async () => {
    const { json } = await recorded(page, undefined, { config: { stripQueryParams: false } });
    expect(json).toContain('http://localhost:3000/reset-password?token=XYZ123');
    expect(json).not.toContain('HASH456');
    expect(json).not.toContain('#main');
  });
});

describe('typing outside form fields', () => {
  it('masks contenteditable regions and role="textbox", in the snapshot and as people type', async () => {
    const { json } = await recorded(
      {
        body: `
          <div contenteditable="true" id="chat">Draft to Sam</div>
          <div contenteditable>Rich text</div>
          <div role="textbox">Custom box</div>
          <div contenteditable="false">Shown as it is</div>`,
      },
      () => {
        document.getElementById('chat')!.textContent = 'my secret message';
      },
    );
    for (const text of ['Draft to Sam', 'Rich text', 'Custom box', 'my secret message', 'secret']) {
      expect(json, text).not.toContain(text);
    }
    expect(json).toContain('Shown as it is');
  });
});

describe('secrets the page itself holds', () => {
  it('masks hidden fields and blanks CSRF token meta tags, also when they change', async () => {
    const { json } = await recorded(
      {
        head: `
          <meta name="csrf-token" content="CSRF_SECRET_1">
          <meta name="csrf-param" content="authenticity_token">
          <meta name="_token" content="LARAVEL_SECRET">
          <meta name="viewport" content="width=device-width">`,
        body: '<form><input type="hidden" name="authenticity_token" value="HIDDEN_SECRET"><input name="q" value="typed"></form>',
      },
      () => {
        document.querySelector('meta[name="csrf-token"]')!.setAttribute('content', 'CSRF_SECRET_2');
        const m = document.createElement('meta');
        m.name = 'x-csrf-token';
        m.content = 'CSRF_SECRET_3';
        document.head.appendChild(m);
      },
    );
    for (const secret of ['CSRF_SECRET', 'LARAVEL_SECRET', 'HIDDEN_SECRET', 'typed']) {
      expect(json, secret).not.toContain(secret);
    }
    expect(json).toContain('"name":"csrf-param","content":""');
    expect(json).toContain('"name":"csrf-token","content":""');
    expect(json).toContain('width=device-width');
  });
});

describe("the site's own selectors", () => {
  const page = { body: '<div data-recap-private>Card 4242</div><p class="ride">Box Hill</p>' };

  it.each([
    ['blockSelector', { blockSelector: '.chat[' }],
    ['maskText', { maskText: 'p:nope(' }],
  ])('an invalid %s stops recording on the page, with an error, instead of dropping the privacy marker', async (_, opt) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { events, record: rec } = await recorded(page, undefined, { recordings: opt });
    expect(rec).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('not a valid CSS selector');
  });

  it('valid ones still record, with the privacy marker left out', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { json } = await recorded(page, undefined, { recordings: { blockSelector: '.chat', maskText: '.ride' } });
    expect(error).not.toHaveBeenCalled();
    expect(json).not.toContain('4242');
    expect(json).not.toContain('Box Hill');
    expect(json).toContain('"type":2');
  });
});
