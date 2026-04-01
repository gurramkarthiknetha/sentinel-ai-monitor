import mongoose from "mongoose";

const SUPPORTED_CAMERA_PROTOCOLS = new Set(["rtsp:", "rtsps:", "http:", "https:"]);

export const isValidCameraUrl = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return SUPPORTED_CAMERA_PROTOCOLS.has(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
};

export const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const parseFiniteNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const CLASS_LABEL_TO_ID = new Map([
  ["person", 0],
  ["bicycle", 1],
  ["car", 2],
  ["motorbike", 3],
  ["motorcycle", 3],
  ["bus", 5],
  ["truck", 7],
]);

const normalizeClassId = (value) => {
  const parsed = parseFiniteNumber(value);

  if (parsed !== null) {
    if (!Number.isInteger(parsed) || parsed < 0) {
      return null;
    }

    return parsed;
  }

  if (typeof value === "string" && value.trim()) {
    const normalizedLabel = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
    return CLASS_LABEL_TO_ID.get(normalizedLabel) ?? null;
  }

  return null;
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

const convertXyxyToXywh = (x1, y1, x2, y2) => {
  const width = x2 - x1;
  const height = y2 - y1;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return [x1, y1, width, height];
};

const normalizeBbox = (value, formatHint = "xywh") => {
  const normalizedFormat =
    typeof formatHint === "string" ? formatHint.trim().toLowerCase() : "xywh";

  if (Array.isArray(value) && value.length === 4) {
    const parsed = value.map(parseFiniteNumber);
    if (parsed.every((num) => num !== null)) {
      if (normalizedFormat === "xyxy") {
        return convertXyxyToXywh(parsed[0], parsed[1], parsed[2], parsed[3]);
      }

      return parsed;
    }
  }

  if (typeof value === "object" && value !== null) {
    const xywhKeys = ["x", "y", "w", "h"];
    if (xywhKeys.every((key) => key in value)) {
      const parsed = xywhKeys.map((key) => parseFiniteNumber(value[key]));
      if (parsed.every((num) => num !== null)) {
        return parsed;
      }
    }

    const xyxyKeys = ["x1", "y1", "x2", "y2"];
    if (xyxyKeys.every((key) => key in value)) {
      const [x1, y1, x2, y2] = xyxyKeys.map((key) => parseFiniteNumber(value[key]));
      if ([x1, y1, x2, y2].every((num) => num !== null)) {
        return convertXyxyToXywh(x1, y1, x2, y2);
      }
    }
  }

  return null;
};

export const normalizeDetectionArray = (detections) => {
  if (!Array.isArray(detections) || detections.length === 0) {
    return null;
  }

  const normalized = [];

  for (const item of detections) {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const classId = normalizeClassId(
      item.class ?? item.classId ?? item.class_id ?? item.label ?? item.className ?? item.class_name,
    );
    const confidence = normalizeConfidence(item.confidence ?? item.score ?? item.probability);

    const bbox = (() => {
      const formatFromPayload =
        typeof item.bboxFormat === "string" ? item.bboxFormat : item.bbox_format;

      if (item.bbox !== undefined) {
        return normalizeBbox(item.bbox, formatFromPayload || "xywh");
      }

      if (item.box !== undefined) {
        return normalizeBbox(item.box, formatFromPayload || "xywh");
      }

      if (item.xywh !== undefined) {
        return normalizeBbox(item.xywh, "xywh");
      }

      if (item.xyxy !== undefined) {
        return normalizeBbox(item.xyxy, "xyxy");
      }

      return null;
    })();

    if (classId === null || confidence === null || bbox === null) {
      return null;
    }

    normalized.push({
      class: classId,
      confidence,
      bbox,
    });
  }

  return normalized;
};

export const isValidDetectionArray = (detections) => Boolean(normalizeDetectionArray(detections));
