-- ===========================================================================
-- Buildora — Phase P14: Team Workspaces & Controlled Collaboration
-- Migration 1/1: workspaces schema, RLS, SECURITY DEFINER RPCs
--
-- Model:
--   * workspaces            — owner_id + name
--   * workspace_members     — role rows for every member (owner included)
--   * workspace_invitations — recipient-scoped, expiring, revocable
--   * workspace_projects    — server-authoritative validated payload + revision
--   * project_edit_leases   — short-lived renewable edit leases
--
-- Security posture (mirrors P6/P12):
--   * RLS on every private table; no direct client writes
--   * all mutations go through SECURITY DEFINER RPCs that verify auth.uid(),
--     membership, and role
--   * invitations are recipient-scoped (auth.jwt() ->> 'email')
--   * optimistic concurrency on workspace_projects (expected revision)
--   * owner invariants: a workspace always has an owner; the last owner can
--     never be removed or downgraded
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  role text not null check (role in ('editor', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);

create table if not exists public.workspace_projects (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id text not null,
  name text not null,
  payload jsonb not null,
  revision integer not null default 1,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, project_id)
);

create table if not exists public.project_edit_leases (
  project_id text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lease_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  -- A project id is only unique WITHIN a workspace; a same-id project in
  -- another workspace must never share or block this workspace's lease.
  unique (workspace_id, project_id)
);

create index if not exists idx_workspace_members_user on public.workspace_members (user_id);
create index if not exists idx_workspace_invitations_email on public.workspace_invitations (email);
create index if not exists idx_workspace_projects_workspace on public.workspace_projects (workspace_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.workspace_projects enable row level security;
alter table public.project_edit_leases enable row level security;

-- Direct reads are allowed only through narrow membership-based policies;
-- writes are exclusively RPC-mediated.
drop policy if exists "member can read workspace" on public.workspaces;
create policy "member can read workspace" on public.workspaces
  for select to authenticated
  using (
    owner_id = auth.uid() or
    exists (select 1 from public.workspace_members m where m.workspace_id = id and m.user_id = auth.uid())
  );

drop policy if exists "member can read members" on public.workspace_members;
create policy "member can read members" on public.workspace_members
  for select to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and (w.owner_id = auth.uid() or exists (
        select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = auth.uid()
      ))
    )
  );

drop policy if exists "member can read workspace projects" on public.workspace_projects;
create policy "member can read workspace projects" on public.workspace_projects
  for select to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and (w.owner_id = auth.uid() or exists (
        select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = auth.uid()
      ))
    )
  );

-- All writes happen inside SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- Is the current user a member (any role incl. owner) of a workspace?
create or replace function public.ws_is_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and (w.owner_id = auth.uid() or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = w.id and m.user_id = auth.uid()
    ))
  );
$$;

-- Is the current user the owner of a workspace?
create or replace function public.ws_is_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = auth.uid()
  );
$$;

-- Role of the current user in a workspace ('owner' | 'editor' | 'viewer').
create or replace function public.ws_role(p_workspace_id uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_role text;
begin
  if exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid()) then
    return 'owner';
  end if;
  select role into v_role from public.workspace_members m
  where m.workspace_id = p_workspace_id and m.user_id = auth.uid();
  return coalesce(v_role, 'viewer');
end;
$$;

-- Workspace JSON view for the current viewer.
create or replace function public.ws_workspace_json(w public.workspaces)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', w.id,
    'name', w.name,
    'ownerId', w.owner_id,
    'createdAt', w.created_at,
    'updatedAt', w.updated_at,
    'memberCount', (select count(*) from public.workspace_members m where m.workspace_id = w.id) + 1,
    'projectCount', (select count(*) from public.workspace_projects p where p.workspace_id = w.id),
    'memberRole', public.ws_role(w.id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Workspace lifecycle
-- ---------------------------------------------------------------------------

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
  return public.ws_workspace_json(v_workspace);
end;
$$;

create or replace function public.delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  -- Cascades delete members, invitations, projects, leases.
  delete from public.workspaces where id = p_workspace_id;
end;
$$;

create or replace function public.list_workspaces()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_owned jsonb;
  v_shared jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select coalesce(jsonb_agg(public.ws_workspace_json(w) order by w.updated_at desc), '[]'::jsonb)
  into v_owned
  from public.workspaces w where w.owner_id = auth.uid();
  select coalesce(jsonb_agg(public.ws_workspace_json(w) order by w.updated_at desc), '[]'::jsonb)
  into v_shared
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = auth.uid() and w.owner_id <> auth.uid();
  return jsonb_build_object('owned', v_owned, 'shared', v_shared);
end;
$$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

create or replace function public.list_workspace_members(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'workspaceId', m.workspace_id,
      'userId', m.user_id,
      'email', p.email,
      'role', m.role,
      'joinedAt', m.joined_at
    ) order by p.email asc), '[]'::jsonb)
    from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_workspace_id and m.user_id <> (
      select owner_id from public.workspaces where id = p_workspace_id
    )
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
  -- Downgrade to viewer invalidates the member's leases.
  if p_role = 'viewer' then
    delete from public.project_edit_leases
    where workspace_id = p_workspace_id and user_id = p_member_user_id;
  end if;
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
  delete from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_member_user_id;
  -- Immediate access loss: drop leases and void pending invitations.
  delete from public.project_edit_leases
  where workspace_id = p_workspace_id and user_id = p_member_user_id;
  update public.workspace_invitations set status = 'revoked', updated_at = now()
  where workspace_id = p_workspace_id and status = 'pending' and email = (
    select email from public.profiles where id = p_member_user_id
  );
  update public.workspaces set updated_at = now() where id = p_workspace_id;
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

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

  -- Already a member?
  if exists (
    select 1 from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_workspace_id and lower(p.email) = v_email
  ) then
    raise exception 'ALREADY_MEMBER';
  end if;

  select name into v_workspace_name from public.workspaces where id = p_workspace_id;

  -- Replace any prior pending invitation for the same workspace + email.
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

create or replace function public.list_my_workspace_invitations()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  update public.workspace_invitations
  set status = 'expired', updated_at = now()
  where status = 'pending' and expires_at < now();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'workspaceId', i.workspace_id,
      'workspaceName', w.name,
      'recipientEmail', i.email,
      'role', i.role,
      'status', i.status,
      'createdAt', i.created_at,
      'expiresAt', i.expires_at,
      'acceptedAt', i.accepted_at
    ) order by i.created_at desc), '[]'::jsonb)
    from public.workspace_invitations i
    join public.workspaces w on w.id = i.workspace_id
    where i.status = 'pending' and lower(i.email) = v_email
  );
end;
$$;

create or replace function public.list_workspace_invitations(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'workspaceId', i.workspace_id,
      'workspaceName', w.name,
      'recipientEmail', i.email,
      'role', i.role,
      'status', i.status,
      'createdAt', i.created_at,
      'expiresAt', i.expires_at,
      'acceptedAt', i.accepted_at
    ) order by i.created_at desc), '[]'::jsonb)
    from public.workspace_invitations i
    join public.workspaces w on w.id = i.workspace_id
    where i.workspace_id = p_workspace_id and i.status = 'pending' and i.expires_at > now()
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
end;
$$;

create or replace function public.revoke_workspace_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.workspace_invitations i
  set status = 'revoked', updated_at = now()
  from public.workspaces w
  where i.id = p_invitation_id
    and i.workspace_id = w.id
    and w.owner_id = auth.uid()
    and i.status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- Workspace projects (server-authoritative, optimistic concurrency)
-- ---------------------------------------------------------------------------

create or replace function public.ws_validate_project(p_project jsonb)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_name text;
  v_bytes integer;
begin
  if p_project is null or jsonb_typeof(p_project) <> 'object' then
    raise exception 'PAYLOAD_INVALID';
  end if;
  v_name := nullif(trim(p_project ->> 'name'), '');
  if v_name is null or length(v_name) > 80 then
    raise exception 'PAYLOAD_INVALID';
  end if;
  v_bytes := length(p_project::text);
  if v_bytes > 8388608 then
    raise exception 'PAYLOAD_TOO_LARGE';
  end if;
  return v_name;
end;
$$;

create or replace function public.create_workspace_project(
  p_workspace_id uuid,
  p_project_id text,
  p_name text,
  p_project jsonb
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

create or replace function public.list_workspace_projects(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'projectId', p.project_id,
      'workspaceId', p.workspace_id,
      'name', p.name,
      'revision', p.revision,
      'createdBy', p.created_by,
      'createdAt', p.created_at,
      'updatedAt', p.updated_at
    ) order by p.updated_at desc), '[]'::jsonb)
    from public.workspace_projects p
    where p.workspace_id = p_workspace_id
  );
end;
$$;

create or replace function public.fetch_workspace_project(
  p_workspace_id uuid,
  p_project_id text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_project public.workspace_projects;
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  select * into v_project
  from public.workspace_projects
  where workspace_id = p_workspace_id and project_id = p_project_id;
  if v_project is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'projectId', v_project.project_id,
    'workspaceId', v_project.workspace_id,
    'name', v_project.name,
    'revision', v_project.revision,
    'createdBy', v_project.created_by,
    'createdAt', v_project.created_at,
    'updatedAt', v_project.updated_at,
    'project', v_project.payload
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
begin
  if v_role not in ('owner', 'editor') then
    raise exception 'PERMISSION_DENIED';
  end if;
  v_name := public.ws_validate_project(p_project);
  -- Optimistic concurrency: only succeed when the revision is unchanged.
  update public.workspace_projects
  set payload = p_project, name = v_name, revision = revision + 1, updated_at = now()
  where workspace_id = p_workspace_id and project_id = p_project_id and revision = p_expected_revision
  returning * into v_project;
  if v_project is null then
    raise exception 'STALE_REVISION';
  end if;
  update public.workspaces set updated_at = now() where id = p_workspace_id;
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

create or replace function public.delete_workspace_project(
  p_workspace_id uuid,
  p_project_id text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  delete from public.workspace_projects
  where workspace_id = p_workspace_id and project_id = p_project_id;
  -- Workspace-scoped: never touch another workspace's same-id project lease.
  delete from public.project_edit_leases
  where project_id = p_project_id and workspace_id = p_workspace_id;
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
-- Edit leases
-- ---------------------------------------------------------------------------

create or replace function public.acquire_edit_lease(
  p_workspace_id uuid,
  p_project_id text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.ws_role(p_workspace_id);
  v_existing public.project_edit_leases;
  v_lease_id text := 'lease-' || gen_random_uuid()::text || '-' || encode(gen_random_bytes(4), 'hex');
  v_now timestamptz := now();
  v_expires timestamptz := v_now + interval '60 seconds';
begin
  if v_role not in ('owner', 'editor') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if not exists (select 1 from public.workspace_projects where workspace_id = p_workspace_id and project_id = p_project_id) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  select * into v_existing
  from public.project_edit_leases
  where project_id = p_project_id and workspace_id = p_workspace_id;
  if v_existing is not null then
    if v_existing.user_id = auth.uid() then
      update public.project_edit_leases
      set acquired_at = v_now, expires_at = v_expires, heartbeat_at = v_now
      where lease_id = v_existing.lease_id
      returning * into v_existing;
      return jsonb_build_object(
        'ok', true,
        'lease', jsonb_build_object(
          'projectId', v_existing.project_id, 'workspaceId', v_existing.workspace_id,
          'leaseId', v_existing.lease_id, 'userId', v_existing.user_id,
          'acquiredAt', v_existing.acquired_at, 'expiresAt', v_existing.expires_at,
          'heartbeatAt', v_existing.heartbeat_at,
          'holderEmail', (select email from public.profiles where id = v_existing.user_id)
        )
      );
    end if;
    if v_existing.expires_at > v_now then
      return jsonb_build_object(
        'ok', false,
        'code', 'LEASE_HELD',
        'lease', jsonb_build_object(
          'projectId', v_existing.project_id, 'workspaceId', v_existing.workspace_id,
          'leaseId', v_existing.lease_id, 'userId', v_existing.user_id,
          'acquiredAt', v_existing.acquired_at, 'expiresAt', v_existing.expires_at,
          'heartbeatAt', v_existing.heartbeat_at,
          'holderEmail', (select email from public.profiles where id = v_existing.user_id)
        )
      );
    end if;
    -- Stale lease → replace (workspace-scoped).
    delete from public.project_edit_leases
    where project_id = p_project_id and workspace_id = p_workspace_id;
  end if;
  insert into public.project_edit_leases (project_id, workspace_id, lease_id, user_id, acquired_at, expires_at, heartbeat_at)
  values (p_project_id, p_workspace_id, v_lease_id, auth.uid(), v_now, v_expires, v_now);
  return jsonb_build_object(
    'ok', true,
    'lease', jsonb_build_object(
      'projectId', p_project_id, 'workspaceId', p_workspace_id,
      'leaseId', v_lease_id, 'userId', auth.uid(),
      'acquiredAt', v_now, 'expiresAt', v_expires, 'heartbeatAt', v_now,
      'holderEmail', (select email from public.profiles where id = auth.uid())
    )
  );
end;
$$;

create or replace function public.heartbeat_edit_lease(p_lease_id text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_lease public.project_edit_leases;
  v_expires timestamptz := now() + interval '60 seconds';
begin
  select * into v_lease from public.project_edit_leases where lease_id = p_lease_id;
  if v_lease is null or v_lease.user_id <> auth.uid() then
    raise exception 'LEASE_INVALID';
  end if;
  if v_lease.expires_at <= now() then
    delete from public.project_edit_leases where lease_id = p_lease_id;
    raise exception 'LEASE_INVALID';
  end if;
  update public.project_edit_leases
  set heartbeat_at = now(), expires_at = v_expires
  where lease_id = p_lease_id
  returning * into v_lease;
  return jsonb_build_object(
    'projectId', v_lease.project_id, 'workspaceId', v_lease.workspace_id,
    'leaseId', v_lease.lease_id, 'userId', v_lease.user_id,
    'acquiredAt', v_lease.acquired_at, 'expiresAt', v_lease.expires_at,
    'heartbeatAt', v_lease.heartbeat_at,
    'holderEmail', (select email from public.profiles where id = v_lease.user_id)
  );
end;
$$;

create or replace function public.release_edit_lease(p_lease_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_lease public.project_edit_leases;
begin
  select * into v_lease from public.project_edit_leases where lease_id = p_lease_id;
  if v_lease is null then
    return;
  end if;
  if v_lease.user_id <> auth.uid() then
    raise exception 'LEASE_INVALID';
  end if;
  delete from public.project_edit_leases where lease_id = p_lease_id;
end;
$$;

create or replace function public.get_edit_lease(
  p_workspace_id uuid,
  p_project_id text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_lease public.project_edit_leases;
begin
  if not public.ws_is_member(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  select * into v_lease
  from public.project_edit_leases
  where project_id = p_project_id and workspace_id = p_workspace_id;
  if v_lease is null then
    return null;
  end if;
  if v_lease.expires_at <= now() then
    delete from public.project_edit_leases
    where project_id = p_project_id and workspace_id = p_workspace_id;
    return null;
  end if;
  return jsonb_build_object(
    'projectId', v_lease.project_id, 'workspaceId', v_lease.workspace_id,
    'leaseId', v_lease.lease_id, 'userId', v_lease.user_id,
    'acquiredAt', v_lease.acquired_at, 'expiresAt', v_lease.expires_at,
    'heartbeatAt', v_lease.heartbeat_at,
    'holderEmail', (select email from public.profiles where id = v_lease.user_id)
  );
end;
$$;

create or replace function public.revoke_leases_for_project(p_project_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  -- Leases are scoped by (workspace, project); a same-id project can exist in
  -- several workspaces. Any member of an owning workspace may request cleanup
  -- for the workspaces they belong to; other workspaces' leases are untouched.
  for v_workspace_id in (
    select distinct workspace_id from public.project_edit_leases
    where project_id = p_project_id
  ) loop
    if public.ws_is_member(v_workspace_id) then
      delete from public.project_edit_leases
      where project_id = p_project_id and workspace_id = v_workspace_id;
    end if;
  end loop;
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
      'create_workspace', 'update_workspace', 'delete_workspace', 'list_workspaces',
      'list_workspace_members', 'change_member_role', 'remove_workspace_member',
      'leave_workspace', 'create_workspace_invitation', 'list_my_workspace_invitations',
      'list_workspace_invitations', 'accept_workspace_invitation',
      'revoke_workspace_invitation', 'create_workspace_project',
      'list_workspace_projects', 'fetch_workspace_project', 'save_workspace_project',
      'delete_workspace_project', 'duplicate_workspace_project', 'acquire_edit_lease',
      'heartbeat_edit_lease', 'release_edit_lease', 'get_edit_lease',
      'revoke_leases_for_project'
    )
  loop
    execute format('revoke all on function %s from public, anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end;
$$;
