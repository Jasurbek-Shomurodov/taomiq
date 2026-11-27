#!/bin/sh
# Applies every migration in supabase/migrations to a throwaway local Postgres, in order, and stops at the first
# error. The project is on Supabase's Free plan, which has no branches, so this is the test a migration gets before
# production (CLAUDE.md, "Migration policy"). Then it runs the checks in supabase/local-test/*.test.sql.
#
#   scripts/test-migrations.sh            apply everything, then stop and delete the server
#   scripts/test-migrations.sh --keep     leave it running and print the psql command, to run checks by hand
#
# Needs Postgres installed locally (initdb, pg_ctl, psql on PATH; `brew install postgresql@17`).
set -eu
export LC_ALL=C

root=$(cd "$(dirname "$0")/.." && pwd)
dir=$(mktemp -d)
port=${PGTEST_PORT:-54399}
run() { psql -h 127.0.0.1 -p "$port" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
stop() { pg_ctl -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$dir"; }

initdb -D "$dir/data" -U postgres -A trust --locale=C -E UTF8 >/dev/null
pg_ctl -D "$dir/data" -l "$dir/log" -w start \
  -o "-p $port -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" >/dev/null
[ "${1:-}" = "--keep" ] || trap stop EXIT

run -d postgres -c "create database taomiq_test"
run -d taomiq_test -f "$root/supabase/local-test/stub.sql"
for file in "$root"/supabase/migrations/*.sql; do
  echo "applying $(basename "$file")"
  run -d taomiq_test -f "$file"
done
echo "all migrations applied"
# Checks of the functions, each file one transaction that rolls itself back (supabase/local-test/*.test.sql).
for file in "$root"/supabase/local-test/*.test.sql; do
  [ -e "$file" ] || continue
  echo "checking $(basename "$file")"
  run -d taomiq_test -f "$file"
done

if [ "${1:-}" = "--keep" ]; then
  echo "server left running:  psql -h 127.0.0.1 -p $port -U postgres -d taomiq_test"
  echo "stop and delete it:   pg_ctl -D $dir/data -m immediate stop && rm -rf $dir"
fi
