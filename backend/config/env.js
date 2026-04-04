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

const parseNumberWithDefault = (value, key, defaultValue, minValue = 0) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    throw new Error(`Environment variable ${key} must be a number >= ${minValue}.`);
  }

  return parsed;
};

const parseIntWithDefault = (value, key, defaultValue, minValue = 0) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    throw new Error(`Environment variable ${key} must be an integer >= ${minValue}.`);
  }

  return parsed;
};

const parseBooleanWithDefault = (value, defaultValue) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Expected boolean-like value but received: ${value}`);
};

const parseOrigins = (value) =>
  value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const parseCsvValues = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return [];
  }

  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseIntListWithDefault = (value, defaultValue = []) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }

  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry) && entry >= 0);
};

const PORT = parsePositiveInt(process.env.PORT, "PORT");
const API_PREFIX = process.env.API_PREFIX;

const defaultApiBaseUrl = `http://127.0.0.1:${PORT}${API_PREFIX}`;
const adminEmailsRaw =
  process.env.ADMINS !== undefined ? process.env.ADMINS : process.env.ADMIN_BOOTSTRAP_EMAILS;
const defaultWorkerApiKey =
  String(process.env.NODE_ENV || "development").trim().toLowerCase() === "production"
    ? ""
    : "sentinel-local-worker-key";

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT,
  MONGO_URI: process.env.MONGO_URI,
  API_PREFIX,
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

  GOOGLE_CLIENT_ID: String(process.env.GOOGLE_CLIENT_ID || "").trim(),
  GOOGLE_CLIENT_SECRET: String(process.env.GOOGLE_CLIENT_SECRET || "").trim(),
  JWT_SECRET: String(process.env.JWT_SECRET || "").trim(),
  JWT_EXPIRES_IN: String(process.env.JWT_EXPIRES_IN || "7d").trim(),
  ADMIN_EMAILS: parseCsvValues(adminEmailsRaw).map((email) => email.toLowerCase()),
  // Legacy alias kept for backwards compatibility with older config references.
  ADMIN_BOOTSTRAP_EMAILS: parseCsvValues(adminEmailsRaw).map((email) => email.toLowerCase()),
  WORKER_API_KEY: String(process.env.WORKER_API_KEY || defaultWorkerApiKey).trim(),
  PYTHONMODEL: String(process.env.PYTHONMODEL || "").trim(),

  RTDETR_WORKER_ENABLED: parseBooleanWithDefault(process.env.RTDETR_WORKER_ENABLED, true),
  RTDETR_AUTO_START_ON_BOOT: parseBooleanWithDefault(process.env.RTDETR_AUTO_START_ON_BOOT, true),
  RTDETR_PYTHON_EXECUTABLE: String(process.env.RTDETR_PYTHON_EXECUTABLE || "").trim(),
  RTDETR_WORKER_SCRIPT: String(process.env.RTDETR_WORKER_SCRIPT || "").trim(),
  RTDETR_MODEL_PATH: String(process.env.RTDETR_MODEL_PATH || "./rtdetr-l.pt").trim(),
  RTDETR_API_BASE_URL: String(process.env.RTDETR_API_BASE_URL || defaultApiBaseUrl).trim(),
  RTDETR_DEVICE: String(process.env.RTDETR_DEVICE || "auto").trim(),
  RTDETR_INPUT_SIZE: parseIntWithDefault(process.env.RTDETR_INPUT_SIZE, "RTDETR_INPUT_SIZE", 960, 64),
  RTDETR_SCORE_THRESHOLD: parseNumberWithDefault(
    process.env.RTDETR_SCORE_THRESHOLD,
    "RTDETR_SCORE_THRESHOLD",
    0.25,
    0,
  ),
  RTDETR_IOU_THRESHOLD: parseNumberWithDefault(
    process.env.RTDETR_IOU_THRESHOLD,
    "RTDETR_IOU_THRESHOLD",
    0.7,
    0,
  ),
  RTDETR_PERSON_CLASS_ID: parseIntWithDefault(
    process.env.RTDETR_PERSON_CLASS_ID,
    "RTDETR_PERSON_CLASS_ID",
    0,
    0,
  ),
  RTDETR_ALL_CLASSES: parseBooleanWithDefault(process.env.RTDETR_ALL_CLASSES, true),
  RTDETR_MAX_DETECTIONS: parseIntWithDefault(
    process.env.RTDETR_MAX_DETECTIONS,
    "RTDETR_MAX_DETECTIONS",
    300,
    1,
  ),
  RTDETR_MIN_BOX_AREA_RATIO: parseNumberWithDefault(
    process.env.RTDETR_MIN_BOX_AREA_RATIO,
    "RTDETR_MIN_BOX_AREA_RATIO",
    0.0005,
    0,
  ),
  RTDETR_MAX_BOX_AREA_RATIO: parseNumberWithDefault(
    process.env.RTDETR_MAX_BOX_AREA_RATIO,
    "RTDETR_MAX_BOX_AREA_RATIO",
    0.9,
    0,
  ),
  RTDETR_EXCLUDE_CLASS_IDS: parseIntListWithDefault(process.env.RTDETR_EXCLUDE_CLASS_IDS, []),
  RTDETR_FRAME_SKIP: parseIntWithDefault(process.env.RTDETR_FRAME_SKIP, "RTDETR_FRAME_SKIP", 1, 0),
  RTDETR_STATUS_HEARTBEAT_SECONDS: parseNumberWithDefault(
    process.env.RTDETR_STATUS_HEARTBEAT_SECONDS,
    "RTDETR_STATUS_HEARTBEAT_SECONDS",
    8,
    0.1,
  ),
  RTDETR_BACKEND_TIMEOUT_SECONDS: parseNumberWithDefault(
    process.env.RTDETR_BACKEND_TIMEOUT_SECONDS,
    "RTDETR_BACKEND_TIMEOUT_SECONDS",
    2.5,
    0.1,
  ),
  RTDETR_RECONNECT_DELAY_SECONDS: parseNumberWithDefault(
    process.env.RTDETR_RECONNECT_DELAY_SECONDS,
    "RTDETR_RECONNECT_DELAY_SECONDS",
    2,
    0,
  ),
  RTDETR_LOG_EVERY_FRAMES: parseIntWithDefault(
    process.env.RTDETR_LOG_EVERY_FRAMES,
    "RTDETR_LOG_EVERY_FRAMES",
    30,
    1,
  ),
  RTDETR_SYNC_INTERVAL_SECONDS: parseIntWithDefault(
    process.env.RTDETR_SYNC_INTERVAL_SECONDS,
    "RTDETR_SYNC_INTERVAL_SECONDS",
    20,
    1,
  ),
  RTDETR_RESTART_DELAY_MS: parseIntWithDefault(
    process.env.RTDETR_RESTART_DELAY_MS,
    "RTDETR_RESTART_DELAY_MS",
    3000,
    0,
  ),
  RTDETR_SHUTDOWN_GRACE_MS: parseIntWithDefault(
    process.env.RTDETR_SHUTDOWN_GRACE_MS,
    "RTDETR_SHUTDOWN_GRACE_MS",
    5000,
    250,
  ),
  RTDETR_HALF: parseBooleanWithDefault(process.env.RTDETR_HALF, false),
  RTDETR_SHOW_PREVIEW: parseBooleanWithDefault(process.env.RTDETR_SHOW_PREVIEW, false),
  RTDETR_SEND_EMPTY: parseBooleanWithDefault(process.env.RTDETR_SEND_EMPTY, false),
  RTDETR_DEBUG_LOG_PAYLOAD: parseBooleanWithDefault(process.env.RTDETR_DEBUG_LOG_PAYLOAD, false),
};