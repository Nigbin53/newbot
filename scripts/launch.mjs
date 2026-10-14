import { readFile, readdir, mkdir, rm, writeFile, lstat, access, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadConfig, redact } from './env.mjs';

export const MANIFEST = 'kinpass-manifest.json';
const PUBLIC_EXTENSIONS = /\.(?:html|css|js|mjs|json|svg|png|jpe?g|webp|ico|woff2?|txt)$/i;
const STARTER_FILES = new Set(['README.md', 'LICENSE', 'LICENSE.md', '.gitignore', '.nojekyll']);
const SECRET_KEYS = ['BOT_TOKEN', 'GITHUB_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD'];
const API_VERSION = '2026-03-10';

export function safePublicPath(path) {
  return !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => !part || part === '..' || part.startsWith('.')) && PUBLIC_EXTENSIONS.test(path) && !/(?:^|\/)(?:config\.toml|package(?:-lock)?\.json|.*\.env)(?:$|\/)/i.test(path);
}

export function checkPublicContent(path, data, config) {
  for (const key of SECRET_KEYS) {
    if (config[key] && data.includes(Buffer.from(config[key]))) throw new Error(`Публикация остановлена: ${path} содержит секрет ${key}.`);
  }
  if (/\.(?:html|css|js|mjs|json|svg|txt)$/i.test(path)) {
    const text = data.toString('utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|sbp_)[A-Za-z\d_]{20,}|\b\d{5,}:[A-Za-z\d_-]{20,}|\b(?:BOT_TOKEN|GITHUB_TOKEN|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|SUPABASE_SERVICE_ROLE_KEY)\s*[=:]/.test(text)) throw new Error(`Публикация остановлена: возможный секрет в ${path}.`);
  }
}

async function gather(directory, prefix = '') {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    const full = join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`Символические ссылки нельзя публиковать: ${path}.`);
    if (item.isDirectory()) files.push(...await gather(full, path));
    else if (item.isFile()) files.push({ path, data: await readFile(full) });
    else throw new Error(`Неподдерживаемый файл: ${path}.`);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function preparePublicFiles(root, config) {
  const web = resolve(root, 'web');
  const files = await gather(web);
  for (const entry of files) {
    if (!safePublicPath(entry.path)) throw new Error(`В web/ обнаружен непубличный файл: ${entry.path}. Оставь здесь только материалы сайта.`);
    if (entry.path === MANIFEST) throw new Error(`${MANIFEST} создаётся автоматически; убери его из web/.`);
    checkPublicContent(entry.path, entry.data, config);
    if (entry.data.length > 900_000) throw new Error(`${entry.path} больше 900 КБ — уменьши файл перед публикацией через Contents API.`);
  }
  if (!files.some(file => file.path === 'index.html') || !files.some(file => file.path === 'mini.html')) throw new Error('В web/ должны быть index.html и mini.html.');
  const publicConfig = Buffer.from(`window.KINPASS_CONFIG = Object.freeze(${JSON.stringify({ apiUrl: config.apiUrl })});\n`);
  const existingConfig = files.findIndex(file => file.path === 'config.js');
  if (existingConfig >= 0) files.splice(existingConfig, 1);
  files.push({ path: 'config.js', data: publicConfig }, { path: '.nojekyll', data: Buffer.alloc(0) });
  files.sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash('sha256');
  for (const file of files) hash.update(file.path).update('\0').update(file.data).update('\0');
  const manifest = { application: 'kinpass', schema: 1, revision: hash.digest('hex'), files: files.map(file => file.path) };
  files.push({ path: MANIFEST, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });
  return { files, manifest };
}

export async function writeDist(root, prepared) {
  const dist = resolve(root, 'dist');
  const info = await lstat(dist).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (info?.isSymbolicLink()) throw new Error('dist/ не должен быть символической ссылкой.');
  await rm(dist, { recursive: true, force: true });
  for (const file of prepared.files) {
    const target = resolve(dist, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.data);
  }
}

export function createClients(config, fetchImpl = fetch) {
  async function request(url, { method = 'GET', headers = {}, body, allowed = [] } = {}) {
    let response;
    try { response = await fetchImpl(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error('Сервис недоступен или соединение прервано. Проверь интернет и повтори запуск.'); }
    const text = await response.text();
    let data = null;
    try { if (text) data = JSON.parse(text); } catch { /* Some successful endpoints return no JSON. */ }
    if (!response.ok && !allowed.includes(response.status)) {
      const service = new URL(url).hostname;
      const message = data?.message || data?.description || 'запрос отклонён';
      throw new Error(redact(`${service}: HTTP ${response.status} — ${message}`, config));
    }
    return { status: response.status, data, text };
  }
  return {
    github: (path, options = {}) => request(`https://api.github.com${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': API_VERSION, 'Content-Type': 'application/json' } }),
    telegram: async (method, body) => {
      const result = await request(`https://api.telegram.org/bot${config.BOT_TOKEN}/${method}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body });
      if (!result.data?.ok) throw new Error(`Telegram: ${redact(result.data?.description || 'неожиданный ответ', config)}`);
      return result.data.result;
    },
    supabase: path => request(`https://api.supabase.com${path}`, { headers: { Authorization: `Bearer ${config.SUPABASE_ACCESS_TOKEN}` } }),
    publicFetch: fetchImpl,
  };
}

function repositoryPath(config) { return `/repos/${encodeURIComponent(config.GITHUB_OWNER)}/${encodeURIComponent(config.GITHUB_REPO)}`; }
function contentsPath(base, path) { return `${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`; }

function validateTree(tree, allowed) {
  if (tree.truncated) throw new Error('Репозиторий слишком большой для безопасной автоматической публикации. Используй отдельный пустой репозиторий.');
  for (const entry of tree.tree || []) {
    if (entry.type === 'tree') continue;
    if (entry.type !== 'blob' || entry.mode === '120000' || !allowed.has(entry.path)) throw new Error(`В ветке найден чужой файл ${entry.path}. Используй отдельный репозиторий Kinpass; этот файл не будет изменён.`);
  }
}

function parseOwnership(data) {
  let manifest;
  try { manifest = JSON.parse(Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8')); }
  catch { throw new Error('Ветка kinpass-pages содержит повреждённый manifest. Публикация остановлена.'); }
  if (manifest.application !== 'kinpass' || manifest.schema !== 1 || !Array.isArray(manifest.files) || !manifest.files.every(path => typeof path === 'string' && (path === '.nojekyll' || safePublicPath(path)))) throw new Error('Ветка kinpass-pages не принадлежит этому приложению. Используй отдельный репозиторий.');
  return manifest;
}

export async function githubPreflight(config, clients) {
  const base = repositoryPath(config);
  const repository = (await clients.github(base)).data;
  if (repository.archived || repository.disabled || repository.permissions?.push === false) throw new Error('Репозиторий недоступен для записи. Проверь права PAT и выбранный репозиторий.');
  const pages = await clients.github(`${base}/pages`, { allowed: [404] });
  if (pages.status !== 404 && (pages.data?.source?.branch !== config.pagesBranch || pages.data?.source?.path !== '/' || pages.data?.build_type === 'workflow' || pages.data?.cname)) throw new Error('В этом репозитории уже настроен другой GitHub Pages сайт. Настройки сохранены. Выбери отдельный репозиторий Kinpass.');
  const reference = await clients.github(`${base}/git/ref/heads/${config.pagesBranch}`, { allowed: [404, 409] });
  if (reference.status === 200) {
    const tree = (await clients.github(`${base}/git/trees/${reference.data.object.sha}?recursive=1`)).data;
    const ownership = await clients.github(`${contentsPath(base, MANIFEST)}?ref=${config.pagesBranch}`, { allowed: [404] });
    if (ownership.status === 404) throw new Error('Ветка kinpass-pages уже существует без manifest Kinpass. Она не будет перезаписана.');
    const manifest = parseOwnership(ownership.data);
    validateTree(tree, new Set([...manifest.files, MANIFEST]));
    return { base, pages, tree, reference, manifest, exists: true, empty: false };
  }
  const defaultReference = await clients.github(`${base}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`, { allowed: [404, 409] });
  if (defaultReference.status !== 200) return { base, pages, repository, exists: false, empty: true, tree: { tree: [] } };
  const tree = (await clients.github(`${base}/git/trees/${defaultReference.data.object.sha}?recursive=1`)).data;
  validateTree(tree, STARTER_FILES);
  return { base, pages, repository, reference: defaultReference, tree, exists: false, empty: false };
}

function gitBlobSha(data) { return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex'); }

export async function publishPages(config, clients, prepared, preflight) {
  const { base } = preflight;
  let tree = preflight.tree;
  if (!preflight.exists) {
    let sha = preflight.reference?.data.object.sha;
    if (preflight.empty) {
      const initial = await clients.github(contentsPath(base, '.nojekyll'), { method: 'PUT', body: { message: 'Initialize Kinpass static hosting', content: '' } });
      sha = initial.data.commit.sha;
      tree = { tree: [{ type: 'blob', path: '.nojekyll', sha: initial.data.content.sha }] };
    }
    await clients.github(`${base}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${config.pagesBranch}`, sha } });
  }
  const existing = new Map((tree.tree || []).filter(entry => entry.type === 'blob').map(entry => [entry.path, entry.sha]));
  const wanted = new Set(prepared.files.map(file => file.path));
  for (const [path, sha] of existing) {
    if (!wanted.has(path)) await clients.github(contentsPath(base, path), { method: 'DELETE', body: { message: `Remove old Kinpass static file: ${path}`, branch: config.pagesBranch, sha } });
  }
  for (const file of prepared.files) {
    if (existing.get(file.path) === gitBlobSha(file.data)) continue;
    await clients.github(contentsPath(base, file.path), { method: 'PUT', body: { message: `Publish Kinpass: ${file.path}`, branch: config.pagesBranch, content: file.data.toString('base64'), ...(existing.has(file.path) ? { sha: existing.get(file.path) } : {}) } });
  }
  if (preflight.pages.status === 404) await clients.github(`${base}/pages`, { method: 'POST', body: { build_type: 'legacy', source: { branch: config.pagesBranch, path: '/' } } });
}

export async function waitForPages(config, clients, manifest, { now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const manifestUrl = new URL(MANIFEST, config.miniAppUrl);
  const deadline = now() + config.waitSeconds * 1000;
  while (now() < deadline) {
    try {
      const current = await clients.publicFetch(`${manifestUrl}?v=${manifest.revision}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (current.ok) {
        const published = await current.json();
        if (published.application === 'kinpass' && published.revision === manifest.revision) {
          const mini = await clients.publicFetch(`${config.miniAppUrl}?v=${manifest.revision}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
          if (mini.ok && /text\/html/i.test(mini.headers.get('content-type') || '')) return;
        }
      }
    } catch { /* Pages may be building; poll until deadline. */ }
    await sleep(10_000);
  }
  throw new Error(`GitHub Pages ещё не отдал новую версию по HTTPS. Кнопка бота не изменена. Проверь Settings → Pages и повтори ./launch.sh. Адрес: ${config.miniAppUrl}`);
}

export async function waitForBackend(config, clients, { now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), waitSeconds = 120 } = {}) {
  const deadline = now() + waitSeconds * 1000;
  while (now() < deadline) {
    try {
      const response = await clients.publicFetch(config.apiUrl, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (response.ok && /application\/json/i.test(response.headers.get('content-type') || '')) {
        const health = await response.json();
        if (health.ok === true && health.service === 'kinpass-api') return;
      }
    } catch { /* The newly deployed function may not be ready yet. */ }
    await sleep(5_000);
  }
  throw new Error('API Supabase не подтвердил готовность. Сайт и кнопка бота ещё не публиковались. Проверь Edge Functions → kinpass-api и повтори запуск.');
}

export async function setMenuButton(config, clients) {
  await clients.telegram('setChatMenuButton', { menu_button: { type: 'web_app', text: config.buttonText, web_app: { url: config.miniAppUrl } } });
  const menu = await clients.telegram('getChatMenuButton');
  if (menu?.type !== 'web_app' || menu.web_app?.url !== config.miniAppUrl) throw new Error('Telegram не подтвердил новую кнопку. Повтори ./launch.sh.');
}

export async function validateProject(root) {
  for (const path of ['web/index.html', 'web/mini.html', 'supabase/config.toml', 'supabase/functions/kinpass-api/index.ts']) {
    await access(resolve(root, path)).catch(() => { throw new Error(`Не найден ${path}. Распакуй весь launch-пакет.`); });
  }
  const migrations = await readdir(resolve(root, 'supabase/migrations')).catch(() => []);
  if (!migrations.some(path => path.endsWith('.sql'))) throw new Error('В пакете отсутствует миграция базы данных.');
}

async function runCli(root, config, args) {
  const executable = resolve(root, 'node_modules/.bin/supabase');
  await access(executable).catch(() => { throw new Error('CLI ещё не установлен. Выполни npm install в папке проекта; brew не нужен.'); });
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: config.SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD: config.SUPABASE_DB_PASSWORD, CI: 'true', DO_NOT_TRACK: '1' };
  for (const key of ['BOT_TOKEN', 'GITHUB_TOKEN']) delete env[key];
  await new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000 });
    let output = '';
    const collect = chunk => { output = (output + chunk.toString()).slice(-1_000_000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => reject(new Error('Не удалось запустить локальный Supabase CLI. Повтори npm install.')));
    child.on('close', code => code === 0 ? resolveRun() : reject(new Error(redact(`Supabase CLI завершился с кодом ${code}.\n${output}`, config))));
  });
}

export async function deployBackend(root, config, { cli = runCli } = {}) {
  await cli(root, config, ['link', '--project-ref', config.SUPABASE_PROJECT_REF]);
  await cli(root, config, ['db', 'push', '--yes']);
  const directory = await mkdtemp(join(tmpdir(), 'kinpass-secrets-'));
  const envFile = join(directory, 'function.env');
  try {
    const secrets = `BOT_TOKEN=${JSON.stringify(config.BOT_TOKEN)}\nAPP_ORIGIN=${JSON.stringify(config.appOrigin)}\n`;
    await writeFile(envFile, secrets, { mode: 0o600 });
    await cli(root, config, ['secrets', 'set', '--project-ref', config.SUPABASE_PROJECT_REF, '--env-file', envFile]);
  } finally { await rm(directory, { recursive: true, force: true }); }
  await cli(root, config, ['functions', 'deploy', 'kinpass-api', '--project-ref', config.SUPABASE_PROJECT_REF, '--no-verify-jwt', '--use-api']);
}

export async function launch(root, config, { clients = createClients(config), backend = deployBackend, readiness = waitForBackend, poll = waitForPages, log = console.log } = {}) {
  log('1/6 Проверяю пакет и публичные файлы…');
  await validateProject(root);
  const prepared = await preparePublicFiles(root, config);
  log('2/6 Проверяю бота и отдельный репозиторий GitHub…');
  const bot = await clients.telegram('getMe');
  if (!bot?.is_bot || !bot.username) throw new Error('Токен Telegram не принадлежит боту.');
  const preflight = await githubPreflight(config, clients);
  await clients.supabase(`/v1/projects/${config.SUPABASE_PROJECT_REF}`);
  log('3/6 Применяю миграцию и разворачиваю защищённый API Supabase…');
  await backend(root, config);
  await readiness(config, clients);
  log('4/6 Публикую только dist/ в ветку kinpass-pages…');
  await writeDist(root, prepared);
  await publishPages(config, clients, prepared, preflight);
  log('5/6 Жду доступности новой версии GitHub Pages по HTTPS…');
  await poll(config, clients, prepared.manifest);
  log('6/6 Добавляю кнопку mini app в меню бота…');
  await setMenuButton(config, clients);
  log(`Готово. Бот: https://t.me/${bot.username}\nMini app: ${config.miniAppUrl}\nОткрой личный чат с ботом и нажми «${config.buttonText}».`);
}

export async function main(args = process.argv.slice(2), root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Нужен Node.js 22 или новее. Установи его с https://nodejs.org/en/download.');
  if (args.length > 1 || (args.length && !['--check', '--dry-run', '--build', '--help'].includes(args[0]))) throw new Error('Использование: ./launch.sh [--check | --dry-run | --build | --help]');
  if (args[0] === '--help') {
    console.log('./launch.sh --check    Проверка .env и файлов без сети и изменений\n./launch.sh --dry-run  Проверка доступов через API без публикации\n./launch.sh --build    Создание только публичной папки dist/\n./launch.sh            Supabase → GitHub Pages → кнопка Telegram');
    return;
  }
  const config = await loadConfig(root, { buildOnly: args[0] === '--build' });
  await validateProject(root);
  const prepared = await preparePublicFiles(root, config);
  if (args[0] === '--check') { console.log('Проверка пройдена. Секреты не выводились; сеть и внешние сервисы не изменялись.'); return; }
  if (args[0] === '--build') { await writeDist(root, prepared); console.log('Готово: dist/ содержит только публичный сайт и URL API.'); return; }
  if (args[0] === '--dry-run') {
    const clients = createClients(config);
    const bot = await clients.telegram('getMe');
    if (!bot?.is_bot) throw new Error('Токен Telegram не принадлежит боту.');
    await githubPreflight(config, clients);
    await clients.supabase(`/v1/projects/${config.SUPABASE_PROJECT_REF}`);
    console.log(`Доступы проверены. Публикации и изменений не было.\nПланируемый адрес: ${config.miniAppUrl}`);
    return;
  }
  await launch(root, config);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Запуск остановлен: ${redact(error.message, process.env)}`);
    process.exitCode = 1;
  });
}
