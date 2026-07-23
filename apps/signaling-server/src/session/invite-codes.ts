import { randomInt } from "node:crypto";
import { redis } from "../redis.js";

const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // matches captcha's ambiguity-free alphabet
const CODE_LENGTH = 6;
const INVITE_TTL_SECONDS = 60 * 60 * 2; // 2 hours

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CHARSET[randomInt(CHARSET.length)];
  return out;
}

export async function mintInviteCode(sessionId: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    // NX so we never silently overwrite a still-live code for another session.
    const set = await redis.set(`invite:${code}`, sessionId, "EX", INVITE_TTL_SECONDS, "NX");
    if (set === "OK") return code;
  }
  throw new Error("Failed to mint a unique invite code after 10 attempts");
}

export async function resolveInviteCode(code: string): Promise<string | null> {
  return redis.get(`invite:${code.toUpperCase()}`);
}

export async function releaseInviteCode(code: string): Promise<void> {
  await redis.del(`invite:${code}`);
}
