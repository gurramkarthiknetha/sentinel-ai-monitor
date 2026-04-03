import User from "../models/User.js";
import { RESPONDER_TYPE_SET, normalizeResponderType } from "../constants/auth.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { INCIDENT_SOCKET_ROLES, roleRoom, responderTypeRoom } from "./socketRooms.js";

const resolveSocketToken = (socket) => {
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  const authorizationHeader = socket.handshake?.headers?.authorization;
  if (typeof authorizationHeader !== "string") {
    return "";
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return "";
  }

  return token.trim();
};

export const initSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = resolveSocketToken(socket);
      if (!token) {
        return next(new Error("Authentication required"));
      }

      let payload;
      try {
        payload = verifyAccessToken(token);
      } catch {
        return next(new Error("Invalid or expired token"));
      }

      const userId = payload?.sub;
      if (!userId) {
        return next(new Error("Invalid token payload"));
      }

      const user = await User.findById(userId).select("_id role approvalStatus responderType");
      if (!user) {
        return next(new Error("User account not found"));
      }

      if (user.approvalStatus !== "approved") {
        return next(new Error("Waiting for admin approval"));
      }

      if (!INCIDENT_SOCKET_ROLES.has(user.role)) {
        return next(new Error("Insufficient socket permissions"));
      }

      const normalizedResponderType = normalizeResponderType(user.responderType);
      if (user.role === "responder" && !RESPONDER_TYPE_SET.has(normalizedResponderType)) {
        return next(new Error("Responder profile is incomplete"));
      }

      socket.data.authUser = {
        id: String(user._id),
        role: user.role,
        responderType: user.role === "responder" ? normalizedResponderType : undefined,
      };

      return next();
    } catch {
      return next(new Error("Socket authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    const authUser = socket.data.authUser;
    if (authUser?.role) {
      socket.join(roleRoom(authUser.role));
    }

    if (authUser?.role === "responder" && authUser.responderType) {
      socket.join(responderTypeRoom(authUser.responderType));
    }

    socket.on("camera:subscribe", (cameraId) => {
      if (cameraId) {
        socket.join(`camera:${cameraId}`);
      }
    });

    socket.on("disconnect", () => {
      console.log("Disconnected:", socket.id);
    });
  });
};
