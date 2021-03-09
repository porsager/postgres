const cp = require('child_process')

exec('psql -c "create user postgres_js_test"')
exec('psql -c "alter system set password_encryption=md5"')
exec('psql -c "select pg_reload_conf()"')
exec('psql -c "create user postgres_js_test_md5 with password \'postgres_js_test_md5\'"')
exec('psql -c "alter system set password_encryption=\'scram-sha-256\'"')
exec('psql -c "select pg_reload_conf()"')
exec('psql -c "create user postgres_js_test_scram with password \'postgres_js_test_scram\'"')

cp.execSync('dropdb postgres_js_test;createdb postgres_js_test')
;['postgres_js_test', 'postgres_js_test', 'postgres_js_test', 'postgres_js_test'].forEach(x =>
  cp.execSync('psql -c "grant all on database postgres_js_test to ' + x + '"')
)

function exec(cmd) {
  try {
    cp.execSync(cmd, { stdio: 'pipe', encoding: 'utf8' })
  } catch (err) {
    if (err.stderr.indexOf('already exists') === -1)
      throw err
  }
}
