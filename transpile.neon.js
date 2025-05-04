import fs from "fs";
import path from "path";

const skipLogic = `    if (canSkipReadyForQuery) {
      canSkipReadyForQuery = false;
      return;
    }`;

const empty = (x) =>
    fs.readdirSync(x).forEach((f) => fs.unlinkSync(path.join(x, f))),
  ensureEmpty = (x) => (!fs.existsSync(x) ? fs.mkdirSync(x) : empty(x)),
  root = "neon",
  src = path.join(root, "src");

ensureEmpty(src);

fs.readdirSync("src").forEach((name) =>
  fs.writeFileSync(
    path.join(src, name),
    transpile(fs.readFileSync(path.join("src", name), "utf8"), name, "src"),
  ),
);

function transpile(x) {
  const timers = x.includes("setImmediate")
    ? "import { setImmediate, clearImmediate } from '../polyfills.js'\n"
    : "";

  const process = x.includes("process.")
    ? "import { process } from '../polyfills.js'\n"
    : "";

  const buffer = x.includes("Buffer")
    ? "import { Buffer } from 'node:buffer'\n"
    : "";

  return (
    process +
    buffer +
    timers +
    x
      .replace("import net from 'net'", "import { net } from '../polyfills.js'")
      .replace("import tls from 'tls'", "import { tls } from '../polyfills.js'")
      .replace(
        "import crypto from 'crypto'",
        "import { crypto } from '../polyfills.js'",
      )
      .replace("import os from 'os'", "import { os } from '../polyfills.js'")
      .replace("import fs from 'fs'", "import { fs } from '../polyfills.js'")
      .replace(
        "import { performance } from 'perf_hooks'",
        "import { performance } from '../polyfills.js'",
      )
      .replace(/ from '([a-z_]+)'/g, " from 'node:$1'")
      // this change "pipelines" the cleartext password and ready for query
      // *before* postgres actually asks for it to speed up connection time
      // by reducing the number of round-trips
      .replace(
        /const s = StartupMessage\(\)\n(\s*)write\(s\)\n/gm,
        "$&$1AuthenticationCleartextPassword()\n$1ReadyForQuery()\n$1canSkipReadyForQuery = true\n",
      )
      // we already sent the password (see above) so we can safely ignore this request
      .replace("x === 82 ? Authentication :", "x === 82 ? noop :          ")
      // simularly, we can also skip the "ReadyForQuery" message when we've already sent it
      .replace(/function ReadyForQuery\(x\) {/g, `$&\n${skipLogic}`)
      .replace("let uid = 1", "$&\nlet canSkipReadyForQuery = false")
  );
}
