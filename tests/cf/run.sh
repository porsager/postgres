#!/bin/sh
# Runs the test worker in workerd (wrangler dev) against the test servers and prints the checks.
#   sh tests/cf/run.sh                 every check, direct to the test server
#   ONLY=trust sh tests/cf/run.sh      the checks of one configuration
#   CHECK=hyperdrive sh tests/cf/run.sh  the checks through the HYPERDRIVE binding
# Workers always verify server certificates: for the TLS checks the server needs a certificate
# for localhost that NODE_EXTRA_CA_CERTS trusts.
set -e
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
port=${PORT:-8787}
path=$([ "${CHECK:-}" = hyperdrive ] && echo /hyperdrive || echo /)
npx -y wrangler@4 dev --port "$port" --ip 127.0.0.1 > wrangler.log 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$port/?only=none" && break; sleep 1; done
curl -s --max-time 300 -w '\n%{http_code}\n' "http://127.0.0.1:$port$path?only=${ONLY:-}" | tee result.json | tail -1 | grep -q 200
