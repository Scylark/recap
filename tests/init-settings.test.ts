import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub everything that touches IndexedDB, network or the DOM panel, so these tests only exercise
// what Recap.init() switches on and off.
const panel = vi.hoisted(() => ({
  openPanel: vi.fn(async () => {}),
  closePanel: vi.fn(),
  isPanelOpen: vi.fn(() => false),
}));
const touch = vi.hoisted(() => ({ stop: vi.fn(), initTouchTrigger: vi.fn() }));
const clicks = vi.hoisted(() => ({ initClickCapture: vi.fn(() => () => {}) }));

vi.mock('../src/viz/panel.js', () => panel);
vi.mock('../src/storage/idb.js', () => ({
  saveEvents: vi.fn(async () => {}),
  purgeOldSessions: vi.fn(async () => {}),
}));
vi.mock('../src/storage/beacon.js', () => ({
  setEndpoint: vi.fn(),
  sendBeaconBatch: vi.fn(async () => {}),
  hasEndpoint: vi.fn(() => false),
}));
vi.mock('../src/storage/buffer.js', () => ({
  initBuffer: vi.fn(() => () => {}),
  flush: vi.fn(async () => {}),
  push: vi.fn(),
  getBuffer: vi.fn(() => []),
  clearBuffer: vi.fn(),
}));
vi.mock('../src/capture/clicks.js', () => clicks);
vi.mock('../src/capture/scroll.js', () => ({
  initScrollCapture: vi.fn(() => () => {}),
  refreshScrollCapture: vi.fn(),
}));
vi.mock('../src/capture/navigation.js', () => ({
  initNavigationCapture: vi.fn(() => () => {}),
  emitCurrentPage: vi.fn(),
}));
vi.mock('../src/capture/touch-trigger.js', () => ({
  initTouchTrigger: touch.initTouchTrigger.mockImplementation(() => touch.stop),
}));

import { Recap } from '../src/index.js';
import { getLabelMode } from '../src/privacy/sanitize.js';

function altShiftY(): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Y', code: 'KeyY', altKey: true, shiftKey: true, bubbles: true, cancelable: true });
}
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  Recap.destroy();
  vi.clearAllMocks();
  touch.initTouchTrigger.mockImplementation(() => touch.stop);
  panel.isPanelOpen.mockReturnValue(false);
});

describe('importing recap-ux', () => {
  it('starts nothing until init()', async () => {
    expect(Recap.isRecording()).toBe(false);
    expect(clicks.initClickCapture).not.toHaveBeenCalled();
    expect(touch.initTouchTrigger).not.toHaveBeenCalled();
    window.dispatchEvent(altShiftY());
    await flushMicrotasks();
    expect(panel.openPanel).not.toHaveBeenCalled();
  });
});

describe('panel: false', () => {
  it('turns off the shortcut, the touch-hold and showPanel', async () => {
    Recap.init({ panel: false, showPanel: true });
    expect(touch.initTouchTrigger).not.toHaveBeenCalled();
    window.dispatchEvent(altShiftY());
    await flushMicrotasks();
    expect(panel.openPanel).not.toHaveBeenCalled();
  });

  it('can be applied by a later init(), after the panel was on', async () => {
    Recap.init({});
    expect(touch.initTouchTrigger).toHaveBeenCalledTimes(1);
    Recap.init({ panel: false });
    expect(touch.stop).toHaveBeenCalled();
    window.dispatchEvent(altShiftY());
    await flushMicrotasks();
    expect(panel.openPanel).not.toHaveBeenCalled();
    expect(clicks.initClickCapture).toHaveBeenCalledTimes(1); // capture isn't started twice
  });

  it('closes the panel if it is open', () => {
    Recap.init({});
    panel.isPanelOpen.mockReturnValue(true);
    Recap.init({ panel: false });
    expect(panel.closePanel).toHaveBeenCalled();
  });
});

describe('shortcut: false', () => {
  it('turns off only the keyboard shortcut', async () => {
    Recap.init({ shortcut: false });
    expect(touch.initTouchTrigger).toHaveBeenCalledTimes(1);
    window.dispatchEvent(altShiftY());
    await flushMicrotasks();
    expect(panel.openPanel).not.toHaveBeenCalled();
  });
});

describe('later init() calls', () => {
  it('keep earlier settings they do not mention', async () => {
    Recap.init({ panel: false });
    Recap.init({ labels: 'none' });
    expect(touch.initTouchTrigger).not.toHaveBeenCalled();
    expect(getLabelMode()).toBe('none');
  });

  it('open the panel only when they ask', async () => {
    Recap.init({ showPanel: true });
    await flushMicrotasks();
    expect(panel.openPanel).toHaveBeenCalledTimes(1);
    Recap.init({ labels: 'text' });
    await flushMicrotasks();
    expect(panel.openPanel).toHaveBeenCalledTimes(1);
  });
});

describe('default label source', () => {
  it("is 'text' in the browser and 'attributes' once sending to a dashboard", () => {
    Recap.init({});
    expect(getLabelMode()).toBe('text');
    Recap.connect({ appId: 'x', endpoint: { url: 'https://example.test/recap' }, sampleRate: 0 });
    expect(getLabelMode()).toBe('attributes');
  });

  it('follows the labels setting when given', () => {
    Recap.init({ labels: 'text', supabase: { url: 'https://x.supabase.co', anonKey: 'sb_publishable_x' }, remote: { appId: 'x', supabase: { url: 'https://x.supabase.co', anonKey: 'k' }, sampleRate: 0 } });
    expect(getLabelMode()).toBe('text');
  });
});
