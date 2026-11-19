begin;
create schema newsroom;
revoke all on schema newsroom from public, anon, authenticated;
grant usage on schema newsroom to authenticated;
create table newsroom.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  max_sources integer not null default 10 check (max_sources >= 0),
  allow_add boolean not null default true,
  feed_days integer not null default 7 check (feed_days between 1 and 90)
);
create table newsroom.members (
  user_id uuid primary key references auth.users on delete cascade,
  org_id uuid references newsroom.organizations,
  role text not null check (role in ('editor','platform_admin')),
  check ((role = 'editor') = (org_id is not null))
);
create table newsroom.sources (
  id uuid primary key default gen_random_uuid(), platform text not null,
  kind text not null, native_key text not null, locator text not null unique, name text not null,
  check ((platform = 'facebook' and kind in ('page','group')) or (platform = 'x' and kind = 'account')),
  unique(platform,kind,native_key), unique(platform,id)
);
-- Only a verified public source enters this catalogue. Alternative URLs map to the same stable ID.
create table newsroom.aliases (
  locator text primary key, source_id uuid not null references newsroom.sources
);
create table newsroom.subscriptions (
  org_id uuid references newsroom.organizations, source_id uuid references newsroom.sources,
  active boolean not null default true, primary key (org_id,source_id)
);
create index subscriptions_by_source on newsroom.subscriptions(source_id,org_id) where active;
create table newsroom.requests (
  org_id uuid references newsroom.organizations, locator text not null,
  requested_at timestamptz not null default now(), primary key(org_id,locator)
);
create table newsroom.posts (
  id uuid primary key default gen_random_uuid(), platform text not null, native_key text not null,
  body text not null default '', media text not null check (media in ('text','photo','video')),
  media_url text, original_url text, published_at timestamptz,
  unique(platform,native_key), unique(platform,id)
);
create table newsroom.appearances (
  source_id uuid not null, post_id uuid not null, platform text not null, seen_at timestamptz not null,
  primary key(source_id,post_id),
  foreign key(platform,source_id) references newsroom.sources(platform,id),
  foreign key(platform,post_id) references newsroom.posts(platform,id)
);
create index appearances_by_post on newsroom.appearances(post_id);
create index appearances_recent on newsroom.appearances(source_id,seen_at desc);
create table newsroom.collection_jobs (
  source_id uuid references newsroom.sources, slot timestamptz not null,
  primary key(source_id,slot)
);

alter table newsroom.organizations enable row level security;
alter table newsroom.members enable row level security;
alter table newsroom.sources enable row level security;
alter table newsroom.aliases enable row level security;
alter table newsroom.subscriptions enable row level security;
alter table newsroom.requests enable row level security;
alter table newsroom.posts enable row level security;
alter table newsroom.appearances enable row level security;
alter table newsroom.collection_jobs enable row level security;

create function newsroom.member_of(o uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from newsroom.members where user_id = (select auth.uid())
                and (org_id = o or role = 'platform_admin'))
$$;
create function newsroom.has_subscription(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from newsroom.subscriptions t where t.source_id = s and newsroom.member_of(t.org_id))
$$;
create function newsroom.can_see_appearance(s uuid, stamp timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from newsroom.subscriptions t join newsroom.organizations o on o.id=t.org_id
    where t.source_id=s and t.active and newsroom.member_of(o.id)
      and stamp >= now() - make_interval(days => o.feed_days))
$$;
create function newsroom.can_see_post(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from newsroom.appearances a where a.post_id=p and newsroom.can_see_appearance(a.source_id,a.seen_at))
$$;
create policy own_org on newsroom.organizations for select to authenticated using (newsroom.member_of(id));
create policy own_subscriptions on newsroom.subscriptions for select to authenticated using (newsroom.member_of(org_id));
create policy own_requests on newsroom.requests for select to authenticated using (newsroom.member_of(org_id));
create policy followed_sources on newsroom.sources for select to authenticated using (newsroom.has_subscription(id));
create policy visible_appearances on newsroom.appearances for select to authenticated using (newsroom.can_see_appearance(source_id,seen_at));
create policy visible_posts on newsroom.posts for select to authenticated using (newsroom.can_see_post(id));

create function public.newsroom_workspaces() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'role',m.role) order by o.name),'[]')
  from newsroom.members m join newsroom.organizations o on (m.org_id=o.id or m.role='platform_admin')
  where m.user_id=(select auth.uid())
$$;

create function public.newsroom_snapshot(p_org uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare org_days integer; addition boolean; result jsonb;
begin
  select feed_days,allow_add into org_days,addition from newsroom.organizations where id=p_org;
  if not found then raise insufficient_privilege using message='Workspace access denied'; end if;
  with selected as (
    select s.id,s.name,s.platform,s.kind,s.locator,t.active from newsroom.subscriptions t
    join newsroom.sources s on s.id=t.source_id where t.org_id=p_org
  ), recent as (
    select a.post_id,max(a.seen_at) as seen,
      jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.id) as visible_sources
    from newsroom.appearances a join selected s on s.active and s.id=a.source_id
    where a.seen_at >= now()-make_interval(days=>org_days)
    group by a.post_id order by seen desc,a.post_id limit 100
  )
  select jsonb_build_object(
    'canAdd',addition,
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.name,s.id) from selected s),'[]'),
    'pending',coalesce((select jsonb_agg(locator order by requested_at,locator) from newsroom.requests where org_id=p_org),'[]'),
    'posts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'platform',p.platform,'text',p.body,
      'media',p.media,'mediaUrl',p.media_url,'originalUrl',p.original_url,'publishedAt',p.published_at,
      'seenAt',r.seen,'sources',r.visible_sources) order by r.seen desc,p.id)
      from recent r join newsroom.posts p on p.id=r.post_id),'[]')
  ) into result;
  return result;
end $$;

create function public.newsroom_follow(p_org uuid,p_locator text) returns text
language plpgsql security definer set search_path = '' as $$
declare cfg newsroom.organizations; src uuid; used integer; is_admin boolean;
begin
  if not newsroom.member_of(p_org) then raise insufficient_privilege; end if;
  if p_locator is null or p_locator !~ '^(facebook:page:[a-z0-9.]{2,75}|facebook:group:[0-9]{1,32}|x:account:[a-z0-9_]{1,15})$'
    then raise invalid_parameter_value using message='Invalid source'; end if;
  select * into strict cfg from newsroom.organizations where id=p_org for update;
  select exists(select 1 from newsroom.members where user_id=(select auth.uid()) and role='platform_admin') into is_admin;
  select id into src from newsroom.sources where locator=p_locator;
  if src is null then select source_id into src from newsroom.aliases where locator=p_locator; end if;
  if exists(select 1 from newsroom.subscriptions where org_id=p_org and source_id=src and active) then return 'already'; end if;
  if exists(select 1 from newsroom.requests where org_id=p_org and locator=p_locator) then return 'pending'; end if;
  if not cfg.allow_add and not is_admin then return 'disabled'; end if;
  select (select count(*) from newsroom.subscriptions where org_id=p_org and active)
       + (select count(*) from newsroom.requests where org_id=p_org) into used;
  if used >= cfg.max_sources then return 'limit'; end if;
  if src is null then
    insert into newsroom.requests(org_id,locator) values(p_org,p_locator);
    return 'queued';
  end if;
  insert into newsroom.subscriptions(org_id,source_id) values(p_org,src)
    on conflict(org_id,source_id) do update set active=true;
  return 'added';
end $$;

create function public.newsroom_pause(p_org uuid,p_source uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not newsroom.member_of(p_org) then raise insufficient_privilege; end if;
  perform 1 from newsroom.organizations where id=p_org for update;
  update newsroom.subscriptions set active=false where org_id=p_org and source_id=p_source;
end $$;

-- Database-owner operation for testing/planning. No external HTTP and no cron.
create function newsroom.plan_slot(at_time timestamptz) returns integer
language plpgsql security invoker set search_path = '' as $$
declare inserted integer;
begin
  insert into newsroom.collection_jobs(source_id,slot)
    select distinct source_id,date_bin(interval '30 minutes',at_time,timestamptz '2000-01-01 00:00:00+00')
    from newsroom.subscriptions where active on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke all on all tables in schema newsroom from public,anon,authenticated;
revoke all on all functions in schema newsroom from public,anon,authenticated;
grant select (id,name,feed_days,allow_add) on newsroom.organizations to authenticated;
grant select (id,name,platform,kind,locator) on newsroom.sources to authenticated;
grant select on newsroom.subscriptions,newsroom.requests,newsroom.appearances to authenticated;
grant select (id,platform,body,media,media_url,original_url,published_at) on newsroom.posts to authenticated;
grant execute on function newsroom.member_of(uuid),newsroom.has_subscription(uuid),
  newsroom.can_see_appearance(uuid,timestamptz),newsroom.can_see_post(uuid) to authenticated;
revoke all on function public.newsroom_workspaces(),public.newsroom_snapshot(uuid),
  public.newsroom_follow(uuid,text),public.newsroom_pause(uuid,uuid) from public,anon,authenticated;
grant execute on function public.newsroom_workspaces(),public.newsroom_snapshot(uuid),
  public.newsroom_follow(uuid,text),public.newsroom_pause(uuid,uuid) to authenticated;
create function public.newsroom_cancel_request(p_org uuid,p_locator text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not newsroom.member_of(p_org) then raise insufficient_privilege; end if;
  perform 1 from newsroom.organizations where id=p_org for update;
  delete from newsroom.requests where org_id=p_org and locator=p_locator;
end $$;
revoke all on function public.newsroom_cancel_request(uuid,text) from public,anon,authenticated;
grant execute on function public.newsroom_cancel_request(uuid,text) to authenticated;
commit;
