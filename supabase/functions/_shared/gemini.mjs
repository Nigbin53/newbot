// Gemini API client (Generate Content REST) with Google Search + Google Maps grounding.
// Used by kinpass-api (institution lookup) and kinpass-bot (answers to plain-text questions).
export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const FALLBACK_MODEL = 'gemini-2.5-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROUNDING = [{ google_search: {} }, { googleMaps: {} }];
const SEARCH_ONLY = [{ google_search: {} }];

export class GeminiError extends Error {
  constructor(status, detail = '') {
    super(`Gemini HTTP ${status}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}

export const INSTITUTION_FIELDS = ['name', 'city', 'address', 'phone', 'hours', 'lunch', 'reception', 'notes'];

const LOOKUP_SYSTEM = `You find contact details of government offices and institutions (civil registry / ZAGS / Starea Civilă, archives, passport offices, consulates, notaries, translation bureaus) mainly in Moldova and Romania.
Use Google Maps and Google Search. Report only facts you actually found; use an empty string for anything unknown. Never invent phone numbers or hours.
Reply with ONE JSON object and nothing else, keys:
{"name": official name as found (add a short Russian explanation in parentheses if the name is Romanian),
 "city": city in Russian,
 "address": street address,
 "phone": main phone in international format,
 "hours": working hours in Russian, compact, e.g. "Пн–Пт 8:00–17:00",
 "lunch": lunch break, e.g. "12:00–13:00",
 "reception": days/hours when documents are accepted or issued, in Russian,
 "notes": up to 2 short practical notes in Russian (appointment needed, online queue, etc.)}`;

const ANSWER_SYSTEM = `Ты — помощник Kinpass в Telegram. Пользователь собирает документы для себя, мамы и дедушки (паспорт, свидетельства, архивные справки, переводы) в разных городах Молдовы и Румынии.
Отвечай по-русски, коротко и по делу: до 900 символов, простой текст без Markdown, списки — через «•».
Опирайся на данные дела ниже. Если спрашивают «что делать дальше» — предложи порядок: сначала то, что делается дольше всего, объедини документы одного города в одну поездку, справки с коротким сроком действия — ближе к подаче.
Для адресов, телефонов, часов работы и официальных требований используй поиск и в конце советуй уточнить в учреждении. Не выдумывай факты.`;

export function parseJsonObject(text) {
  const clean = String(text || '').replace(/```(?:json)?/gi, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object');
  const value = JSON.parse(clean.slice(start, end + 1));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('No JSON object');
  return value;
}

export function createGemini({ apiKey, model = DEFAULT_MODEL, fetcher = fetch, timeout = 28000 }) {
  async function call(modelName, tools, prompt, system) {
    const response = await fetcher(`${ENDPOINT}/${encodeURIComponent(modelName)}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools,
      }),
    });
    if (!response.ok) {
      let detail = '';
      try { detail = String((await response.json())?.error?.message || '').replace(/\s+/g, ' ').slice(0, 200); } catch { /* no JSON body */ }
      throw new GeminiError(response.status, detail);
    }
    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const text = (candidate?.content?.parts || []).map(part => typeof part.text === 'string' ? part.text : '').join('').trim();
    const seen = new Set();
    const sources = [];
    for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
      const source = chunk?.maps || chunk?.web;
      const uri = typeof source?.uri === 'string' ? source.uri : '';
      if (!/^https:\/\//.test(uri) || seen.has(uri)) continue;
      seen.add(uri);
      sources.push({ title: String(source.title || (chunk.maps ? 'Google Maps' : 'Источник')).slice(0, 120), uri: uri.slice(0, 500), maps: Boolean(chunk.maps) });
      if (sources.length === 5) break;
    }
    return { text, sources };
  }
  // Maps grounding or a model name may be unavailable for a key/region: fall back step by step.
  async function generate(prompt, system) {
    const attempts = [[model, GROUNDING], [model, SEARCH_ONLY]];
    if (model !== FALLBACK_MODEL) attempts.push([FALLBACK_MODEL, SEARCH_ONLY]);
    let last;
    for (const [modelName, tools] of attempts) {
      try { return await call(modelName, tools, prompt, system); }
      catch (error) {
        last = error;
        if (!(error instanceof GeminiError) || ![400, 403, 404].includes(error.status)) throw error;
      }
    }
    throw last;
  }
  return {
    async lookupInstitution({ query, city }) {
      const { text, sources } = await generate(`Найди учреждение: «${query}»${city ? `, город ${city}` : ''}.`, LOOKUP_SYSTEM);
      let institution = {};
      try { institution = parseJsonObject(text); } catch { /* the model found nothing usable */ }
      return { institution, sources };
    },
    async answer({ question, context }) {
      return await generate(question, `${ANSWER_SYSTEM}\n\n${context}`);
    },
  };
}

const OWNERS = { self: 'Я', mom: 'Мама', grand: 'Дедушка' };
const STATUSES = { todo: 'нужно запросить', pending: 'в работе', ready: 'получен' };

// Compact plain-text summary of a user's case for the model.
export function describeCase(state, today) {
  const institutions = Array.isArray(state?.institutions) ? state.institutions : [];
  const byId = new Map(institutions.map(item => [item.id, item]));
  const documents = (Array.isArray(state?.documents) ? state.documents : []).map(doc => {
    const place = byId.get(doc.institution);
    return [`• ${doc.name} (${OWNERS[doc.owner] || doc.owner})`, `город: ${doc.city || '—'}`, `статус: ${STATUSES[doc.status] || doc.status}`,
      `изготовление ~${doc.days} дн.`, doc.requested && `запрошен ${doc.requested}`, doc.expected && `ожидается ${doc.expected}`,
      doc.issued && `выдан ${doc.issued}`, doc.expires && `действует до ${doc.expires}`, place && `учреждение: ${place.name}`]
      .filter(Boolean).join('; ');
  });
  const places = institutions.map(item => [`• ${item.name}`, item.city, item.address, item.phone && `тел. ${item.phone}`,
    item.hours && `часы: ${item.hours}`, item.lunch && `обед: ${item.lunch}`, item.reception && `приём: ${item.reception}`]
    .filter(Boolean).join('; '));
  return `Сегодня: ${today}.\nДокументы дела:\n${documents.join('\n') || 'пока нет'}\nУчреждения:\n${places.join('\n') || 'пока нет'}`;
}
