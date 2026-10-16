/* Initialize Supabase client
 * IMPORTANT: This file contains your publishable anon key. Keep it public-only.
 */
const SUPABASE_URL = "https://xdtbkcakuqbxzrqmeyhh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JdXY56-qgLduVs6BHSnytg_-ftCIBam";

// The CDN build exposes a global `supabase` factory. Create a client and export it.
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export { _supabase as supabase };
