import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotHandler, webhookSecret, WELCOME, HINT } from '../supabase/functions/kinpass-bot/bot.mjs';

const token = '123456:TEST_ONLY_NOT_A_REAL_BOT_TOKEN';
const miniAppUrl = 'https://example.github.io/kinpass/mini.html';
function setup() {
  const sent = [];
  const handle = createBotHandler({ botToken: token, miniAppUrl, fetcher: async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return new Response('{}'); } });
  return { handle, sent };
}
const update = async (handle, message, secret) => handle(new Request('https://x/kinpass-bot', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret ?? await webhookSecret(token) },
  body: JSON.stringify({ update_id: 1, message }),
}));

test('/start in a private chat answers with a web_app button to the mini app', async () => {
  const { handle, sent } = setup();
  const response = await update(handle, { chat: { id: 42, type: 'private' }, text: '/start' });
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.chat_id, 42);
  assert.equal(sent[0].body.text, WELCOME);
  assert.deepEqual(sent[0].body.reply_markup.inline_keyboard[0][0], { text: 'Открыть Kinpass', web_app: { url: miniAppUrl } });
  assert.match(sent[0].url, /\/sendMessage$/);
});

test('other private messages get a short hint; groups are ignored', async () => {
  const { handle, sent } = setup();
  await update(handle, { chat: { id: 42, type: 'private' }, text: 'привет' });
  await update(handle, { chat: { id: -100, type: 'group' }, text: '/start' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.text, HINT);
});

test('requests without the Telegram webhook secret are rejected and send nothing', async () => {
  const { handle, sent } = setup();
  assert.equal((await update(handle, { chat: { id: 42, type: 'private' }, text: '/start' }, 'forged')).status, 403);
  assert.equal(sent.length, 0);
});
