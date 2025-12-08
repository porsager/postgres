/* global Deno */

import { isIP, Socket } from 'node:net'
import { connect } from 'node:tls'
import { Buffer } from 'node:buffer'

export const net = {
  isIP,
  createServer() {
    const server =  {
      address() {
        return { port: 9876 }
      },
      async listen() {
        server.raw = Deno.listen({ port: 9876, transport: 'tcp' })
        for await (const conn of server.raw)
          setTimeout(() => conn.close(), 500)
      },
      close() {
        server.raw.close()
      }
    }
    return server
  },
  Socket
}

export const tls = {
  connect,
}

const enc = new TextEncoder()

export const HmacSha256 = async (key, x) => {
  const keyBytes = typeof key === "string" ? enc.encode(key) : key
  const dataBytes = typeof x === "string" ? enc.encode(x) : x

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )

  const mac = await crypto.subtle.sign("HMAC", cryptoKey, dataBytes)
  return Buffer.from(mac)
}
