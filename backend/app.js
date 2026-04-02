import cors from "cors";
import express from "express";
import morgan from "morgan";
import cameraRoutes from "./routes/cameraRoutes.js";
import detectionRoutes from "./routes/detectionRoutes.js";
import incidentRoutes from "./routes/incidentRoutes.js";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";

const resolveCorsOrigin = (origins) => {
  if (origins.includes("*")) {
    return "*";
  }

  return origins;
};

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");

  app.use(
    cors({
      origin: resolveCorsOrigin(env.SOCKET_CORS_ORIGINS),
    }),
  );

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  app.use(`${env.API_PREFIX}/cameras`, cameraRoutes);
  app.use(`${env.API_PREFIX}/detections`, detectionRoutes);
  app.use(`${env.API_PREFIX}/incidents`, incidentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
