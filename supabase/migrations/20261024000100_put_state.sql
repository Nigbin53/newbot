-- «Путь»: the whole case (documents of three generations, trips, orders, submission)
-- is stored as one JSON document per Telegram account. The earlier Kinpass columns
-- (documents, institutions) stay untouched as the source of the first conversion.
alter table public.kinpass_state add column put_state jsonb;
alter table public.kinpass_state add constraint kinpass_put_state_shape check (
  put_state is null or (jsonb_typeof(put_state) = 'object' and octet_length(put_state::text) <= 262144)
);

create function public.kinpass_save_put(p_user_id bigint, p_state jsonb, p_revision bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_state public.kinpass_state%rowtype;
begin
  if p_user_id is null or p_user_id <= 0 or p_revision is null or p_revision < 0 or p_state is null
    or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 262144 then
    raise exception 'Invalid state';
  end if;
  insert into public.kinpass_state (telegram_user_id) values (p_user_id) on conflict do nothing;
  select * into v_state from public.kinpass_state where telegram_user_id = p_user_id for update;
  if v_state.revision <> p_revision then
    return jsonb_build_object('ok', false, 'put', v_state.put_state, 'revision', v_state.revision);
  end if;
  update public.kinpass_state set put_state = p_state, revision = revision + 1, updated_at = now()
    where telegram_user_id = p_user_id returning * into v_state;
  return jsonb_build_object('ok', true, 'put', v_state.put_state, 'revision', v_state.revision);
end $$;

revoke all on function public.kinpass_save_put(bigint, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.kinpass_save_put(bigint, jsonb, bigint) to service_role;
