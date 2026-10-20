import { createBackend } from './backend.mjs';
import { createHandler } from './handler.mjs';
import { createGemini } from '../_shared/gemini.mjs';

const botToken = Deno.env.get('BOT_TOKEN');
const appOrigin = Deno.env.get('APP_ORIGIN');
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const maxAgeSeconds = Number(Deno.env.get('INIT_DATA_MAX_AGE_SECONDS') || 3600);
const geminiKey = Deno.env.get('GEMINI_API_KEY');
const ai = geminiKey ? createGemini({ apiKey: geminiKey, model: Deno.env.get('GEMINI_MODEL') || undefined }) : null;

if (!botToken || !appOrigin || !supabaseUrl || !serviceKey) {
  throw new Error('Kinpass configuration is incomplete. Set BOT_TOKEN and APP_ORIGIN as Edge Function secrets.');
}
if (new URL(appOrigin).origin !== appOrigin || !appOrigin.startsWith('https://')) {
  throw new Error('APP_ORIGIN must be an HTTPS origin without a path or trailing slash.');
}
if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 60 || maxAgeSeconds > 86400) {
  throw new Error('INIT_DATA_MAX_AGE_SECONDS must be between 60 and 86400.');
}

Deno.serve(createHandler({
  botToken, appOrigin, maxAgeSeconds, ai,
  backend: createBackend({ url: supabaseUrl, serviceKey }),
}));
