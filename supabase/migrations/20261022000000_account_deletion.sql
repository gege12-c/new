-- Phase 5 : suppression du compte par son titulaire (droit à l'effacement).
--
-- Disparaissent : le compte et son profil sportif, ses seuils, compétitions, séances, commentaires,
-- activités, déclarations, exports, notifications, réglages, connexions et jetons, ainsi que son
-- historique d'audit. En tant que coach : ses relations, invitations et modèles, ses modifications
-- en attente et les séances restées brouillon chez ses athlètes. Les séances qu'il a publiées
-- restent chez ses athlètes (elles leur appartiennent), sans auteur ; ses actions passées dans leur
-- historique deviennent anonymes.
--
-- La révocation de l'accès Strava est faite par l'application juste avant (elle seule déchiffre les
-- jetons) ; si elle n'a pas pu se faire, la connexion et les jetons sont tout de même effacés ici.

-- Pendant la suppression, les clés étrangères « on delete set null » réécrivent les séances
-- (auteur, dernier éditeur, modèle) : le trigger ne doit pas y inscrire le compte en cours de
-- suppression comme dernier éditeur. Seul changement : `updated_by` ne désigne qu'un profil existant.
create or replace function private.guard_planned_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.state = 'published' then
      new.published_at := now();
    end if;
    new.version := 1;
    return new;
  end if;

  -- created_by peut seulement passer à null (suppression du compte auteur, via la clé étrangère).
  if new.athlete_id <> old.athlete_id
     or (new.created_by is not null and new.created_by is distinct from old.created_by) then
    raise exception 'immutable_field' using errcode = '42501';
  end if;

  -- L'athlète peut seulement déplacer une séance planifiée par quelqu'un d'autre.
  if v_actor = old.athlete_id and old.created_by is distinct from v_actor then
    if (to_jsonb(new) - array['scheduled_date', 'start_time', 'updated_at', 'updated_by', 'version'])
       is distinct from (to_jsonb(old) - array['scheduled_date', 'start_time', 'updated_at', 'updated_by', 'version']) then
      raise exception 'athlete_can_only_reschedule' using errcode = '42501';
    end if;
  end if;

  if new.state = 'published' and old.state is distinct from 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  new.updated_by := (select p.id from public.profiles p where p.id = v_actor);
  new.version := old.version + 1;
  return new;
end;
$$;

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invitations uuid[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  -- Invitations envoyées par ce compte, ou acceptées par lui : leur trace d'audit part avec lui.
  select coalesce(array_agg(i.id), '{}') into v_invitations
  from public.invitations i
  where i.coach_id = v_uid or i.accepted_by = v_uid;
  delete from public.invitations where accepted_by = v_uid;

  -- Travail de coach jamais montré à l'athlète : modifications en attente et brouillons.
  delete from public.planned_session_drafts where updated_by = v_uid;
  delete from public.planned_sessions where created_by = v_uid and athlete_id <> v_uid and state = 'draft';

  -- Le compte : la cascade efface tout ce qui lui appartient.
  delete from auth.users where id = v_uid;

  -- Historique : ce qui concernait ce compte disparaît ; ses actions chez les autres deviennent anonymes.
  delete from public.audit_logs
  where athlete_id = v_uid or (entity_type = 'invitations' and entity_id = any (v_invitations));
  update public.audit_logs set actor_id = null where actor_id = v_uid;
end;
$$;

comment on function public.delete_my_account() is
  'Supprime le compte de l''utilisateur connecté et toutes ses données ; irréversible.';

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
