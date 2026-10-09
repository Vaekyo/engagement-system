import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashAuthorId } from "./crypto";
import { signSession, verifySession } from "./auth/session-token";
import { hashPassword, verifyPassword } from "./auth/password";
import { redact } from "./audit";

describe("token encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const enc = encryptSecret("ya29.secret-access-token");
    expect(enc).not.toContain("secret-access-token");
    expect(decryptSecret(enc)).toBe("ya29.secret-access-token");
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("rejects tampered ciphertext", () => {
    const parts = encryptSecret("token").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});

describe("session tokens", () => {
  const secret = "s".repeat(40);
  it("verifies valid sessions and rejects forged or expired ones", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signSession({ creatorId: "c1", exp }, secret);
    expect(verifySession(token, secret)?.creatorId).toBe("c1");
    expect(verifySession(token, "x".repeat(40))).toBeNull();
    const [body] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ creatorId: "c2", exp })).toString("base64url");
    expect(verifySession(`${forged}.${token.split(".")[1]}`, secret)).toBeNull();
    expect(verifySession(body, secret)).toBeNull();
    expect(verifySession(signSession({ creatorId: "c1", exp: 1 }, secret), secret)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
  });
});

describe("passwords", () => {
  it("hashes with scrypt and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toContain("correct");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("privacy helpers", () => {
  it("hashes author IDs deterministically without exposing them", () => {
    const h = hashAuthorId("youtube", "UC123");
    expect(h).toBe(hashAuthorId("youtube", "UC123"));
    expect(h).not.toContain("UC123");
    expect(h).not.toBe(hashAuthorId("instagram", "UC123"));
  });

  it("redacts secrets from audit metadata", () => {
    expect(redact({ accessToken: "a", nested: { client_secret: "b", ok: 1 }, list: [{ password: "c" }] })).toEqual({
      accessToken: "[redacted]",
      nested: { client_secret: "[redacted]", ok: 1 },
      list: [{ password: "[redacted]" }],
    });
  });
});
