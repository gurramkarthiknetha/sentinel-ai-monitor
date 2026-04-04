import Camera from "../models/Camera.js";
import Detection from "../models/Detection.js";
import { analyzeFrameBuffer } from "../services/yoloService.js";
import { emitToMonitoringRoles } from "../sockets/socketRooms.js";
import { isValidObjectId, normalizeDetectionArray } from "../utils/validators.js";

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\r\n]+)$/;

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

const persistAndBroadcastDetection = async ({ req, camera, detections, timestamp }) => {
  const normalizedCameraId = camera._id.toString();

  const detectionPayload = {
    cameraId: normalizedCameraId,
    detections,
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
    detections,
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
    });

    return res.status(201).json({
      success: true,
      data: newDetection,
      ml: {
        summary: yoloResult.summary,
        analysis: yoloResult.analysis,
        fireDetection: yoloResult.fireDetection,
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
