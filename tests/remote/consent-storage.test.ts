// With requireConsent, IndexedDB (the copy Recap keeps in this browser) isn't opened before opt-in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/storage/idb.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/storage/idb.js')>();
  return {
    ...real,
    purgeOldSessions: vi.fn(async () => undefined),
    saveEvents: vi.fn(async () => undefined),
    deleteLocalData: vi.fn(async () => undefined),
  };
});

import { Recap } from '../../src/index';
import { purgeOldSessions, saveEvents } from '../../src/storage/idb.js';

describe('IndexedDB and consent', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(purgeOldSessions).mockClear();
    vi.mocked(saveEvents).mockClear();
    document.body.innerHTML = '<button id="b">Go</button>';
  });

  afterEach(() => Recap.destroy());

  it('with requireConsent, is not touched until optIn()', async () => {
    Recap.init({ requireConsent: true, panel: false });
    (document.getElementById('b') as HTMLElement).click();
    await Recap.flush();
    expect(purgeOldSessions).not.toHaveBeenCalled();
    expect(saveEvents).not.toHaveBeenCalled();

    Recap.optIn();
    (document.getElementById('b') as HTMLElement).click();
    await Recap.flush();
    expect(purgeOldSessions).toHaveBeenCalledTimes(1);
    expect(saveEvents).toHaveBeenCalled();
  });

  it('without requireConsent, old sessions are purged at start as before', () => {
    Recap.init({ panel: false });
    expect(purgeOldSessions).toHaveBeenCalledTimes(1);
  });
});
