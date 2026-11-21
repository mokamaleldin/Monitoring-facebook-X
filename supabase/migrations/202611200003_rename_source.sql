begin;

create or replace function public.newsroom_admin_rename_source(
  p_source uuid,
  p_name text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_clean text;
  v_row newsroom.sources;
begin
  if not newsroom.is_admin() then
    raise insufficient_privilege using message = 'Platform admin access required';
  end if;
  v_clean := btrim(coalesce(p_name, ''));
  if v_clean = '' or char_length(v_clean) > 120 then
    raise invalid_parameter_value using message = 'Invalid source name';
  end if;

  update newsroom.sources
  set name = v_clean
  where id = p_source
  returning * into v_row;

  if not found then
    raise invalid_parameter_value using message = 'Source not found';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'locator', v_row.locator
  );
end $$;

revoke all on function public.newsroom_admin_rename_source(uuid, text)
  from public, anon, authenticated;
grant execute on function public.newsroom_admin_rename_source(uuid, text)
  to authenticated;

commit;
