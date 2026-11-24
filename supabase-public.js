import { loadSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './catalog/catalog-data.js?v=1';

let clientPromise;

export function getPublicSupabase() {
  clientPromise ??= loadSupabase().then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
  ).catch(error => {
    clientPromise = undefined;
    throw error;
  });
  return clientPromise;
}
