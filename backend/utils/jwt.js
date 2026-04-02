import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const ensureJwtSecret = () => {
  if (!env.JWT_SECRET || !String(env.JWT_SECRET).trim()) {
    const error = new Error("JWT auth is not configured. Missing JWT_SECRET.");
    error.statusCode = 500;
    throw error;
  }

  return String(env.JWT_SECRET).trim();
};

export const signAccessToken = (user) => {
  const secret = ensureJwtSecret();

  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      responderType: user.responderType || null,
      approvalStatus: user.approvalStatus,
    },
    secret,
    {
      expiresIn: env.JWT_EXPIRES_IN,
    },
  );
};

export const verifyAccessToken = (token) => {
  const secret = ensureJwtSecret();
  return jwt.verify(token, secret);
};
