/**
 * Верификация Google ID-токена (JWT).
 * Использует встроенные crypto-модули Node.js, без внешних зависимостей.
 */
import { createPublicKey, createVerify, webcrypto } from "node:crypto";

const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

let certsCache = null;
let certsExpireAt = 0;

async function fetchCerts() {
  const now = Date.now();
  if (certsCache && now < certsExpireAt) return certsCache;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error("Google certs fetch failed");
  const data = await res.json();
  // Обычно cache-control: max-age
  const cc = res.headers.get("cache-control") || "";
  const m = /max-age=(\d+)/.exec(cc);
  const ttl = m ? Number(m[1]) * 1000 : 3600_000;
  certsCache = {};
  for (const k of data.keys) certsCache[k.kid] = k;
  certsExpireAt = now + ttl;
  return certsCache;
}

function base64urlToBuffer(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function jwkToKey(jwk) {
  return createPublicKey({ key: jwk, format: "jwk" });
}

/**
 * Верифицирует Google ID-токен и возвращает payload, либо бросает ошибку.
 * @param {string} idToken
 * @param {string} clientId — OAuth Client ID для aud-проверки (опционально)
 */
export async function verifyGoogleIdToken(idToken, clientId = null) {
  const [headerB64, payloadB64, sigB64] = idToken.split(".");
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error("Invalid token");
  const header = JSON.parse(base64urlToBuffer(headerB64).toString("utf8"));
  const payload = JSON.parse(base64urlToBuffer(payloadB64).toString("utf8"));

  const certs = await fetchCerts();
  const jwk = certs[header.kid];
  if (!jwk) throw new Error("Key not found");
  const key = jwkToKey(jwk);

  const data = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  const sig = base64urlToBuffer(sigB64);

  const algo = header.alg === "RS256" ? "RSA-SHA256" : header.alg === "ES256" ? "sha256" : null;
  if (!algo) throw new Error("Unsupported alg");

  let valid = false;
  if (header.alg === "RS256") {
    const verify = createVerify("RSA-SHA256");
    verify.update(data);
    verify.end();
    valid = verify.verify(key, sig);
  }
  if (!valid) throw new Error("Signature verification failed");

  // Проверки
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) throw new Error("Token expired");
  if (payload.iat && payload.iat > now + 300) throw new Error("Invalid iat");
  if (!ISSUERS.includes(payload.iss)) throw new Error("Invalid issuer");
  if (clientId && payload.aud !== clientId) throw new Error("Invalid audience");

  return payload;
}
