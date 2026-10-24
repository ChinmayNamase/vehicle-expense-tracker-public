// Creates the single data client used by every page. Three possible backends:
//  1. OWN API   – js/config.js has API_CONFIG (the Java Spring Boot server
//                 serves this file): all data goes to our own REST API + database.
//  2. Supabase  – js/config.js has a Supabase URL + publishable key.
//  3. Local     – nothing configured: data is kept in this browser only.
// Every backend offers the same functions, so the rest of the app is unchanged.
import { createLocalClient } from './local-backend.js';
import { createApiClient } from './api-backend.js';

let config = null;
let apiConfig = null;
try {
  ({ SUPABASE_CONFIG: config = null, API_CONFIG: apiConfig = null } = await import('./config.js'));
} catch {
  config = null; // js/config.js has not been created yet
}

const hasSupabaseConfig = Boolean(
  config &&
  /^https:\/\/.+/.test(config.url || '') &&
  config.publishableKey &&
  !config.publishableKey.includes('xxxxxxxx'),
);

/** 'api' (own Java server), 'supabase' or 'local' */
export const backendMode = apiConfig ? 'api' : hasSupabaseConfig ? 'supabase' : 'local';

/** true when running without any server (data saved in this browser only). */
export const isLocalMode = backendMode === 'local';

/** true when using our own Java REST API and database. */
export const isOwnApi = backendMode === 'api';

/** A backend is always available. */
export const isConfigured = true;

async function createSupabaseClient() {
  // Loaded only when Supabase is actually used.
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export const supabase = backendMode === 'api'
  ? createApiClient(apiConfig.baseUrl || '')
  : backendMode === 'supabase'
    ? await createSupabaseClient()
    : createLocalClient();
