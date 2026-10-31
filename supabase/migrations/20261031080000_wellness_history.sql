-- Mesures du matin d'intervals.icu (FC au repos, VFC, sommeil, poids) : une année d'historique reçue
-- une fois, comme les activités. La date retenue évite de relire l'année à chaque passage.
alter table public.external_connections add column wellness_from date;
comment on column public.external_connections.wellness_from is
  'Date depuis laquelle les mesures du matin ont été reçues (historique d''un an, une fois) ; null : pas encore.';
