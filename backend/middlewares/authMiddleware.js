import User from "../models/User.js";
import { env } from "../config/env.js";
import { verifyAccessToken } from "../utils/jwt.js";

const extractBearerToken = (req) => {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") {
    return "";
  }

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return "";
  }

  return token.trim();
};

const sendAuthError = (res, statusCode, code, message) =>
  res.status(statusCode).json({
    success: false,
    code,
    message,
  });

const loadUserFromRequest = async (req) => {
  const token = extractBearerToken(req);
  if (!token) {
    return { error: { statusCode: 401, code: "AUTH_REQUIRED", message: "Authentication required" } };
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return { error: { statusCode: 401, code: "INVALID_TOKEN", message: "Invalid or expired token" } };
  }

  const userId = payload?.sub;
  if (!userId) {
    return { error: { statusCode: 401, code: "INVALID_TOKEN", message: "Invalid authentication payload" } };
  }

  const user = await User.findById(userId);
  if (!user) {
    return { error: { statusCode: 401, code: "USER_NOT_FOUND", message: "User account not found" } };
  }

  return { user };
};

const isWorkerRequest = (req) => {
  const configuredKey = String(env.WORKER_API_KEY || "").trim();
  if (!configuredKey) {
    return false;
  }

  const supplied = String(req.headers["x-worker-key"] || "").trim();
  return supplied.length > 0 && supplied === configuredKey;
};

export const authenticateRequest = async (req, res, next) => {
  try {
    const { user, error } = await loadUserFromRequest(req);
    if (error) {
      return sendAuthError(res, error.statusCode, error.code, error.message);
    }

    req.authUser = user;
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireApprovedUser = (req, res, next) => {
  if (!req.authUser) {
    return sendAuthError(res, 401, "AUTH_REQUIRED", "Authentication required");
  }

  if (req.authUser.approvalStatus !== "approved") {
    return sendAuthError(res, 403, "APPROVAL_REQUIRED", "Waiting for admin approval");
  }

  return next();
};

export const requireRoles = (...roles) => (req, res, next) => {
  if (!req.authUser) {
    return sendAuthError(res, 401, "AUTH_REQUIRED", "Authentication required");
  }

  if (roles.length > 0 && !roles.includes(req.authUser.role)) {
    return sendAuthError(res, 403, "FORBIDDEN", "Insufficient permissions for this action");
  }

  return next();
};

export const authenticateWorkerOrRoles = (...roles) => async (req, res, next) => {
  try {
    if (isWorkerRequest(req)) {
      req.authClient = { type: "worker" };
      return next();
    }

    const { user, error } = await loadUserFromRequest(req);
    if (error) {
      return sendAuthError(res, error.statusCode, error.code, error.message);
    }

    if (user.approvalStatus !== "approved") {
      return sendAuthError(res, 403, "APPROVAL_REQUIRED", "Waiting for admin approval");
    }

    if (roles.length > 0 && !roles.includes(user.role)) {
      return sendAuthError(res, 403, "FORBIDDEN", "Insufficient permissions for this action");
    }

    req.authUser = user;
    return next();
  } catch (error) {
    return next(error);
  }
};
