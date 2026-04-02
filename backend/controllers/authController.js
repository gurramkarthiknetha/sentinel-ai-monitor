import { OAuth2Client } from "google-auth-library";
import { isValidObjectId } from "mongoose";
import { env } from "../config/env.js";
import User from "../models/User.js";
import {
  APPROVAL_STATUS_SET,
  RESPONDER_TYPE_SET,
  USER_ROLE_SET,
  normalizeApprovalStatus,
  normalizeResponderType,
  normalizeRole,
} from "../constants/auth.js";
import { signAccessToken } from "../utils/jwt.js";

let googleClient = null;

const toPublicUser = (user) => ({
  id: String(user._id),
  googleId: user.googleId,
  email: user.email,
  name: user.name,
  avatar: user.avatar,
  role: user.role,
  responderType: user.responderType || null,
  approvalStatus: user.approvalStatus,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const hasGoogleClientId = () => Boolean(String(env.GOOGLE_CLIENT_ID || "").trim());

const hasJwtSigningConfig = () => Boolean(String(env.JWT_SECRET || "").trim());

const getJwtConfigErrorResponse = () => ({
  success: false,
  code: "AUTH_CONFIG_MISSING",
  message: "JWT auth is not configured on server (missing JWT_SECRET)",
});

export const getGoogleAuthConfig = (_req, res) => {
  if (!String(env.GOOGLE_CLIENT_ID || "").trim()) {
    return res.status(500).json({
      success: false,
      message: "Google OAuth client id is not configured",
    });
  }

  return res.json({
    success: true,
    data: {
      clientId: env.GOOGLE_CLIENT_ID,
    },
  });
};

const getGoogleClient = () => {
  if (!hasGoogleClientId()) {
    return null;
  }

  if (!googleClient) {
    const clientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim() || undefined;
    googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID, clientSecret);
  }

  return googleClient;
};

const resolveGoogleProfile = async (credential) => {
  const client = getGoogleClient();
  if (!client) {
    return {
      error: {
        statusCode: 500,
        code: "AUTH_CONFIG_MISSING",
        message: "Google OAuth is not configured on server (missing GOOGLE_CLIENT_ID)",
      },
    };
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return {
      error: {
        statusCode: 401,
        code: "GOOGLE_TOKEN_INVALID",
        message: "Invalid Google credential",
      },
    };
  }

  if (!payload?.sub || !payload?.email || !payload?.email_verified) {
    return {
      error: {
        statusCode: 401,
        code: "GOOGLE_PROFILE_INVALID",
        message: "Google profile is missing a verified email",
      },
    };
  }

  return {
    profile: {
      googleId: String(payload.sub),
      email: String(payload.email).trim().toLowerCase(),
      name: String(payload.name || payload.email).trim(),
      avatar: String(payload.picture || "").trim() || undefined,
    },
  };
};

const getAuthStatePayload = (authState, extra = {}) => ({
  success: true,
  data: {
    authState,
    ...extra,
  },
});

const updateUserGoogleProfile = async (user, profile) => {
  let changed = false;

  if (!user.googleId) {
    user.googleId = profile.googleId;
    changed = true;
  }

  if (user.googleId !== profile.googleId) {
    return {
      error: {
        statusCode: 409,
        code: "GOOGLE_ACCOUNT_MISMATCH",
        message: "Google account does not match this user",
      },
    };
  }

  if (profile.name && user.name !== profile.name) {
    user.name = profile.name;
    changed = true;
  }

  if (profile.avatar && user.avatar !== profile.avatar) {
    user.avatar = profile.avatar;
    changed = true;
  }

  if (user.email !== profile.email) {
    user.email = profile.email;
    changed = true;
  }

  if (changed) {
    await user.save();
  }

  return { user };
};

const buildApprovedAuthResponse = (user) => {
  const token = signAccessToken(user);

  return getAuthStatePayload("approved", {
    token,
    user: toPublicUser(user),
  });
};

const isBootstrapAdmin = (email) =>
  Array.isArray(env.ADMIN_EMAILS) && env.ADMIN_EMAILS.includes(String(email || "").toLowerCase());

const validateRoleAndResponderType = (roleInput, responderTypeInput) => {
  const normalizedRole = normalizeRole(roleInput);
  const normalizedResponderType = normalizeResponderType(responderTypeInput);

  if (!normalizedRole) {
    return {
      valid: false,
      code: "ONBOARDING_REQUIRED",
      message: "Role selection is required",
    };
  }

  if (!USER_ROLE_SET.has(normalizedRole) || normalizedRole === "admin") {
    return {
      valid: false,
      code: "ROLE_INVALID",
      message: "Role must be operator or responder",
    };
  }

  if (normalizedRole === "responder" && !RESPONDER_TYPE_SET.has(normalizedResponderType)) {
    return {
      valid: false,
      code: "RESPONDER_TYPE_REQUIRED",
      message: "Responder type is required",
    };
  }

  return {
    valid: true,
    role: normalizedRole,
    responderType: normalizedRole === "responder" ? normalizedResponderType : undefined,
  };
};

export const googleLogin = async (req, res, next) => {
  try {
    const { credential, role, responderType } = req.body || {};

    if (typeof credential !== "string" || !credential.trim()) {
      return res.status(400).json({
        success: false,
        code: "GOOGLE_CREDENTIAL_REQUIRED",
        message: "Google credential is required",
      });
    }

    const profileResult = await resolveGoogleProfile(credential.trim());
    if (profileResult.error) {
      return res.status(profileResult.error.statusCode).json({
        success: false,
        code: profileResult.error.code,
        message: profileResult.error.message,
      });
    }

    const profile = profileResult.profile;
    const bootstrapAdmin = isBootstrapAdmin(profile.email);

    let user = await User.findOne({ googleId: profile.googleId });
    if (!user) {
      user = await User.findOne({ email: profile.email });
    }

    if (!user) {
      const onboarding = validateRoleAndResponderType(role, responderType);
      if (!onboarding.valid) {
        return res.json(
          getAuthStatePayload("onboarding_required", {
            code: onboarding.code,
            message: onboarding.message,
            profile,
          }),
        );
      }

      const assignedRole = bootstrapAdmin ? "admin" : onboarding.role;
      const assignedResponderType = assignedRole === "responder" ? onboarding.responderType : undefined;
      const approvalStatus = bootstrapAdmin ? "approved" : "pending";

      const createdUser = await User.create({
        googleId: profile.googleId,
        email: profile.email,
        name: profile.name,
        avatar: profile.avatar,
        role: assignedRole,
        responderType: assignedResponderType,
        approvalStatus,
      });

      if (createdUser.approvalStatus === "approved") {
        if (!hasJwtSigningConfig()) {
          return res.status(500).json(getJwtConfigErrorResponse());
        }

        return res.json(buildApprovedAuthResponse(createdUser));
      }

      return res.json(
        getAuthStatePayload("pending_approval", {
          message: "Waiting for admin approval",
          user: toPublicUser(createdUser),
        }),
      );
    }

    const updateResult = await updateUserGoogleProfile(user, profile);
    if (updateResult.error) {
      return res.status(updateResult.error.statusCode).json({
        success: false,
        code: updateResult.error.code,
        message: updateResult.error.message,
      });
    }

    user = updateResult.user;

    if (bootstrapAdmin && (user.role !== "admin" || user.approvalStatus !== "approved")) {
      user.role = "admin";
      user.responderType = undefined;
      user.approvalStatus = "approved";
      await user.save();
    }

    if (user.approvalStatus === "pending") {
      return res.json(
        getAuthStatePayload("pending_approval", {
          message: "Waiting for admin approval",
          user: toPublicUser(user),
        }),
      );
    }

    if (user.approvalStatus === "rejected") {
      return res.json(
        getAuthStatePayload("rejected", {
          message: "Access has been rejected by admin",
          user: toPublicUser(user),
        }),
      );
    }

    if (!hasJwtSigningConfig()) {
      return res.status(500).json(getJwtConfigErrorResponse());
    }

    return res.json(buildApprovedAuthResponse(user));
  } catch (error) {
    return next(error);
  }
};

export const getCurrentUser = async (req, res, next) => {
  try {
    return res.json({ success: true, data: toPublicUser(req.authUser) });
  } catch (error) {
    return next(error);
  }
};

export const getPendingUsers = async (_req, res, next) => {
  try {
    const users = await User.find({ approvalStatus: "pending" }).sort({ createdAt: 1 });
    return res.json({ success: true, data: users.map(toPublicUser) });
  } catch (error) {
    return next(error);
  }
};

export const getUsers = async (req, res, next) => {
  try {
    const status = normalizeApprovalStatus(req.query.status);
    const filter = {};

    if (status && APPROVAL_STATUS_SET.has(status)) {
      filter.approvalStatus = status;
    }

    const users = await User.find(filter).sort({ createdAt: -1 });
    return res.json({ success: true, data: users.map(toPublicUser) });
  } catch (error) {
    return next(error);
  }
};

export const updateUserByAdmin = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const payload = req.body || {};
    const roleInput = payload.role !== undefined ? normalizeRole(payload.role) : undefined;
    const responderTypeInput =
      payload.responderType !== undefined ? normalizeResponderType(payload.responderType) : undefined;
    const approvalStatusInput =
      payload.approvalStatus !== undefined ? normalizeApprovalStatus(payload.approvalStatus) : undefined;

    if (roleInput !== undefined) {
      if (!USER_ROLE_SET.has(roleInput)) {
        return res.status(400).json({ success: false, message: "Invalid role" });
      }
      user.role = roleInput;
    }

    const effectiveRole = roleInput !== undefined ? roleInput : user.role;

    if (effectiveRole === "responder") {
      const effectiveResponderType =
        responderTypeInput !== undefined ? responderTypeInput : normalizeResponderType(user.responderType);

      if (!RESPONDER_TYPE_SET.has(effectiveResponderType)) {
        return res.status(400).json({ success: false, message: "Invalid responderType" });
      }

      user.responderType = effectiveResponderType;
    } else if (responderTypeInput !== undefined) {
      user.responderType = undefined;
    } else if (effectiveRole !== "responder") {
      user.responderType = undefined;
    }

    if (approvalStatusInput !== undefined) {
      if (!APPROVAL_STATUS_SET.has(approvalStatusInput)) {
        return res.status(400).json({ success: false, message: "Invalid approvalStatus" });
      }
      user.approvalStatus = approvalStatusInput;
    }

    await user.save();

    return res.json({ success: true, data: toPublicUser(user) });
  } catch (error) {
    return next(error);
  }
};
