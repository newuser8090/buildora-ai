-- ===========================================================================
-- Buildora — Phase P6: Cloud Sync, Accounts & Private Shared Libraries
-- Migration 1/2: core schema, ownership triggers, indexes, and RLS
--
-- Local-first product principle: IndexedDB is the immediate source for the
-- editor UI. These tables are the CLOUD copy of the validated native model
-- (never raw pasted source, never executable content, never object URLs).
--
-- Security model:
--   * Row Level Security is enabled on EVERY user-owned table.
--   * owner_id is assigned by a BEFORE INSERT trigger from auth.uid() —
--     clients can never forge another owner.
--   * Tombstones are implemented as soft-delete (deleted_at) on the record
--     itself, so delete/edit conflicts can be detected against a baseline.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- extensions / helpers
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (lower(email));

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile on signup (email normalized to lowercase).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, lower(coalesce(new.email, '')))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- cloud_my_blocks — cloud copy of validated MyBlockRecord payloads
-- ---------------------------------------------------------------------------
create table public.cloud_my_blocks (
  id text primary key,
  owner_id uuid not null,
  schema_version integer not null default 1,
  name text not null,
  description text,
  category text not null default 'other',
  tags text[] not null default '{}',
  tree jsonb not null,
  source_metadata jsonb,
  preview_metadata jsonb not null default '{}'::jsonb,
  content_revision integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  client_updated_at timestamptz not null,
  device_id text,
  deleted_at timestamptz
);

create index cloud_my_blocks_owner_idx on public.cloud_my_blocks (owner_id);
create index cloud_my_blocks_updated_idx on public.cloud_my_blocks (owner_id, updated_at);
create index cloud_my_blocks_deleted_idx on public.cloud_my_blocks (owner_id, deleted_at);

alter table public.cloud_my_blocks enable row level security;

create policy "blocks_select_own" on public.cloud_my_blocks
  for select using (auth.uid() = owner_id);
create policy "blocks_insert_own" on public.cloud_my_blocks
  for insert with check (auth.uid() = owner_id);
create policy "blocks_update_own" on public.cloud_my_blocks
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "blocks_delete_own" on public.cloud_my_blocks
  for delete using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- cloud_my_block_collections — cloud copy of MyBlockCollection payloads
-- ---------------------------------------------------------------------------
create table public.cloud_my_block_collections (
  id text primary key,
  owner_id uuid not null,
  schema_version integer not null default 1,
  name text not null,
  description text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_order integer not null default 0,
  block_ids text[] not null default '{}',
  deleted_at timestamptz
);

create index cloud_collections_owner_idx on public.cloud_my_block_collections (owner_id);
create index cloud_collections_updated_idx on public.cloud_my_block_collections (owner_id, updated_at);
create index cloud_collections_deleted_idx on public.cloud_my_block_collections (owner_id, deleted_at);

alter table public.cloud_my_block_collections enable row level security;

create policy "collections_select_own" on public.cloud_my_block_collections
  for select using (auth.uid() = owner_id);
create policy "collections_insert_own" on public.cloud_my_block_collections
  for insert with check (auth.uid() = owner_id);
create policy "collections_update_own" on public.cloud_my_block_collections
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "collections_delete_own" on public.cloud_my_block_collections
  for delete using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Ownership trigger — assigns owner_id from the session. The client cannot
-- forge owner_id: any supplied value is overwritten with auth.uid().
-- ---------------------------------------------------------------------------
create function public.enforce_owner_id()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'anonymous users cannot write cloud records';
  end if;
  new.owner_id := auth.uid();
  return new;
end;
$$;

create trigger set_owner_id_blocks
  before insert on public.cloud_my_blocks
  for each row execute function public.enforce_owner_id();

create trigger set_owner_id_collections
  before insert on public.cloud_my_block_collections
  for each row execute function public.enforce_owner_id();

-- ---------------------------------------------------------------------------
-- cloud_sync_tombstones — bounded tombstone log (soft-delete is the primary
-- mechanism; this log records the fact for bounded cleanup / audit).
-- ---------------------------------------------------------------------------
create table public.cloud_sync_tombstones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  entity_type text not null check (entity_type in ('myBlock', 'collection')),
  entity_id text not null,
  created_at timestamptz not null default now()
);

create index cloud_sync_tombstones_owner_idx on public.cloud_sync_tombstones (owner_id);
create index cloud_sync_tombstones_entity_idx on public.cloud_sync_tombstones (owner_id, entity_type, entity_id);

alter table public.cloud_sync_tombstones enable row level security;

create policy "tombstones_select_own" on public.cloud_sync_tombstones
  for select using (auth.uid() = owner_id);
create policy "tombstones_insert_own" on public.cloud_sync_tombstones
  for insert with check (auth.uid() = owner_id);
create policy "tombstones_delete_own" on public.cloud_sync_tombstones
  for delete using (auth.uid() = owner_id);

create trigger set_owner_id_tombstones
  before insert on public.cloud_sync_tombstones
  for each row execute function public.enforce_owner_id();

-- ---------------------------------------------------------------------------
-- shared_libraries — private shared libraries (owner-managed)
-- ---------------------------------------------------------------------------
create table public.shared_libraries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index shared_libraries_owner_idx on public.shared_libraries (owner_id);
create index shared_libraries_updated_idx on public.shared_libraries (updated_at);

alter table public.shared_libraries enable row level security;

-- Owners manage their own libraries. Members gain read access through the
-- membership table policy (NOT through a direct policy here).
create policy "shared_libraries_select_owner" on public.shared_libraries
  for select using (auth.uid() = owner_id and deleted_at is null);
create policy "shared_libraries_insert_owner" on public.shared_libraries
  for insert with check (auth.uid() = owner_id);
create policy "shared_libraries_update_owner" on public.shared_libraries
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "shared_libraries_delete_owner" on public.shared_libraries
  for delete using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- shared_library_members — membership grants (viewer / editor)
-- ---------------------------------------------------------------------------
create table public.shared_library_members (
  library_id uuid not null references public.shared_libraries(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  primary key (library_id, user_id)
);

create index shared_library_members_user_idx on public.shared_library_members (user_id);

alter table public.shared_library_members enable row level security;

-- A member can read their own membership rows (drives "shared with me").
create policy "members_select_own" on public.shared_library_members
  for select using (auth.uid() = user_id);

-- Membership rows are only ever written by the invitation / revocation RPCs
-- (security definer). Direct writes are not permitted.
create policy "members_no_client_insert" on public.shared_library_members
  for insert with check (false);

-- Members can read shared_library rows for libraries they belong to. This is
-- the ONLY read path for non-owners — enforced by membership.
create policy "shared_libraries_select_member" on public.shared_libraries
  for select using (
    exists (
      select 1 from public.shared_library_members m
      where m.library_id = id and m.user_id = auth.uid()
    )
    and deleted_at is null
  );

-- ---------------------------------------------------------------------------
-- shared_library_blocks — which validated cloud blocks a library contains.
-- Blocks belong to the library owner's cloud_my_blocks (never copied).
-- ---------------------------------------------------------------------------
create table public.shared_library_blocks (
  library_id uuid not null references public.shared_libraries(id) on delete cascade,
  block_id text not null,
  added_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (library_id, block_id)
);

create index shared_library_blocks_block_idx on public.shared_library_blocks (block_id);

alter table public.shared_library_blocks enable row level security;

-- Readers of a library (owner or member) can see which blocks it contains.
create policy "blocks_select_library_reader" on public.shared_library_blocks
  for select using (
    exists (
      select 1 from public.shared_library_members m
      where m.library_id = library_id and m.user_id = auth.uid()
    )
    or
    exists (
      select 1 from public.shared_libraries s
      where s.id = library_id and s.owner_id = auth.uid()
    )
  );

-- Block membership is only written by owner RPCs (security definer).
create policy "blocks_no_client_insert" on public.shared_library_blocks
  for insert with check (false);

-- ---------------------------------------------------------------------------
-- library_invitations — email invitations to join a shared library.
-- Emails are stored normalized (lowercase). Token_hash supports a future
-- email-link flow; the in-app flow matches the authenticated user's email.
-- ---------------------------------------------------------------------------
create table public.library_invitations (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.shared_libraries(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  token_hash text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days')
);

create index invitations_library_idx on public.library_invitations (library_id);
create index invitations_email_idx on public.library_invitations (lower(email));
create index invitations_status_idx on public.library_invitations (status);
create index invitations_token_hash_idx on public.library_invitations (token_hash) where token_hash is not null;

alter table public.library_invitations enable row level security;

-- Owners can read invitations for their libraries (manage/revoke).
create policy "invitations_select_owner" on public.library_invitations
  for select using (
    exists (
      select 1 from public.shared_libraries s
      where s.id = library_id and s.owner_id = auth.uid()
    )
  );

-- A recipient can read ONLY their own pending invitations (email match).
create policy "invitations_select_recipient" on public.library_invitations
  for select using (
    status = 'pending'
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Invitations are only created/revoked by owner RPCs (security definer).
create policy "invitations_no_client_insert" on public.library_invitations
  for insert with check (false);
create policy "invitations_no_client_update" on public.library_invitations
  for update using (false);
