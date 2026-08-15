-- ===========================================================================
-- Buildora — Phase P22-J: Backend/data integrations
-- Migration 1/1: runtime data records for collection bindings
--
-- Collection DEFINITIONS are durable Project data (never stored here).
-- This table holds RUNTIME RECORDS only — the values element bindings
-- resolve against in the editor preview and the static export snapshot:
--
--   * data_records — one row per runtime record, keyed by
--     (workspace_id | owner, project_id, collection_id, record_id)
--
-- Security posture (mirrors P14/P15/P16):
--   * RLS on the private table; no direct client writes
--   * all mutations go through SECURITY DEFINER RPCs; actor = auth.uid()
--   * workspace projects: membership/role gates via ws_is_member / ws_role
--   * personal projects: owner-scoped (owner_user_id = auth.uid())
--   * records are size-bounded (256 KB)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.data_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid null references public.workspaces(id) on delete cascade,
  project_id text not null,
  collection_id text not null,
  record_id text not null,
  record jsonb not null,
  owner_user_id uuid null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Personal (workspace_id null) and workspace rows share one uniqueness space
-- per project/collection/record — NULL workspace ids coalesce so personal
-- upserts are idempotent too.
create unique index if not exists idx_data_records_identity
  on public.data_records (
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    project_id,
    collection_id,
    record_id
  );

create index if not exists idx_data_records_ws_project_collection
  on public.data_records (workspace_id, project_id, collection_id);

create index if not exists idx_data_records_owner_project_collection
  on public.data_records (owner_user_id, project_id, collection_id);

-- ---------------------------------------------------------------------------
-- RLS — members/owners read; writes only through RPCs
-- ---------------------------------------------------------------------------

alter table public.data_records enable row level security;

create policy "data records readable by workspace members"
  on public.data_records
  for select
  using (
    (workspace_id is not null and public.ws_is_member(workspace_id))
    or
    (workspace_id is null and owner_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- List runtime records for a collection (members / owner only).
create or replace function public.data_list_records(
  p_workspace_id uuid default null,
  p_project_id text default '',
  p_collection_id text default ''
)
returns table (record_id text, record jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_workspace_id is not null then
    if not public.ws_is_member(p_workspace_id) then
      raise exception 'PERMISSION_DENIED';
    end if;
    return query
      select r.record_id, r.record
      from public.data_records r
      where r.workspace_id = p_workspace_id
        and r.project_id = p_project_id
        and r.collection_id = p_collection_id
      order by r.created_at, r.id;
  else
    if auth.uid() is null then
      raise exception 'PERMISSION_DENIED';
    end if;
    return query
      select r.record_id, r.record
      from public.data_records r
      where r.owner_user_id = auth.uid()
        and r.project_id = p_project_id
        and r.collection_id = p_collection_id
      order by r.created_at, r.id;
  end if;
end;
$$;

-- Upsert one runtime record (editor/owner for workspaces; owner for personal).
-- Returns the stored (record_id, record) so the client gets the canonical row.
create or replace function public.data_save_record(
  p_workspace_id uuid default null,
  p_project_id text default '',
  p_collection_id text default '',
  p_record jsonb default '{}'::jsonb
)
returns table (record_id text, record jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id text;
  v_record jsonb := p_record;
  v_role text;
begin
  if p_workspace_id is not null then
    v_role := public.ws_role(p_workspace_id);
    if v_role not in ('owner', 'editor') then
      raise exception 'PERMISSION_DENIED';
    end if;
  else
    if auth.uid() is null then
      raise exception 'PERMISSION_DENIED';
    end if;
  end if;

  if jsonb_typeof(v_record) <> 'object' then
    raise exception 'PAYLOAD_INVALID';
  end if;
  if octet_length(v_record::text) > 262144 then -- 256 KB (architecture §39)
    raise exception 'PAYLOAD_TOO_LARGE';
  end if;

  v_record_id := v_record->>'id';
  if v_record_id is null or v_record_id = '' then
    v_record_id := gen_random_uuid()::text;
    v_record := v_record || jsonb_build_object('id', v_record_id);
  end if;

  insert into public.data_records (
    workspace_id, project_id, collection_id, record_id, record, owner_user_id
  ) values (
    p_workspace_id, p_project_id, p_collection_id, v_record_id, v_record,
    case when p_workspace_id is null then auth.uid() else null end
  )
  on conflict (
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    project_id, collection_id, record_id
  ) do update
    set record = excluded.record, updated_at = now();

  return query
    select r.record_id, r.record
    from public.data_records r
    where r.project_id = p_project_id
      and r.collection_id = p_collection_id
      and r.record_id = v_record_id
      and (
        (p_workspace_id is not null and r.workspace_id = p_workspace_id)
        or
        (p_workspace_id is null and r.owner_user_id = auth.uid())
      )
    limit 1;
end;
$$;

-- Delete one runtime record (editor/owner for workspaces; owner for personal).
create or replace function public.data_delete_record(
  p_workspace_id uuid default null,
  p_project_id text default '',
  p_collection_id text default '',
  p_record_id text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_workspace_id is not null then
    v_role := public.ws_role(p_workspace_id);
    if v_role not in ('owner', 'editor') then
      raise exception 'PERMISSION_DENIED';
    end if;
    delete from public.data_records
    where workspace_id = p_workspace_id
      and project_id = p_project_id
      and collection_id = p_collection_id
      and record_id = p_record_id;
  else
    if auth.uid() is null then
      raise exception 'PERMISSION_DENIED';
    end if;
    delete from public.data_records
    where owner_user_id = auth.uid()
      and project_id = p_project_id
      and collection_id = p_collection_id
      and record_id = p_record_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — authenticated role only; anon never.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  for fn in select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'data_list_records', 'data_save_record', 'data_delete_record'
    )
  loop
    execute format('revoke all on function %s from public, anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end;
$$;
