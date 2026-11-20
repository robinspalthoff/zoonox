import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  createVerify,
  type KeyObject,
} from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// jwt.ts reads app id + key path from config at import time, so we set the
// environment and generate a throwaway key BEFORE dynamically importing it.

const APP_ID = "test-app-id-1234";
const keyPath = join(tmpdir(), `eb-test-key-${process.pid}.pem`);
let publicKey: KeyObject;
let getAppJwt: () => string;

function base64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(base64urlToBuffer(seg).toString("utf8"));
}

before(async () => {
  const { privateKey, publicKey: pub } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  publicKey = pub;
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }) as string);

  process.env.ENABLEBANKING_APP_ID = APP_ID;
  process.env.ENABLEBANKING_PRIVATE_KEY_PATH = keyPath;

  ({ getAppJwt } = await import("../../src/lib/enable-banking/jwt"));
});

after(() => {
  rmSync(keyPath, { force: true });
});

test("produces a well-formed three-segment JWT", () => {
  const jwt = getAppJwt();
  assert.equal(jwt.split(".").length, 3);
});

test("header uses RS256 and the app id as kid", () => {
  const [h] = getAppJwt().split(".");
  const header = decodeSegment(h);
  assert.equal(header.alg, "RS256");
  assert.equal(header.typ, "JWT");
  assert.equal(header.kid, APP_ID);
});

test("payload has correct iss/aud and exp after iat", () => {
  const [, p] = getAppJwt().split(".");
  const payload = decodeSegment(p) as { iss: string; aud: string; iat: number; exp: number };
  assert.equal(payload.iss, "enablebanking.com");
  assert.equal(payload.aud, "api.enablebanking.com");
  assert.ok(payload.exp > payload.iat, "exp must be after iat");
  // TTL must stay within Enable Banking's 24h maximum.
  assert.ok(payload.exp - payload.iat <= 86_400);
});

test("signature verifies against the paired public key", () => {
  const jwt = getAppJwt();
  const [h, p, sig] = jwt.split(".");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${h}.${p}`);
  verifier.end();
  assert.ok(
    verifier.verify(publicKey, base64urlToBuffer(sig)),
    "JWT signature must verify with the public key",
  );
});

test("caches the token across calls within its TTL", () => {
  assert.equal(getAppJwt(), getAppJwt());
});
