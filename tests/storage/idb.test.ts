import { afterEach, describe, expect, it, vi } from 'vitest';

/** Just enough IndexedDB to open the database, save into it and delete it. */
function fakeIndexedDB() {
  const db = {
    close: vi.fn(),
    onversionchange: null as null | (() => void),
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx: { objectStore: () => { add: () => void }; oncomplete?: () => void } = {
        objectStore: () => ({ add: () => undefined }),
      };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  const deleted: string[] = [];
  const idb = {
    open: () => {
      const req: { onsuccess?: (e: unknown) => void } = {};
      setTimeout(() => req.onsuccess?.({ target: { result: db } }), 0);
      return req;
    },
    deleteDatabase: (name: string) => {
      deleted.push(name);
      const req: { onsuccess?: () => void } = {};
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  };
  return { db, idb, deleted };
}

const event = { sessionId: 's', timestamp: 1, type: 'scroll', url: '/', viewport: { width: 1, height: 1 }, depth: 1, maxDepth: 1 };

describe('local storage of events (IndexedDB)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('closes its own connection before deleting the database, so the delete is not blocked', async () => {
    const { db, idb, deleted } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', idb);
    const store = await import('../../src/storage/idb');
    await store.saveEvents([event as never]);
    await store.deleteLocalData();
    expect(db.close).toHaveBeenCalled();
    expect(deleted).toEqual(['recap-sessions']);
  });

  it('lets another tab delete or upgrade the database', async () => {
    const { db, idb } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', idb);
    const store = await import('../../src/storage/idb');
    await store.saveEvents([event as never]);
    expect(db.onversionchange).toBeTypeOf('function');
    db.onversionchange!();
    expect(db.close).toHaveBeenCalled();
  });

  it('waits for an open in progress instead of racing it', async () => {
    const { db, idb, deleted } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', idb);
    const store = await import('../../src/storage/idb');
    const saving = store.saveEvents([event as never]); // opens the database
    await store.deleteLocalData();
    await saving;
    expect(db.close).toHaveBeenCalled();
    expect(deleted).toEqual(['recap-sessions']);
  });
});
