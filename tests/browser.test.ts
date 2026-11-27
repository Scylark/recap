import { afterEach, describe, expect, it } from 'vitest';
import { Recap, summarize } from '../src/index';

afterEach(() => {
  Recap.destroy();
});

describe('window.Recap in the script-tag build', () => {
  it('is the API itself, with the module exports still on it', async () => {
    const { default: api } = await import('../src/browser');
    // What a page calls: Recap.init(), Recap.optIn(), Recap.status() …
    for (const name of Object.keys(Recap) as Array<keyof typeof Recap>) expect(api[name]).toBe(Recap[name]);
    expect(api.status()).toMatchObject({ running: true, reason: 'running' }); // importing it started Recap
    // … and what code written for the module namespace used.
    expect(api.Recap).toBe(Recap);
    expect(api.default).toBe(Recap);
    expect(api.summarize).toBe(summarize);
  });
});
