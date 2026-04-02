import http from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";
import { startCameraStatusMonitor } from "./services/cameraStatusMonitor.js";
import {
  initializeRTDETRWorkerManager,
  shutdownRTDETRWorkerManager,
} from "./services/rtdetrWorkerManager.js";
import { initSocket } from "./sockets/socketHandler.js";

const resolveCorsOrigin = (origins) => {
  if (origins.includes("*")) {
    return "*";
  }

  return origins;
};

const bootstrap = async () => {
  await connectDB(env.MONGO_URI);

  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: resolveCorsOrigin(env.SOCKET_CORS_ORIGINS),
    },
  });

  app.set("io", io);

  initSocket(io);
  await initializeRTDETRWorkerManager();

  const stopStatusMonitor = startCameraStatusMonitor({
    io,
    offlineTimeoutSeconds: env.CAMERA_OFFLINE_TIMEOUT_SECONDS,
    checkIntervalSeconds: env.CAMERA_OFFLINE_CHECK_INTERVAL_SECONDS,
  });

  server.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);

    stopStatusMonitor();
    await shutdownRTDETRWorkerManager();

    server.close(async () => {
      await mongoose.connection.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

bootstrap().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});
