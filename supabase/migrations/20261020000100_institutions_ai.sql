-- Institutions list (addresses, phones, hours) stored next to documents in the
-- same row, so a single compare-and-swap save keeps both consistent.
alter table public.kinpass_state add column institutions jsonb not null default '[]'::jsonb;
alter table public.kinpass_state add constraint kinpass_institution_array check (
  jsonb_typeof(institutions) = 'array' and jsonb_array_length(institutions) <= 100
  and octet_length(institutions::text) <= 131072
);

drop function public.kinpass_save_state(bigint, jsonb, bigint);

-- p_institutions = null keeps the stored list unchanged.
create function public.kinpass_save_state(p_user_id bigint, p_documents jsonb, p_revision bigint, p_institutions jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_state public.kinpass_state%rowtype;
  v_document jsonb;
  v_cleanup text[] := array[]::text[];
begin
  if p_user_id is null or p_user_id <= 0 or p_revision is null or p_revision < 0
    or p_documents is null or jsonb_typeof(p_documents) <> 'array'
    or jsonb_array_length(p_documents) > 100 or octet_length(p_documents::text) > 131072
    or (p_institutions is not null and (jsonb_typeof(p_institutions) <> 'array'
      or jsonb_array_length(p_institutions) > 100 or octet_length(p_institutions::text) > 131072)) then
    raise exception 'Invalid state';
  end if;
  insert into public.kinpass_state (telegram_user_id) values (p_user_id) on conflict do nothing;
  select * into v_state from public.kinpass_state where telegram_user_id = p_user_id for update;
  if v_state.revision <> p_revision then
    return jsonb_build_object('ok', false, 'documents', v_state.documents, 'institutions', v_state.institutions, 'revision', v_state.revision);
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
  with removed as (
    delete from public.kinpass_uploads u
    where u.telegram_user_id = p_user_id
      and exists (select 1 from jsonb_array_elements(v_state.documents) d where d->>'file' = u.path)
      and not exists (select 1 from jsonb_array_elements(p_documents) d where d->>'file' = u.path)
    returning path
  ) select coalesce(array_agg(path), array[]::text[]) into v_cleanup from removed;
  update public.kinpass_state set documents = p_documents, institutions = coalesce(p_institutions, institutions),
    revision = revision + 1, updated_at = now()
    where telegram_user_id = p_user_id returning * into v_state;
  return jsonb_build_object('ok', true, 'documents', v_state.documents, 'institutions', v_state.institutions,
    'revision', v_state.revision, 'cleanup', v_cleanup);
end $$;

-- Daily AI request counter per Telegram account (institution search + bot answers).
create table public.kinpass_ai_usage (
  telegram_user_id bigint not null check (telegram_user_id > 0),
  day date not null,
  requests integer not null default 0 check (requests >= 0),
  primary key (telegram_user_id, day)
);
alter table public.kinpass_ai_usage enable row level security;
revoke all on public.kinpass_ai_usage from public, anon, authenticated;
grant select, insert, update, delete on public.kinpass_ai_usage to service_role;

create function public.kinpass_ai_take(p_user_id bigint, p_limit integer)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ok boolean;
begin
  if p_user_id is null or p_user_id <= 0 or p_limit is null or p_limit < 1 then return false; end if;
  insert into public.kinpass_ai_usage as u (telegram_user_id, day, requests) values (p_user_id, current_date, 1)
    on conflict (telegram_user_id, day) do update set requests = u.requests + 1 where u.requests < p_limit
    returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

revoke all on function public.kinpass_save_state(bigint, jsonb, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.kinpass_ai_take(bigint, integer) from public, anon, authenticated;
grant execute on function public.kinpass_save_state(bigint, jsonb, bigint, jsonb) to service_role;
grant execute on function public.kinpass_ai_take(bigint, integer) to service_role;
