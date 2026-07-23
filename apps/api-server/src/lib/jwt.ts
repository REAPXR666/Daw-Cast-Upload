import jwt from "jsonwebtoken";
import type { AccessTokenClaims } from "@daw-cast/shared-types";
import { env } from "../env.js";

export function signAccessToken(claims: Omit<AccessTokenClaims, "iat" | "exp">): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenClaims;
}
