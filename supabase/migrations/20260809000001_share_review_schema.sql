-- ===========================================================================
-- Buildora — Phase P12: Share Links & Review Experience
-- Migration 1/1: share_links + review_comments, RLS, and SECURITY DEFINER RPCs
--
-- Security model:
--   * Share links are OWNER service metadata. Raw tokens are NEVER stored —
--     only SHA-256 hashes. The raw token is returned exactly once (at create
--     / regenerate) by the owner RPCs.
--   * Viewers are ANONYMOUS. Their only read path is resolve_share(p_token),
--     which enforces status = 'active' and expiry server-side and returns
--     ONLY the sanitized projection (never token_hash, owner_id, or internals).
--   * Review comments are untrusted input: plain text, bounded, inserted only
--     through submit_review_comment which enforces feedback_enabled + active
--     + expiry + bounds.
--   * No project enumeration: share_links is selectable only by the owner.
--   * Revoked/expired links fail immediately on every resolve (no client
--     cache can override server authorization).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- share_links
-- ---------------------------------------------------------------------------
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id text not null,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'revoked')),
  feedback_enabled boolean not null default false,
  require_name boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz,
  feedback_count integer not null default 0,
  projection jsonb,
  projection_revision integer,
  projection_updated_at timestamptz
);

create index share_links_owner_project_idx on public.share_links (owner_id, project_id);
create index share_links_token_hash_idx on public.share_links (token_hash);

alter table public.share_links enable row level security;

-- Owners may read their own links. All writes go through owner RPCs
-- (SECURITY DEFINER) so token_hash generation is never client-forgeable.
create policy "share_links_select_own" on public.share_links
  for select using (auth.uid() = owner_id);
create policy "share_links_no_client_insert" on public.share_links
  for insert with check (false);
create policy "share_links_no_client_update" on public.share_links
  for update using (false);
create policy "share_links_no_client_delete" on public.share_links
  for delete using (false);

-- ---------------------------------------------------------------------------
-- review_comments
-- ---------------------------------------------------------------------------
create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.share_links(id) on delete cascade,
  project_id text not null,
  page_id text,
  section_id text,
  author_name text,
  body text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index review_comments_share_idx on public.review_comments (share_id, created_at);

alter table public.review_comments enable row level security;

-- Owners read comments for their own shares. Writes are RPC-only.
create policy "review_comments_select_owner" on public.review_comments
  for select using (
    exists (
      select 1 from public.share_links s
      where s.id = share_id and s.owner_id = auth.uid()
    )
  );
create policy "review_comments_no_client_insert" on public.review_comments
  for insert with check (false);
create policy "review_comments_no_client_update" on public.review_comments
  for update using (false);
create policy "review_comments_no_client_delete" on public.review_comments
  for delete using (false);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- Deterministic SHA-256 hash of a raw token (what gets stored / looked up).
create function public.share_token_hash(p_token text)
returns text
language sql
immutable
as $$
  select encode(digest(p_token, 'sha256'), 'hex');
$$;

-- ISO-8601 rendering of a timestamptz (UTC).
create function public.share_iso(p_ts timestamptz)
returns text
language sql
immutable
as $$
  select to_char(p_ts at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Owner-facing summary of a share (never token_hash, never owner_id).
create function public.share_link_summary_json(p_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', sl.id::text,
    'projectId', sl.project_id,
    'status', sl.status,
    'feedbackEnabled', sl.feedback_enabled,
    'requireName', sl.require_name,
    'expiresAt', case when sl.expires_at is null then null else public.share_iso(sl.expires_at) end,
    'createdAt', public.share_iso(sl.created_at),
    'updatedAt', public.share_iso(sl.updated_at),
    'lastOpenedAt', case when sl.last_opened_at is null then null else public.share_iso(sl.last_opened_at) end,
    'feedbackCount', sl.feedback_count
  )
  from public.share_links sl
  where sl.id = p_id;
$$;

-- Comment row as a safe jsonb (public fields only).
create function public.review_comment_json(p_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id::text,
    'shareId', c.share_id::text,
    'projectId', c.project_id,
    'pageId', c.page_id,
    'sectionId', c.section_id,
    'authorName', c.author_name,
    'body', c.body,
    'createdAt', public.share_iso(c.created_at),
    'resolvedAt', case when c.resolved_at is null then null else public.share_iso(c.resolved_at) end
  )
  from public.review_comments c
  where c.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- Owner RPCs (SECURITY DEFINER — the ONLY writers)
-- ---------------------------------------------------------------------------

create or replace function public.create_share_link(
  p_project_id text,
  p_feedback_enabled boolean,
  p_require_name boolean,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

create or replace function public.list_share_links(p_project_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select coalesce(jsonb_agg(public.share_link_summary_json(sl.id) order by sl.created_at), '[]'::jsonb)
  into v_out
  from public.share_links sl
  where sl.owner_id = auth.uid() and sl.project_id = p_project_id;
  return v_out;
end;
$$;

create or replace function public.share_status_batch(p_project_ids text[])
returns table (project_id text, has_active boolean)
language sql
security definer
set search_path = public
as $$
  select sl.project_id, (count(*) filter (where sl.status = 'active' and (sl.expires_at is null or sl.expires_at > now()))) > 0 as has_active
  from public.share_links sl
  where sl.owner_id = auth.uid() and sl.project_id = any(p_project_ids)
  group by sl.project_id;
$$;

create or replace function public.update_share_link(
  p_share_id uuid,
  p_feedback_enabled boolean default null,
  p_require_name boolean default null,
  p_expires_at timestamptz default null,
  p_clear_expiry boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select id into v_id from public.share_links
  where id = p_share_id and owner_id = auth.uid();
  if v_id is null then
    raise exception 'NOT_FOUND';
  end if;
  update public.share_links
  set feedback_enabled = coalesce(p_feedback_enabled, feedback_enabled),
      require_name = case when p_feedback_enabled is not null
                          then coalesce(p_require_name, false) and p_feedback_enabled
                          else require_name end,
      -- "Never" must actually clear an existing expiry (a plain null would
      -- coalesce and be a no-op), so the caller signals it explicitly.
      expires_at = case when p_clear_expiry then null else coalesce(p_expires_at, expires_at) end,
      updated_at = now()
  where id = v_id;
  return public.share_link_summary_json(v_id);
end;
$$;

create or replace function public.push_share_snapshot(
  p_share_id uuid,
  p_projection jsonb,
  p_projection_revision integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select id into v_id from public.share_links
  where id = p_share_id and owner_id = auth.uid();
  if v_id is null then
    raise exception 'NOT_FOUND';
  end if;
  if p_projection is null then
    raise exception 'INVALID_INPUT';
  end if;
  if pg_column_size(p_projection) > 4194304 then
    raise exception 'PROJECTION_TOO_LARGE';
  end if;
  update public.share_links
  set projection = p_projection,
      projection_revision = coalesce(p_projection_revision, projection_revision),
      projection_updated_at = now(),
      updated_at = now()
  where id = v_id;
end;
$$;

create or replace function public.regenerate_share_link(p_share_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text;
  v_hash text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select id into v_id from public.share_links
  where id = p_share_id and owner_id = auth.uid();
  if v_id is null then
    raise exception 'NOT_FOUND';
  end if;
  v_raw := rtrim(
    replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'),
    '='
  );
  v_hash := public.share_token_hash(v_raw);
  update public.share_links
  set token_hash = v_hash, updated_at = now()
  where id = v_id;
  return jsonb_build_object(
    'id', v_id::text,
    'rawToken', v_raw,
    'summary', public.share_link_summary_json(v_id)
  );
end;
$$;

create or replace function public.revoke_share_link(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  update public.share_links
  set status = 'revoked', updated_at = now()
  where id = p_share_id and owner_id = auth.uid();
end;
$$;

create or replace function public.list_review_comments(p_share_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.share_links s
    where s.id = p_share_id and s.owner_id = auth.uid()
  ) then
    raise exception 'NOT_FOUND';
  end if;
  select coalesce(jsonb_agg(public.review_comment_json(c.id) order by c.created_at), '[]'::jsonb)
  into v_out
  from public.review_comments c
  where c.share_id = p_share_id;
  return v_out;
end;
$$;

create or replace function public.set_comment_resolved(
  p_share_id uuid,
  p_comment_id uuid,
  p_resolved boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  update public.review_comments c
  set resolved_at = case when p_resolved then now() else null end
  from public.share_links s
  where c.id = p_comment_id
    and c.share_id = p_share_id
    and s.id = p_share_id
    and s.owner_id = auth.uid();
end;
$$;

create or replace function public.delete_review_comment(
  p_share_id uuid,
  p_comment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  delete from public.review_comments c
  using public.share_links s
  where c.id = p_comment_id
    and c.share_id = p_share_id
    and s.id = p_share_id
    and s.owner_id = auth.uid();
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'NOT_FOUND';
  end if;
  update public.share_links
  set feedback_count = greatest(0, feedback_count - 1), updated_at = now()
  where id = p_share_id and owner_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Public (anonymous) RPCs — token-gated
-- ---------------------------------------------------------------------------

create or replace function public.resolve_share(p_token text)
returns table (
  state text,
  share_id text,
  project_name text,
  feedback_enabled boolean,
  require_name boolean,
  projection jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_id uuid;
  v_projection jsonb;
  v_name text;
begin
  if p_token is null or length(p_token) < 40 then
    return query select 'invalid'::text, ''::text, ''::text, false, false, null::jsonb;
    return;
  end if;
  v_hash := public.share_token_hash(p_token);
  select id, projection into v_id, v_projection
  from public.share_links
  where token_hash = v_hash
    and status = 'active'
    and (expires_at is null or expires_at > now());
  if v_id is null then
    -- Distinguish invalid vs revoked vs expired for honest copy without
    -- revealing which link (if any) the token matched.
    if exists (select 1 from public.share_links where token_hash = v_hash) then
      if exists (select 1 from public.share_links where token_hash = v_hash and status = 'revoked') then
        return query select 'revoked'::text, ''::text, ''::text, false, false, null::jsonb;
      end if;
      return query select 'expired'::text, ''::text, ''::text, false, false, null::jsonb;
    end if;
    return query select 'invalid'::text, ''::text, ''::text, false, false, null::jsonb;
    return;
  end if;
  -- Privacy-conscious last-opened tracking: a timestamp only, never an IP or
  -- fingerprint. Best-effort (never fails the resolve).
  update public.share_links set last_opened_at = now() where id = v_id;
  v_name := coalesce(v_projection ->> 'name', 'Website');
  return query
    select 'active'::text,
           v_id::text,
           left(v_name, 120),
           (select feedback_enabled from public.share_links where id = v_id),
           (select require_name from public.share_links where id = v_id),
           v_projection;
end;
$$;

create or replace function public.submit_review_comment(
  p_token text,
  p_share_id uuid,
  p_page_id text default null,
  p_section_id text default null,
  p_author_name text default null,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_record public.share_links%rowtype;
  v_comment_id uuid;
  v_name text;
  v_body text;
begin
  if p_token is null or length(p_token) < 40 then
    raise exception 'INVALID_TOKEN';
  end if;
  v_hash := public.share_token_hash(p_token);
  select * into v_record
  from public.share_links
  where token_hash = v_hash and id = p_share_id;
  if v_record.id is null then
    raise exception 'INVALID_TOKEN';
  end if;
  if v_record.status <> 'active' then
    raise exception 'REVOKED';
  end if;
  if v_record.expires_at is not null and v_record.expires_at <= now() then
    raise exception 'EXPIRED';
  end if;
  if not v_record.feedback_enabled then
    raise exception 'FEEDBACK_DISABLED';
  end if;
  v_body := left(trim(coalesce(p_body, '')), 2000);
  if length(v_body) = 0 then
    raise exception 'INVALID_INPUT';
  end if;
  v_name := left(trim(coalesce(p_author_name, '')), 60);
  if v_record.require_name and length(v_name) = 0 then
    raise exception 'INVALID_INPUT';
  end if;
  -- Duplicate-spam guard: same name + body within 60s is rejected.
  if exists (
    select 1 from public.review_comments c
    where c.share_id = p_share_id
      and coalesce(c.author_name, '') = coalesce(v_name, '')
      and c.body = v_body
      and c.created_at > now() - interval '60 seconds'
  ) then
    raise exception 'RATE_LIMITED';
  end if;
  insert into public.review_comments
    (share_id, project_id, page_id, section_id, author_name, body)
  values
    (p_share_id, v_record.project_id,
     case when p_page_id ~ '^[A-Za-z0-9_-]{1,120}$' then p_page_id else null end,
     case when p_section_id ~ '^[A-Za-z0-9_-]{1,120}$' then p_section_id else null end,
     nullif(v_name, ''), v_body)
  returning id into v_comment_id;
  update public.share_links
  set feedback_count = feedback_count + 1, updated_at = now()
  where id = p_share_id;
  return public.review_comment_json(v_comment_id);
end;
$$;

create or replace function public.delete_share_data_for_project(p_project_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revoked integer := 0;
  v_deleted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select count(*) into v_revoked
  from public.share_links
  where owner_id = auth.uid() and project_id = p_project_id and status = 'active';
  select count(*) into v_deleted
  from public.review_comments c
  join public.share_links s on s.id = c.share_id
  where s.owner_id = auth.uid() and s.project_id = p_project_id;
  delete from public.review_comments c
  using public.share_links s
  where c.share_id = s.id
    and s.owner_id = auth.uid()
    and s.project_id = p_project_id;
  update public.share_links
  set status = 'revoked', updated_at = now()
  where owner_id = auth.uid() and project_id = p_project_id and status = 'active';
  return jsonb_build_object('revokedShares', v_revoked, 'deletedComments', v_deleted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function public.create_share_link(text, boolean, boolean, timestamptz) to authenticated;
grant execute on function public.list_share_links(text) to authenticated;
grant execute on function public.share_status_batch(text[]) to authenticated;
grant execute on function public.update_share_link(uuid, boolean, boolean, timestamptz, boolean) to authenticated;
grant execute on function public.push_share_snapshot(uuid, jsonb, integer) to authenticated;
grant execute on function public.regenerate_share_link(uuid) to authenticated;
grant execute on function public.revoke_share_link(uuid) to authenticated;
grant execute on function public.list_review_comments(uuid) to authenticated;
grant execute on function public.set_comment_resolved(uuid, uuid, boolean) to authenticated;
grant execute on function public.delete_review_comment(uuid, uuid) to authenticated;
grant execute on function public.delete_share_data_for_project(text) to authenticated;

-- Anonymous viewers: resolve + submit are the ONLY public paths.
grant execute on function public.resolve_share(text) to anon;
grant execute on function public.submit_review_comment(text, uuid, text, text, text, text) to anon;
