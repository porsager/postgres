#!/bin/sh

cd /var/lib/postgresql/data

openssl req \
    -new -x509 -days 365 -nodes -text \
    -out server.crt -keyout server.key -subj "/CN=localhost"
chmod og-rwx server.key

sed -ri \
    -e "s/^#ssl = .*/ssl = on/" \
    -e "s/^#password_encryption = .*/password_encryption = scram-sha-256/" \
    -e "s/^#unix_socket_directories = .*/unix_socket_directories = '\\/socket'/" \
    -e "s/^#unix_socket_permissions = .*/unix_socket_permissions = 0777/" \
    postgresql.conf

cat > pg_hba.conf <<EOF
# Trust all unix domain socket connections.
local  all                all                                  trust

# Allow test users to connect to the postgres_js_test database
# with the expected authentication method
host   postgres_js_test   postgres_js_test           all       trust
host   postgres_js_test   postgres_js_test_clear     all       password
host   postgres_js_test   postgres_js_test_md5       all       md5
host   postgres_js_test   postgres_js_test_scram     all       scram-sha-256

# Allow user "postgres" to connect to database "postgres"
# (for the "Connects with no options" test)
host   postgres           postgres             all       trust
EOF

# Reload config before running setup.sql
pg_ctl reload
