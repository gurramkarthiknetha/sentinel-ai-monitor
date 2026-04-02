import User from "../models/User.js";
import { verifyAccessToken } from "../utils/jwt.js";

const MONITORING_SOCKET_ROLES = new Set(["admin", "operator"]);

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

      const user = await User.findById(userId).select("_id role approvalStatus");
      if (!user) {
        return next(new Error("User account not found"));
      }

      if (user.approvalStatus !== "approved") {
        return next(new Error("Waiting for admin approval"));
      }

      if (!MONITORING_SOCKET_ROLES.has(user.role)) {
        return next(new Error("Insufficient socket permissions"));
      }

      socket.data.authUser = {
        id: String(user._id),
        role: user.role,
      };

      return next();
    } catch {
      return next(new Error("Socket authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

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
