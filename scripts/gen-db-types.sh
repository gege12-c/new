#!/usr/bin/env bash
# Régénère src/lib/supabase/database.types.ts à partir des migrations, sans Docker :
# démarre un PostgreSQL jetable, applique la couche de compatibilité Supabase et les migrations,
# puis lance `supabase gen types`. À relancer après chaque nouvelle migration.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PG_BIN="${PG_BIN:-$(pg_config --bindir)}"
PORT="${PORT:-55439}"
WORK="$(mktemp -d)"
RUN=()
if [ "$(id -u)" = "0" ]; then
  chown postgres:postgres "$WORK"
  RUN=(runuser -u postgres --)
fi

cleanup() {
  "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/log" -w \
  -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" start >/dev/null

PSQL=("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -d postgres -c "create database types"
"${PSQL[@]}" -d types -f "$ROOT/tests/db/supabase-shim.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d types -f "$migration"
done

OUT="$ROOT/src/lib/supabase/database.types.ts"
npx --yes supabase@2 gen types typescript \
  --db-url "postgresql://postgres@127.0.0.1:$PORT/types?sslmode=disable" --schema public > "$OUT"
npx --yes oxfmt "$OUT" >/dev/null
echo "Types régénérés : $OUT"
