import { spawn } from 'node:child_process'

await exec('dropdb', ['postgres_js_test'])

await exec('psql', ['-c', 'alter system set ssl=on'])
await exec('psql', ['-c', 'drop user postgres_js_test'])
await exec('psql', ['-c', 'create user postgres_js_test'])
await exec('psql', ['-c', 'alter system set password_encryption=md5'])
await exec('psql', ['-c', 'select pg_reload_conf()'])
await exec('psql', ['-c', 'drop user if exists postgres_js_test_md5'])
await exec('psql', ['-c', 'create user postgres_js_test_md5 with password \'postgres_js_test_md5\''])
await exec('psql', ['-c', 'alter system set password_encryption=\'scram-sha-256\''])
await exec('psql', ['-c', 'select pg_reload_conf()'])
await exec('psql', ['-c', 'drop user if exists postgres_js_test_scram'])
await exec('psql', ['-c', 'create user postgres_js_test_scram with password \'postgres_js_test_scram\''])

await exec('createdb', ['postgres_js_test'])
await exec('psql', ['-c', 'grant all on database postgres_js_test to postgres_js_test'])
await exec('psql', ['-c', 'alter database postgres_js_test owner to postgres_js_test'])

function ignore(cmd, args) {
  const { stderr } = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' })
  if (stderr && !stderr.includes('already exists') && !stderr.includes('does not exist'))
    throw stderr
}

export async function exec(cmd, args) { // eslint-disable-line
  let stderr = ''
  const cp = await spawn(cmd, args, { stdio: 'pipe', encoding: 'utf8' }) // eslint-disable-line
  cp.stderr.on('data', x => stderr += x)
  await new Promise(x => cp.on('exit', x))
  if (stderr && !stderr.includes('already exists') && !stderr.includes('does not exist'))
    throw new Error(stderr)
}
