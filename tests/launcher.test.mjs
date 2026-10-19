import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { parseEnv, validateConfig, redact } from '../scripts/env.mjs';
import { preparePublicFiles, createClients, githubPreflight, deployBackend, launch, waitForPages, waitForBackend } from '../scripts/launch.mjs';

const ENV = {
  BOT_TOKEN: '123456:fixture_bot_token_abcdefghijklmnopqrstuvwxyz',
  GITHUB_OWNER: 'octocat', GITHUB_REPO: 'kinpass-mini-app',
  GITHUB_TOKEN: 'fixture_github_access_token_abcdefghijklmnopqrstuvwxyz',
  SUPABASE_ACCESS_TOKEN: 'fixture_supabase_access_token_abcdefghijklmnopqrstuvwxyz',
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', SUPABASE_DB_PASSWORD: 'literal $() password # value',
};
const config = validateConfig(ENV);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kinpass-launch-test-'));
  for (const directory of ['web', 'supabase/migrations', 'supabase/functions/kinpass-api']) await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, 'web/index.html'), '<!doctype html><title>Kinpass</title>');
  await writeFile(join(root, 'web/mini.html'), '<!doctype html><title>Kinpass mini</title>');
  await writeFile(join(root, 'web/app.js'), 'window.app = "public";');
  await writeFile(join(root, 'supabase/config.toml'), '[functions.kinpass-api]\nverify_jwt = false\n');
  await writeFile(join(root, 'supabase/migrations/202610110001_init.sql'), '-- migration');
  await writeFile(join(root, 'supabase/functions/kinpass-api/index.ts'), '// backend');
  await writeFile(join(root, '.env'), 'BOT_TOKEN=secret_outside_web');
  return root;
}

test('.env treats dollar signs, substitutions, spaces and hashes literally', () => {
  const parsed = parseEnv("# comment\nexport PASSWORD='literal $() $HOME # value'\nDOUBLE=\"literal \\\"quote\\\" $TOKEN\" # comment\nUNQUOTED=abc#def # comment\nEMPTY= # empty comment\n");
  assert.equal(parsed.PASSWORD, 'literal $() $HOME # value');
  assert.equal(parsed.DOUBLE, 'literal "quote" $TOKEN');
  assert.equal(parsed.UNQUOTED, 'abc#def');
  assert.equal(parsed.EMPTY, '');
  assert.equal(parseEnv('ESCAPED="two\\\\"').ESCAPED, 'two\\');
  assert.throws(() => parseEnv('A=one\nA=two'), /указан дважды/);
  assert.throws(() => parseEnv('A="unterminated'), /кавычки/);
});

test('config derives Pages origin separately from repository path and rejects placeholders', () => {
  assert.equal(config.appOrigin, 'https://octocat.github.io');
  assert.equal(config.miniAppUrl, 'https://octocat.github.io/kinpass-mini-app/mini.html');
  assert.equal(validateConfig({ ...ENV, GITHUB_REPO: 'octocat.github.io' }).miniAppUrl, 'https://octocat.github.io/mini.html');
  assert.throws(() => validateConfig({ ...ENV, BOT_TOKEN: 'PASTE_BOTFATHER_TOKEN' }), /Заполни BOT_TOKEN/);
  assert.throws(() => validateConfig({ ...ENV, GITHUB_REPO: '../other' }), /GITHUB_REPO/);
  assert.throws(() => validateConfig({ ...ENV, SUPABASE_URL: 'http://example.com' }), /HTTPS/);
});

test('public build publishes web only, with URL-only config and no credentials', async () => {
  const root = await fixture();
  try {
    const result = await preparePublicFiles(root, config);
    assert.deepEqual(result.files.map(file => file.path).sort(), ['.nojekyll', 'app.js', 'config.js', 'index.html', 'kinpass-manifest.json', 'mini.html']);
    const published = Buffer.concat(result.files.map(file => file.data)).toString();
    for (const key of ['BOT_TOKEN', 'GITHUB_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']) assert.ok(!published.includes(ENV[key]));
    const publicConfig = result.files.find(file => file.path === 'config.js').data.toString();
    assert.ok(publicConfig.includes(JSON.stringify({ apiUrl: config.apiUrl })));
    await writeFile(join(root, 'web/.env'), 'BOT_TOKEN=unsafe');
    await assert.rejects(preparePublicFiles(root, config), /непубличный файл/);
    await rm(join(root, 'web/.env'));
    await writeFile(join(root, 'web/app.js'), `const hidden = '${ENV.BOT_TOKEN}';`);
    await assert.rejects(preparePublicFiles(root, config), /содержит секрет BOT_TOKEN/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('backend deploy keeps secrets out of argv, applies migration first, and deletes its mode600 env file', async () => {
  const calls = [];
  let secretPath;
  await deployBackend('/fixture', config, { cli: async (root, received, args) => {
    calls.push(args);
    assert.ok(!args.join(' ').includes(config.BOT_TOKEN));
    assert.ok(!args.join(' ').includes(config.SUPABASE_DB_PASSWORD));
    if (args[0] === 'secrets') {
      secretPath = args[args.indexOf('--env-file') + 1];
      assert.equal((await stat(secretPath)).mode & 0o777, 0o600);
      const secrets = parseEnv(await readFile(secretPath, 'utf8'));
      assert.deepEqual(secrets, { BOT_TOKEN: config.BOT_TOKEN, APP_ORIGIN: config.appOrigin });
    }
  } });
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [['link', '--project-ref'], ['db', 'push'], ['secrets', 'set'], ['functions', 'deploy']]);
  assert.ok(calls[3].includes('--use-api'));
  await assert.rejects(access(secretPath));
});

test('backend temporary secrets file is cleaned up after CLI failure', async () => {
  let secretPath;
  await assert.rejects(deployBackend('/fixture', config, { cli: async (_root, _config, args) => {
    if (args[0] === 'secrets') { secretPath = args[args.indexOf('--env-file') + 1]; throw new Error('fixture failure'); }
  } }), /fixture failure/);
  await assert.rejects(access(secretPath));
});

test('GitHub preflight refuses unrelated Pages settings before any writes', async () => {
  const calls = [];
  await assert.rejects(githubPreflight(config, { github: async (path, options = {}) => {
    calls.push({ path, ...options });
    return path.endsWith('/pages') ? { status: 200, data: { source: { branch: 'main', path: '/docs' } } } : { status: 200, data: { default_branch: 'main' } };
  } }), /уже настроен другой/);
  assert.ok(calls.every(call => !call.method));
});

test('mock HTTP launch sends only static Contents payloads and changes menu after HTTPS publication', async () => {
  const root = await fixture();
  const requests = [];
  const trace = [];
  const prepared = await preparePublicFiles(root, config);
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const service = req.headers['x-original-service'];
    requests.push({ service, method: req.method, path: req.url, body });
    let status = 200;
    let data = {};
    const path = req.url.split('?')[0];
    if (service === 'api.telegram.org') {
      const method = path.split('/').at(-1);
      trace.push(method);
      data = { ok: true, result: method === 'getMe' ? { is_bot: true, username: 'fixture_bot' } : method === 'getChatMenuButton' ? { type: 'web_app', web_app: { url: config.miniAppUrl } } : true };
    } else if (service === 'api.github.com') {
      if (req.method === 'GET' && path === '/repos/octocat/kinpass-mini-app') data = { default_branch: 'main', permissions: { push: true } };
      else if (req.method === 'GET') { status = path.endsWith('/heads/main') ? 409 : 404; data = { message: 'Not found' }; }
      else if (req.method === 'PUT' && path.endsWith('/.nojekyll') && !body.branch) data = { commit: { sha: 'initial-commit' }, content: { sha: 'empty-blob' } };
      else if (path.endsWith('/pages')) trace.push('pages-configured');
    } else if (service === 'abcdefghijklmnopqrst.supabase.co') {
      trace.push('backend-ready');
      data = { ok: true, service: 'kinpass-api' };
    } else if (service === 'octocat.github.io') {
      trace.push('public-https');
      if (path.endsWith('/kinpass-manifest.json')) data = prepared.manifest;
      else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Kinpass mini</title>'); return; }
    }
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const localUrl = `http://127.0.0.1:${server.address().port}`;
  const fetchImpl = (url, options = {}) => {
    const parsed = new URL(url);
    return fetch(`${localUrl}${parsed.pathname}${parsed.search}`, { ...options, headers: { ...options.headers, 'x-original-service': parsed.hostname } });
  };
  try {
    await launch(root, config, { clients: createClients(config, fetchImpl), backend: async () => { trace.push('backend-deployed'); }, log: () => {} });
    const uploads = requests.filter(request => request.service === 'api.github.com' && request.method === 'PUT' && request.path.includes('/contents/'));
    const uploadedPaths = uploads.map(request => decodeURIComponent(request.path.split('/contents/')[1]));
    assert.ok(uploadedPaths.includes('mini.html'));
    assert.ok(uploadedPaths.includes('config.js'));
    assert.ok(uploadedPaths.includes('kinpass-manifest.json'));
    assert.ok(!uploadedPaths.some(path => path.includes('.env') || path.startsWith('supabase/') || path.includes('launch.sh')));
    for (const upload of uploads) {
      const content = Buffer.from(upload.body.content, 'base64').toString();
      for (const key of ['BOT_TOKEN', 'GITHUB_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']) assert.ok(!content.includes(ENV[key]));
    }
    const menu = requests.find(request => request.path.endsWith('/setChatMenuButton'));
    assert.deepEqual(menu.body, { menu_button: { type: 'web_app', text: 'Открыть Kinpass', web_app: { url: config.miniAppUrl } } });
    assert.ok(trace.indexOf('backend-deployed') < trace.indexOf('pages-configured'));
    assert.ok(trace.indexOf('backend-ready') < trace.indexOf('pages-configured'));
    assert.ok(trace.indexOf('setChatMenuButton') > trace.lastIndexOf('public-https'));
    assert.equal(uploads.at(-1).path.split('/').at(-1), 'kinpass-manifest.json');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('Pages timeout does not set Telegram menu', async () => {
  let currentTime = 0;
  const calls = [];
  await assert.rejects(waitForPages({ ...config, waitSeconds: 30 }, { publicFetch: async url => { calls.push(url); return new Response('not found', { status: 404 }); } }, { revision: 'fixture' }, { now: () => currentTime, sleep: async ms => { currentTime += ms; } }), /Кнопка бота не изменена/);
  assert.equal(calls.length, 3);
});

test('backend readiness rejects HTML, wrong service and failed health marker', async () => {
  let currentTime = 0;
  let attempt = 0;
  const responses = [
    new Response('<html>ok</html>', { headers: { 'content-type': 'text/html' } }),
    Response.json({ ok: true, service: 'other' }),
    Response.json({ ok: false, service: 'kinpass-api' }),
  ];
  await assert.rejects(waitForBackend(config, { publicFetch: async () => responses[attempt++] }, { now: () => currentTime, sleep: async ms => { currentTime += ms; }, waitSeconds: 15 }), /не подтвердил готовность/);
  assert.equal(attempt, 3);
  await waitForBackend(config, { publicFetch: async () => Response.json({ ok: true, service: 'kinpass-api' }) });
});

test('redaction covers all configured secrets and token-bearing Telegram URLs', () => {
  const output = redact(Object.values(ENV).join(' ') + ` https://api.telegram.org/bot${ENV.BOT_TOKEN}/getMe`, ENV);
  for (const key of ['BOT_TOKEN', 'GITHUB_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']) assert.ok(!output.includes(ENV[key]));
});

test('public build adds content-hash versions to local scripts and styles in HTML', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'web/mini.html'), '<link rel="stylesheet" href="style.css"><script src="https://telegram.org/js/telegram-web-app.js"></script><script defer src="config.js"></script><script defer src="app.js"></script>');
    await writeFile(join(root, 'web/style.css'), 'body{}');
    const { files } = await preparePublicFiles(root, config);
    const mini = files.find(file => file.path === 'mini.html').data.toString();
    assert.match(mini, /href="style\.css\?v=[a-f0-9]{10}"/);
    assert.match(mini, /src="app\.js\?v=[a-f0-9]{10}"/);
    assert.match(mini, /src="config\.js\?v=[a-f0-9]{10}"/);
    assert.match(mini, /src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
