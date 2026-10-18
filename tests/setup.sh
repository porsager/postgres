#!/bin/sh
# Starts the two PostgreSQL servers the test suite expects, from scratch if needed.
#
#   sh tests/setup.sh          start (creating the clusters the first time)
#   sh tests/setup.sh stop     stop both servers
#   sh tests/setup.sh reset    stop and delete the clusters
#
# Run as an ordinary user (initdb refuses root), then run the tests with
#   PGHOST=localhost PGUSER=postgres node tests
# PG_BIN points at the PostgreSQL binaries if pg_ctl is not on PATH.
# PGTEST_DIR (default tests/.pgdata) holds the clusters, PGTEST_PORTS the two ports.

set -e

dir=${PGTEST_DIR:-$(cd "$(dirname "$0")" && pwd)/.pgdata}
ports=${PGTEST_PORTS:-"5432 5433"}
here=$(cd "$(dirname "$0")" && pwd)

bin=${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl /opt/homebrew/opt/postgresql*/bin/pg_ctl /usr/local/opt/postgresql*/bin/pg_ctl 2>/dev/null | sort -V | tail -n 1)")}
[ -x "$bin/pg_ctl" ] || { echo "pg_ctl not found, set PG_BIN" >&2; exit 1; }

case "$1" in
  stop)
    for port in $ports; do "$bin/pg_ctl" -D "$dir/$port" -m fast stop || true; done
    exit 0
    ;;
  reset)
    for port in $ports; do "$bin/pg_ctl" -D "$dir/$port" -m fast stop 2>/dev/null || true; done
    rm -rf "$dir"
    exit 0
    ;;
esac

for port in $ports; do
  data="$dir/$port"
  if [ ! -f "$data/PG_VERSION" ]; then
    mkdir -p "$data"
    "$bin/initdb" -D "$data" -U postgres --auth=trust >/dev/null
    cp "$here/pg_hba.conf" "$data/pg_hba.conf"
    openssl req -new -x509 -nodes -days 3650 -subj "/CN=localhost" \
      -keyout "$data/server.key" -out "$data/server.crt" >/dev/null 2>&1
    chmod 600 "$data/server.key"
    cat >> "$data/postgresql.conf" <<EOF
port = $port
listen_addresses = 'localhost'
unix_socket_directories = '/tmp'
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
wal_level = logical
max_prepared_transactions = 100
max_connections = 200
EOF
  fi
  "$bin/pg_ctl" -D "$data" -l "$data/log" -w status >/dev/null 2>&1 \
    || "$bin/pg_ctl" -D "$data" -l "$data/log" -w start >/dev/null
  echo "PostgreSQL $(cat "$data/PG_VERSION") on port $port"
done
