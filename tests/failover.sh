#!/bin/sh
# A primary on 5434 with a streaming standby on 5435, for tests/failover.js. Run as an ordinary user.
#   sh tests/failover.sh          create (if needed) and start both
#   sh tests/failover.sh reset    stop both and delete them
set -e

dir=${PGTEST_DIR:-$(cd "$(dirname "$0")" && pwd)/.pgdata}/failover
here=$(cd "$(dirname "$0")" && pwd)
bin=${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl /opt/homebrew/opt/postgresql*/bin/pg_ctl 2>/dev/null | sort -V | tail -n 1)")}

stop() {
  for x in primary standby; do "$bin/pg_ctl" -D "$dir/$x" -m immediate stop >/dev/null 2>&1 || true; done
}

if [ "$1" = reset ]; then
  stop
  rm -rf "$dir"
  exit 0
fi

stop
rm -rf "$dir"
mkdir -p "$dir"
"$bin/initdb" -D "$dir/primary" -U postgres --auth=trust >/dev/null
cp "$here/pg_hba.conf" "$dir/primary/pg_hba.conf"
printf "host replication all samehost trust\nlocal replication all trust\n" >> "$dir/primary/pg_hba.conf"
cat >> "$dir/primary/postgresql.conf" <<EOF
port = 5434
listen_addresses = 'localhost'
unix_socket_directories = '/tmp'
wal_level = replica
max_wal_senders = 5
hot_standby = on
EOF
"$bin/pg_ctl" -D "$dir/primary" -l "$dir/primary.log" -w start >/dev/null
"$bin/pg_basebackup" -h localhost -p 5434 -U postgres -D "$dir/standby" -R -X stream >/dev/null
sed -i.bak 's/^port = 5434/port = 5435/' "$dir/standby/postgresql.conf"
"$bin/pg_ctl" -D "$dir/standby" -l "$dir/standby.log" -w start >/dev/null
echo "primary on 5434, standby on 5435"
