import { createClient } from '@supabase/supabase-js';
import type { Deps } from './handlers';

// Lu à chaque requête (pas au build) ; seule la clé publique est utilisée.
// Une variable absente lève dans le try/catch du handler → 502 no-store.
function client() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_ANON_KEY manquante');
  return createClient(url, key, { auth: { persistSession: false } });
}

export const supabaseDeps: Deps = {
  rpc: async (fn, args) => await client().rpc(fn, args),
  select: async (table, columns) => await client().from(table).select(columns),
  now: () => new Date(),
};
