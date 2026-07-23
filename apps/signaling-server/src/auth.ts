import jwt from "jsonwebtoken";
import type { AccessTokenClaims } from "@daw-cast/shared-types";
import { env } from "./env.js";

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenClaims;
}
