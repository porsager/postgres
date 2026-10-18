#!/bin/sh
# Starts PgBouncer in front of the test database on POOLER_PORT (default 6432).
# usage: sh tests/pooler.sh <session|transaction|prepared>
# "prepared" is transaction mode with max_prepared_statements (PgBouncer 1.21+).
set -e
mode=$1
port=${POOLER_PORT:-6432}
dir=${POOLER_DIR:-/tmp/pgbouncer-test}
case $mode in
  session) pool_mode=session; prepared=0 ;;
  transaction) pool_mode=transaction; prepared=0 ;;
  prepared) pool_mode=transaction; prepared=200 ;;
  *) echo "usage: sh tests/pooler.sh <session|transaction|prepared>"; exit 1 ;;
esac
mkdir -p $dir
cat > $dir/pgbouncer.ini <<INI
[databases]
* = host=127.0.0.1 port=${PGPORT:-5432}
[pgbouncer]
listen_addr = 127.0.0.1
listen_port = $port
unix_socket_dir =
auth_type = trust
auth_file = $dir/users.txt
pool_mode = $pool_mode
max_prepared_statements = $prepared
max_client_conn = 1000
default_pool_size = 10
ignore_startup_parameters = extra_float_digits,options
server_reset_query = DISCARD ALL
logfile = $dir/pgbouncer.log
pidfile = $dir/pgbouncer.pid
INI
cat > $dir/users.txt <<USERS
"postgres" ""
"postgres_js_test" ""
"postgres_js_test_md5" "postgres_js_test_md5"
"postgres_js_test_scram" "postgres_js_test_scram"
USERS
[ -f $dir/pgbouncer.pid ] && kill $(cat $dir/pgbouncer.pid) 2>/dev/null && sleep 1 || true
pgbouncer -d $dir/pgbouncer.ini
sleep 1
psql -h 127.0.0.1 -p $port -U postgres_js_test postgres_js_test -Atc "select 'pgbouncer $mode on $port'"
