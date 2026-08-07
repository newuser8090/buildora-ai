-- ---------------------------------------------------------------------------
-- Phase P6 — deterministic delta fetch (cloud sync)
--
-- The sync engine fetches changes since an opaque cursor of the form
-- `<updated_at>|<id>`. This SECURITY DEFINER function returns the next page
-- as a UNION of blocks and collections in ONE (updated_at, id) ordering so
-- a page boundary can never skip an entity in the other store:
--   - records updated after the cursor timestamp are returned
--   - records at the SAME timestamp are ordered by their stable id (strict
--     id > tie-breaker), so equal-timestamp records are never skipped or
--     re-sent
--   - one extra row is returned (p_limit + 1) so the caller can report
--     hasMore exactly
--
-- Authorization is enforced here (owner_id = auth.uid()) so no client-side
-- filter can ever be bypassed.
-- ---------------------------------------------------------------------------

create or replace function fetch_cloud_changes(p_cursor text, p_limit int)
returns table (kind text, id text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ts timestamptz := coalesce(
    nullif(split_part(coalesce(p_cursor, ''), '|', 1), ''),
    '1970-01-01'
  )::timestamptz;
  v_id text := coalesce(nullif(split_part(coalesce(p_cursor, ''), '|', 2), ''), '');
begin
  return query
    select 'block'::text as kind, b.id, b.updated_at
    from cloud_my_blocks b
    where b.owner_id = auth.uid()
      and (b.updated_at > v_ts or (b.updated_at = v_ts and b.id > v_id))
    union all
    select 'collection'::text, c.id, c.updated_at
    from cloud_my_block_collections c
    where c.owner_id = auth.uid()
      and (c.updated_at > v_ts or (c.updated_at = v_ts and c.id > v_id))
    order by updated_at asc, id asc
    limit greatest(1, p_limit + 1);
end;
$$;

grant execute on function fetch_cloud_changes(text, int) to authenticated;
