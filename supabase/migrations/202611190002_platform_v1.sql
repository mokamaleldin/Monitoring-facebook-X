begin;

-- 1) Schema extensions for real snapshot data, future analytics, reference date, and bounded collection logs
alter table newsroom.sources
  add column if not exists legacy_id text unique;

alter table newsroom.posts
  add column if not exists raw_media_type text,
  add column if not exists media_items jsonb not null default '[]'::jsonb,
  add column if not exists engagement jsonb,
  add column if not exists shared_post boolean,
  add column if not exists time_origin text,
  add column if not exists time_semantics_verified boolean,
  add column if not exists updated_at timestamptz not null default now();

alter table newsroom.appearances
  add column if not exists last_seen_at timestamptz;

update newsroom.appearances
set last_seen_at = seen_at
where last_seen_at is null;

create table newsroom.runtime_config (
  id integer primary key check (id = 1),
  feed_reference_at timestamptz,
  reference_label text,
  updated_at timestamptz not null default now()
);

insert into newsroom.runtime_config (id, feed_reference_at, reference_label)
values (1, null, null)
on conflict (id) do nothing;

create table newsroom.collection_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  platform text not null default 'facebook' check (platform in ('facebook', 'x')),
  triggered_by uuid references auth.users,
  status text not null check (status in ('running', 'completed', 'stopped', 'failed')),
  request_cap integer not null check (request_cap between 1 and 10),
  credit_cap integer not null check (credit_cap between 1 and 10),
  requests_made integer not null default 0,
  usage_checks integer not null default 0,
  credits_charged integer not null default 0,
  credits_uncertain boolean not null default false,
  credits_remaining integer,
  usage_before jsonb,
  usage_after jsonb,
  account_usage_delta integer,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  stop_reason text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table newsroom.collection_run_items (
  run_id uuid not null references newsroom.collection_runs on delete cascade,
  source_id uuid not null references newsroom.sources,
  source_name text not null,
  source_kind text not null,
  endpoint text not null,
  status text not null check (status in ('attempted', 'ok', 'error', 'uncertain', 'skipped')),
  http_status integer,
  returned_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  empty_response boolean not null default false,
  old_posts_count integer not null default 0,
  missing_time_count integer not null default 0,
  invalid_count integer not null default 0,
  credits_charged integer,
  credits_uncertain boolean not null default false,
  has_next boolean not null default false,
  error_message text,
  elapsed_ms integer,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (run_id, source_id)
);

create index collection_runs_started_idx on newsroom.collection_runs (started_at desc);

alter table newsroom.runtime_config enable row level security;
alter table newsroom.collection_runs enable row level security;
alter table newsroom.collection_run_items enable row level security;

-- 2) Helper functions
create or replace function newsroom.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
    from newsroom.members
    where user_id = (select auth.uid())
      and role = 'platform_admin'
  )
$$;

create or replace function newsroom.reference_now() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select feed_reference_at from newsroom.runtime_config where id = 1),
    now()
  )
$$;

create or replace function newsroom.reference_meta() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select jsonb_build_object(
        'referenceAt', feed_reference_at,
        'referenceLabel', reference_label
      )
      from newsroom.runtime_config
      where id = 1
    ),
    jsonb_build_object('referenceAt', null, 'referenceLabel', null)
  )
$$;

create or replace function newsroom.fold_arabic(input text) returns text
language sql immutable set search_path = '' as $$
  select btrim(
    translate(
      regexp_replace(lower(coalesce(input, '')), E'[\u064b-\u065f\u0670\u0640]', '', 'g'),
      'أإآٱى',
      'ااااي'
    )
  )
$$;

create or replace function newsroom.escape_like(input text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(input, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- Update RLS appearance visibility to honor the server-controlled reference date (NULL = live now())
create or replace function newsroom.can_see_appearance(s uuid, stamp timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
    from newsroom.subscriptions t
    join newsroom.organizations o on o.id = t.org_id
    where t.source_id = s
      and t.active
      and newsroom.member_of(o.id)
      and stamp >= newsroom.reference_now() - make_interval(days => o.feed_days)
  )
$$;

-- Admin-only RLS policies for internal collection logs
create policy admin_collection_runs on newsroom.collection_runs
  for select to authenticated using (newsroom.is_admin());

create policy admin_collection_run_items on newsroom.collection_run_items
  for select to authenticated using (newsroom.is_admin());

-- 3) Idempotent post + appearance upsert (service/DB-owner only) preserving post identity & first seen_at
create or replace function newsroom.upsert_post_appearance(
  p_platform text,
  p_native_key text,
  p_source_id uuid,
  p_body text,
  p_media text,
  p_raw_media_type text,
  p_media_url text,
  p_media_items jsonb,
  p_original_url text,
  p_published_at timestamptz,
  p_seen_at timestamptz,
  p_engagement jsonb,
  p_shared_post boolean,
  p_time_origin text,
  p_time_semantics_verified boolean
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_post_id uuid;
  v_post_inserted boolean;
  v_app_inserted boolean;
begin
  insert into newsroom.posts (
    platform, native_key, body, media, raw_media_type, media_url, media_items,
    original_url, published_at, engagement, shared_post, time_origin,
    time_semantics_verified, updated_at
  ) values (
    p_platform, p_native_key, coalesce(p_body, ''), p_media, p_raw_media_type,
    p_media_url, coalesce(p_media_items, '[]'::jsonb), p_original_url,
    p_published_at, p_engagement, p_shared_post, p_time_origin,
    p_time_semantics_verified, now()
  )
  on conflict (platform, native_key) do update set
    body = excluded.body,
    media = excluded.media,
    raw_media_type = coalesce(excluded.raw_media_type, newsroom.posts.raw_media_type),
    media_url = coalesce(excluded.media_url, newsroom.posts.media_url),
    media_items = case
      when jsonb_array_length(excluded.media_items) > 0 then excluded.media_items
      else newsroom.posts.media_items
    end,
    original_url = coalesce(excluded.original_url, newsroom.posts.original_url),
    published_at = coalesce(newsroom.posts.published_at, excluded.published_at),
    engagement = coalesce(excluded.engagement, newsroom.posts.engagement),
    shared_post = coalesce(excluded.shared_post, newsroom.posts.shared_post),
    time_origin = coalesce(excluded.time_origin, newsroom.posts.time_origin),
    time_semantics_verified = coalesce(excluded.time_semantics_verified, newsroom.posts.time_semantics_verified),
    updated_at = now()
  returning id, (xmax = 0) into v_post_id, v_post_inserted;

  insert into newsroom.appearances (source_id, post_id, platform, seen_at, last_seen_at)
  values (p_source_id, v_post_id, p_platform, p_seen_at, p_seen_at)
  on conflict (source_id, post_id) do update set
    seen_at = least(newsroom.appearances.seen_at, excluded.seen_at),
    last_seen_at = greatest(coalesce(newsroom.appearances.last_seen_at, newsroom.appearances.seen_at), excluded.last_seen_at)
  returning (xmax = 0) into v_app_inserted;

  return jsonb_build_object(
    'postId', v_post_id,
    'inserted', v_post_inserted,
    'appearanceInserted', v_app_inserted
  );
end $$;

-- 4) Updated snapshot RPC (keeps backwards compatibility while adding enriched fields & reference_now())
create or replace function public.newsroom_snapshot(p_org uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  org_days integer;
  addition boolean;
  ref_now timestamptz;
  ref_meta jsonb;
  result jsonb;
begin
  select feed_days, allow_add into org_days, addition from newsroom.organizations where id = p_org;
  if not found then raise insufficient_privilege using message = 'Workspace access denied'; end if;
  ref_now := newsroom.reference_now();
  ref_meta := newsroom.reference_meta();
  with selected as (
    select s.id, s.name, s.platform, s.kind, s.locator, t.active
    from newsroom.subscriptions t
    join newsroom.sources s on s.id = t.source_id
    where t.org_id = p_org
  ), recent as (
    select a.post_id, max(a.seen_at) as seen,
      jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.id) as visible_sources
    from newsroom.appearances a
    join selected s on s.active and s.id = a.source_id
    where a.seen_at >= ref_now - make_interval(days => org_days)
    group by a.post_id
    order by seen desc, a.post_id asc
    limit 100
  )
  select jsonb_build_object(
    'canAdd', addition,
    'referenceAt', ref_meta->'referenceAt',
    'referenceLabel', ref_meta->'referenceLabel',
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.name, s.id) from selected s), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(locator order by requested_at, locator) from newsroom.requests where org_id = p_org), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'platform', p.platform,
          'text', p.body,
          'media', p.media,
          'mediaUrl', p.media_url,
          'mediaItems', coalesce(p.media_items, '[]'::jsonb),
          'originalUrl', p.original_url,
          'publishedAt', p.published_at,
          'seenAt', r.seen,
          'sources', r.visible_sources,
          'engagement', p.engagement,
          'sharedPost', p.shared_post,
          'timeOrigin', p.time_origin,
          'timeSemanticsVerified', p.time_semantics_verified
        ) order by r.seen desc, p.id asc
      )
      from recent r
      join newsroom.posts p on p.id = r.post_id
    ), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- 5) Workspace metadata RPC (sources + pending + canAdd without fetching posts)
create or replace function public.newsroom_org_meta(p_org uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_name text;
  v_days integer;
  v_add boolean;
  ref_meta jsonb;
  result jsonb;
begin
  select name, feed_days, allow_add into v_name, v_days, v_add
  from newsroom.organizations
  where id = p_org;
  if not found then raise insufficient_privilege using message = 'Workspace access denied'; end if;
  ref_meta := newsroom.reference_meta();
  with selected as (
    select s.id, s.name, s.platform, s.kind, s.locator, t.active
    from newsroom.subscriptions t
    join newsroom.sources s on s.id = t.source_id
    where t.org_id = p_org
  )
  select jsonb_build_object(
    'id', p_org,
    'name', v_name,
    'feedDays', v_days,
    'canAdd', v_add,
    'referenceAt', ref_meta->'referenceAt',
    'referenceLabel', ref_meta->'referenceLabel',
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.name, s.id) from selected s), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(locator order by requested_at, locator) from newsroom.requests where org_id = p_org), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- 6) Paginated & server-filtered feed RPC (permissions + filters + Arabic search applied BEFORE cursor/limit)
create or replace function public.newsroom_feed(
  p_org uuid,
  p_platform text default 'facebook',
  p_media text default 'all',
  p_source uuid default null,
  p_query text default '',
  p_cursor_seen timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 8
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  org_days integer;
  ref_now timestamptz;
  ref_meta jsonb;
  v_limit integer;
  v_needle text;
  v_like text;
  result jsonb;
begin
  select feed_days into org_days from newsroom.organizations where id = p_org;
  if not found then raise insufficient_privilege using message = 'Workspace access denied'; end if;
  if p_platform not in ('facebook', 'x') then
    raise invalid_parameter_value using message = 'Invalid platform';
  end if;
  if p_media not in ('all', 'text', 'photo', 'video') then
    raise invalid_parameter_value using message = 'Invalid media filter';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 8), 50));
  v_needle := newsroom.fold_arabic(coalesce(p_query, ''));
  v_like := newsroom.escape_like(v_needle);
  ref_now := newsroom.reference_now();
  ref_meta := newsroom.reference_meta();

  with selected as (
    select s.id, s.name, s.platform, s.kind, s.locator
    from newsroom.subscriptions t
    join newsroom.sources s on s.id = t.source_id
    where t.org_id = p_org
      and t.active
      and s.platform = p_platform
  ),
  grouped as (
    select
      a.post_id,
      max(a.seen_at) as seen,
      jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.id) as visible_sources,
      array_agg(s.id) as source_ids,
      string_agg(s.name, ' ') as source_names
    from newsroom.appearances a
    join selected s on s.id = a.source_id
    where a.seen_at >= ref_now - make_interval(days => org_days)
    group by a.post_id
  ),
  filtered as (
    select
      p.id,
      p.platform,
      p.body,
      p.media,
      p.media_url,
      coalesce(p.media_items, '[]'::jsonb) as media_items,
      p.original_url,
      p.published_at,
      p.engagement,
      p.shared_post,
      p.time_origin,
      p.time_semantics_verified,
      g.seen,
      g.visible_sources
    from grouped g
    join newsroom.posts p on p.id = g.post_id
    where p.platform = p_platform
      and (p_media = 'all' or p.media = p_media)
      and (p_source is null or p_source = any(g.source_ids))
      and (
        v_needle = ''
        or newsroom.fold_arabic(p.body || ' ' || g.source_names) like '%' || v_like || '%' escape '\'
      )
  ),
  counted as (
    select count(*)::integer as total_count from filtered
  ),
  paged as (
    select *
    from filtered
    where (
      p_cursor_seen is null
      or seen < p_cursor_seen
      or (seen = p_cursor_seen and p_cursor_id is not null and id > p_cursor_id)
    )
    order by seen desc, id asc
    limit v_limit + 1
  ),
  trimmed as (
    select *
    from paged
    order by seen desc, id asc
    limit v_limit
  ),
  last_row as (
    select seen, id
    from trimmed
    order by seen asc, id desc
    limit 1
  )
  select jsonb_build_object(
    'totalCount', (select total_count from counted),
    'hasMore', ((select count(*) from paged) > v_limit),
    'nextCursor', case
      when (select count(*) from paged) > v_limit then (
        select jsonb_build_object('seenAt', seen, 'id', id) from last_row
      )
      else null
    end,
    'referenceAt', ref_meta->'referenceAt',
    'referenceLabel', ref_meta->'referenceLabel',
    'posts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'platform', t.platform,
          'text', t.body,
          'media', t.media,
          'mediaUrl', t.media_url,
          'mediaItems', t.media_items,
          'originalUrl', t.original_url,
          'publishedAt', t.published_at,
          'seenAt', t.seen,
          'sources', t.visible_sources,
          'engagement', t.engagement,
          'sharedPost', t.shared_post,
          'timeOrigin', t.time_origin,
          'timeSemanticsVerified', t.time_semantics_verified
        ) order by t.seen desc, t.id asc
      )
      from trimmed t
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

-- 7) Admin-only RPCs (server-verified platform_admin role)
create or replace function public.newsroom_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ref_meta jsonb;
  result jsonb;
begin
  if not newsroom.is_admin() then
    raise insufficient_privilege using message = 'Platform admin access required';
  end if;
  ref_meta := newsroom.reference_meta();

  select jsonb_build_object(
    'referenceAt', ref_meta->'referenceAt',
    'referenceLabel', ref_meta->'referenceLabel',
    'uniqueSources', (select count(*)::integer from newsroom.sources),
    'uniqueActiveFacebookSources', (
      select count(distinct t.source_id)::integer
      from newsroom.subscriptions t
      join newsroom.sources s on s.id = t.source_id
      where t.active and s.platform = 'facebook'
    ),
    'totalPosts', (select count(*)::integer from newsroom.posts),
    'organizations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'maxSources', o.max_sources,
          'allowAdd', o.allow_add,
          'feedDays', o.feed_days,
          'activeSourceCount', (select count(*)::integer from newsroom.subscriptions t where t.org_id = o.id and t.active),
          'pendingCount', (select count(*)::integer from newsroom.requests r where r.org_id = o.id),
          'editors', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'userId', m.user_id,
                'email', to_jsonb(u)->>'email',
                'role', m.role
              ) order by coalesce(to_jsonb(u)->>'email', m.user_id::text)
            )
            from newsroom.members m
            join auth.users u on u.id = m.user_id
            where m.org_id = o.id
          ), '[]'::jsonb),
          'sources', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', s.id,
                'name', s.name,
                'platform', s.platform,
                'kind', s.kind,
                'locator', s.locator,
                'active', t.active
              ) order by s.name, s.id
            )
            from newsroom.subscriptions t
            join newsroom.sources s on s.id = t.source_id
            where t.org_id = o.id
          ), '[]'::jsonb),
          'pending', coalesce((
            select jsonb_agg(r.locator order by r.requested_at, r.locator)
            from newsroom.requests r
            where r.org_id = o.id
          ), '[]'::jsonb)
        ) order by o.name, o.id
      )
      from newsroom.organizations o
    ), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cr.id,
          'runKey', cr.run_key,
          'platform', cr.platform,
          'status', cr.status,
          'requestCap', cr.request_cap,
          'creditCap', cr.credit_cap,
          'requestsMade', cr.requests_made,
          'usageChecks', cr.usage_checks,
          'creditsCharged', cr.credits_charged,
          'creditsUncertain', cr.credits_uncertain,
          'creditsRemaining', cr.credits_remaining,
          'usageBefore', cr.usage_before,
          'usageAfter', cr.usage_after,
          'accountUsageDelta', cr.account_usage_delta,
          'insertedCount', cr.inserted_count,
          'updatedCount', cr.updated_count,
          'stopReason', cr.stop_reason,
          'startedAt', cr.started_at,
          'finishedAt', cr.finished_at,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'sourceId', ci.source_id,
                'sourceName', ci.source_name,
                'sourceKind', ci.source_kind,
                'endpoint', ci.endpoint,
                'status', ci.status,
                'httpStatus', ci.http_status,
                'returnedCount', ci.returned_count,
                'insertedCount', ci.inserted_count,
                'updatedCount', ci.updated_count,
                'emptyResponse', ci.empty_response,
                'oldPostsCount', ci.old_posts_count,
                'missingTimeCount', ci.missing_time_count,
                'invalidCount', ci.invalid_count,
                'creditsCharged', ci.credits_charged,
                'creditsUncertain', ci.credits_uncertain,
                'hasNext', ci.has_next,
                'errorMessage', ci.error_message,
                'elapsedMs', ci.elapsed_ms
              ) order by ci.started_at, ci.source_name
            )
            from newsroom.collection_run_items ci
            where ci.run_id = cr.id
          ), '[]'::jsonb)
        ) order by cr.started_at desc
      )
      from (select * from newsroom.collection_runs order by started_at desc limit 20) cr
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

create or replace function public.newsroom_admin_create_org(
  p_name text,
  p_max_sources integer default 10,
  p_allow_add boolean default true,
  p_feed_days integer default 7
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_clean text;
  v_row newsroom.organizations;
begin
  if not newsroom.is_admin() then
    raise insufficient_privilege using message = 'Platform admin access required';
  end if;
  v_clean := btrim(coalesce(p_name, ''));
  if v_clean = '' or char_length(v_clean) > 120 then
    raise invalid_parameter_value using message = 'Invalid organization name';
  end if;
  if p_max_sources is null or p_max_sources < 0 or p_max_sources > 5000 then
    raise invalid_parameter_value using message = 'Invalid max_sources';
  end if;
  if p_feed_days is null or p_feed_days < 1 or p_feed_days > 90 then
    raise invalid_parameter_value using message = 'Invalid feed_days';
  end if;

  insert into newsroom.organizations (name, max_sources, allow_add, feed_days)
  values (v_clean, p_max_sources, coalesce(p_allow_add, true), p_feed_days)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'maxSources', v_row.max_sources,
    'allowAdd', v_row.allow_add,
    'feedDays', v_row.feed_days
  );
end $$;

create or replace function public.newsroom_admin_update_org(
  p_org uuid,
  p_name text default null,
  p_max_sources integer default null,
  p_allow_add boolean default null,
  p_feed_days integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row newsroom.organizations;
  v_clean text;
begin
  if not newsroom.is_admin() then
    raise insufficient_privilege using message = 'Platform admin access required';
  end if;
  if p_name is not null then
    v_clean := btrim(p_name);
    if v_clean = '' or char_length(v_clean) > 120 then
      raise invalid_parameter_value using message = 'Invalid organization name';
    end if;
  end if;
  if p_max_sources is not null and (p_max_sources < 0 or p_max_sources > 5000) then
    raise invalid_parameter_value using message = 'Invalid max_sources';
  end if;
  if p_feed_days is not null and (p_feed_days < 1 or p_feed_days > 90) then
    raise invalid_parameter_value using message = 'Invalid feed_days';
  end if;

  update newsroom.organizations set
    name = coalesce(v_clean, name),
    max_sources = coalesce(p_max_sources, max_sources),
    allow_add = coalesce(p_allow_add, allow_add),
    feed_days = coalesce(p_feed_days, feed_days)
  where id = p_org
  returning * into v_row;

  if not found then
    raise invalid_parameter_value using message = 'Organization not found';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'maxSources', v_row.max_sources,
    'allowAdd', v_row.allow_add,
    'feedDays', v_row.feed_days
  );
end $$;

create or replace function public.newsroom_admin_set_reference(
  p_reference_at timestamptz,
  p_label text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not newsroom.is_admin() then
    raise insufficient_privilege using message = 'Platform admin access required';
  end if;

  insert into newsroom.runtime_config (id, feed_reference_at, reference_label, updated_at)
  values (1, p_reference_at, nullif(btrim(coalesce(p_label, '')), ''), now())
  on conflict (id) do update set
    feed_reference_at = excluded.feed_reference_at,
    reference_label = excluded.reference_label,
    updated_at = now();

  return newsroom.reference_meta();
end $$;

create or replace function public.newsroom_admin_resolve_request(
  p_org uuid,
  p_locator text,
  p_name text,
  p_native_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_parts text[];
  v_platform text;
  v_kind text;
  v_key text;
  v_src uuid;
  v_clean_name text;
begin
  if not newsroom.is_admin() then
    raise insufficient_privilege using message = 'Platform admin access required';
  end if;
  if p_locator is null or p_locator !~ '^(facebook:page:[a-z0-9.]{2,75}|facebook:group:[0-9]{1,32}|x:account:[a-z0-9_]{1,15})$' then
    raise invalid_parameter_value using message = 'Invalid source locator';
  end if;
  v_clean_name := btrim(coalesce(p_name, ''));
  if v_clean_name = '' or char_length(v_clean_name) > 120 then
    raise invalid_parameter_value using message = 'Invalid source name';
  end if;

  perform 1 from newsroom.organizations where id = p_org for update;
  if not found then
    raise invalid_parameter_value using message = 'Organization not found';
  end if;

  v_parts := string_to_array(p_locator, ':');
  v_platform := v_parts[1];
  v_kind := v_parts[2];
  v_key := coalesce(nullif(btrim(coalesce(p_native_key, '')), ''), v_parts[3]);

  insert into newsroom.sources (platform, kind, native_key, locator, name)
  values (v_platform, v_kind, v_key, p_locator, v_clean_name)
  on conflict (locator) do update set name = excluded.name
  returning id into v_src;

  delete from newsroom.requests where org_id = p_org and locator = p_locator;

  insert into newsroom.subscriptions (org_id, source_id, active)
  values (p_org, v_src, true)
  on conflict (org_id, source_id) do update set active = true;

  return jsonb_build_object('sourceId', v_src, 'locator', p_locator, 'name', v_clean_name);
end $$;

-- 8) Strict permissions
revoke all on table newsroom.runtime_config, newsroom.collection_runs, newsroom.collection_run_items from public, anon, authenticated;
grant select on newsroom.collection_runs, newsroom.collection_run_items to authenticated;
grant select (raw_media_type, media_items, engagement, shared_post, time_origin, time_semantics_verified) on newsroom.posts to authenticated;
grant select (last_seen_at) on newsroom.appearances to authenticated;

revoke all on function newsroom.is_admin(), newsroom.reference_now(), newsroom.reference_meta(),
  newsroom.fold_arabic(text), newsroom.escape_like(text),
  newsroom.upsert_post_appearance(text,text,uuid,text,text,text,text,jsonb,text,timestamptz,timestamptz,jsonb,boolean,text,boolean)
  from public, anon, authenticated;

grant execute on function newsroom.is_admin(), newsroom.reference_now(), newsroom.reference_meta(),
  newsroom.fold_arabic(text), newsroom.escape_like(text) to authenticated;

revoke all on function public.newsroom_org_meta(uuid),
  public.newsroom_feed(uuid,text,text,uuid,text,timestamptz,uuid,integer),
  public.newsroom_admin_overview(),
  public.newsroom_admin_create_org(text,integer,boolean,integer),
  public.newsroom_admin_update_org(uuid,text,integer,boolean,integer),
  public.newsroom_admin_set_reference(timestamptz,text),
  public.newsroom_admin_resolve_request(uuid,text,text,text)
  from public, anon, authenticated;

grant execute on function public.newsroom_org_meta(uuid),
  public.newsroom_feed(uuid,text,text,uuid,text,timestamptz,uuid,integer),
  public.newsroom_admin_overview(),
  public.newsroom_admin_create_org(text,integer,boolean,integer),
  public.newsroom_admin_update_org(uuid,text,integer,boolean,integer),
  public.newsroom_admin_set_reference(timestamptz,text),
  public.newsroom_admin_resolve_request(uuid,text,text,text)
  to authenticated;

-- 9) Service-role-only RPCs (keep schema newsroom private while allowing Edge Functions / CLI scripts via Supabase API)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end $$;

grant usage on schema newsroom to service_role;

create or replace function public.newsroom_service_is_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from newsroom.members where user_id = p_user and role = 'platform_admin'
  )
$$;

create or replace function public.newsroom_service_org_exists(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from newsroom.organizations where id = p_org)
$$;

create or replace function public.newsroom_service_get_membership(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (
    select jsonb_build_object('userId', user_id, 'orgId', org_id, 'role', role)
    from newsroom.members
    where user_id = p_user
  )
$$;

create or replace function public.newsroom_service_assign_member(
  p_user uuid,
  p_org uuid,
  p_role text default 'editor',
  p_ignore_conflict boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_ignore_conflict then
    insert into newsroom.members (user_id, org_id, role)
    values (p_user, p_org, p_role)
    on conflict (user_id) do nothing;
  else
    insert into newsroom.members (user_id, org_id, role)
    values (p_user, p_org, p_role);
  end if;
  return public.newsroom_service_get_membership(p_user);
end $$;

create or replace function public.newsroom_service_orphan_users() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('userId', u.id, 'email', to_jsonb(u)->>'email')
      order by coalesce(to_jsonb(u)->>'email', u.id::text)
    ),
    '[]'::jsonb
  )
  from auth.users u
  left join newsroom.members m on m.user_id = u.id
  where m.user_id is null
$$;

create or replace function public.newsroom_service_upsert_org(
  p_id uuid,
  p_name text,
  p_max_sources integer default 10,
  p_allow_add boolean default true,
  p_feed_days integer default 7
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into newsroom.organizations (id, name, max_sources, allow_add, feed_days)
  values (p_id, p_name, p_max_sources, p_allow_add, p_feed_days)
  on conflict (id) do update set name = excluded.name
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.newsroom_service_upsert_source(
  p_id uuid,
  p_platform text,
  p_kind text,
  p_native_key text,
  p_locator text,
  p_name text,
  p_legacy_id text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from newsroom.sources where locator = p_locator;
  if v_id is not null then
    update newsroom.sources
    set name = p_name, legacy_id = coalesce(p_legacy_id, legacy_id)
    where id = v_id;
    return v_id;
  end if;
  insert into newsroom.sources (id, platform, kind, native_key, locator, name, legacy_id)
  values (p_id, p_platform, p_kind, p_native_key, p_locator, p_name, p_legacy_id)
  on conflict (locator) do update set
    name = excluded.name,
    legacy_id = coalesce(excluded.legacy_id, newsroom.sources.legacy_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.newsroom_service_subscribe(
  p_org uuid,
  p_source uuid
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into newsroom.subscriptions (org_id, source_id, active)
  values (p_org, p_source, true)
  on conflict (org_id, source_id) do nothing;
end $$;

create or replace function public.newsroom_service_upsert_post(
  p_platform text,
  p_native_key text,
  p_source_id uuid,
  p_body text,
  p_media text,
  p_raw_media_type text,
  p_media_url text,
  p_media_items jsonb,
  p_original_url text,
  p_published_at timestamptz,
  p_seen_at timestamptz,
  p_engagement jsonb,
  p_shared_post boolean,
  p_time_origin text,
  p_time_semantics_verified boolean
) returns jsonb
language sql security definer set search_path = '' as $$
  select newsroom.upsert_post_appearance(
    p_platform, p_native_key, p_source_id, p_body, p_media, p_raw_media_type,
    p_media_url, p_media_items, p_original_url, p_published_at, p_seen_at,
    p_engagement, p_shared_post, p_time_origin, p_time_semantics_verified
  )
$$;

create or replace function public.newsroom_service_set_reference(
  p_reference_at timestamptz,
  p_label text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  insert into newsroom.runtime_config (id, feed_reference_at, reference_label, updated_at)
  values (1, p_reference_at, nullif(btrim(coalesce(p_label, '')), ''), now())
  on conflict (id) do update set
    feed_reference_at = excluded.feed_reference_at,
    reference_label = excluded.reference_label,
    updated_at = now();
  return newsroom.reference_meta();
end $$;

create or replace function public.newsroom_service_get_run(p_run_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (
    select jsonb_build_object(
      'id', cr.id,
      'runKey', cr.run_key,
      'platform', cr.platform,
      'status', cr.status,
      'requestCap', cr.request_cap,
      'creditCap', cr.credit_cap,
      'requestsMade', cr.requests_made,
      'usageChecks', cr.usage_checks,
      'creditsCharged', cr.credits_charged,
      'creditsUncertain', cr.credits_uncertain,
      'creditsRemaining', cr.credits_remaining,
      'usageBefore', cr.usage_before,
      'usageAfter', cr.usage_after,
      'accountUsageDelta', cr.account_usage_delta,
      'insertedCount', cr.inserted_count,
      'updatedCount', cr.updated_count,
      'stopReason', cr.stop_reason,
      'startedAt', cr.started_at,
      'finishedAt', cr.finished_at,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'sourceId', ci.source_id,
            'sourceName', ci.source_name,
            'sourceKind', ci.source_kind,
            'endpoint', ci.endpoint,
            'status', ci.status,
            'httpStatus', ci.http_status,
            'returnedCount', ci.returned_count,
            'insertedCount', ci.inserted_count,
            'updatedCount', ci.updated_count,
            'emptyResponse', ci.empty_response,
            'oldPostsCount', ci.old_posts_count,
            'missingTimeCount', ci.missing_time_count,
            'invalidCount', ci.invalid_count,
            'creditsCharged', ci.credits_charged,
            'creditsUncertain', ci.credits_uncertain,
            'hasNext', ci.has_next,
            'errorMessage', ci.error_message,
            'elapsedMs', ci.elapsed_ms
          ) order by ci.started_at, ci.source_name
        )
        from newsroom.collection_run_items ci
        where ci.run_id = cr.id
      ), '[]'::jsonb)
    )
    from newsroom.collection_runs cr
    where cr.run_key = p_run_key
  )
$$;

create or replace function public.newsroom_service_claim_run(
  p_run_key text,
  p_triggered_by uuid,
  p_request_cap integer,
  p_credit_cap integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into newsroom.collection_runs (run_key, platform, triggered_by, status, request_cap, credit_cap)
  values (p_run_key, 'facebook', p_triggered_by, 'running', p_request_cap, p_credit_cap)
  on conflict (run_key) do nothing
  returning id into v_id;
  return jsonb_build_object('claimed', v_id is not null, 'runId', v_id);
end $$;

create or replace function public.newsroom_service_list_active_fb_sources() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'locator', s.locator)
      order by s.name, s.id
    ),
    '[]'::jsonb
  )
  from (
    select distinct s.id, s.name, s.kind, s.locator
    from newsroom.subscriptions t
    join newsroom.sources s on s.id = t.source_id
    where t.active = true and s.platform = 'facebook' and s.kind in ('page', 'group')
  ) s
$$;

create or replace function public.newsroom_service_claim_run_item(
  p_run_id uuid,
  p_source_id uuid,
  p_source_name text,
  p_source_kind text,
  p_endpoint text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_src uuid;
begin
  insert into newsroom.collection_run_items (run_id, source_id, source_name, source_kind, endpoint, status)
  values (p_run_id, p_source_id, p_source_name, p_source_kind, p_endpoint, 'attempted')
  on conflict (run_id, source_id) do nothing
  returning source_id into v_src;
  return v_src is not null;
end $$;

create or replace function public.newsroom_service_update_run_item(
  p_run_id uuid,
  p_source_id uuid,
  p_status text,
  p_http_status integer,
  p_returned_count integer,
  p_inserted_count integer,
  p_updated_count integer,
  p_empty_response boolean,
  p_old_posts_count integer,
  p_missing_time_count integer,
  p_invalid_count integer,
  p_credits_charged integer,
  p_credits_uncertain boolean,
  p_has_next boolean,
  p_error_message text,
  p_elapsed_ms integer,
  p_details jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update newsroom.collection_run_items set
    status = p_status,
    http_status = p_http_status,
    returned_count = p_returned_count,
    inserted_count = p_inserted_count,
    updated_count = p_updated_count,
    empty_response = p_empty_response,
    old_posts_count = p_old_posts_count,
    missing_time_count = p_missing_time_count,
    invalid_count = p_invalid_count,
    credits_charged = p_credits_charged,
    credits_uncertain = p_credits_uncertain,
    has_next = p_has_next,
    error_message = p_error_message,
    elapsed_ms = p_elapsed_ms,
    details = coalesce(p_details, '{}'::jsonb),
    finished_at = now()
  where run_id = p_run_id and source_id = p_source_id;
end $$;

create or replace function public.newsroom_service_finish_run(
  p_run_id uuid,
  p_status text,
  p_requests_made integer,
  p_usage_checks integer,
  p_credits_charged integer,
  p_credits_uncertain boolean,
  p_credits_remaining integer,
  p_usage_before jsonb,
  p_usage_after jsonb,
  p_account_usage_delta integer,
  p_inserted_count integer,
  p_updated_count integer,
  p_stop_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update newsroom.collection_runs set
    status = p_status,
    requests_made = p_requests_made,
    usage_checks = p_usage_checks,
    credits_charged = p_credits_charged,
    credits_uncertain = p_credits_uncertain,
    credits_remaining = p_credits_remaining,
    usage_before = p_usage_before,
    usage_after = p_usage_after,
    account_usage_delta = p_account_usage_delta,
    inserted_count = p_inserted_count,
    updated_count = p_updated_count,
    stop_reason = p_stop_reason,
    finished_at = now()
  where id = p_run_id;
end $$;

revoke all on function
  public.newsroom_service_is_admin(uuid),
  public.newsroom_service_org_exists(uuid),
  public.newsroom_service_get_membership(uuid),
  public.newsroom_service_assign_member(uuid,uuid,text,boolean),
  public.newsroom_service_orphan_users(),
  public.newsroom_service_upsert_org(uuid,text,integer,boolean,integer),
  public.newsroom_service_upsert_source(uuid,text,text,text,text,text,text),
  public.newsroom_service_subscribe(uuid,uuid),
  public.newsroom_service_upsert_post(text,text,uuid,text,text,text,text,jsonb,text,timestamptz,timestamptz,jsonb,boolean,text,boolean),
  public.newsroom_service_set_reference(timestamptz,text),
  public.newsroom_service_get_run(text),
  public.newsroom_service_claim_run(text,uuid,integer,integer),
  public.newsroom_service_list_active_fb_sources(),
  public.newsroom_service_claim_run_item(uuid,uuid,text,text,text),
  public.newsroom_service_update_run_item(uuid,uuid,text,integer,integer,integer,integer,boolean,integer,integer,integer,integer,boolean,boolean,text,integer,jsonb),
  public.newsroom_service_finish_run(uuid,text,integer,integer,integer,boolean,integer,jsonb,jsonb,integer,integer,integer,text)
  from public, anon, authenticated;

grant execute on function
  public.newsroom_service_is_admin(uuid),
  public.newsroom_service_org_exists(uuid),
  public.newsroom_service_get_membership(uuid),
  public.newsroom_service_assign_member(uuid,uuid,text,boolean),
  public.newsroom_service_orphan_users(),
  public.newsroom_service_upsert_org(uuid,text,integer,boolean,integer),
  public.newsroom_service_upsert_source(uuid,text,text,text,text,text,text),
  public.newsroom_service_subscribe(uuid,uuid),
  public.newsroom_service_upsert_post(text,text,uuid,text,text,text,text,jsonb,text,timestamptz,timestamptz,jsonb,boolean,text,boolean),
  public.newsroom_service_set_reference(timestamptz,text),
  public.newsroom_service_get_run(text),
  public.newsroom_service_claim_run(text,uuid,integer,integer),
  public.newsroom_service_list_active_fb_sources(),
  public.newsroom_service_claim_run_item(uuid,uuid,text,text,text),
  public.newsroom_service_update_run_item(uuid,uuid,text,integer,integer,integer,integer,boolean,integer,integer,integer,integer,boolean,boolean,text,integer,jsonb),
  public.newsroom_service_finish_run(uuid,text,integer,integer,integer,boolean,integer,jsonb,jsonb,integer,integer,integer,text)
  to service_role;

commit;
