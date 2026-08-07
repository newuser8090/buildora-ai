-- ===========================================================================
-- Buildora — Phase P6: Cloud Sync, Accounts & Private Shared Libraries
-- Migration 2/2: shared-library RPCs (SECURITY DEFINER)
--
-- All shared-library authorization is centralized here, server-side:
--   * owners create/update/delete libraries, add/remove blocks, invite,
--     revoke members and invitations
--   * members can read libraries they belong to, list members, and fetch
--     individual validated blocks to copy
--   * invite recipients can list + accept only their own pending invitations
--   * revoked members lose access immediately (membership row deleted)
--   * no library information is leaked through invalid tokens/ids
--
-- Functions are security definer with an explicit search_path and execute is
-- granted ONLY to the authenticated role. Never expose these to anon.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Serialize a cloud_my_blocks row into the validated camelCase payload that
-- the browser serializer expects (schemaVersion 1). No raw source, no object
-- URLs, no local-only UI fields.
create or replace function public.block_payload_json(b public.cloud_my_blocks)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', b.id,
    'schemaVersion', b.schema_version,
    'name', b.name,
    'description', b.description,
    'category', b.category,
    'tags', coalesce(b.tags, '{}'::text[]),
    'tree', b.tree,
    'sourceMetadata', b.source_metadata,
    'previewMetadata', coalesce(b.preview_metadata, '{}'::jsonb),
    'contentRevision', b.content_revision,
    'createdAt', b.created_at,
    'updatedAt', b.updated_at,
    'clientUpdatedAt', b.client_updated_at,
    'deviceId', b.device_id,
    'deletedAt', b.deleted_at
  );
$$;

-- Is the current user the owner of a library?
create or replace function public.is_library_owner(p_library_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.shared_libraries s
    where s.id = p_library_id and s.owner_id = auth.uid() and s.deleted_at is null
  );
$$;

-- Is the current user a member (non-owner) of a library?
create or replace function public.is_library_member(p_library_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.shared_library_members m
    where m.library_id = p_library_id and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Library lifecycle (owner only)
-- ---------------------------------------------------------------------------

create or replace function public.create_shared_library(
  p_name text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_library public.shared_libraries;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'INVALID_NAME';
  end if;

  insert into public.shared_libraries (owner_id, name, description)
  values (auth.uid(), trim(p_name), p_description)
  returning * into v_library;

  return jsonb_build_object(
    'id', v_library.id,
    'ownerId', v_library.owner_id,
    'name', v_library.name,
    'description', v_library.description,
    'createdAt', v_library.created_at,
    'updatedAt', v_library.updated_at,
    'deletedAt', v_library.deleted_at,
    'memberRole', 'owner',
    'memberCount', 1,
    'blockCount', 0
  );
end;
$$;

create or replace function public.update_shared_library(
  p_library_id uuid,
  p_name text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_library public.shared_libraries;
begin
  if not public.is_library_owner(p_library_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_name is not null and length(trim(p_name)) = 0 then
    raise exception 'INVALID_NAME';
  end if;

  update public.shared_libraries
  set name = coalesce(nullif(trim(p_name), ''), name),
      description = p_description,
      updated_at = now()
  where id = p_library_id
  returning * into v_library;

  return jsonb_build_object(
    'id', v_library.id,
    'ownerId', v_library.owner_id,
    'name', v_library.name,
    'description', v_library.description,
    'createdAt', v_library.created_at,
    'updatedAt', v_library.updated_at,
    'deletedAt', v_library.deleted_at,
    'memberRole', 'owner',
    'memberCount', (select count(*) from public.shared_library_members m where m.library_id = v_library.id) + 1,
    'blockCount', (select count(*) from public.shared_library_blocks sb where sb.library_id = v_library.id)
  );
end;
$$;

create or replace function public.delete_shared_library(p_library_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_library_owner(p_library_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  update public.shared_libraries
  set deleted_at = now(), updated_at = now()
  where id = p_library_id;
  delete from public.library_invitations where library_id = p_library_id and status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- Listing / reading
-- ---------------------------------------------------------------------------

create or replace function public.library_json(s public.shared_libraries, p_role text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', s.id,
    'ownerId', s.owner_id,
    'name', s.name,
    'description', s.description,
    'createdAt', s.created_at,
    'updatedAt', s.updated_at,
    'deletedAt', s.deleted_at,
    'memberRole', p_role,
    'memberCount', (select count(*) from public.shared_library_members m where m.library_id = s.id) + 1,
    'blockCount', (select count(*) from public.shared_library_blocks sb where sb.library_id = s.id)
  );
$$;

create or replace function public.list_shared_libraries()
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

  select coalesce(jsonb_agg(public.library_json(s, 'owner') order by s.updated_at desc), '[]'::jsonb)
  into v_owned
  from public.shared_libraries s
  where s.owner_id = auth.uid() and s.deleted_at is null;

  select coalesce(jsonb_agg(public.library_json(s, m.role) order by s.updated_at desc), '[]'::jsonb)
  into v_shared
  from public.shared_library_members m
  join public.shared_libraries s on s.id = m.library_id
  where m.user_id = auth.uid() and s.deleted_at is null;

  return jsonb_build_object('owned', v_owned, 'shared', v_shared);
end;
$$;

create or replace function public.get_shared_library(p_library_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_library public.shared_libraries;
  v_role text;
  v_blocks jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select s.* into v_library
  from public.shared_libraries s
  where s.id = p_library_id and s.deleted_at is null;

  if v_library is null then
    return null;
  end if;

  if v_library.owner_id = auth.uid() then
    v_role := 'owner';
  elsif public.is_library_member(p_library_id) then
    select m.role into v_role from public.shared_library_members m where m.library_id = p_library_id and m.user_id = auth.uid();
  else
    raise exception 'PERMISSION_DENIED';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', sb.block_id,
      'libraryId', sb.library_id,
      'block', public.block_payload_json(b)
    ) order by sb.created_at desc
  ), '[]'::jsonb)
  into v_blocks
  from public.shared_library_blocks sb
  join public.cloud_my_blocks b on b.id = sb.block_id and b.owner_id = v_library.owner_id
  where sb.library_id = p_library_id;

  return jsonb_build_object(
    'library', public.library_json(v_library, v_role),
    'blocks', v_blocks
  );
end;
$$;

create or replace function public.fetch_shared_block(p_library_id uuid, p_block_id text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_library public.shared_libraries;
  v_block public.cloud_my_blocks;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select s.* into v_library
  from public.shared_libraries s
  where s.id = p_library_id and s.deleted_at is null;
  if v_library is null then
    raise exception 'PERMISSION_DENIED';
  end if;

  if v_library.owner_id <> auth.uid() and not public.is_library_member(p_library_id) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select b.* into v_block
  from public.shared_library_blocks sb
  join public.cloud_my_blocks b on b.id = sb.block_id
  where sb.library_id = p_library_id and sb.block_id = p_block_id
    and b.owner_id = v_library.owner_id and b.deleted_at is null;

  if v_block is null then
    return null;
  end if;

  return public.block_payload_json(v_block);
end;
$$;

-- ---------------------------------------------------------------------------
-- Blocks within a library (owner only)
-- ---------------------------------------------------------------------------

create or replace function public.add_blocks_to_library(p_library_id uuid, p_block_ids text[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_block_id text;
begin
  if not public.is_library_owner(p_library_id) then
    raise exception 'PERMISSION_DENIED';
  end if;

  foreach v_block_id in array p_block_ids loop
    -- Only blocks owned by the library owner may be shared.
    if exists (
      select 1 from public.cloud_my_blocks b
      where b.id = v_block_id and b.owner_id = auth.uid() and b.deleted_at is null
    ) then
      insert into public.shared_library_blocks (library_id, block_id, added_by)
      values (p_library_id, v_block_id, auth.uid())
      on conflict (library_id, block_id) do nothing;
    end if;
  end loop;

  update public.shared_libraries set updated_at = now() where id = p_library_id;
end;
$$;

create or replace function public.remove_block_from_library(p_library_id uuid, p_block_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_library_owner(p_library_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  delete from public.shared_library_blocks
  where library_id = p_library_id and block_id = p_block_id;
  update public.shared_libraries set updated_at = now() where id = p_library_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

create or replace function public.list_library_members(p_library_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_library_owner(p_library_id) and not public.is_library_member(p_library_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'userId', m.user_id,
      'email', p.email,
      'role', m.role
    ) order by m.created_at asc), '[]'::jsonb)
    from public.shared_library_members m
    join public.profiles p on p.id = m.user_id
    where m.library_id = p_library_id
  );
end;
$$;

create or replace function public.revoke_member(p_library_id uuid, p_member_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_library_owner(p_library_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_member_user_id = auth.uid() then
    raise exception 'PERMISSION_DENIED';
  end if;
  delete from public.shared_library_members
  where library_id = p_library_id and user_id = p_member_user_id;
  -- Revoking a member also voids their pending invitations (re-invite required).
  update public.library_invitations set status = 'revoked', updated_at = now()
  where library_id = p_library_id and email = (
    select email from public.profiles where id = p_member_user_id
  ) and status = 'pending';
  update public.shared_libraries set updated_at = now() where id = p_library_id;
end;
$$;

create or replace function public.leave_shared_library(p_library_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_library_member(p_library_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  delete from public.shared_library_members
  where library_id = p_library_id and user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

create or replace function public.create_invitation(
  p_library_id uuid,
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
  v_invitation public.library_invitations;
  v_library_name text;
begin
  if not public.is_library_owner(p_library_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_email is null or v_email = '' or v_email not like '%@%' then
    raise exception 'INVALID_EMAIL';
  end if;
  if p_role not in ('viewer', 'editor') then
    raise exception 'INVALID_ROLE';
  end if;
  if v_email = lower((select email from public.profiles where id = auth.uid())) then
    raise exception 'INVALID_EMAIL'; -- cannot invite yourself
  end if;

  -- Rate limit: at most 10 pending invitations per library.
  select count(*) into v_count
  from public.library_invitations
  where library_id = p_library_id and status = 'pending';
  if v_count >= 10 then
    raise exception 'RATE_LIMITED';
  end if;

  -- Already a member?
  if exists (
    select 1 from public.shared_library_members m
    join public.profiles p on p.id = m.user_id
    where m.library_id = p_library_id and lower(p.email) = v_email
  ) then
    raise exception 'ALREADY_MEMBER';
  end if;

  select name into v_library_name from public.shared_libraries where id = p_library_id;

  -- Replace any prior pending invitation for the same library + email.
  update public.library_invitations
  set status = 'revoked', updated_at = now()
  where library_id = p_library_id and lower(email) = v_email and status = 'pending';

  insert into public.library_invitations (
    library_id, invited_by, email, role, token_hash, expires_at
  ) values (
    p_library_id, auth.uid(), v_email, p_role,
    encode(gen_random_bytes(32), 'hex'),
    now() + interval '14 days'
  )
  returning * into v_invitation;

  return jsonb_build_object(
    'id', v_invitation.id,
    'libraryId', v_invitation.library_id,
    'libraryName', v_library_name,
    'recipientEmail', v_invitation.email,
    'role', v_invitation.role,
    'status', v_invitation.status,
    'createdAt', v_invitation.created_at,
    'expiresAt', v_invitation.expires_at,
    'acceptedAt', v_invitation.accepted_at
  );
end;
$$;

create or replace function public.list_my_invitations()
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

  -- Expire stale pending invitations lazily.
  update public.library_invitations
  set status = 'expired', updated_at = now()
  where status = 'pending' and expires_at < now();

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'libraryId', i.library_id,
      'libraryName', s.name,
      'recipientEmail', i.email,
      'role', i.role,
      'status', i.status,
      'createdAt', i.created_at,
      'expiresAt', i.expires_at,
      'acceptedAt', i.accepted_at
    ) order by i.created_at desc), '[]'::jsonb)
    from public.library_invitations i
    join public.shared_libraries s on s.id = i.library_id
    where i.status = 'pending' and lower(i.email) = v_email and s.deleted_at is null
  );
end;
$$;

create or replace function public.list_library_invitations(p_library_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_library_owner(p_library_id) then
    raise exception 'PERMISSION_DENIED';
  end if;

  -- Owners see the pending invitations they created for THIS library so they
  -- can review/revoke them. Recipients' own inbox is covered by
  -- list_my_invitations — this RPC never exposes invitations to non-owners.
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'libraryId', i.library_id,
      'libraryName', s.name,
      'recipientEmail', i.email,
      'role', i.role,
      'status', i.status,
      'createdAt', i.created_at,
      'expiresAt', i.expires_at,
      'acceptedAt', i.accepted_at
    ) order by i.created_at desc), '[]'::jsonb)
    from public.library_invitations i
    join public.shared_libraries s on s.id = i.library_id
    where i.library_id = p_library_id and i.status = 'pending' and i.expires_at > now()
  );
end;
$$;

create or replace function public.accept_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_invitation public.library_invitations;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_invitation
  from public.library_invitations
  where id = p_invitation_id and status = 'pending';

  if v_invitation is null then
    raise exception 'INVITE_INVALID';
  end if;
  if lower(v_invitation.email) <> v_email then
    -- Never confirm whether an invitation exists for another email.
    raise exception 'INVITE_INVALID';
  end if;
  if v_invitation.expires_at < now() then
    update public.library_invitations set status = 'expired', updated_at = now() where id = p_invitation_id;
    raise exception 'INVITE_EXPIRED';
  end if;

  insert into public.shared_library_members (library_id, user_id, role)
  values (v_invitation.library_id, auth.uid(), v_invitation.role)
  on conflict (library_id, user_id) do update set role = excluded.role;

  update public.library_invitations
  set status = 'accepted', accepted_at = now(), updated_at = now()
  where id = p_invitation_id;
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.library_invitations i
  set status = 'revoked', updated_at = now()
  from public.shared_libraries s
  where i.id = p_invitation_id
    and i.library_id = s.id
    and s.owner_id = auth.uid()
    and i.status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — only the authenticated role may call these; anon never.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  for fn in select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_shared_library', 'update_shared_library', 'delete_shared_library',
      'list_shared_libraries', 'get_shared_library', 'fetch_shared_block',
      'add_blocks_to_library', 'remove_block_from_library', 'list_library_members',
      'revoke_member', 'leave_shared_library', 'create_invitation',
      'list_my_invitations', 'list_library_invitations', 'accept_invitation', 'revoke_invitation'
    )
  loop
    execute format('revoke all on function %s from public, anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end;
$$;
