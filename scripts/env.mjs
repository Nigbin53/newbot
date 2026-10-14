import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const ENV_KEYS = ['BOT_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'SUPABASE_DB_PASSWORD', 'SUPABASE_URL', 'MINI_APP_BUTTON_TEXT', 'PAGES_WAIT_SECONDS'];
const REQUIRED = ENV_KEYS.slice(0, 7);
const SECRET_KEYS = ['BOT_TOKEN', 'GITHUB_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD'];

// Deliberately no shell execution, interpolation, or variable expansion.
export function parseEnv(text) {
  const result = {};
  for (const [index, line] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`.env: строка ${index + 1} должна иметь вид KEY=value.`);
    const [, key, raw] = match;
    if (Object.hasOwn(result, key)) throw new Error(`.env: ${key} указан дважды.`);
    let value;
    if (raw.startsWith("'") || raw.startsWith('"')) {
      const quote = raw[0];
      let end = 1;
      while (end < raw.length) {
        let escapes = 0;
        for (let previous = end - 1; previous >= 0 && raw[previous] === '\\'; previous--) escapes++;
        if (raw[end] === quote && (quote === "'" || escapes % 2 === 0)) break;
        end++;
      }
      if (end === raw.length || !/^\s*(?:#.*)?$/.test(raw.slice(end + 1))) throw new Error(`.env: проверь кавычки в строке ${index + 1}.`);
      value = raw.slice(1, end);
      if (quote === '"') value = value.replace(/\\([\\"nrt])/g, (_, escape) => ({ '\\': '\\', '"': '"', n: '\n', r: '\r', t: '\t' })[escape]);
    } else value = raw.replace(/(?:^|\s+)#.*$/, '').trimEnd();
    result[key] = value;
  }
  return result;
}

export function validateConfig(env, { buildOnly = false } = {}) {
  const required = buildOnly ? ['SUPABASE_PROJECT_REF'] : REQUIRED;
  for (const key of required) {
    if (!env[key] || /(?:PASTE_|YOUR_|CHANGE_ME|example_token)/i.test(env[key])) throw new Error(`Заполни ${key} в .env.`);
    if (/[\r\n\0]/.test(env[key])) throw new Error(`${key} должен занимать одну строку.`);
  }
  if (!/^[a-z]{20}$/.test(env.SUPABASE_PROJECT_REF)) throw new Error('SUPABASE_PROJECT_REF: нужны 20 строчных латинских букв из настроек проекта.');
  if (!buildOnly) {
    if (!/^[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?$/.test(env.GITHUB_OWNER)) throw new Error('Проверь GITHUB_OWNER: имя пользователя или организации GitHub.');
    if (!/^[A-Za-z\d_.-]{1,100}$/.test(env.GITHUB_REPO) || ['.', '..'].includes(env.GITHUB_REPO)) throw new Error('Проверь GITHUB_REPO: только название, без URL и слешей.');
    if (!/^\d{5,}:[A-Za-z\d_-]{20,}$/.test(env.BOT_TOKEN)) throw new Error('BOT_TOKEN не похож на токен BotFather.');
    for (const key of ['GITHUB_TOKEN', 'SUPABASE_ACCESS_TOKEN']) if (env[key].length < 20) throw new Error(`Проверь ${key}.`);
    if (env.SUPABASE_DB_PASSWORD.length < 6) throw new Error('SUPABASE_DB_PASSWORD слишком короткий.');
  }
  const supabaseUrl = env.SUPABASE_URL || `https://${env.SUPABASE_PROJECT_REF}.supabase.co`;
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || !['', '/'].includes(parsedUrl.pathname)) throw new Error('SUPABASE_URL должен быть HTTPS адресом проекта без пути, логина и параметров.');
  const owner = env.GITHUB_OWNER?.toLowerCase();
  const origin = owner ? `https://${owner}.github.io` : null;
  const path = owner && env.GITHUB_REPO.toLowerCase() !== `${owner}.github.io` ? `/${encodeURIComponent(env.GITHUB_REPO)}` : '';
  const buttonText = env.MINI_APP_BUTTON_TEXT || 'Открыть Kinpass';
  if ([...buttonText].length > 40 || !buttonText.trim() || /[\r\n\0]/.test(buttonText)) throw new Error('MINI_APP_BUTTON_TEXT: от 1 до 40 символов на одной строке.');
  const waitSeconds = Number(env.PAGES_WAIT_SECONDS || 600);
  if (!Number.isInteger(waitSeconds) || waitSeconds < 30 || waitSeconds > 3600) throw new Error('PAGES_WAIT_SECONDS: целое число от 30 до 3600.');
  return { ...env, supabaseUrl: parsedUrl.origin, apiUrl: `${parsedUrl.origin}/functions/v1/kinpass-api`, appOrigin: origin, miniAppUrl: origin ? `${origin}${path}/mini.html` : null, pagesBranch: 'kinpass-pages', buttonText, waitSeconds };
}

export async function loadConfig(root, options = {}) {
  let file;
  try { file = await readFile(resolve(root, '.env'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; file = ''; }
  const env = parseEnv(file);
  for (const key of ENV_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
  return validateConfig(env, options);
}

export function redact(value, env) {
  let result = String(value);
  for (const key of SECRET_KEYS) if (env[key]) result = result.split(env[key]).join('[скрыто]');
  return result.replace(/bot\d{5,}:[A-Za-z\d_-]+/g, 'bot[скрыто]').replace(/\b(?:github_pat_|ghp_|sbp_)[A-Za-z\d_]+/g, '[скрыто]');
}
