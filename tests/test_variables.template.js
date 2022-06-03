export const idle_timeout = 1
export const login = {
  user: 'postgres_js_test'
}

export const login_md5 = {
  user: 'postgres_js_test_md5',
  pass: 'postgres_js_test_md5'
}

export const login_scram = {
  user: 'postgres_js_test_scram',
  pass: 'postgres_js_test_scram'
}

export const options = {
  host: "127.0.0.1",
  port: "5432",
  db: 'postgres_js_test',
  user: login.user,
  pass: login.pass,
  idle_timeout,
  connect_timeout: 1,
  max: 1
}
export const postgresConnection = 'localhost:5432';