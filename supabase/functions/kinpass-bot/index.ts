import { createBotHandler } from './bot.mjs';

const botToken = Deno.env.get('BOT_TOKEN');
const miniAppUrl = Deno.env.get('MINI_APP_URL');
if (!botToken || !miniAppUrl || !miniAppUrl.startsWith('https://')) {
  throw new Error('Set BOT_TOKEN and MINI_APP_URL as Edge Function secrets.');
}

Deno.serve(createBotHandler({ botToken, miniAppUrl }));
