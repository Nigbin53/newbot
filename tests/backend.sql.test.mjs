import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const doc = (extra = {}) => ({ id: 'd1', name: 'Birth certificate', owner: 'self', city: 'Test',
  status: 'todo', issued: '', expires: '', days: 7, requested: '', expected: '', file: '', fileName: '', ...extra });
const path = (owner = 101, sequence = 1, documentId = 'd1') => `${owner}/${documentId}/00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}.jpg`;

// Storage itself is an external HTTP service. These fixtures provide its real
// schema surface and Supabase roles so the actual PostgreSQL migration can run.
before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema storage;
    grant usage on schema public, storage to anon, authenticated, service_role;
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id bigint generated always as identity primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
    grant usage, select on all sequences in schema storage to anon, authenticated, service_role;
    -- Simulate an existing unsafe allow-all policy installed by another app.
    create policy existing_broad_access on storage.objects for all to anon, authenticated
      using (true) with check (true);
  `);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, directory), 'utf8'));
  }
});

beforeEach(async () => { await db.exec('reset role; truncate public.kinpass_uploads, public.kinpass_state, public.kinpass_ai_usage, storage.objects restart identity cascade;'); });
after(async () => { await db.close(); });

async function asRole(role, work) {
  await db.exec(`set role ${role}`);
  try { return await work(); }
  finally { await db.exec('reset role'); }
}
async function save(owner, documents, revision, institutions = null) {
  return await asRole('service_role', async () => {
    const result = await db.query('select public.kinpass_save_state($1, $2::jsonb, $3, $4::jsonb) as result', [owner, JSON.stringify(documents), revision, institutions === null ? null : JSON.stringify(institutions)]);
    return result.rows[0].result;
  });
}
async function register(owner = 101, sequence = 1, size = 100, documentId = 'd1') {
  return await asRole('service_role', async () => {
    const result = await db.query('select public.kinpass_register_upload($1,$2,$3,$4,$5,$6) as result',
      [owner, documentId, path(owner, sequence, documentId), 'birth.jpg', 'image/jpeg', size]);
    return result.rows[0].result;
  });
}

test('Actual migration creates a private bounded bucket and isolated state tables', async () => {
  const bucket = (await db.query("select * from storage.buckets where id='kinpass-documents'")).rows[0];
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 3145728);
  assert.deepEqual(bucket.allowed_mime_types.sort(), ['image/jpeg', 'image/png', 'image/webp']);
  const rls = (await db.query("select relname, relrowsecurity from pg_class where relname in ('kinpass_state','kinpass_uploads')")).rows;
  assert.equal(rls.length, 2);
  assert.ok(rls.every(row => row.relrowsecurity));
});

test('Real PostgreSQL CAS preserves state on stale revisions and isolates accounts', async () => {
  const first = await save(101, [doc()], 0);
  assert.equal(first.ok, true);
  assert.equal(first.revision, 1);
  const stale = await save(101, [doc({ name: 'Lost edit' })], 0);
  assert.equal(stale.ok, false);
  assert.equal(stale.revision, 1);
  assert.equal(stale.documents[0].name, 'Birth certificate');
  const secondAccount = await save(202, [doc({ name: 'Other account' })], 0);
  assert.equal(secondAccount.revision, 1);
  const owner = (await db.query('select documents,revision from public.kinpass_state where telegram_user_id=101')).rows[0];
  assert.equal(owner.documents[0].name, 'Birth certificate');
  assert.equal(Number(owner.revision), 1);
});

test('Real RPC attachment checks reject another account/document, unknown paths and revoked files', async () => {
  await save(101, [doc()], 0);
  const registered = await register();
  assert.equal(registered.ok, true);
  const attachment = doc({ file: path(), fileName: 'birth.jpg' });
  assert.equal((await save(202, [attachment], 0)).error, 'INVALID_ATTACHMENT');
  assert.equal((await save(101, [doc({ id: 'd2', file: path(), fileName: 'birth.jpg' })], 1)).error, 'INVALID_ATTACHMENT');
  assert.equal((await save(101, [doc({ file: path(101, 999), fileName: 'fake.jpg' })], 1)).error, 'INVALID_ATTACHMENT');
  assert.equal((await save(101, [doc({ file: path(), fileName: 'spoof.jpg' })], 1)).error, 'INVALID_ATTACHMENT');
  const linked = await save(101, [attachment], 1);
  assert.equal(linked.ok, true);
  assert.equal(linked.revision, 2);
  const removed = await save(101, [doc()], 2);
  assert.deepEqual(removed.cleanup, [path()]);
  assert.equal((await db.query('select count(*)::int as count from public.kinpass_uploads')).rows[0].count, 0);
  assert.equal((await save(101, [attachment], 3)).error, 'INVALID_ATTACHMENT');
  assert.equal((await db.query('select revision from public.kinpass_state where telegram_user_id=101')).rows[0].revision, 3);
});

test('Real RPC enforces document existence and Storage ownership path constraints', async () => {
  assert.equal((await register()).error, 'DOCUMENT_NOT_FOUND');
  await save(101, [doc()], 0);
  assert.equal((await register(101, 1, 100, 'missing')).error, 'DOCUMENT_NOT_FOUND');
  await assert.rejects(asRole('service_role', () => db.query(
    'select public.kinpass_register_upload($1,$2,$3,$4,$5,$6)', [101, 'd1', path(202), 'birth.jpg', 'image/jpeg', 100],
  )), { code: '23514' });
  assert.equal((await db.query('select count(*)::int as count from public.kinpass_uploads')).rows[0].count, 0);
});

test('Real RPC blocks a 121st registered upload under the account row lock', async () => {
  await save(101, [doc()], 0);
  await db.query(`insert into public.kinpass_uploads (path,telegram_user_id,document_id,file_name,mime_type,size_bytes)
    select '101/d1/00000000-0000-4000-8000-' || lpad(n::text,12,'0') || '.jpg',101,'d1','birth.jpg','image/jpeg',100
    from generate_series(1,120) n`);
  const denied = await register(101, 121);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'STORAGE_LIMIT');
  assert.equal((await db.query('select count(*)::int as count from public.kinpass_uploads')).rows[0].count, 120);
});

test('Real RPC caps total storage at 330MiB and keeps other users outside the quota', async () => {
  await save(101, [doc()], 0);
  await save(202, [doc()], 0);
  await db.query(`insert into public.kinpass_uploads (path,telegram_user_id,document_id,file_name,mime_type,size_bytes)
    select '101/d1/00000000-0000-4000-8000-' || lpad(n::text,12,'0') || '.jpg',101,'d1','birth.jpg','image/jpeg',3145728
    from generate_series(1,110) n`);
  assert.equal((await register(101, 111, 1)).error, 'STORAGE_LIMIT');
  assert.equal((await register(202, 1, 100)).ok, true);
});

test('Abandoned uploads expire before quota checks; referenced older attachments stay valid', async () => {
  await save(101, [doc()], 0);
  await register(101, 1);
  await register(101, 2);
  await save(101, [doc({ file: path(), fileName: 'birth.jpg' })], 1);
  await db.query("update public.kinpass_uploads set created_at=now()-interval '2 hours'");
  const registered = await register(101, 3);
  assert.deepEqual(registered.cleanup, [path(101, 2)]);
  const remaining = (await db.query('select path from public.kinpass_uploads order by path')).rows.map(row => row.path);
  assert.deepEqual(remaining, [path(101, 1), path(101, 3)]);
});

test('Anon and authenticated cannot read/write app tables or execute privileged RPCs', async () => {
  await save(101, [doc()], 0);
  for (const role of ['anon', 'authenticated']) {
    for (const statement of [
      'select * from public.kinpass_state',
      'select * from public.kinpass_uploads',
      "insert into public.kinpass_state(telegram_user_id) values(999)",
      "select public.kinpass_save_state(101,'[]'::jsonb,1,null)",
      "select public.kinpass_register_upload(101,'d1','bad','bad.jpg','image/jpeg',1)",
    ]) await assert.rejects(asRole(role, () => db.query(statement)), { code: '42501' });
  }
});

test('Restrictive Storage policy blocks this private bucket despite existing allow-all policy', async () => {
  await db.query("insert into storage.objects(bucket_id,name) values ('kinpass-documents','private.jpg'),('other-bucket','public.png')");
  for (const role of ['anon', 'authenticated']) {
    const visible = await asRole(role, () => db.query('select bucket_id from storage.objects'));
    assert.deepEqual(visible.rows, [{ bucket_id: 'other-bucket' }]);
    await assert.rejects(asRole(role, () => db.query("insert into storage.objects(bucket_id,name) values('kinpass-documents','forged.jpg')")), { code: '42501' });
  }
  const server = await asRole('service_role', () => db.query("select name from storage.objects where bucket_id='kinpass-documents'"));
  assert.deepEqual(server.rows, [{ name: 'private.jpg' }]);
});

test('Institutions migration: saved with documents under one revision; null keeps the list; conflict returns it', async () => {
  const place = { id: 'i1', name: 'ЗАГС', city: 'Бельцы' };
  const first = await save(101, [doc({ institution: 'i1' })], 0, [place]);
  assert.equal(first.ok, true);
  assert.deepEqual(first.institutions, [place]);
  const kept = await save(101, [doc()], 1);
  assert.deepEqual(kept.institutions, [place]);
  const stale = await save(101, [doc()], 0, []);
  assert.equal(stale.ok, false);
  assert.deepEqual(stale.institutions, [place]);
  await assert.rejects(save(101, [doc()], 2, { not: 'array' }));
});

test('AI daily quota is counted per account and blocked for anon/authenticated', async () => {
  const take = (owner, limit) => asRole('service_role', async () => (await db.query('select public.kinpass_ai_take($1, $2) as ok', [owner, limit])).rows[0].ok);
  assert.equal(await take(101, 2), true);
  assert.equal(await take(101, 2), true);
  assert.equal(await take(101, 2), false);
  assert.equal(await take(202, 2), true);
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asRole(role, () => db.query('select public.kinpass_ai_take(101, 100)')), { code: '42501' });
    await assert.rejects(asRole(role, () => db.query('select * from public.kinpass_ai_usage')), { code: '42501' });
  }
});

test('«Путь» state is saved with compare-and-swap and keeps the earlier Kinpass columns', async () => {
  const savePut = (owner, state, revision) => asRole('service_role', async () => (await db.query('select public.kinpass_save_put($1, $2::jsonb, $3) as r', [owner, JSON.stringify(state), revision])).rows[0].r);
  await save(101, [doc()], 0, [{ id: 'i1', name: 'ЗАГС', city: 'Бельцы' }]);
  const first = await savePut(101, { version: 3, documents: [] }, 1);
  assert.equal(first.ok, true);
  assert.equal(first.revision, 2);
  const stale = await savePut(101, { version: 3, documents: [{ id: 'lost' }] }, 1);
  assert.equal(stale.ok, false);
  assert.deepEqual(stale.put, { version: 3, documents: [] });
  const row = (await db.query('select documents, institutions from public.kinpass_state where telegram_user_id = 101')).rows[0];
  assert.equal(row.documents.length, 1);
  assert.equal(row.institutions[0].name, 'ЗАГС');
  await assert.rejects(savePut(101, [1, 2], 2));
  await assert.rejects(asRole('anon', () => db.query("select public.kinpass_save_put(101, '{}'::jsonb, 2)")), { code: '42501' });
});

