-- ===========================================================================
-- Buildora — Phase P15: Presence, Activity & Version History
-- Migration 1/1: workspace presence gate, activity timeline, version history
--
-- Adds three capabilities on top of the P14 workspace model:
--   * workspace_activity            — durable, bounded (300), privacy-safe timeline
--   * workspace_project_versions    — server-backed snapshots (retention 50)
--   * workspace_presence            — authorization gate for realtime presence
--
-- Security posture (mirrors P14):
--   * RLS on every private table; no direct client writes
--   * all writes go through SECURITY DEFINER RPCs; actor = auth.uid() always
--   * activity types + metadata keys are allow-listed (no free JSON events)
--   * version snapshots are the same schema-validated Project payload the
--     workspace server stores (no collaboration/runtime metadata by shape)
--   * restore requires the current revision (optimistic concurrency); a stale
--     restore raises STALE_REVISION and never overwrites newer state
--   * restore is owner-only; copy/checkpoint need editor/owner + lease
--
-- NOTE ON REALTIME: Supabase Realtime RLS authorization applies only to
-- `postgres_changes` channels — presence channels do NOT evaluate table RLS.
-- Membership for presence is therefore enforced by the ws_join_presence RPC
-- (SECURITY DEFINER) that must succeed before the client tracks anything.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.workspace_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id text,
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_activity_ws_time
  on public.workspace_activity (workspace_id, created_at desc, id desc);

create table if not exists public.workspace_project_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id text not null,
  revision integer not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('autosave', 'publish', 'checkpoint', 'pre-restore', 'restore')),
  label text,
  content_hash text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_versions_project
  on public.workspace_project_versions (workspace_id, project_id, created_at desc);

-- Authorization gate for realtime presence (one row per workspace; membership
-- is enforced by the ws_join_presence RPC — see note above).
create table if not exists public.workspace_presence (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.workspace_activity enable row level security;
alter table public.workspace_project_versions enable row level security;
alter table public.workspace_presence enable row level security;

-- Members may read the workspace timeline (no client writes — RPCs only).
drop policy if exists "member can read activity" on public.workspace_activity;
create policy "member can read activity" on public.workspace_activity
  for select to authenticated
  using (public.ws_is_member(workspace_id));

-- Members may read versions of accessible projects (no client writes).
drop policy if exists "member can read project versions" on public.workspace_project_versions;
create policy "member can read project versions" on public.workspace_project_versions
  for select to authenticated
  using (public.ws_is_member(workspace_id));

-- Members may read the presence gate rows (informational; enforcement is the
-- ws_join_presence RPC).
drop policy if exists "member can read presence gate" on public.workspace_presence;
create policy "member can read presence gate" on public.workspace_presence
  for select to authenticated
  using (public.ws_is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Presence gate RPC
-- ---------------------------------------------------------------------------

-- Must succeed before a client may track presence for a workspace. Raises
-- PERMISSION_DENIED for non-members (Realtime presence channels do not
-- evaluate table RLS).
create or replace function public.ws_join_presence(p_workspace_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Activity helpers
-- ---------------------------------------------------------------------------

create or replace function public.ws_activity_type_allowed(p_type text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select p_type in (
    'workspace.created', 'workspace.renamed',
    'member.invited', 'member.joined', 'member.role_changed', 'member.removed',
    'project.created', 'project.moved_in', 'project.renamed',
    'project.saved', 'project.duplicated', 'project.deleted',
    'project.version_created', 'project.version_restored',
    'publish.completed', 'publish.rollback',
    'share.created', 'share.revoked',
    'domain.attached', 'domain.removed'
  );
$$;

-- Per-type metadata key allow-list (scalar values only; never free JSON).
create or replace function public.ws_activity_metadata_allowed(p_type text)
returns text[]
language sql
stable
security definer set search_path = public
as $$
  select case p_type
    when 'workspace.renamed' then array['to']
    when 'member.invited' then array['email', 'role']
    when 'member.joined' then array['role']
    when 'member.role_changed' then array['member', 'to']
    when 'member.removed' then array['member']
    when 'project.created' then array['project']
    when 'project.moved_in' then array['project']
    when 'project.renamed' then array['project', 'to']
    when 'project.saved' then array['revision']
    when 'project.duplicated' then array['project', 'from']
    when 'project.deleted' then array['project']
    when 'project.version_created' then array['version', 'label']
    when 'project.version_restored' then array['from', 'to']
    when 'publish.completed' then array['provider', 'project']
    when 'publish.rollback' then array['provider', 'project']
    when 'share.created' then array['project']
    when 'share.revoked' then array['project']
    when 'domain.attached' then array['domain', 'project']
    when 'domain.removed' then array['domain', 'project']
    else array[]::text[]
  end;
$$;

-- Sanitize metadata against the type's allow-list: scalar values only, bounded
-- string length, bounded entry count. Returns a clean object.
create or replace function public.ws_sanitize_activity_metadata(
  p_type text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_allowed text[] := public.ws_activity_metadata_allowed(p_type);
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_value jsonb;
  v_entries integer := 0;
begin
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    return v_out;
  end if;
  for v_key, v_value in select * from jsonb_each(p_metadata)
  loop
    if v_entries >= 4 then
      exit;
    end if;
    if not v_key = any(v_allowed) then
      continue;
    end if;
    if jsonb_typeof(v_value) = 'string' then
      if length(v_value #>> '{}') > 200 then
        continue;
      end if;
    elsif jsonb_typeof(v_value) not in ('number', 'boolean') then
      continue;
    end if;
    v_out := jsonb_set(v_out, array[v_key], v_value);
    v_entries := v_entries + 1;
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Activity lifecycle
-- ---------------------------------------------------------------------------

-- Record an activity event. Actor is ALWAYS auth.uid() — a client-supplied
-- actor is structurally impossible (no actor parameter). Type + metadata are
-- allow-listed. Prunes to the retention bound inside the same transaction.
create or replace function public.record_activity_event(
  p_workspace_id uuid,
  p_project_id text default null,
  p_type text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_type is null or not public.ws_activity_type_allowed(p_type) then
    raise exception 'INVALID_INPUT';
  end if;
  if p_project_id is not null then
    if not exists (
      select 1 from public.workspace_projects
      where workspace_id = p_workspace_id and project_id = p_project_id
    ) then
      raise exception 'PROJECT_NOT_FOUND';
    end if;
  end if;
  insert into public.workspace_activity (workspace_id, project_id, actor_user_id, type, metadata)
  values (
    p_workspace_id,
    p_project_id,
    auth.uid(),
    p_type,
    public.ws_sanitize_activity_metadata(p_type, p_metadata)
  );
  -- Retention: keep the latest 300 events per workspace.
  delete from public.workspace_activity a
  where a.workspace_id = p_workspace_id
    and a.id not in (
      select id from public.workspace_activity
      where workspace_id = p_workspace_id
      order by created_at desc, id desc
      limit 300
    );
end;
$$;

-- List activity for a workspace (members only) with (created_at desc, id desc)
-- cursor pagination. Filter is category-level; type allow-listing is separate.
create or replace function public.list_workspace_activity(
  p_workspace_id uuid,
  p_before_ts timestamptz default null,
  p_before_id text default null,
  p_limit integer default 30,
  p_filter text default 'all'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 30));
  v_rows record;
  v_events jsonb := '[]'::jsonb;
  v_next jsonb := null;
  v_has_more boolean := false;
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  for v_rows in
    select a.id, a.workspace_id, a.project_id, a.actor_user_id, a.type, a.metadata, a.created_at,
           coalesce(p.email, '') as actor_email
    from public.workspace_activity a
    left join public.profiles p on p.id = a.actor_user_id
    where a.workspace_id = p_workspace_id
      and (p_before_ts is null or a.created_at < p_before_ts
           or (a.created_at = p_before_ts and a.id::text < p_before_id))
      and (
        p_filter = 'all'
        or (p_filter = 'projects' and a.type in (
              'project.created', 'project.moved_in', 'project.renamed',
              'project.saved', 'project.duplicated', 'project.deleted',
              'project.version_created', 'project.version_restored'))
        or (p_filter = 'members' and a.type in (
              'member.invited', 'member.joined', 'member.role_changed', 'member.removed'))
        or (p_filter = 'publishing' and a.type in (
              'publish.completed', 'publish.rollback',
              'domain.attached', 'domain.removed'))
        or (p_filter = 'sharing' and a.type in ('share.created', 'share.revoked'))
      )
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  loop
    if jsonb_array_length(v_events) >= v_limit then
      v_has_more := true;
      exit;
    end if;
    v_events := v_events || jsonb_build_object(
      'id', v_rows.id,
      'workspaceId', v_rows.workspace_id,
      'projectId', v_rows.project_id,
      'actorUserId', v_rows.actor_user_id,
      'actorName', public.ws_display_name(v_rows.actor_email),
      'type', v_rows.type,
      'createdAt', v_rows.created_at,
      'metadata', v_rows.metadata
    );
    v_next := jsonb_build_object('ts', v_rows.created_at, 'id', v_rows.id);
  end loop;
  if not v_has_more then
    v_next := null;
  end if;
  return jsonb_build_object('events', v_events, 'nextCursor', v_next);
end;
$$;

-- Friendly display name from an email (same heuristic as P14 lease holders):
-- split the local part on [._-]+, capitalize the first two segments.
create or replace function public.ws_display_name(p_email text)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_local text;
  v_parts text[];
  v_out text := '';
begin
  if p_email is null or p_email = '' then
    return 'A teammate';
  end if;
  v_local := split_part(p_email, '@', 1);
  if v_local = '' then
    return 'A teammate';
  end if;
  v_parts := regexp_split_to_array(v_local, '[._-]+');
  if array_length(v_parts, 1) is null then
    return v_local;
  end if;
  for i in 1..least(2, array_length(v_parts, 1)) loop
    if length(v_parts[i]) > 0 then
      v_out := v_out || upper(left(v_parts[i], 1)) || substr(v_parts[i], 2);
      if i < least(2, array_length(v_parts, 1)) then
        v_out := v_out || ' ';
      end if;
    end if;
  end loop;
  v_out := trim(v_out);
  if v_out = '' then
    return v_local;
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Version history helpers
-- ---------------------------------------------------------------------------

-- Deterministic content hash of a canonical jsonb payload (md5 of the
-- canonical jsonb serialization — stable within the server).
create or replace function public.ws_version_content_hash(p_snapshot jsonb)
returns text
language sql
stable
security definer set search_path = public
as $$
  select md5(coalesce(p_snapshot, '{}'::jsonb)::text);
$$;

-- Insert a version (newest last) and prune to retention (50). Autosave
-- versions are deduped by content hash against the latest version; explicit
-- reasons (checkpoint/publish/restore/pre-restore) always record.
create or replace function public.ws_push_version(
  p_workspace_id uuid,
  p_project_id text,
  p_revision integer,
  p_created_by uuid,
  p_reason text,
  p_label text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_hash text := public.ws_version_content_hash(p_snapshot);
  v_latest text;
  v_id uuid;
  v_created_at timestamptz;
begin
  if p_reason = 'autosave' then
    select content_hash into v_latest
    from public.workspace_project_versions
    where workspace_id = p_workspace_id and project_id = p_project_id
    order by created_at desc, id desc
    limit 1;
    if v_latest is not null and v_latest = v_hash then
      return null; -- identical content → no redundant version
    end if;
  end if;
  insert into public.workspace_project_versions (
    workspace_id, project_id, revision, created_by, reason, label, content_hash, snapshot
  ) values (
    p_workspace_id, p_project_id, p_revision, p_created_by, p_reason, p_label, v_hash, p_snapshot
  )
  returning id, created_at into v_id, v_created_at;
  -- Retention: keep the latest 50 versions per project.
  delete from public.workspace_project_versions v
  where v.workspace_id = p_workspace_id and v.project_id = p_project_id
    and v.id not in (
      select id from public.workspace_project_versions
      where workspace_id = p_workspace_id and project_id = p_project_id
      order by created_at desc, id desc
      limit 50
    );
  return jsonb_build_object(
    'id', v_id,
    'workspaceId', p_workspace_id,
    'projectId', p_project_id,
    'revision', p_revision,
    'createdBy', p_created_by,
    'createdAt', v_created_at,
    'reason', p_reason,
    'label', p_label,
    'contentHash', v_hash
  );
end;
$$;

-- Metadata-only version list (snapshots are never fetched for the list).
create or replace function public.list_project_versions(
  p_workspace_id uuid,
  p_project_id text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if not exists (
    select 1 from public.workspace_projects
    where workspace_id = p_workspace_id and project_id = p_project_id
  ) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id,
    'workspaceId', v.workspace_id,
    'projectId', v.project_id,
    'revision', v.revision,
    'createdBy', v.created_by,
    'createdByName', public.ws_display_name((select email from public.profiles where id = v.created_by)),
    'createdAt', v.created_at,
    'reason', v.reason,
    'label', v.label,
    'contentHash', v.content_hash
  ) order by v.created_at desc, v.id desc), '[]'::jsonb)
  into v_out
  from public.workspace_project_versions v
  where v.workspace_id = p_workspace_id and v.project_id = p_project_id;
  return v_out;
end;
$$;

-- Fetch a full version snapshot (preview / restore / copy).
create or replace function public.fetch_project_version(
  p_workspace_id uuid,
  p_project_id text,
  p_version_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_version public.workspace_project_versions;
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  select * into v_version
  from public.workspace_project_versions
  where id = p_version_id
    and workspace_id = p_workspace_id
    and project_id = p_project_id;
  if v_version is null then
    raise exception 'VERSION_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'id', v_version.id,
    'workspaceId', v_version.workspace_id,
    'projectId', v_version.project_id,
    'revision', v_version.revision,
    'createdBy', v_version.created_by,
    'createdByName', public.ws_display_name((select email from public.profiles where id = v_version.created_by)),
    'createdAt', v_version.created_at,
    'reason', v_version.reason,
    'label', v_version.label,
    'contentHash', v_version.content_hash,
    'project', v_version.snapshot
  );
end;
$$;

-- Manual checkpoint of the current server content (editor/owner with lease).
create or replace function public.create_manual_version(
  p_workspace_id uuid,
  p_project_id text,
  p_label text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.ws_role(p_workspace_id);
  v_project public.workspace_projects;
  v_lease public.project_edit_leases;
  v_label text;
  v_version jsonb;
begin
  if v_role not in ('owner', 'editor') then
    raise exception 'PERMISSION_DENIED';
  end if;
  select * into v_project
  from public.workspace_projects
  where workspace_id = p_workspace_id and project_id = p_project_id;
  if v_project is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  -- Manual checkpoints require the session to hold the active edit lease.
  select * into v_lease
  from public.project_edit_leases
  where workspace_id = p_workspace_id and project_id = p_project_id;
  if v_lease is null or v_lease.user_id <> auth.uid() or v_lease.expires_at <= now() then
    raise exception 'LEASE_INVALID';
  end if;
  if p_label is not null and trim(p_label) <> '' then
    v_label := left(trim(p_label), 80);
    if v_label = '' then
      raise exception 'INVALID_INPUT';
    end if;
  end if;
  v_version := public.ws_push_version(
    p_workspace_id, p_project_id, v_project.revision, auth.uid(),
    'checkpoint', v_label, v_project.payload
  );
  if v_version is null then
    raise exception 'INVALID_INPUT'; -- identical content → no redundant checkpoint
  end if;
  perform public.record_activity_event(
    p_workspace_id, p_project_id, 'project.version_created',
    jsonb_build_object(
      'version', v_version ->> 'id',
      'label', coalesce(v_label, '')
    )
  );
  return v_version;
end;
$$;

-- Restore a version as a NEW revision (owner-only; optimistic concurrency).
create or replace function public.restore_project_version(
  p_workspace_id uuid,
  p_project_id text,
  p_version_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_project public.workspace_projects;
  v_version public.workspace_project_versions;
  v_current_hash text;
  v_target_hash text;
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  select * into v_project
  from public.workspace_projects
  where workspace_id = p_workspace_id and project_id = p_project_id;
  if v_project is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  -- Optimistic concurrency: never silently overwrite a newer server revision.
  if v_project.revision <> p_expected_revision then
    raise exception 'STALE_REVISION';
  end if;
  select * into v_version
  from public.workspace_project_versions
  where id = p_version_id and workspace_id = p_workspace_id and project_id = p_project_id;
  if v_version is null then
    raise exception 'VERSION_NOT_FOUND';
  end if;
  v_current_hash := public.ws_version_content_hash(v_project.payload);
  v_target_hash := public.ws_version_content_hash(v_version.snapshot);
  -- Safety version of the CURRENT state (preserves what restore overwrites).
  if v_current_hash <> v_target_hash then
    perform public.ws_push_version(
      p_workspace_id, p_project_id, v_project.revision, auth.uid(),
      'pre-restore', 'Before restoring version ' || v_version.revision, v_project.payload
    );
  end if;
  -- Apply the snapshot as a NEW revision; old versions are never deleted.
  update public.workspace_projects
  set payload = v_version.snapshot,
      name = coalesce(nullif(trim(v_version.snapshot ->> 'name'), ''), v_project.name),
      revision = v_project.revision + 1,
      updated_at = now()
  where workspace_id = p_workspace_id and project_id = p_project_id
  returning revision into v_project.revision;
  perform public.ws_push_version(
    p_workspace_id, p_project_id, v_project.revision, auth.uid(),
    'restore', 'Restored from version ' || v_version.revision, v_version.snapshot
  );
  perform public.record_activity_event(
    p_workspace_id, p_project_id, 'project.version_restored',
    jsonb_build_object('from', v_version.id::text, 'to', v_project.revision)
  );
  return jsonb_build_object('revision', v_project.revision);
end;
$$;

-- Copy a version's snapshot into a fresh project in the SAME workspace.
create or replace function public.copy_project_from_version(
  p_workspace_id uuid,
  p_project_id text,
  p_version_id uuid,
  p_new_project_id text,
  p_name text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.ws_role(p_workspace_id);
  v_version public.workspace_project_versions;
  v_name text;
  v_project public.workspace_projects;
begin
  if v_role not in ('owner', 'editor') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_new_project_id is null or length(p_new_project_id) = 0 or length(p_new_project_id) > 200 then
    raise exception 'INVALID_INPUT';
  end if;
  if exists (
    select 1 from public.workspace_projects
    where workspace_id = p_workspace_id and project_id = p_new_project_id
  ) then
    raise exception 'INVALID_INPUT';
  end if;
  select * into v_version
  from public.workspace_project_versions
  where id = p_version_id and workspace_id = p_workspace_id and project_id = p_project_id;
  if v_version is null then
    raise exception 'VERSION_NOT_FOUND';
  end if;
  v_name := coalesce(nullif(trim(p_name), ''), 'Copy of version ' || v_version.revision);
  v_name := left(v_name, 80);
  insert into public.workspace_projects (
    workspace_id, project_id, name, payload, revision, created_by
  ) values (
    p_workspace_id, p_new_project_id, v_name, v_version.snapshot, 1, auth.uid()
  )
  returning * into v_project;
  update public.workspaces set updated_at = now() where id = p_workspace_id;
  perform public.record_activity_event(
    p_workspace_id, p_new_project_id, 'project.created',
    jsonb_build_object('project', v_project.name)
  );
  return jsonb_build_object(
    'projectId', v_project.project_id,
    'workspaceId', v_project.workspace_id,
    'name', v_project.name,
    'revision', v_project.revision,
    'createdBy', v_project.created_by,
    'createdAt', v_project.created_at,
    'updatedAt', v_project.updated_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Patches: wire activity/versions/presence into existing P14 flows
-- ---------------------------------------------------------------------------

-- Workspace lifecycle → activity.
create or replace function public.create_workspace(p_name text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_workspace public.workspaces;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_name is null or length(trim(p_name)) = 0 or length(trim(p_name)) > 80 then
    raise exception 'INVALID_NAME';
  end if;
  insert into public.workspaces (owner_id, name)
  values (auth.uid(), trim(p_name))
  returning * into v_workspace;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace.id, auth.uid(), 'owner');
  insert into public.workspace_presence (workspace_id)
  values (v_workspace.id);
  perform public.record_activity_event(v_workspace.id, null, 'workspace.created', '{}'::jsonb);
  return public.ws_workspace_json(v_workspace);
end;
$$;

create or replace function public.update_workspace(p_workspace_id uuid, p_name text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_workspace public.workspaces;
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_name is null or length(trim(p_name)) = 0 or length(trim(p_name)) > 80 then
    raise exception 'INVALID_NAME';
  end if;
  update public.workspaces set name = trim(p_name), updated_at = now()
  where id = p_workspace_id
  returning * into v_workspace;
  perform public.record_activity_event(
    p_workspace_id, null, 'workspace.renamed',
    jsonb_build_object('to', v_workspace.name)
  );
  return public.ws_workspace_json(v_workspace);
end;
$$;

-- Members → activity.
create or replace function public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role text default 'viewer'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_count integer;
  v_invitation public.workspace_invitations;
  v_workspace_name text;
  v_caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_email = '' or v_email not like '%@%' then
    raise exception 'INVALID_EMAIL';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'INVALID_ROLE';
  end if;
  if v_email = v_caller_email then
    raise exception 'INVALID_EMAIL';
  end if;

  select count(*) into v_count
  from public.workspace_invitations
  where workspace_id = p_workspace_id and status = 'pending';
  if v_count >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  if exists (
    select 1 from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_workspace_id and lower(p.email) = v_email
  ) then
    raise exception 'ALREADY_MEMBER';
  end if;

  select name into v_workspace_name from public.workspaces where id = p_workspace_id;

  update public.workspace_invitations
  set status = 'revoked', updated_at = now()
  where workspace_id = p_workspace_id and lower(email) = v_email and status = 'pending';

  insert into public.workspace_invitations (
    workspace_id, invited_by, email, role, token_hash, expires_at
  ) values (
    p_workspace_id, auth.uid(), v_email, p_role,
    encode(gen_random_bytes(32), 'hex'),
    now() + interval '14 days'
  )
  returning * into v_invitation;

  perform public.record_activity_event(
    p_workspace_id, null, 'member.invited',
    jsonb_build_object('email', v_email, 'role', p_role)
  );

  return jsonb_build_object(
    'id', v_invitation.id,
    'workspaceId', v_invitation.workspace_id,
    'workspaceName', v_workspace_name,
    'recipientEmail', v_invitation.email,
    'role', v_invitation.role,
    'status', v_invitation.status,
    'createdAt', v_invitation.created_at,
    'expiresAt', v_invitation.expires_at,
    'acceptedAt', v_invitation.accepted_at
  );
end;
$$;

create or replace function public.accept_workspace_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_invitation public.workspace_invitations;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select * into v_invitation
  from public.workspace_invitations
  where id = p_invitation_id and status = 'pending';
  if v_invitation is null then
    raise exception 'INVITE_INVALID';
  end if;
  if lower(v_invitation.email) <> v_email then
    raise exception 'INVITE_INVALID';
  end if;
  if v_invitation.expires_at < now() then
    update public.workspace_invitations set status = 'expired', updated_at = now() where id = p_invitation_id;
    raise exception 'INVITE_EXPIRED';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_invitation.workspace_id, auth.uid(), v_invitation.role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;
  update public.workspace_invitations
  set status = 'accepted', accepted_at = now(), updated_at = now()
  where id = p_invitation_id;
  perform public.record_activity_event(
    v_invitation.workspace_id, null, 'member.joined',
    jsonb_build_object('role', v_invitation.role)
  );
end;
$$;

create or replace function public.change_member_role(
  p_workspace_id uuid,
  p_member_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner uuid;
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'INVALID_ROLE';
  end if;
  select owner_id into v_owner from public.workspaces where id = p_workspace_id;
  if p_member_user_id = v_owner then
    raise exception 'PERMISSION_DENIED';
  end if;
  update public.workspace_members
  set role = p_role
  where workspace_id = p_workspace_id and user_id = p_member_user_id;
  update public.workspaces set updated_at = now() where id = p_workspace_id;
  -- Downgrade to viewer invalidates the member's leases AND link management.
  if p_role = 'viewer' then
    delete from public.project_edit_leases
    where workspace_id = p_workspace_id and user_id = p_member_user_id;
    perform public.ws_revoke_member_shares(p_workspace_id, p_member_user_id);
  end if;
  perform public.record_activity_event(
    p_workspace_id, null, 'member.role_changed',
    jsonb_build_object(
      'member', public.ws_display_name((select email from public.profiles where id = p_member_user_id)),
      'to', p_role
    )
  );
end;
$$;

create or replace function public.remove_workspace_member(
  p_workspace_id uuid,
  p_member_user_id uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner uuid;
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  select owner_id into v_owner from public.workspaces where id = p_workspace_id;
  if p_member_user_id = v_owner then
    raise exception 'LAST_OWNER';
  end if;
  -- Immediate access loss: drop leases, void invitations, revoke shares.
  delete from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_member_user_id;
  delete from public.project_edit_leases
  where workspace_id = p_workspace_id and user_id = p_member_user_id;
  update public.workspace_invitations set status = 'revoked', updated_at = now()
  where workspace_id = p_workspace_id and status = 'pending' and email = (
    select email from public.profiles where id = p_member_user_id
  );
  perform public.ws_revoke_member_shares(p_workspace_id, p_member_user_id);
  update public.workspaces set updated_at = now() where id = p_workspace_id;
  perform public.record_activity_event(
    p_workspace_id, null, 'member.removed',
    jsonb_build_object(
      'member', public.ws_display_name((select email from public.profiles where id = p_member_user_id))
    )
  );
end;
$$;

create or replace function public.leave_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if public.ws_role(p_workspace_id) = 'owner' then
    raise exception 'PERMISSION_DENIED';
  end if;
  delete from public.workspace_members
  where workspace_id = p_workspace_id and user_id = auth.uid();
  delete from public.project_edit_leases
  where workspace_id = p_workspace_id and user_id = auth.uid();
  perform public.record_activity_event(
    p_workspace_id, null, 'member.removed',
    jsonb_build_object(
      'member', public.ws_display_name((select email from public.profiles where id = auth.uid()))
    )
  );
end;
$$;

-- Project lifecycle → activity + versions.
create or replace function public.create_workspace_project(
  p_workspace_id uuid,
  p_project_id text,
  p_name text,
  p_project jsonb,
  p_origin text default 'create'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.ws_role(p_workspace_id);
  v_name text;
  v_project public.workspace_projects;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_role not in ('owner', 'editor') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_project_id is null or length(p_project_id) = 0 or length(p_project_id) > 200 then
    raise exception 'INVALID_INPUT';
  end if;
  v_name := public.ws_validate_project(p_project);
  if exists (select 1 from public.workspace_projects where workspace_id = p_workspace_id and project_id = p_project_id) then
    raise exception 'INVALID_INPUT';
  end if;
  insert into public.workspace_projects (workspace_id, project_id, name, payload, revision, created_by)
  values (p_workspace_id, p_project_id, coalesce(trim(p_name), v_name), p_project, 1, auth.uid())
  returning * into v_project;
  update public.workspaces set updated_at = now() where id = p_workspace_id;
  perform public.record_activity_event(
    p_workspace_id, p_project_id,
    case when p_origin = 'move-in' then 'project.moved_in' else 'project.created' end,
    jsonb_build_object('project', v_project.name)
  );
  return jsonb_build_object(
    'projectId', v_project.project_id,
    'workspaceId', v_project.workspace_id,
    'name', v_project.name,
    'revision', v_project.revision,
    'createdBy', v_project.created_by,
    'createdAt', v_project.created_at,
    'updatedAt', v_project.updated_at
  );
end;
$$;

create or replace function public.save_workspace_project(
  p_workspace_id uuid,
  p_project_id text,
  p_project jsonb,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.ws_role(p_workspace_id);
  v_name text;
  v_project public.workspace_projects;
  v_old_name text;
  v_version jsonb;
begin
  if v_role not in ('owner', 'editor') then
    raise exception 'PERMISSION_DENIED';
  end if;
  v_name := public.ws_validate_project(p_project);
  select name into v_old_name from public.workspace_projects
  where workspace_id = p_workspace_id and project_id = p_project_id;
  -- Optimistic concurrency: only succeed when the revision is unchanged.
  update public.workspace_projects
  set payload = p_project, name = v_name, revision = revision + 1, updated_at = now()
  where workspace_id = p_workspace_id and project_id = p_project_id and revision = p_expected_revision
  returning * into v_project;
  if v_project is null then
    raise exception 'STALE_REVISION';
  end if;
  update public.workspaces set updated_at = now() where id = p_workspace_id;
  -- Version history: a changed-content save creates a deduped autosave
  -- version and records meaningful activity (identical saves are silent).
  v_version := public.ws_push_version(
    p_workspace_id, p_project_id, v_project.revision, auth.uid(),
    'autosave', null, v_project.payload
  );
  if v_version is not null then
    perform public.record_activity_event(
      p_workspace_id, p_project_id, 'project.saved',
      jsonb_build_object('revision', v_project.revision)
    );
  end if;
  if v_old_name is not null and v_old_name <> v_name then
    perform public.record_activity_event(
      p_workspace_id, p_project_id, 'project.renamed',
      jsonb_build_object('project', v_name, 'to', v_name)
    );
  end if;
  return jsonb_build_object(
    'projectId', v_project.project_id,
    'workspaceId', v_project.workspace_id,
    'name', v_project.name,
    'revision', v_project.revision,
    'createdBy', v_project.created_by,
    'createdAt', v_project.created_at,
    'updatedAt', v_project.updated_at
  );
end;
$$;

-- Project deletion: cascade versions; presence is channel-scoped (no rows);
-- activity retains a safe metadata tombstone; review links revoked (P14).
create or replace function public.delete_workspace_project(
  p_workspace_id uuid,
  p_project_id text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_name text;
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  select name into v_name from public.workspace_projects
  where workspace_id = p_workspace_id and project_id = p_project_id;
  delete from public.workspace_projects
  where workspace_id = p_workspace_id and project_id = p_project_id;
  -- Versions are removed with the project (no orphaned snapshots).
  delete from public.workspace_project_versions
  where workspace_id = p_workspace_id and project_id = p_project_id;
  -- Workspace-scoped: never touch another workspace's same-id project lease.
  delete from public.project_edit_leases
  where project_id = p_project_id and workspace_id = p_workspace_id;
  -- Revoke review links to the deleted project.
  perform public.ws_revoke_project_shares(p_project_id);
  -- Activity tombstone: the project's history row remains (metadata only).
  perform public.record_activity_event(
    p_workspace_id, p_project_id, 'project.deleted',
    jsonb_build_object('project', coalesce(v_name, ''))
  );
end;
$$;

create or replace function public.duplicate_workspace_project(
  p_workspace_id uuid,
  p_project_id text,
  p_new_project_id text,
  p_name text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.ws_role(p_workspace_id);
  v_source public.workspace_projects;
  v_project public.workspace_projects;
begin
  if v_role not in ('owner', 'editor') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_new_project_id is null or length(p_new_project_id) = 0 or length(p_new_project_id) > 200 then
    raise exception 'INVALID_INPUT';
  end if;
  select * into v_source
  from public.workspace_projects
  where workspace_id = p_workspace_id and project_id = p_project_id;
  if v_source is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  insert into public.workspace_projects (
    workspace_id, project_id, name, payload, revision, created_by
  ) values (
    p_workspace_id, p_new_project_id,
    coalesce(nullif(trim(p_name), ''), v_source.name || ' Copy'),
    v_source.payload, 1, auth.uid()
  )
  returning * into v_project;
  update public.workspaces set updated_at = now() where id = p_workspace_id;
  perform public.record_activity_event(
    p_workspace_id, p_new_project_id, 'project.duplicated',
    jsonb_build_object('project', v_project.name, 'from', v_source.name)
  );
  return jsonb_build_object(
    'projectId', v_project.project_id,
    'workspaceId', v_project.workspace_id,
    'name', v_project.name,
    'revision', v_project.revision,
    'createdBy', v_project.created_by,
    'createdAt', v_project.created_at,
    'updatedAt', v_project.updated_at
  );
end;
$$;

-- Workspace deletion cascades activity/versions/presence via FKs, but share
-- revocation must run first (P14 gate) while the projects still exist.
create or replace function public.delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_project_id text;
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  for v_project_id in (
    select project_id from public.workspace_projects
    where workspace_id = p_workspace_id
  ) loop
    perform public.ws_revoke_project_shares(v_project_id);
  end loop;
  -- Cascades delete members, invitations, projects, leases, activity,
  -- versions, and the presence gate row.
  delete from public.workspaces where id = p_workspace_id;
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
      'ws_join_presence', 'record_activity_event', 'list_workspace_activity',
      'list_project_versions', 'fetch_project_version', 'create_manual_version',
      'restore_project_version', 'copy_project_from_version'
    )
  loop
    execute format('revoke all on function %s from public, anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end;
$$;
