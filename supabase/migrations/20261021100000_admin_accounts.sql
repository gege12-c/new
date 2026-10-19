-- Phase 5 : gestion des comptes et des rôles par un administrateur, sans aucune donnée sportive.
--
-- L'administrateur voit chaque compte (nom, email, mode coach, administrateur, dates d'inscription
-- et de dernière connexion, nombre de relations coach-athlète) et peut donner ou retirer le rôle
-- d'administrateur. Il ne voit ni séances, ni activités, ni seuils, ni commentaires.

create function public.admin_accounts()
returns table (
  id uuid,
  display_name text,
  email text,
  is_coach boolean,
  is_admin boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  athletes bigint,
  coaches bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select
      p.id,
      p.display_name,
      u.email::text,
      p.is_coach,
      exists (select 1 from public.admin_users a where a.user_id = p.id),
      u.created_at,
      u.last_sign_in_at,
      (select count(*) from public.coach_athlete_links l where l.coach_id = p.id and l.status = 'active'),
      (select count(*) from public.coach_athlete_links l where l.athlete_id = p.id and l.status = 'active')
    from public.profiles p
    join auth.users u on u.id = p.id
    order by u.created_at desc;
end;
$$;

/** Donne ou retire le rôle d'administrateur ; le dernier administrateur ne peut pas se le retirer. */
create function public.admin_set_admin(p_user uuid, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  if p_admin then
    insert into public.admin_users (user_id) values (p_user) on conflict (user_id) do nothing;
  else
    if not exists (select 1 from public.admin_users a where a.user_id <> p_user) then
      raise exception 'last_admin' using errcode = '42501';
    end if;
    delete from public.admin_users where user_id = p_user;
  end if;
end;
$$;

revoke all on function public.admin_accounts() from public, anon;
revoke all on function public.admin_set_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_accounts() to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;
