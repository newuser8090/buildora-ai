-- ===========================================================================
-- Buildora — Phase P16: Real-Time Collaborative Editing
-- Migration 1/1: durable collaborative update log + RLS + RPCs
--
-- Real-time relay uses Supabase Realtime Broadcast channels (collab:{ws}:{pid}).
-- Broadcast is a delivery hint only — DURABLE collaborative state lives here:
--
--   * workspace_project_collab_updates — incremental Yjs updates (base64),
--     retained between the checkpoint frontier and the live seq, pruned by
--     the checkpoint RPC (bounded growth — architecture §26)
--   * workspace_project_collab_locks   — owner-only maintenance lock for
--     project-wide replacement (version restore / import) — architecture §45
--
-- The durable checkpoint is the EXISTING P14 workspace_projects save path:
-- the collab client calls save_workspace_project with the projected canonical
-- Project (optimistic concurrency), then prunes the update log via
-- ws_collab_checkpoint. No second copy of the project is stored.
--
-- Security posture (mirrors P14/P15):
--   * RLS on every private table; no direct client writes
--   * all mutations go through SECURITY DEFINER RPCs; actor = auth.uid() always
--   * join/list/catch-up require workspace membership (viewers included — they
--     must see live updates without mutating)
--   * append/checkpoint require editor/owner; lock is owner-only
--   * updates are size-bounded (256 KB); the log is pruned at every checkpoint
--   * removed/downgraded members are denied by the same membership helpers
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.workspace_project_collab_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id text not null,
  state text not null, -- base64 canonical Yjs state
  updated_at timestamptz not null default now(),
  primary key (workspace_id, project_id)
);

create table if not exists public.workspace_project_collab_updates (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id text not null,
  seq bigint not null,
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  data text not null, -- base64-encoded Yjs update
  created_at timestamptz not null default now(),
  primary key (workspace_id, project_id, seq)
);

create index if not exists idx_collab_updates_ws_project_seq
  on public.workspace_project_collab_updates (workspace_id, project_id, seq);

create table if not exists public.workspace_project_collab_locks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id text not null,
  holder_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, project_id)
);

-- ---------------------------------------------------------------------------
-- Realtime publication (members receive live updates; RLS still gates reads)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.workspace_project_collab_updates;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — members only; no direct writes
-- ---------------------------------------------------------------------------

alter table public.workspace_project_collab_state enable row level security;
alter table public.workspace_project_collab_updates enable row level security;
alter table public.workspace_project_collab_locks enable row level security;

create policy "collab state readable by workspace members"
  on public.workspace_project_collab_state
  for select
  using (public.ws_is_member(workspace_id));

create policy "collab updates readable by workspace members"
  on public.workspace_project_collab_updates
  for select
  using (public.ws_is_member(workspace_id));

create policy "collab locks readable by workspace members"
  on public.workspace_project_collab_locks
  for select
  using (public.ws_is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Durable base + frontier for joining/catching up (member-visible).
create or replace function public.ws_collab_get_state(
  p_workspace_id uuid,
  p_project_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_seq bigint;
  v_checkpoint_seq bigint;
  v_project jsonb;
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  select max(seq) into v_max_seq
    from public.workspace_project_collab_updates
    where workspace_id = p_workspace_id and project_id = p_project_id;
  v_max_seq := coalesce(v_max_seq, 0);
  -- The checkpoint frontier is the highest project revision that has been
  -- durably saved (the room's durable base is the workspace project payload).
  select revision into v_checkpoint_seq
    from public.workspace_projects
    where workspace_id = p_workspace_id and project_id = p_project_id;
  v_checkpoint_seq := coalesce(v_checkpoint_seq, 0);
  select payload into v_project
    from public.workspace_projects
    where workspace_id = p_workspace_id and project_id = p_project_id;
  return jsonb_build_object(
    'seq', v_max_seq,
    'checkpointSeq', v_checkpoint_seq,
    'base', coalesce(v_project, '{}'::jsonb),
    'state', (
      select state from public.workspace_project_collab_state
      where workspace_id = p_workspace_id and project_id = p_project_id
    )
  );
end;
$$;

-- List updates after a frontier (member-visible catch-up; bounded at 500 rows).
create or replace function public.ws_collab_list_updates(
  p_workspace_id uuid,
  p_project_id text,
  p_after_seq bigint
)
returns table (seq bigint, data text, actor_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  return query
    select u.seq, u.data, u.actor_user_id
    from public.workspace_project_collab_updates u
    where u.workspace_id = p_workspace_id
      and u.project_id = p_project_id
      and u.seq > p_after_seq
    order by u.seq
    limit 500;
end;
$$;

-- Append one binary Yjs update (editor/owner only). Returns the new seq.
create or replace function public.ws_collab_append_update(
  p_workspace_id uuid,
  p_project_id text,
  p_update text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
  v_locked boolean;
  v_role text := public.ws_role(p_workspace_id);
begin
  if v_role not in ('owner', 'editor') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if octet_length(p_update) > 262144 then -- 256 KB (architecture §39)
    raise exception 'PAYLOAD_TOO_LARGE';
  end if;
  select exists (
    select 1 from public.workspace_project_collab_locks
    where workspace_id = p_workspace_id and project_id = p_project_id
      and holder_user_id <> auth.uid()
  ) into v_locked;
  if v_locked then
    raise exception 'LOCKED';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq
    from public.workspace_project_collab_updates
    where workspace_id = p_workspace_id and project_id = p_project_id;
  insert into public.workspace_project_collab_updates (
    workspace_id, project_id, seq, actor_user_id, data
  ) values (p_workspace_id, p_project_id, v_seq, auth.uid(), p_update);
  return v_seq;
end;
$$;

-- Prune the retained update log after a durable checkpoint (editor/owner) and
-- refresh the canonical state so late joiners converge to identical structs.
-- Ordering: the canonical state is written BEFORE the log is pruned, inside the
-- same function (single PL/pgSQL transaction) — a prune can never leave the
-- room without an adequate canonical snapshot (architecture §10).
create or replace function public.ws_collab_checkpoint(
  p_workspace_id uuid,
  p_project_id text,
  p_seq bigint,
  p_state text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ws_role(p_workspace_id);
begin
  if v_role not in ('owner', 'editor') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_state is not null and octet_length(p_state) <= 262144 then
    insert into public.workspace_project_collab_state (
      workspace_id, project_id, state, updated_at
    ) values (p_workspace_id, p_project_id, p_state, now())
    on conflict (workspace_id, project_id) do update
      set state = excluded.state, updated_at = now();
  end if;
  delete from public.workspace_project_collab_updates
  where workspace_id = p_workspace_id
    and project_id = p_project_id
    and seq <= p_seq;
end;
$$;

-- Seed the canonical state (first writer wins, race-safe). Returns the state
-- to apply: null when THIS client's seed won, the existing state otherwise.
--
-- Atomicity: INSERT ... ON CONFLICT DO NOTHING means two concurrent first
-- seeds cannot both win — one insert succeeds, the other no-ops, and both
-- re-read the row. (A SELECT-then-INSERT pattern would let both see "no row"
-- and upsert, making the LAST writer win — that is exactly what this avoids.)
create or replace function public.ws_collab_seed(
  p_workspace_id uuid,
  p_project_id text,
  p_state text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ws_role(p_workspace_id);
  v_existing text;
begin
  if v_role not in ('owner', 'editor') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if octet_length(p_state) > 262144 then
    raise exception 'PAYLOAD_TOO_LARGE';
  end if;
  insert into public.workspace_project_collab_state (
    workspace_id, project_id, state, updated_at
  ) values (p_workspace_id, p_project_id, p_state, now())
  on conflict (workspace_id, project_id) do nothing;
  select state into v_existing from public.workspace_project_collab_state
    where workspace_id = p_workspace_id and project_id = p_project_id;
  if v_existing = p_state then
    return null; -- our seed won (identical content)
  end if;
  return v_existing; -- another client won the seed
end;
$$;

-- Owner-only maintenance lock (version restore / import).
create or replace function public.ws_collab_lock(
  p_workspace_id uuid,
  p_project_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  insert into public.workspace_project_collab_locks (
    workspace_id, project_id, holder_user_id
  ) values (p_workspace_id, p_project_id, auth.uid())
  on conflict (workspace_id, project_id) do update
    set holder_user_id = auth.uid(), created_at = now();
end;
$$;

create or replace function public.ws_collab_unlock(
  p_workspace_id uuid,
  p_project_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.workspace_project_collab_locks
  where workspace_id = p_workspace_id
    and project_id = p_project_id
    and holder_user_id = auth.uid();
end;
$$;

-- Reset the room after a project-wide replacement (restore/import): clear the
-- log, the canonical state, and the lock so connected clients rebase from the
-- new base and late joiners seed fresh (a stale canonical state would otherwise
-- resurrect pre-restore content).
create or replace function public.ws_collab_reset(
  p_workspace_id uuid,
  p_project_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  delete from public.workspace_project_collab_updates
  where workspace_id = p_workspace_id and project_id = p_project_id;
  delete from public.workspace_project_collab_state
  where workspace_id = p_workspace_id and project_id = p_project_id;
  delete from public.workspace_project_collab_locks
  where workspace_id = p_workspace_id and project_id = p_project_id;
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
      'ws_collab_get_state', 'ws_collab_list_updates', 'ws_collab_append_update',
      'ws_collab_checkpoint', 'ws_collab_seed', 'ws_collab_lock', 'ws_collab_unlock',
      'ws_collab_reset'
    )
  loop
    execute format('revoke all on function %s from public, anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end;
$$;
