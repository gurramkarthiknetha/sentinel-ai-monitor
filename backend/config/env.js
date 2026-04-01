import dotenv from "dotenv";

dotenv.config();

const requiredVars = [
  "PORT",
  "MONGO_URI",
  "SOCKET_CORS_ORIGIN",
  "API_PREFIX",
  "CAMERA_OFFLINE_TIMEOUT_SECONDS",
  "CAMERA_OFFLINE_CHECK_INTERVAL_SECONDS",
  "JSON_BODY_LIMIT",
];

for (const key of requiredVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const parsePositiveInt = (value, key) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer.`);
  }
  return parsed;
};

const parseOrigins = (value) =>
  value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parsePositiveInt(process.env.PORT, "PORT"),
  MONGO_URI: process.env.MONGO_URI,
  API_PREFIX: process.env.API_PREFIX,
  SOCKET_CORS_ORIGINS: parseOrigins(process.env.SOCKET_CORS_ORIGIN),
  CAMERA_OFFLINE_TIMEOUT_SECONDS: parsePositiveInt(
    process.env.CAMERA_OFFLINE_TIMEOUT_SECONDS,
    "CAMERA_OFFLINE_TIMEOUT_SECONDS",
  ),
  CAMERA_OFFLINE_CHECK_INTERVAL_SECONDS: parsePositiveInt(
    process.env.CAMERA_OFFLINE_CHECK_INTERVAL_SECONDS,
    "CAMERA_OFFLINE_CHECK_INTERVAL_SECONDS",
  ),
  JSON_BODY_LIMIT: process.env.JSON_BODY_LIMIT,
};
