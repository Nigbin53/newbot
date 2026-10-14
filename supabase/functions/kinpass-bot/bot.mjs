// Telegram webhook: answers /start (and any other private message) with a button
// that opens the mini app. Telegram proves each request with a secret header
// derived from the bot token, so no extra secret has to be configured.
const encoder = new TextEncoder();

export async function webhookSecret(botToken) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`kinpass-webhook:${botToken}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export const WELCOME = 'Kinpass — ваши документы, документы мамы и дедушки в одном деле.\n\n' +
  'Города, сроки получения и сроки действия — в одной карточке. Нажмите «Открыть Kinpass», чтобы начать.';
export const HINT = 'Все документы — в приложении. Нажмите «Открыть Kinpass».';

export function createBotHandler({ botToken, miniAppUrl, fetcher = fetch }) {
  const secret = webhookSecret(botToken);
  return async function handle(request) {
    if (request.method !== 'POST') return new Response('ok');
    if (request.headers.get('x-telegram-bot-api-secret-token') !== await secret) return new Response('forbidden', { status: 403 });
    let update;
    try { update = await request.json(); } catch { return new Response('ok'); }
    const message = update?.message;
    if (message?.chat?.type !== 'private' || !Number.isSafeInteger(message.chat.id)) return new Response('ok');
    const start = typeof message.text === 'string' && /^\/start(?:@\w+)?(?:\s|$)/.test(message.text);
    try {
      await fetcher(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          chat_id: message.chat.id, text: start ? WELCOME : HINT,
          reply_markup: { inline_keyboard: [[{ text: 'Открыть Kinpass', web_app: { url: miniAppUrl } }]] },
        }),
      });
    } catch { /* Telegram retries nothing here; the menu button still works. */ }
    return new Response('ok');
  };
}
