// The React bindings, with React's hooks and React Native replaced by recorders so they run in Node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  effects: [] as (() => unknown)[],
  layoutEffects: [] as (() => unknown)[],
  keyboard: new Map<string, () => void>(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (fn: () => unknown) => void h.effects.push(fn),
    useLayoutEffect: (fn: () => unknown) => void h.layoutEffects.push(fn),
    useRef: (current: unknown) => ({ current }),
    useCallback: (fn: unknown) => fn,
    useContext: () => undefined,
  };
});

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
  Dimensions: { get: () => ({ width: 400, height: 800 }) },
  Keyboard: {
    addListener: (event: string, cb: () => void) => {
      h.keyboard.set(event, cb);
      return { remove() {} };
    },
  },
  Modal: () => null,
  PixelRatio: { get: () => 1 },
  Platform: { OS: 'ios', Version: '18.0' },
  View: () => null,
}));

import { RecapPrivate, RecapProvider, recap, useRecapPrivate } from '../src/react';

const internals = recap as unknown as { privacyHolds: number; keyboardOpen: boolean };

describe('React bindings', () => {
  beforeEach(() => {
    h.effects.length = 0;
    h.layoutEffects.length = 0;
    h.keyboard.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('RecapPrivate pauses recording in a layout effect, before its content is painted', () => {
    RecapPrivate({ children: null });
    expect(h.effects).toHaveLength(0);
    expect(h.layoutEffects).toHaveLength(1);
    const release = h.layoutEffects[0]!() as () => void;
    expect(internals.privacyHolds).toBe(1);
    release();
    expect(internals.privacyHolds).toBe(0);

    useRecapPrivate(false);
    expect(h.layoutEffects[1]!()).toBeUndefined();
    expect(internals.privacyHolds).toBe(0);
  });

  it('follows the keyboard when only screen pictures are on, so they pause while typing', () => {
    RecapProvider({ config: { appId: 'test', screenshots: true }, captureRef: async () => 'QUJD' });
    const cleanups = h.effects.map((fn) => fn());
    try {
      expect([...h.keyboard.keys()].sort()).toEqual(['keyboardDidHide', 'keyboardWillShow']);
      h.keyboard.get('keyboardWillShow')!();
      expect(internals.keyboardOpen).toBe(true);
      h.keyboard.get('keyboardDidHide')!();
      expect(internals.keyboardOpen).toBe(false);
    } finally {
      for (const c of cleanups) if (typeof c === 'function') c();
    }
  });
});
