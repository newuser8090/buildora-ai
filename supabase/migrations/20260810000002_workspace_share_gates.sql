-- ===========================================================================
-- Buildora — Phase P14: Team Workspaces & Controlled Collaboration
-- Migration 2/2: workspace-aware review-link gates
--
-- Extends the Phase P12 share RPCs so WORKSPACE projects can only be shared /
-- managed by workspace members with owner or editor role (see the permission
-- matrix). Personal projects keep the exact P12 semantics.
--
-- Changes:
--   * create_share_link        — rejects viewers / non-members for workspace
--                                projects (PERMISSION_DENIED)
--   * list_share_links         — empty for viewers / non-members on workspace
--                                projects (no enumeration)
--   * share_status_batch       — same gate (no badge leak to viewers)
--   * remove_workspace_member  — also revokes the removed member's active
--                                review links for that workspace's projects
--   * change_member_role (to viewer) — same share revocation, so a downgraded
--                                member loses link management immediately
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Helper: may the current user manage review links for this project?
--   - workspace project → must be owner/editor member
--   - personal project  → true (P12 semantics: any signed-in owner)
-- ---------------------------------------------------------------------------
create or replace function public.ws_can_manage_review_links(p_project_id text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select
    case
      -- Workspace project? A project id is only unique WITHIN a workspace, so
      -- the caller must hold owner/editor role in EVERY workspace holding the
      -- id — a viewer/non-member in any one of them denies link management.
      when exists (
        select 1 from public.workspace_projects wp
        where wp.project_id = p_project_id
      ) then not exists (
        select 1
        from public.workspace_projects wp
        join public.workspaces w on w.id = wp.workspace_id
        where wp.project_id = p_project_id
          and not (
            w.owner_id = auth.uid()
            or exists (
              select 1 from public.workspace_members m
              where m.workspace_id = wp.workspace_id
                and m.user_id = auth.uid()
                and m.role in ('owner', 'editor')
            )
          )
      )
      -- Personal project: allowed (matches P12).
      else true
    end;
$$;

-- ---------------------------------------------------------------------------
-- Patch create_share_link
-- ---------------------------------------------------------------------------
create or replace function public.create_share_link(
  p_project_id text,
  p_feedback_enabled boolean,
  p_require_name boolean,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_raw text;
  v_hash text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_project_id is null or length(p_project_id) = 0 or length(p_project_id) > 200 then
    raise exception 'INVALID_INPUT';
  end if;
  if not public.ws_can_manage_review_links(p_project_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  -- 32 random bytes → base64url (256-bit entropy). Only the hash is stored.
  v_raw := rtrim(
    replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'),
    '='
  );
  v_hash := public.share_token_hash(v_raw);
  insert into public.share_links
    (owner_id, project_id, token_hash, feedback_enabled, require_name, expires_at)
  values
    (auth.uid(), p_project_id, v_hash,
     coalesce(p_feedback_enabled, false),
     coalesce(p_require_name, false) and coalesce(p_feedback_enabled, false),
     p_expires_at)
  returning id into v_id;
  return jsonb_build_object(
    'id', v_id::text,
    'rawToken', v_raw,
    'summary', public.share_link_summary_json(v_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Patch list_share_links
-- ---------------------------------------------------------------------------
create or replace function public.list_share_links(p_project_id text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not public.ws_can_manage_review_links(p_project_id) then
    return v_out;
  end if;
  select coalesce(jsonb_agg(public.share_link_summary_json(sl.id) order by sl.created_at), '[]'::jsonb)
  into v_out
  from public.share_links sl
  where sl.owner_id = auth.uid() and sl.project_id = p_project_id;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Patch share_status_batch
-- ---------------------------------------------------------------------------
create or replace function public.share_status_batch(p_project_ids text[])
returns table (project_id text, has_active boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  v_project_id text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_project_ids is null then
    return;
  end if;
  foreach v_project_id in array p_project_ids
  loop
    if not public.ws_can_manage_review_links(v_project_id) then
      continue;
    end if;
    return query
      select sl.project_id,
             (count(*) filter (where sl.status = 'active' and (sl.expires_at is null or sl.expires_at > now()))) > 0
      from public.share_links sl
      where sl.owner_id = auth.uid() and sl.project_id = v_project_id
      group by sl.project_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Revoke a member's active shares for a workspace's projects.
-- ---------------------------------------------------------------------------
create or replace function public.ws_revoke_member_shares(p_workspace_id uuid, p_user_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.share_links sl
  set status = 'revoked', updated_at = now()
  where sl.owner_id = p_user_id
    and sl.status = 'active'
    and exists (
      select 1 from public.workspace_projects wp
      where wp.workspace_id = p_workspace_id and wp.project_id = sl.project_id
    );
$$;

-- ---------------------------------------------------------------------------
-- Revoke every active review link to a workspace's project (project deletion:
-- deleted content must not remain shareable). Scoped by project id across all
-- owners; in the (UI-unreachable) case where the same id exists in two
-- workspaces, revoking is the safe direction.
-- ---------------------------------------------------------------------------
create or replace function public.ws_revoke_project_shares(p_project_id text)
returns void
language sql
security definer set search_path = public
as $$
  update public.share_links sl
  set status = 'revoked', updated_at = now()
  where sl.status = 'active' and sl.project_id = p_project_id;
$$;

-- ---------------------------------------------------------------------------
-- Patch delete_workspace_project: deleting a workspace project revokes its
-- review links immediately.
-- ---------------------------------------------------------------------------
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
  -- Revoke review links to the deleted project.
  perform public.ws_revoke_project_shares(p_project_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Patch delete_workspace: deleting a workspace revokes review links to all of
-- its projects before the cascade removes the project rows.
-- ---------------------------------------------------------------------------
create or replace function public.delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.ws_is_owner(p_workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  -- Revoke review links for every project of this workspace first (the
  -- workspace_projects rows still exist at this point).
  for v_project_id in (
    select project_id from public.workspace_projects
    where workspace_id = p_workspace_id
  ) loop
    perform public.ws_revoke_project_shares(v_project_id);
  end loop;
  -- Cascades delete members, invitations, projects, leases.
  delete from public.workspaces where id = p_workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Patch remove_workspace_member to revoke the removed member's shares.
-- ---------------------------------------------------------------------------
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Patch change_member_role: downgrading to viewer revokes link management.
-- ---------------------------------------------------------------------------
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants for the new helpers (authenticated only; never anon).
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  for fn in select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'ws_can_manage_review_links', 'ws_revoke_member_shares',
      'ws_revoke_project_shares'
    )
  loop
    execute format('revoke all on function %s from public, anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end;
$$;
