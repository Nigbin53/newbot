-- Browser clients use only kinpass-api. Neither the database nor the private
-- bucket accepts the public anon/authenticated credentials for this app.
create table public.kinpass_state (
  telegram_user_id bigint primary key check (telegram_user_id > 0),
  documents jsonb not null default '[]'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint kinpass_document_array check (
    jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) <= 100
    and octet_length(documents::text) <= 131072
  )
);

create table public.kinpass_uploads (
  path text primary key,
  telegram_user_id bigint not null references public.kinpass_state(telegram_user_id) on delete cascade,
  document_id text not null check (document_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  file_name text not null check (length(file_name) between 1 and 180),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 3145728),
  created_at timestamptz not null default now(),
  constraint kinpass_owned_upload_path check (
    split_part(path, '/', 1) = telegram_user_id::text and split_part(path, '/', 2) = document_id
  )
);
create index kinpass_upload_owner on public.kinpass_uploads (telegram_user_id);

alter table public.kinpass_state enable row level security;
alter table public.kinpass_uploads enable row level security;
revoke all on public.kinpass_state, public.kinpass_uploads from public, anon, authenticated;
grant select, insert, update, delete on public.kinpass_state, public.kinpass_uploads to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kinpass-documents', 'kinpass-documents', false, 3145728,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A restrictive policy protects this bucket even if another application has
-- already installed a broad permissive Storage policy in the same project.
create policy kinpass_private_bucket on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'kinpass-documents')
with check (bucket_id <> 'kinpass-documents');

create function public.kinpass_save_state(p_user_id bigint, p_documents jsonb, p_revision bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_state public.kinpass_state%rowtype;
  v_document jsonb;
  v_cleanup text[] := array[]::text[];
begin
  if p_user_id is null or p_user_id <= 0 or p_revision is null or p_revision < 0
    or p_documents is null or jsonb_typeof(p_documents) <> 'array'
    or jsonb_array_length(p_documents) > 100 or octet_length(p_documents::text) > 131072 then
    raise exception 'Invalid state';
  end if;
  insert into public.kinpass_state (telegram_user_id) values (p_user_id) on conflict do nothing;
  select * into v_state from public.kinpass_state where telegram_user_id = p_user_id for update;
  if v_state.revision <> p_revision then
    return jsonb_build_object('ok', false, 'documents', v_state.documents, 'revision', v_state.revision);
  end if;
  for v_document in select value from jsonb_array_elements(p_documents) loop
    if coalesce(v_document->>'file', '') <> '' and not exists (
      select 1 from public.kinpass_uploads u where u.telegram_user_id = p_user_id
        and u.document_id = v_document->>'id' and u.path = v_document->>'file'
        and u.file_name = v_document->>'fileName'
    ) then
      return jsonb_build_object('ok', false, 'error', 'INVALID_ATTACHMENT');
    end if;
  end loop;
  -- Replacing/removing attachments revokes their metadata before object cleanup.
  -- The same lock covers every save and registration for this Telegram account.
  with removed as (
    delete from public.kinpass_uploads u
    where u.telegram_user_id = p_user_id
      and exists (select 1 from jsonb_array_elements(v_state.documents) d where d->>'file' = u.path)
      and not exists (select 1 from jsonb_array_elements(p_documents) d where d->>'file' = u.path)
    returning path
  ) select coalesce(array_agg(path), array[]::text[]) into v_cleanup from removed;
  update public.kinpass_state set documents = p_documents, revision = revision + 1, updated_at = now()
    where telegram_user_id = p_user_id returning * into v_state;
  return jsonb_build_object('ok', true, 'documents', v_state.documents, 'revision', v_state.revision, 'cleanup', v_cleanup);
end $$;

create function public.kinpass_register_upload(
  p_user_id bigint, p_document_id text, p_path text, p_file_name text, p_mime_type text, p_size integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_state public.kinpass_state%rowtype;
  v_cleanup text[] := array[]::text[];
  v_upload_count bigint;
  v_upload_bytes bigint;
begin
  select * into v_state from public.kinpass_state where telegram_user_id = p_user_id for update;
  if not found or not exists (select 1 from jsonb_array_elements(v_state.documents) d where d->>'id' = p_document_id) then
    return jsonb_build_object('ok', false, 'error', 'DOCUMENT_NOT_FOUND');
  end if;
  -- Abandoned uploads are private and expire from the registry after one hour.
  with removed as (
    delete from public.kinpass_uploads u where u.telegram_user_id = p_user_id
      and u.created_at < now() - interval '1 hour'
      and not exists (select 1 from jsonb_array_elements(v_state.documents) d where d->>'file' = u.path)
    returning path
  ) select coalesce(array_agg(path), array[]::text[]) into v_cleanup from removed;
  select count(*), coalesce(sum(size_bytes), 0) into v_upload_count, v_upload_bytes
    from public.kinpass_uploads where telegram_user_id = p_user_id;
  if v_upload_count >= 120 or v_upload_bytes + p_size > 346030080 then
    return jsonb_build_object('ok', false, 'error', 'STORAGE_LIMIT', 'cleanup', v_cleanup);
  end if;
  insert into public.kinpass_uploads (path, telegram_user_id, document_id, file_name, mime_type, size_bytes)
    values (p_path, p_user_id, p_document_id, p_file_name, p_mime_type, p_size);
  return jsonb_build_object('ok', true, 'cleanup', v_cleanup);
end $$;

revoke all on function public.kinpass_save_state(bigint, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.kinpass_register_upload(bigint, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.kinpass_save_state(bigint, jsonb, bigint) to service_role;
grant execute on function public.kinpass_register_upload(bigint, text, text, text, text, integer) to service_role;
