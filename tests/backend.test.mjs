import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createHandler } from '../supabase/functions/kinpass-api/handler.mjs';
import { createBackend } from '../supabase/functions/kinpass-api/backend.mjs';
import { verifyInitData, validateDocuments, validateInstitutions, cleanInstitution, decodeUpload, MAX_FILE_BYTES, AI_DAILY_LIMIT } from '../supabase/functions/kinpass-api/security.mjs';
import { createGemini, parseJsonObject, describeCase } from '../supabase/functions/_shared/gemini.mjs';

const token = '123456:TEST_ONLY_NOT_A_REAL_BOT_TOKEN';
const origin = 'https://example.github.io';
const now = 1791741600000;
const document = (id = 'd1', extra = {}) => ({
  id, name: 'Свидетельство о рождении', owner: 'self', city: 'Кишинёв', status: 'todo',
  issued: '', expires: '', days: 7, requested: '', expected: '', file: '', ...extra,
});
const photo = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.from('Test fixture')]).toString('base64')}`;

// Sign independently using Node crypto, rather than the verification helper.
function signed(userId = 101, extra = {}) {
  const fields = {
    auth_date: String(Math.floor(now / 1000)),
    query_id: 'test-query', user: JSON.stringify({ id: userId, first_name: 'Test' }), ...extra,
  };
  const checkString = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

class FakeBackend {
  states = new Map();
  registry = new Map();
  objects = new Set();
  signedPaths = [];
  loadCalls = [];
  async load(id) {
    this.loadCalls.push(id);
    return structuredClone(this.states.get(id) || { documents: [], institutions: [], revision: 0 });
  }
  async uploads(id, paths) {
    return paths.map(path => this.registry.get(path)).filter(item => item?.telegram_user_id === id).map(item => structuredClone(item));
  }
  async uploadUsage(id) {
    return [...this.registry.values()].filter(upload => upload.telegram_user_id === id);
  }
  aiUsage = new Map();
  async takeAi(id, limit) {
    const used = this.aiUsage.get(id) || 0;
    if (used >= limit) return false;
    this.aiUsage.set(id, used + 1);
    return true;
  }
  async save(id, documents, revision, institutions = null) {
    const state = this.states.get(id) || { documents: [], institutions: [], revision: 0 };
    if (state.revision !== revision) return { ok: false, ...structuredClone(state) };
    for (const item of documents.filter(item => item.file)) {
      const upload = this.registry.get(item.file);
      if (!upload || upload.telegram_user_id !== id || upload.document_id !== item.id || upload.file_name !== item.fileName) {
        return { ok: false, error: 'INVALID_ATTACHMENT' };
      }
    }
    const cleanup = state.documents.map(item => item.file).filter(path => path && !documents.some(item => item.file === path));
    for (const path of cleanup) this.registry.delete(path);
    const next = { documents: structuredClone(documents), institutions: structuredClone(institutions ?? state.institutions ?? []), revision: revision + 1 };
    this.states.set(id, next);
    return { ok: true, ...structuredClone(next), cleanup };
  }
  async upload(path) { this.objects.add(path); }
  async registerUpload(id, documentId, path, fileName, mimeType, size) {
    if (!this.states.get(id)?.documents.some(item => item.id === documentId)) return { ok: false, error: 'DOCUMENT_NOT_FOUND' };
    this.registry.set(path, { telegram_user_id: id, document_id: documentId, path, file_name: fileName, mime_type: mimeType,
      size_bytes: size, created_at: new Date(now).toISOString() });
    return { ok: true, cleanup: [] };
  }
  async remove(paths) { for (const path of paths) this.objects.delete(path); }
  async sign(path) { this.signedPaths.push(path); return `https://storage.example/signed/${path}?token=test`; }
}

function setup(ai = null) {
  const backend = new FakeBackend();
  let sequence = 0;
  const handler = createHandler({ botToken: token, appOrigin: origin, backend, ai, now: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  });
  const request = async (action, data = {}, userId = 101, requestOrigin = origin) => {
    const response = await handler(new Request('https://api.example/functions/v1/kinpass-api', {
      method: 'POST', headers: { origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, initData: signed(userId), ...data }),
    }));
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  return { backend, handler, request };
}

test('Telegram HMAC verifies signed identity and includes the signature field', async () => {
  assert.equal((await verifyInitData(signed(), token, { now })).id, '101');
  assert.equal((await verifyInitData(signed(202, { signature: 'third-party-signature' }), token, { now })).id, '202');
});

test('Telegram identity tampering and wrong bot tokens are rejected', async () => {
  const forged = new URLSearchParams(signed());
  forged.set('user', JSON.stringify({ id: 999, first_name: 'Forged' }));
  await assert.rejects(verifyInitData(forged.toString(), token, { now }), { code: 'INVALID_TELEGRAM_AUTH' });
  await assert.rejects(verifyInitData(signed(), 'wrong-token', { now }), { code: 'INVALID_TELEGRAM_AUTH' });
});

test('Expired, future, duplicate, and signed invalid Telegram users are rejected', async () => {
  await assert.rejects(verifyInitData(signed(101, { auth_date: String(now / 1000 - 3601) }), token, { now }), { code: 'TELEGRAM_AUTH_EXPIRED' });
  await assert.rejects(verifyInitData(signed(101, { auth_date: String(now / 1000 + 31) }), token, { now }), { code: 'INVALID_TELEGRAM_AUTH' });
  await assert.rejects(verifyInitData(`${signed()}&user=other`, token, { now }), { code: 'INVALID_TELEGRAM_AUTH' });
  for (const userId of [0, -1, 1.5, '101', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(verifyInitData(signed(userId), token, { now }), { code: 'INVALID_TELEGRAM_AUTH' });
  }
});

test('Unauthenticated and wrong-origin requests never query sensitive state', async () => {
  const { backend, request, handler } = setup();
  assert.equal((await request('load', { initData: '' })).status, 401);
  assert.equal((await request('load', {}, 101, 'https://evil.example')).status, 403);
  assert.equal((await request('load', {}, 101, '')).status, 403);
  assert.deepEqual(backend.loadCalls, []);
  const preflight = await handler(new Request('https://api.example', { method: 'OPTIONS', headers: { origin } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
});

test('Unauthenticated GET readiness returns only service status without accessing user state', async () => {
  const { backend, handler } = setup();
  const result = await handler(new Request('https://api.example/functions/v1/kinpass-api'));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, service: 'kinpass-api', ai: false });
  assert.deepEqual(backend.loadCalls, []);
});

test('Separate forged client user ID cannot read or overwrite another Telegram account', async () => {
  const { request } = setup();
  assert.equal((await request('save', { documents: [document()], revision: 0 })).status, 200);
  const stranger = await request('load', { userId: '101', telegram_user_id: '101' }, 202);
  assert.deepEqual(stranger.body, { documents: [], institutions: [], revision: 0 });
  assert.equal((await request('save', { documents: [document('other')], revision: 0, userId: '101' }, 202)).status, 200);
  const owner = await request('load');
  assert.equal(owner.body.documents[0].id, 'd1');
});

test('Concurrent saves return one success and one conflict without losing the committed state', async () => {
  const { request } = setup();
  const results = await Promise.all([
    request('save', { documents: [document('first')], revision: 0 }),
    request('save', { documents: [document('second')], revision: 0 }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const successful = results.find(result => result.status === 200);
  const conflict = results.find(result => result.status === 409);
  assert.equal(conflict.body.error, 'REVISION_CONFLICT');
  assert.deepEqual(conflict.body.documents, successful.body.documents);
  assert.equal(conflict.body.revision, 1);
});

test('Document validation rejects impossible dates, reversed ranges, duplicate IDs and excessive count', () => {
  assert.throws(() => validateDocuments([document('d1', { issued: '2026-02-30' })]), { code: 'INVALID_DATE' });
  assert.throws(() => validateDocuments([document('d1', { issued: '2026-10-11', expires: '2026-10-10' })]), { code: 'INVALID_DATE_RANGE' });
  assert.throws(() => validateDocuments([document('d1', { requested: '2026-10-11', expected: '2026-10-10' })]), { code: 'INVALID_DATE_RANGE' });
  assert.throws(() => validateDocuments([document(), document()]), { code: 'DUPLICATE_DOCUMENT_ID' });
  assert.throws(() => validateDocuments(Array.from({ length: 101 }, (_, id) => document(String(id)))), { code: 'INVALID_DOCUMENTS' });
  assert.throws(() => validateDocuments([document('../d1')]), { code: 'INVALID_DOCUMENT_ID' });
  assert.throws(() => validateDocuments([document('d1', { telegram_user_id: 999 })]), { code: 'INVALID_DOCUMENT' });
  assert.equal(validateDocuments([document('d1', { issued: '2024-02-29' })])[0].issued, '2024-02-29');
});

test('Attachment upload requires an already-saved owned document', async () => {
  const { request, backend } = setup();
  const missing = await request('upload', { documentId: 'd1', fileName: 'birth.jpg', dataUrl: photo });
  assert.equal(missing.status, 404);
  await request('save', { documents: [document()], revision: 0 });
  const stranger = await request('upload', { documentId: 'd1', fileName: 'birth.jpg', dataUrl: photo }, 202);
  assert.equal(stranger.status, 404);
  assert.equal(backend.objects.size, 0);
  const result = await request('upload', { documentId: 'd1', fileName: 'birth.jpg', dataUrl: photo });
  assert.equal(result.status, 200);
  assert.match(result.body.file, /^101\/d1\/[a-f0-9-]{36}\.jpg$/);
});

test('Early upload quota prevents Storage writes at the object and byte limits', async () => {
  const { request, backend } = setup();
  await request('save', { documents: [document()], revision: 0 });
  for (let index = 0; index < 120; index++) {
    const path = `101/d1/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.jpg`;
    backend.registry.set(path, { telegram_user_id: '101', path, size_bytes: 100, created_at: new Date(now).toISOString() });
  }
  const byCount = await request('upload', { documentId: 'd1', fileName: 'birth.jpg', dataUrl: photo });
  assert.equal(byCount.status, 413);
  assert.equal(byCount.body.error, 'STORAGE_LIMIT');
  assert.equal(backend.objects.size, 0);
  backend.registry.clear();
  for (let index = 0; index < 110; index++) {
    const path = `101/d1/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.jpg`;
    backend.registry.set(path, { telegram_user_id: '101', path, size_bytes: MAX_FILE_BYTES, created_at: new Date(now).toISOString() });
  }
  assert.equal((await request('upload', { documentId: 'd1', fileName: 'birth.jpg', dataUrl: photo })).body.error, 'STORAGE_LIMIT');
  assert.equal(backend.objects.size, 0);
});

test('Expired abandoned uploads do not permanently block the early quota check', async () => {
  const { request, backend } = setup();
  await request('save', { documents: [document()], revision: 0 });
  for (let index = 0; index < 120; index++) {
    const path = `101/d1/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.jpg`;
    backend.registry.set(path, { telegram_user_id: '101', path, size_bytes: MAX_FILE_BYTES, created_at: new Date(now - 7200000).toISOString() });
  }
  assert.equal((await request('upload', { documentId: 'd1', fileName: 'birth.jpg', dataUrl: photo })).status, 200);
});

test('A quota rejection from the locked registration RPC removes the just-uploaded object', async () => {
  const { request, backend } = setup();
  await request('save', { documents: [document()], revision: 0 });
  backend.registerUpload = async () => ({ ok: false, error: 'STORAGE_LIMIT', cleanup: [] });
  const rejected = await request('upload', { documentId: 'd1', fileName: 'birth.jpg', dataUrl: photo });
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.error, 'STORAGE_LIMIT');
  assert.equal(backend.objects.size, 0);
});

test('A Storage request failure also attempts cleanup of a potentially-created private object', async () => {
  const { request, backend } = setup();
  await request('save', { documents: [document()], revision: 0 });
  backend.upload = async path => { backend.objects.add(path); throw new Error('Connection closed after write'); };
  assert.equal((await request('upload', { documentId: 'd1', fileName: 'birth.jpg', dataUrl: photo })).status, 500);
  assert.equal(backend.objects.size, 0);
  assert.equal(backend.registry.size, 0);
});

test('File signing follows saved attachment ownership and ignores any supplied arbitrary path', async () => {
  const { request, backend } = setup();
  await request('save', { documents: [document()], revision: 0 });
  const upload = await request('upload', { documentId: 'd1', fileName: 'birth.jpg', dataUrl: photo });
  assert.equal((await request('file', { documentId: 'd1', file: upload.body.file })).status, 404);
  await request('save', { documents: [document('d1', upload.body)], revision: 1 });
  const owner = await request('file', { documentId: 'd1', path: '202/d1/forged.jpg' });
  assert.equal(owner.status, 200);
  assert.equal(owner.body.mimeType, 'image/jpeg');
  assert.deepEqual(backend.signedPaths, [upload.body.file]);
  assert.equal((await request('file', { documentId: 'd1', file: upload.body.file }, 202)).status, 404);
  const forgedSave = await request('save', { documents: [document('d1', upload.body)], revision: 0 }, 202);
  assert.equal(forgedSave.status, 400);
  assert.equal(forgedSave.body.error, 'INVALID_ATTACHMENT');
  const unregistered = await request('save', { documents: [document('d1', {
    file: '101/d1/00000000-0000-4000-8000-999999999999.jpg', fileName: 'fake.jpg',
  })], revision: 2 });
  assert.equal(unregistered.body.error, 'INVALID_ATTACHMENT');
});

test('Removing an attachment revokes signing and deletes its object', async () => {
  const { request, backend } = setup();
  await request('save', { documents: [document()], revision: 0 });
  const upload = await request('upload', { documentId: 'd1', fileName: 'birth.jpg', dataUrl: photo });
  await request('save', { documents: [document('d1', upload.body)], revision: 1 });
  const removed = await request('save', { documents: [document()], revision: 2 });
  assert.equal(removed.status, 200);
  assert.equal(backend.objects.size, 0);
  assert.equal(backend.registry.size, 0);
  assert.equal((await request('file', { documentId: 'd1' })).status, 404);
  assert.equal((await request('save', { documents: [document('d1', upload.body)], revision: 3 })).body.error, 'INVALID_ATTACHMENT');
});

test('MIME magic checks reject HTML/SVG masquerading as an allowed document and reject oversized files', () => {
  const html = Buffer.from('<html><script>unsafe</script></html>').toString('base64');
  for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.throws(() => decodeUpload(`data:${mime};base64,${html}`), { code: 'INVALID_FILE_CONTENT' });
  }
  assert.throws(() => decodeUpload('data:image/svg+xml;base64,PHN2Zz4='), { code: 'INVALID_FILE' });
  const large = Buffer.alloc(MAX_FILE_BYTES + 1, 1); large[0] = 255; large[1] = 216; large[2] = 255;
  assert.throws(() => decodeUpload(`data:image/jpeg;base64,${large.toString('base64')}`), { code: 'FILE_TOO_LARGE' });
  assert.equal(decodeUpload(photo).mimeType, 'image/jpeg');
  assert.throws(() => decodeUpload(`data:application/pdf;base64,${Buffer.from('%PDF-1.7').toString('base64')}`), { code: 'INVALID_FILE' });
  for (const [mime, bytes] of [
    ['image/jpeg', Buffer.from([255, 216, 255, 224])],
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['image/webp', Buffer.from('RIFF0000WEBP')],
  ]) assert.equal(decodeUpload(`data:${mime};base64,${bytes.toString('base64')}`).mimeType, mime);
});

test('REST backend always scopes reads by verified ID and uses non-public Storage/sign endpoints', async () => {
  const calls = [];
  const backend = createBackend({ url: 'https://project.supabase.co', serviceKey: 'server-only-test', fetcher: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.includes('/object/sign/') ? { signedURL: '/object/sign/kinpass-documents/test?token=test' } : []), { status: 200 });
  } });
  await backend.load('101');
  await backend.uploads('101', ['101/d1/00000000-0000-4000-8000-000000000001.jpg']);
  assert.equal(new URL(calls[0].url).searchParams.get('telegram_user_id'), 'eq.101');
  assert.equal(new URL(calls[1].url).searchParams.get('telegram_user_id'), 'eq.101');
  assert.equal(await backend.sign('101/d1/test.jpg'), 'https://project.supabase.co/storage/v1/object/sign/kinpass-documents/test?token=test');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer server-only-test');
  assert.equal(JSON.parse(calls[2].options.body).expiresIn, 300);
  assert.ok(calls.every(call => !call.url.includes('/object/public/')));
});

test('Migration blocks direct client access and RPC execution; CAS uses an owner row lock', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261011000100_kinpass.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.kinpass_state enable row level security/i);
  assert.match(sql, /revoke all on public\.kinpass_state, public\.kinpass_uploads from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.kinpass_save_state\(bigint, jsonb, bigint\) from public, anon, authenticated/i);
  assert.match(sql, /create policy kinpass_private_bucket on storage\.objects as restrictive/i);
  assert.match(sql, /where telegram_user_id = p_user_id for update/i);
  assert.match(sql, /if v_state\.revision <> p_revision then/i);
});

const place = (id = 'i1', extra = {}) => ({ id, name: 'Отдел ЗАГС Бельцы', city: 'Бельцы', address: 'ул. Индепенденцей, 1',
  phone: '+373 231 00000', hours: 'Пн–Пт 8:00–17:00', lunch: '12:00–13:00', reception: 'Вт, Чт 9:00–12:00', notes: '',
  source: 'https://maps.google.com/?cid=1', checked: '2026-10-20', ...extra });

test('Institutions are validated, saved with documents in one revision and returned on load', async () => {
  const { request } = setup();
  const saved = await request('save', { documents: [document('d1', { institution: 'i1' })], institutions: [place()], revision: 0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.documents[0].institution, 'i1');
  assert.equal(saved.body.institutions[0].name, 'Отдел ЗАГС Бельцы');
  const loaded = await request('load');
  assert.deepEqual(loaded.body.institutions, saved.body.institutions);
  // A save without the institutions field keeps the stored list.
  const kept = await request('save', { documents: [document('d1')], revision: 1 });
  assert.equal(kept.body.institutions.length, 1);
  assert.equal(kept.body.documents[0].institution, '');
});

test('Invalid institutions are rejected: unknown keys, missing name, bad links, duplicates, too many', () => {
  assert.throws(() => validateInstitutions([place('i1', { extra: 1 })]), { code: 'INVALID_INSTITUTION' });
  assert.throws(() => validateInstitutions([place('i1', { name: '  ' })]), { code: 'INVALID_INSTITUTION' });
  assert.throws(() => validateInstitutions([place('i1', { source: 'javascript:alert(1)' })]), { code: 'INVALID_INSTITUTION' });
  assert.throws(() => validateInstitutions([place('i1', { checked: '2026-02-31' })]), { code: 'INVALID_INSTITUTION' });
  assert.throws(() => validateInstitutions([place('i1'), place('i1')]), { code: 'INVALID_INSTITUTION' });
  assert.throws(() => validateInstitutions(Array.from({ length: 101 }, (_, i) => place(`i${i}`))), { code: 'INVALID_INSTITUTIONS' });
  assert.throws(() => validateDocuments([document('d1', { institution: '../x' })]), { code: 'INVALID_DOCUMENT_ID' });
  assert.equal(validateInstitutions([place('i1', { source: '' })])[0].source, '');
});

test('AI lookup: not configured, success with cleaned fields and https sources, daily limit, failures', async () => {
  assert.equal((await setup().request('lookup', { query: 'ЗАГС', city: 'Бельцы' })).body.error, 'AI_NOT_CONFIGURED');
  const calls = [];
  const ai = { async lookupInstitution(input) {
    calls.push(input);
    return { institution: { name: 'Starea Civilă Bălți', city: 'Бельцы', address: 'str.\n1', phone: '+373', hours: 'Пн–Пт', evil: '<script>', notes: 5 },
      sources: [{ title: 'Google Maps', uri: 'https://maps.google.com/?cid=1', maps: true }, { title: 'bad', uri: 'javascript:1' }] };
  } };
  const { request, backend } = setup(ai);
  assert.equal((await request('lookup', { query: 'x' })).body.error, 'INVALID_LOOKUP');
  const found = await request('lookup', { query: '  ЗАГС  Бельцы ', city: 'Бельцы' });
  assert.equal(found.status, 200);
  assert.deepEqual(calls[0], { query: 'ЗАГС Бельцы', city: 'Бельцы' });
  assert.equal(found.body.institution.address, 'str. 1');
  assert.equal(found.body.institution.notes, '');
  assert.equal('evil' in found.body.institution, false);
  assert.deepEqual(found.body.sources, [{ title: 'Google Maps', uri: 'https://maps.google.com/?cid=1', maps: true }]);
  backend.aiUsage.set('101', AI_DAILY_LIMIT);
  assert.equal((await request('lookup', { query: 'ЗАГС' })).body.error, 'AI_LIMIT');
  const broken = setup({ async lookupInstitution() { throw new Error('down'); } });
  assert.equal((await broken.request('lookup', { query: 'ЗАГС' })).body.error, 'AI_UNAVAILABLE');
  const empty = setup({ async lookupInstitution() { return { institution: { name: 'X' }, sources: [] }; } });
  assert.equal((await empty.request('lookup', { query: 'ЗАГС' })).body.error, 'AI_NOT_FOUND');
});

test('Gemini client sends grounded request and parses JSON answer and sources', async () => {
  let sent;
  const gemini = createGemini({ apiKey: 'test-key', model: 'gemini-test', fetcher: async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n{"name":"ЗАГС","phone":"+373 1"}\n```' }] },
      groundingMetadata: { groundingChunks: [{ maps: { uri: 'https://maps.google.com/?cid=7', title: 'ЗАГС' } }, { web: { uri: 'http://insecure' } }, { maps: { uri: 'https://maps.google.com/?cid=7' } }] } }] }));
  } });
  const result = await gemini.lookupInstitution({ query: 'ЗАГС', city: 'Бельцы' });
  assert.match(sent.url, /\/models\/gemini-test:generateContent$/);
  assert.equal(sent.options.headers['x-goog-api-key'], 'test-key');
  assert.deepEqual(sent.body.tools, [{ google_search: {} }, { googleMaps: {} }]);
  assert.equal(result.institution.phone, '+373 1');
  assert.deepEqual(result.sources, [{ title: 'ЗАГС', uri: 'https://maps.google.com/?cid=7', maps: true }]);
  assert.throws(() => parseJsonObject('нет данных'));
  assert.deepEqual(cleanInstitution({ name: 'a'.repeat(500), phone: 7 }).phone, '');
  const summary = describeCase({ documents: [document('d1', { institution: 'i1', status: 'pending', expected: '2026-11-01' })], institutions: [place()] }, '2026-10-20');
  assert.match(summary, /Сегодня: 2026-10-20/);
  assert.match(summary, /в работе.*ожидается 2026-11-01.*учреждение: Отдел ЗАГС Бельцы/);
  assert.match(summary, /обед: 12:00–13:00/);
});

