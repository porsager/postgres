import { spawn } from 'https://deno.land/std@0.107.0/node/child_process.ts'

await execAsync('psql', ['-c', 'create user postgres_js_test'])
await execAsync('psql', ['-c', 'alter system set password_encryption=md5'])
await execAsync('psql', ['-c', 'select pg_reload_conf()'])
await execAsync('psql', ['-c', 'create user postgres_js_test_md5 with password \'postgres_js_test_md5\''])
await execAsync('psql', ['-c', 'alter system set password_encryption=\'scram-sha-256\''])
await execAsync('psql', ['-c', 'select pg_reload_conf()'])
await execAsync('psql', ['-c', 'create user postgres_js_test_scram with password \'postgres_js_test_scram\''])

await execAsync('dropdb', ['postgres_js_test'])
await execAsync('createdb', ['postgres_js_test'])
await execAsync('psql', ['-c', 'grant all on database postgres_js_test to postgres_js_test'])

function exec(cmd, args) {
  const { stderr } = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' })
  if (stderr && !stderr.includes('already exists') && !stderr.includes('does not exist'))
    throw stderr
}

async function execAsync(cmd, args) {
  let stderr = ''
  const cp = await spawn(cmd, args, { stdio: 'pipe', encoding: 'utf8' })
  cp.stderr.on('data', x => stderr += x)
  await new Promise(x => cp.on('exit', x))
  if (stderr && !stderr.includes('already exists') && !stderr.includes('does not exist'))
    throw new Error(stderr)
}
