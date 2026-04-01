import Camera from "../models/Camera.js";
import Detection from "../models/Detection.js";
import { isValidObjectId, normalizeDetectionArray } from "../utils/validators.js";

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

    const normalizedCameraId = camera._id.toString();

    const newDetection = await Detection.create({
      cameraId: normalizedCameraId,
      detections: sanitizedDetections,
    });

    camera.status = "ONLINE";
    camera.lastActive = new Date();
    await camera.save();

    const io = req.app.get("io");

    io?.emit("detection:update", {
      cameraId: normalizedCameraId,
      detections: sanitizedDetections,
      timestamp: newDetection.timestamp,
    });

    io?.emit("camera:status", {
      cameraId: normalizedCameraId,
      status: camera.status,
      lastActive: camera.lastActive,
      timestamp: new Date().toISOString(),
    });

    return res.status(201).json({ success: true, data: newDetection });
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
