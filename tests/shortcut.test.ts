import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub everything that touches IndexedDB, network or the DOM panel so the test
// only exercises the keyboard shortcut path through Recap.init().
const panel = vi.hoisted(() => ({
  openPanel: vi.fn(),
  closePanel: vi.fn(),
  isPanelOpen: vi.fn(() => false),
}));

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
}));
vi.mock('../src/capture/clicks.js', () => ({ initClickCapture: vi.fn(() => () => {}) }));
vi.mock('../src/capture/scroll.js', () => ({
  initScrollCapture: vi.fn(() => () => {}),
  refreshScrollCapture: vi.fn(),
}));
vi.mock('../src/capture/navigation.js', () => ({ initNavigationCapture: vi.fn(() => () => {}) }));
vi.mock('../src/capture/touch-trigger.js', () => ({ initTouchTrigger: vi.fn(() => () => {}) }));

import { Recap } from '../src/index.js';

// Option+Shift+Y on macOS: e.key can be a composed character, so the shortcut must match on e.code (the physical key).
function altShiftY(overrides: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Y',
    code: 'KeyY',
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...overrides,
  });
}

describe('Alt+Shift+Y shortcut', () => {
  beforeEach(() => {
    Recap.init({ showPanel: false });
  });

  afterEach(() => {
    Recap.destroy();
    vi.clearAllMocks();
    panel.isPanelOpen.mockReturnValue(false);
  });

  it('opens the panel on a macOS-style Option+Shift+Y press', async () => {
    document.dispatchEvent(altShiftY());
    await vi.waitFor(() => expect(panel.openPanel).toHaveBeenCalledTimes(1));
  });

  it('still fires when the focused element stops propagation', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.addEventListener('keydown', (e) => e.stopPropagation());

    input.dispatchEvent(altShiftY());
    await vi.waitFor(() => expect(panel.openPanel).toHaveBeenCalledTimes(1));
    input.remove();
  });

  it('ignores auto-repeat so holding the keys does not flicker the panel', async () => {
    document.dispatchEvent(altShiftY());
    document.dispatchEvent(altShiftY({ repeat: true }));
    document.dispatchEvent(altShiftY({ repeat: true }));
    await vi.waitFor(() => expect(panel.openPanel).toHaveBeenCalledTimes(1));
  });

  it('closes the panel when it is already open', async () => {
    panel.isPanelOpen.mockReturnValue(true);
    document.dispatchEvent(altShiftY());
    await vi.waitFor(() => expect(panel.closePanel).toHaveBeenCalledTimes(1));
    expect(panel.openPanel).not.toHaveBeenCalled();
  });

  it('ignores other key combinations', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', bubbles: true }));
    document.dispatchEvent(altShiftY({ shiftKey: false }));
    await new Promise((r) => setTimeout(r, 0));
    expect(panel.openPanel).not.toHaveBeenCalled();
  });
});
