function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Bytes(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(buf);
}

/**
 * Розшифровує ENCRYPTED_BREAKERS ключем з QR (?k=...).
 * Формат: nonce(12) + tag(16) + ciphertext
 */
export async function decryptBreakers(accessKey, packedB64) {
  const packed = b64ToBytes(packedB64);
  if (packed.length < 29) throw new Error("Bad encrypted payload");

  const nonce = packed.slice(0, 12);
  const tag = packed.slice(12, 28);
  const cipher = packed.slice(28);

  // WebCrypto expects ciphertext||tag
  const cipherWithTag = new Uint8Array(cipher.length + tag.length);
  cipherWithTag.set(cipher, 0);
  cipherWithTag.set(tag, cipher.length);

  const keyBytes = await sha256Bytes(accessKey);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    cryptoKey,
    cipherWithTag
  );

  const json = new TextDecoder().decode(plainBuf);
  const list = JSON.parse(json);
  if (!Array.isArray(list)) throw new Error("Invalid breakers payload");
  return list;
}
