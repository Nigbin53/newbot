import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotHandler, webhookSecret, formatAnswer, WELCOME, WELCOME_AI, HINT, LIMIT, FAILED, AI_DAILY_LIMIT } from '../supabase/functions/kinpass-bot/bot.mjs';

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

function smart({ answer, state = { documents: [{ id: 'd1', name: 'Архивная справка', owner: 'grand', city: 'Яссы', status: 'todo', days: 30 }], institutions: [] } } = {}) {
  const sent = [], questions = [], usage = new Map();
  const backend = { async takeAi(id, limit) { const n = usage.get(id) || 0; if (n >= limit) return false; usage.set(id, n + 1); return true; }, async load() { return state; } };
  const ai = { async answer(input) { questions.push(input); if (answer instanceof Error) throw answer; return answer || { text: '**Сначала** Яссы: справка делается 30 дней.', sources: [{ title: 'Google Maps', uri: 'https://maps.google.com/?cid=1' }] }; } };
  const handle = createBotHandler({ botToken: token, miniAppUrl, backend, ai, now: () => Date.UTC(2026, 9, 20, 9),
    fetcher: async (url, options) => { sent.push({ method: url.split('/').pop(), body: JSON.parse(options.body) }); return new Response('{}'); } });
  return { handle, sent, questions, usage };
}

test('with AI configured, a plain question is answered from the user case, with sources and the app button', async () => {
  const { handle, sent, questions } = smart();
  await update(handle, { chat: { id: 42, type: 'private' }, from: { id: 42 }, text: 'Что мне делать на этой неделе?' });
  assert.deepEqual(sent.map(item => item.method), ['sendChatAction', 'sendMessage']);
  assert.equal(questions[0].question, 'Что мне делать на этой неделе?');
  assert.match(questions[0].context, /Сегодня: 2026-10-20/);
  assert.match(questions[0].context, /Архивная справка \(Дедушка\).*город: Яссы.*нужно запросить.*~30 дн\./);
  const reply = sent[1].body;
  assert.equal(reply.text, 'Сначала Яссы: справка делается 30 дней.\n\nИсточники:\n• Google Maps: https://maps.google.com/?cid=1');
  assert.equal(reply.reply_markup.inline_keyboard[0][0].web_app.url, miniAppUrl);
});

test('/start mentions plain-text questions when AI is on; limits and failures get friendly replies', async () => {
  const { handle, sent, usage } = smart();
  await update(handle, { chat: { id: 42, type: 'private' }, text: '/start' });
  assert.equal(sent[0].body.text, WELCOME + WELCOME_AI);
  usage.set('42', AI_DAILY_LIMIT);
  await update(handle, { chat: { id: 42, type: 'private' }, from: { id: 42 }, text: 'вопрос' });
  assert.equal(sent.at(-1).body.text, LIMIT);
  const broken = smart({ answer: new Error('down') });
  await update(broken.handle, { chat: { id: 7, type: 'private' }, from: { id: 7 }, text: 'вопрос' });
  assert.equal(broken.sent.at(-1).body.text, FAILED);
  await update(broken.handle, { chat: { id: 7, type: 'private' }, from: { id: 7 }, text: '/help' });
  assert.equal(broken.sent.at(-1).body.text, HINT);
});

test('answers are trimmed to Telegram size and Markdown bold is removed', () => {
  const long = formatAnswer('**a** ' + 'x'.repeat(5000), []);
  assert.ok(long.length <= 3400);
  assert.ok(long.startsWith('a x'));
});

