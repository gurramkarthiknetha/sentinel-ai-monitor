import Camera from "../models/Camera.js";
import Detection from "../models/Detection.js";
import { createOrRefreshFireIncidentFromDetection } from "../services/fireEscalationService.js";
import { analyzeFrameBuffer } from "../services/yoloService.js";
import { emitToMonitoringRoles } from "../sockets/socketRooms.js";
import { isValidObjectId, normalizeDetectionArray } from "../utils/validators.js";

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\r\n]+)$/;
const PERSON_CLASS_ID = 0;
const FIRE_CLASS_ID = 80;
const SMOKE_CLASS_ID = 81;
const STAMPEDE_CLASS_ID = 82;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const parseStampedeConfidence = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(0.99, Math.max(0.5, parsed));
};

const parseThreshold = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, parsed));
};

const STAMPEDE_MIN_PEOPLE = parsePositiveInt(process.env.STAMPEDE_MIN_PEOPLE, 9);
const STAMPEDE_ALERT_CONFIDENCE = parseStampedeConfidence(
  process.env.STAMPEDE_ALERT_CONFIDENCE,
  0.9,
);
const FIRE_ALERT_CONFIDENCE = parseThreshold(process.env.YOLO_FIRE_ALERT_THRESHOLD, 0.9);
const SMOKE_ALERT_CONFIDENCE = parseThreshold(process.env.YOLO_SMOKE_ALERT_THRESHOLD, 0.5);

const filterHazardDetectionsForDisplay = (detections, hazardFlags = {}) => {
  if (!Array.isArray(detections) || detections.length === 0) {
    return [];
  }

  const fireDetectedFromSummary =
    typeof hazardFlags.fireDetected === "boolean" ? hazardFlags.fireDetected : null;
  const smokeDetectedFromSummary =
    typeof hazardFlags.smokeDetected === "boolean" ? hazardFlags.smokeDetected : null;

  const fireAlertTriggered =
    fireDetectedFromSummary ??
    detections.some(
      (item) =>
        Number(item?.class) === FIRE_CLASS_ID &&
        Number.isFinite(item?.confidence) &&
        item.confidence >= FIRE_ALERT_CONFIDENCE,
    );
  const smokeAlertTriggered =
    smokeDetectedFromSummary ??
    detections.some(
      (item) =>
        Number(item?.class) === SMOKE_CLASS_ID &&
        Number.isFinite(item?.confidence) &&
        item.confidence >= SMOKE_ALERT_CONFIDENCE,
    );

  return detections.filter((item) => {
    const classId = Number(item?.class);

    if (classId === FIRE_CLASS_ID) {
      return (
        fireAlertTriggered &&
        Number.isFinite(item?.confidence) &&
        item.confidence >= FIRE_ALERT_CONFIDENCE
      );
    }

    if (classId === SMOKE_CLASS_ID) {
      return (
        smokeAlertTriggered &&
        Number.isFinite(item?.confidence) &&
        item.confidence >= SMOKE_ALERT_CONFIDENCE
      );
    }

    return true;
  });
};

const appendStampedeDetectionIfNeeded = (detections) => {
  if (!Array.isArray(detections) || detections.length === 0) {
    return detections;
  }

  const hasConfirmedStampede = detections.some(
    (item) =>
      Number(item?.class) === STAMPEDE_CLASS_ID &&
      Number.isFinite(item?.confidence) &&
      item.confidence >= STAMPEDE_ALERT_CONFIDENCE,
  );
  if (hasConfirmedStampede) {
    return detections;
  }

  const personDetections = detections.filter((item) => Number(item?.class) === PERSON_CLASS_ID);
  if (personDetections.length < STAMPEDE_MIN_PEOPLE) {
    return detections;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const detection of personDetections) {
    const [x, y, w, h] = Array.isArray(detection.bbox) ? detection.bbox : [];
    if (![x, y, w, h].every((value) => Number.isFinite(value)) || w <= 0 || h <= 0) {
      continue;
    }

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    return detections;
  }

  const syntheticStampede = {
    class: STAMPEDE_CLASS_ID,
    confidence: STAMPEDE_ALERT_CONFIDENCE,
    bbox: [minX, minY, maxX - minX, maxY - minY],
  };

  return [...detections, syntheticStampede];
};

const parseBase64Frame = (input, mimeTypeHint) => {
  const rawInput = typeof input === "string" ? input.trim() : "";
  if (!rawInput) {
    return null;
  }

  let mimeType =
    typeof mimeTypeHint === "string" && mimeTypeHint.trim() ? mimeTypeHint.trim() : "image/jpeg";
  let base64Payload = rawInput;

  const dataUrlMatch = rawInput.match(DATA_URL_PATTERN);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1] || mimeType;
    base64Payload = dataUrlMatch[2] || "";
  }

  const sanitizedBase64 = base64Payload.replace(/\s+/g, "");
  if (!sanitizedBase64 || !/^[a-zA-Z0-9+/=]+$/.test(sanitizedBase64)) {
    return null;
  }

  const buffer = Buffer.from(sanitizedBase64, "base64");
  if (buffer.length === 0) {
    return null;
  }

  return {
    buffer,
    mimeType,
  };
};

const parseConfidenceValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
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

const extractFireConfidence = (yoloResult) => {
  const fromFireSummary = parseConfidenceValue(yoloResult?.fireDetection?.max_fire_confidence);
  if (fromFireSummary !== null) {
    return fromFireSummary;
  }

  const fireDetected = Boolean(yoloResult?.fireDetection?.fire_detected);
  if (!fireDetected) {
    return null;
  }

  const fromScores = parseConfidenceValue(yoloResult?.scores?.fire);
  if (fromScores !== null) {
    return fromScores;
  }

  return null;
};

const extractSnapshotBase64 = (rawInput) => {
  const raw = typeof rawInput === "string" ? rawInput.trim() : "";
  if (!raw) {
    return undefined;
  }

  const dataUrlMatch = raw.match(DATA_URL_PATTERN);
  const payload = dataUrlMatch ? dataUrlMatch[2] || "" : raw;
  const sanitized = payload.replace(/\s+/g, "");

  if (!sanitized || !/^[a-zA-Z0-9+/=]+$/.test(sanitized)) {
    return undefined;
  }

  // Keep snapshots bounded so incident records stay lightweight.
  if (sanitized.length > 2_000_000) {
    return undefined;
  }

  return sanitized;
};

const persistAndBroadcastDetection = async ({
  req,
  camera,
  detections,
  timestamp,
  hazardFlags,
}) => {
  const normalizedCameraId = camera._id.toString();
  const displayDetections = filterHazardDetectionsForDisplay(detections, hazardFlags);
  const detectionsWithStampede = appendStampedeDetectionIfNeeded(displayDetections);

  const detectionPayload = {
    cameraId: normalizedCameraId,
    detections: detectionsWithStampede,
  };

  const parsedTimestamp = timestamp ? new Date(timestamp) : null;
  if (parsedTimestamp && Number.isFinite(parsedTimestamp.getTime())) {
    detectionPayload.timestamp = parsedTimestamp;
  }

  const newDetection = await Detection.create(detectionPayload);

  camera.status = "ONLINE";
  camera.lastActive = new Date();
  await camera.save();

  const io = req.app.get("io");

  emitToMonitoringRoles(io, "detection:update", {
    cameraId: normalizedCameraId,
    detections: detectionsWithStampede,
    timestamp: newDetection.timestamp,
  });

  emitToMonitoringRoles(io, "camera:status", {
    cameraId: normalizedCameraId,
    status: camera.status,
    lastActive: camera.lastActive,
    timestamp: new Date().toISOString(),
  });

  return newDetection;
};

export const createDetection = async (req, res, next) => {
  try {
    const { cameraId, detections } = req.body;

    if (process.env.DEBUG_DETECTIONS === "true") {
      const rawCount = Array.isArray(detections) ? detections.length : 0;
      console.log(`[detection:create] cameraId=${cameraId} rawDetections=${rawCount}`);
    }

    if (!isValidObjectId(cameraId)) {
      return res.status(400).json({ message: "Invalid cameraId" });
    }

    const sanitizedDetections = normalizeDetectionArray(detections);

    if (!sanitizedDetections) {
      return res.status(400).json({
        message:
          "Invalid detections payload. Supported fields: class|classId|class_id|label|className|class_name, confidence|score|probability, bbox|box|xywh|xyxy (use bboxFormat=xyxy for bbox arrays).",
      });
    }

    if (process.env.DEBUG_DETECTIONS === "true") {
      console.log(
        `[detection:create] cameraId=${cameraId} acceptedDetections=${sanitizedDetections.length}`,
      );
    }

    const camera = await Camera.findById(cameraId);
    if (!camera) {
      return res.status(404).json({ message: "Camera not found" });
    }

    const newDetection = await persistAndBroadcastDetection({
      req,
      camera,
      detections: sanitizedDetections,
    });

    return res.status(201).json({ success: true, data: newDetection });
  } catch (error) {
    return next(error);
  }
};

export const analyzeDetectionFrame = async (req, res, next) => {
  try {
    const { cameraId, imageBase64, frameBase64, fileName, mimeType } = req.body || {};

    if (!isValidObjectId(cameraId)) {
      return res.status(400).json({ message: "Invalid cameraId" });
    }

    const camera = await Camera.findById(cameraId);
    if (!camera) {
      return res.status(404).json({ message: "Camera not found" });
    }

    const parsedFrame =
      parseBase64Frame(imageBase64, mimeType) || parseBase64Frame(frameBase64, mimeType);

    if (!parsedFrame) {
      return res.status(400).json({
        message:
          "Missing valid image payload. Provide imageBase64 (or frameBase64) as raw base64 or data URL.",
      });
    }

    const yoloResult = await analyzeFrameBuffer({
      cameraId: camera._id.toString(),
      imageBuffer: parsedFrame.buffer,
      fileName:
        typeof fileName === "string" && fileName.trim() ? fileName.trim() : "frame.jpg",
      mimeType: parsedFrame.mimeType,
    });

    const newDetection = await persistAndBroadcastDetection({
      req,
      camera,
      detections: yoloResult.detections,
      timestamp: yoloResult.timestamp,
      hazardFlags: {
        fireDetected:
          typeof yoloResult?.fireDetection?.fire_detected === "boolean"
            ? yoloResult.fireDetection.fire_detected
            : undefined,
        smokeDetected:
          typeof yoloResult?.fireDetection?.smoke_detected === "boolean"
            ? yoloResult.fireDetection.smoke_detected
            : undefined,
      },
    });

    const io = req.app.get("io");
    const fireConfidence = extractFireConfidence(yoloResult);
    const snapshotBase64 = extractSnapshotBase64(imageBase64 || frameBase64);
    let fireIncident = null;

    if (fireConfidence !== null) {
      try {
        const predictionDetails = `AI fire confidence ${Math.round(fireConfidence * 100)}% from ${
          camera.name || "camera"
        }`;

        const fireWorkflowResult = await createOrRefreshFireIncidentFromDetection({
          io,
          camera,
          confidence: fireConfidence,
          snapshotBase64,
          predictionDetails,
        });

        if (fireWorkflowResult?.incident) {
          fireIncident = {
            id: fireWorkflowResult.incident.id,
            status: fireWorkflowResult.incident.status,
            confidence: fireWorkflowResult.incident.confidence,
            confirmationDeadline: fireWorkflowResult.incident.confirmationDeadline,
            escalatedAt: fireWorkflowResult.incident.escalatedAt,
            created: Boolean(fireWorkflowResult.created),
          };
        }
      } catch (workflowError) {
        console.error("[fire-workflow] Unable to process fire escalation workflow:", workflowError);
      }
    }

    return res.status(201).json({
      success: true,
      data: newDetection,
      ml: {
        summary: yoloResult.summary,
        analysis: yoloResult.analysis,
        fireDetection: yoloResult.fireDetection,
        fireIncident,
        scores: yoloResult.scores,
        rawDetections: yoloResult.rawDetections,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getDetectionsByCamera = async (req, res, next) => {
  try {
    const { cameraId } = req.params;
    const limit = Number.parseInt(req.query.limit, 10) || 25;

    if (!isValidObjectId(cameraId)) {
      return res.status(400).json({ message: "Invalid cameraId" });
    }

    const detections = await Detection.find({ cameraId })
      .sort({ timestamp: -1 })
      .limit(Math.min(limit, 200));

    return res.json({ success: true, data: detections });
  } catch (error) {
    return next(error);
  }
};
