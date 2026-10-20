// Telegram webhook: /start shows the mini app button; other private messages are answered
// by Gemini using the user's own case (documents + institutions). Telegram proves each
// request with a secret header derived from the bot token.
import { describeCase } from '../_shared/gemini.mjs';

const encoder = new TextEncoder();
export const AI_DAILY_LIMIT = 40;

export async function webhookSecret(botToken) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`kinpass-webhook:${botToken}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export const WELCOME = 'Kinpass — ваши документы, документы мамы и дедушки в одном деле.\n\n' +
  'Города, сроки получения и сроки действия — в одной карточке. Нажмите «Открыть Kinpass», чтобы начать.';
export const WELCOME_AI = '\n\nМожно спросить и обычным текстом, например: «Что мне делать на этой неделе?» или «Когда работает ЗАГС в Бельцах?»';
export const HINT = 'Все документы — в приложении. Нажмите «Открыть Kinpass».';
export const LIMIT = 'На сегодня лимит вопросов исчерпан. Попробуйте завтра — или откройте Kinpass.';
export const FAILED = 'Не получилось ответить прямо сейчас. Попробуйте ещё раз через минуту.';

const today = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Chisinau', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));

export function formatAnswer(text, sources = []) {
  const body = String(text || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim().slice(0, 3400);
  const links = sources.slice(0, 3).map(source => `• ${source.title}: ${source.uri}`).join('\n');
  return links ? `${body}\n\nИсточники:\n${links}` : body;
}

export function createBotHandler({ botToken, miniAppUrl, fetcher = fetch, backend = null, ai = null, now = () => Date.now() }) {
  const secret = webhookSecret(botToken);
  const telegram = (method, body) => fetcher(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000), body: JSON.stringify(body),
  });
  const button = { inline_keyboard: [[{ text: 'Открыть Kinpass', web_app: { url: miniAppUrl } }]] };
  const reply = async (chatId, text) => {
    try { await telegram('sendMessage', { chat_id: chatId, text, reply_markup: button, link_preview_options: { is_disabled: true } }); }
    catch { /* The menu button still works. */ }
  };

  async function answer(message) {
    const userId = Number.isSafeInteger(message.from?.id) ? message.from.id : message.chat.id;
    try { await telegram('sendChatAction', { chat_id: message.chat.id, action: 'typing' }); } catch { /* optional */ }
    try {
      if (!await backend.takeAi(String(userId), AI_DAILY_LIMIT)) return LIMIT;
      let state = { documents: [], institutions: [] };
      try { state = await backend.load(String(userId)); } catch { /* answer without the case */ }
      const result = await ai.answer({ question: message.text.slice(0, 1500), context: describeCase(state, today(now())) });
      return result.text ? formatAnswer(result.text, result.sources) : FAILED;
    } catch { return FAILED; }
  }

  return async function handle(request) {
    if (request.method !== 'POST') return new Response('ok');
    if (request.headers.get('x-telegram-bot-api-secret-token') !== await secret) return new Response('forbidden', { status: 403 });
    let update;
    try { update = await request.json(); } catch { return new Response('ok'); }
    const message = update?.message;
    if (message?.chat?.type !== 'private' || !Number.isSafeInteger(message.chat.id)) return new Response('ok');
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    const smart = Boolean(ai && backend);
    if (/^\/start(?:@\w+)?(?:\s|$)/.test(text)) await reply(message.chat.id, WELCOME + (smart ? WELCOME_AI : ''));
    else if (smart && text && !text.startsWith('/')) await reply(message.chat.id, await answer({ ...message, text }));
    else await reply(message.chat.id, HINT);
    return new Response('ok');
  };
}
