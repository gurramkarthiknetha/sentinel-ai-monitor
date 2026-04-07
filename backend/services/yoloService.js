import { env } from "../config/env.js";

const DEFAULT_TIMEOUT_MS = 15000;

const CLASS_NAME_TO_ID = new Map([
  ["fire", 80],
  ["flame", 80],
  ["smoke", 81],
  ["crowd", 82],
  ["people", 82],
  ["stampede", 82],
  ["medical emergency", 83],
  ["person", 0],
  ["bicycle", 1],
  ["car", 2],
  ["motorbike", 3],
  ["motorcycle", 3],
  ["bus", 5],
  ["truck", 7],
  ["baseball bat", 34],
  ["knife", 43],
  ["scissors", 76],
]);

const asHttpError = (message, statusCode = 502) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parseFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeConfidence = (value) => {
  const parsed = parseFiniteNumber(value);
  if (parsed === null) {
    return null;
  }

  if (parsed >= 0 && parsed <= 1) {
    return parsed;
  }

  if (parsed > 1 && parsed <= 100) {
    return parsed / 100;
  }

  return null;
};

const normalizeClassId = (value, fallbackLabel) => {
  if (typeof fallbackLabel === "string" && fallbackLabel.trim()) {
    const normalized = fallbackLabel.trim().toLowerCase().replace(/[_-]+/g, " ");
    const mapped = CLASS_NAME_TO_ID.get(normalized);
    if (typeof mapped === "number") {
      return mapped;
    }
  }

  const parsed = parseFiniteNumber(value);

  if (parsed !== null && Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  return null;
};

const toXywh = (x1, y1, x2, y2) => {
  const width = x2 - x1;
  const height = y2 - y1;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return [x1, y1, width, height];
};

const normalizeBBox = (bbox, formatHint = "xywh") => {
  if (Array.isArray(bbox) && bbox.length === 4) {
    const parsed = bbox.map(parseFiniteNumber);
    if (parsed.every((value) => value !== null)) {
      const normalizedFormat = String(formatHint || "xywh").trim().toLowerCase();
      if (normalizedFormat === "xyxy") {
        return toXywh(parsed[0], parsed[1], parsed[2], parsed[3]);
      }

      if (parsed[2] <= 0 || parsed[3] <= 0) {
        return null;
      }

      return parsed;
    }
  }

  if (!bbox || typeof bbox !== "object") {
    return null;
  }

  if ("x1" in bbox && "y1" in bbox && "x2" in bbox && "y2" in bbox) {
    const x1 = parseFiniteNumber(bbox.x1);
    const y1 = parseFiniteNumber(bbox.y1);
    const x2 = parseFiniteNumber(bbox.x2);
    const y2 = parseFiniteNumber(bbox.y2);

    if ([x1, y1, x2, y2].every((value) => value !== null)) {
      return toXywh(x1, y1, x2, y2);
    }
  }

  if ("x" in bbox && "y" in bbox && "w" in bbox && "h" in bbox) {
    const x = parseFiniteNumber(bbox.x);
    const y = parseFiniteNumber(bbox.y);
    const w = parseFiniteNumber(bbox.w);
    const h = parseFiniteNumber(bbox.h);

    if ([x, y, w, h].every((value) => value !== null) && w > 0 && h > 0) {
      return [x, y, w, h];
    }
  }

  if ("x1" in bbox && "y1" in bbox && "width" in bbox && "height" in bbox) {
    const x = parseFiniteNumber(bbox.x1);
    const y = parseFiniteNumber(bbox.y1);
    const w = parseFiniteNumber(bbox.width);
    const h = parseFiniteNumber(bbox.height);

    if ([x, y, w, h].every((value) => value !== null) && w > 0 && h > 0) {
      return [x, y, w, h];
    }
  }

  return null;
};

const normalizeDetection = (input) => {
  if (!input || typeof input !== "object") {
    return null;
  }

  const classLabel =
    typeof input.class === "string"
      ? input.class
      : typeof input.class_name === "string"
        ? input.class_name
        : "";

  const classId = normalizeClassId(input.class_id ?? input.classId ?? input.class, classLabel);
  const confidence = normalizeConfidence(input.confidence ?? input.score ?? input.probability);
  const bbox = normalizeBBox(input.bbox ?? input.box ?? input.xywh ?? input.xyxy, input.bboxFormat ?? input.bbox_format ?? (input.xyxy ? "xyxy" : "xywh"));

  if (classId === null || confidence === null || bbox === null) {
    return null;
  }

  return {
    class: classId,
    confidence,
    bbox,
  };
};

const normalizeDetections = (detections) => {
  if (!Array.isArray(detections)) {
    return [];
  }

  const normalized = [];

  for (const item of detections) {
    const detection = normalizeDetection(item);
    if (detection) {
      normalized.push(detection);
    }
  }

  return normalized;
};

const buildBaseUrl = () => {
  const configuredValue = String(env.PYTHONMODEL || "").trim();
  if (!configuredValue) {
    throw asHttpError("PYTHONMODEL is not configured on backend", 500);
  }

  const valueWithProtocol = /^https?:\/\//i.test(configuredValue)
    ? configuredValue
    : `http://${configuredValue}`;

  let parsed;
  try {
    parsed = new URL(valueWithProtocol);
  } catch {
    throw asHttpError("PYTHONMODEL must be a valid URL", 500);
  }

  if (parsed.hostname === "0.0.0.0" || parsed.hostname === "::") {
    parsed.hostname = "127.0.0.1";
  }

  return parsed.toString().replace(/\/$/, "");
};

const fetchWithJson = async (path, options = {}) => {
  const baseUrl = buildBaseUrl();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && typeof payload.error === "string"
          ? payload.error
          : payload && typeof payload === "object" && typeof payload.detail === "string"
            ? payload.detail
            : `YOLO service request failed with status ${response.status}`;

      throw asHttpError(message, response.status);
    }

    return {
      baseUrl,
      payload,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw asHttpError("YOLO service request timed out", 504);
    }

    if (error?.statusCode) {
      throw error;
    }

    throw asHttpError(`Unable to reach YOLO service: ${error.message}`, 502);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const getYOLOHealth = async () => {
  const { baseUrl, payload } = await fetchWithJson("/health", {
    method: "GET",
  });

  return {
    baseUrl,
    health: payload,
  };
};

export const analyzeFrameBuffer = async ({
  cameraId,
  imageBuffer,
  fileName = "frame.jpg",
  mimeType = "image/jpeg",
}) => {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw asHttpError("Image buffer is required for YOLO analysis", 400);
  }

  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: mimeType });

  formData.append("file", blob, fileName);
  formData.append("camera_id", String(cameraId || "system_camera"));

  const { payload } = await fetchWithJson("/api/ml/analyze/enhanced", {
    method: "POST",
    body: formData,
  });

  if (!payload || payload.success !== true) {
    const message =
      payload && typeof payload === "object" && typeof payload.error === "string"
        ? payload.error
        : "YOLO analysis failed";
    throw asHttpError(message, 502);
  }

  const rawDetections = Array.isArray(payload.detections) ? payload.detections : [];

  return {
    timestamp:
      typeof payload.timestamp === "string" && payload.timestamp.trim()
        ? payload.timestamp
        : new Date().toISOString(),
    detections: normalizeDetections(rawDetections),
    rawDetections,
    summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
    analysis: payload.analysis && typeof payload.analysis === "object" ? payload.analysis : {},
    fireDetection:
      payload.fire_detection && typeof payload.fire_detection === "object"
        ? payload.fire_detection
        : {},
    scores: payload.scores && typeof payload.scores === "object" ? payload.scores : {},
  };
};
