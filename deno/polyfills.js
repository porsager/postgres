/* global Deno */

import { Buffer } from 'node:buffer'

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
