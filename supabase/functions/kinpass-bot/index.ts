import { createBotHandler } from './bot.mjs';
import { createBackend } from '../kinpass-api/backend.mjs';
import { createGemini } from '../_shared/gemini.mjs';

const botToken = Deno.env.get('BOT_TOKEN');
const miniAppUrl = Deno.env.get('MINI_APP_URL');
if (!botToken || !miniAppUrl || !miniAppUrl.startsWith('https://')) {
  throw new Error('Set BOT_TOKEN and MINI_APP_URL as Edge Function secrets.');
}
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const geminiKey = Deno.env.get('GEMINI_API_KEY');

Deno.serve(createBotHandler({
  botToken, miniAppUrl,
  backend: supabaseUrl && serviceKey ? createBackend({ url: supabaseUrl, serviceKey }) : null,
  ai: geminiKey ? createGemini({ apiKey: geminiKey, model: Deno.env.get('GEMINI_MODEL') || undefined }) : null,
}));
