import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Demo mode (`npm run demo`): sample data, no database and no sign-in. */
export const isDemo = import.meta.env.VITE_RECAP_DEMO === '1';

export const isConfigured = isDemo || Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isDemo
  ? createClient('https://demo.invalid', 'demo', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => import('../demo/fetch').then((m) => m.demoFetch(input, init)) },
    })
  : isConfigured
    ? // PKCE: a sign-in link only works in the browser that asked for it, so a link carrying someone
      // else's session can't sign you in as them.
      createClient(url!, anonKey!, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } })
    : null;

export function db(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}
