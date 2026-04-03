import Camera from "../models/Camera.js";
import Detection from "../models/Detection.js";
import { startWorkerForCamera, stopWorkerForCamera } from "../services/rtdetrWorkerManager.js";
import { emitToMonitoringRoles } from "../sockets/socketRooms.js";
import { isValidCameraUrl, isValidObjectId } from "../utils/validators.js";

const normalizeSystemDeviceIndex = (value) => {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }

  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }

  const namedIndexMatch = raw.match(/^(?:camera|cam|video)\s*(\d+)$/i);
  if (namedIndexMatch) {
    return Number.parseInt(namedIndexMatch[1], 10);
  }

  return null;
};

const parseSystemDeviceIndexFromRtspUrl = (rtspUrlValue) => {
  const rtspUrl = typeof rtspUrlValue === "string" ? rtspUrlValue.trim() : "";
  if (!rtspUrl.toLowerCase().startsWith("system://")) {
    return null;
  }

  const encodedDevicePart = rtspUrl.slice("system://".length).trim();
  if (!encodedDevicePart) {
    return null;
  }

  let decodedDevicePart = encodedDevicePart;
  try {
    decodedDevicePart = decodeURIComponent(encodedDevicePart);
  } catch {
    decodedDevicePart = encodedDevicePart;
  }

  return normalizeSystemDeviceIndex(decodedDevicePart);
};

const resolveSystemDeviceIndex = (cameraLike) =>
  normalizeSystemDeviceIndex(cameraLike?.deviceIndex) ??
  parseSystemDeviceIndexFromRtspUrl(cameraLike?.rtspUrl) ??
  normalizeSystemDeviceIndex(cameraLike?.deviceId) ??
  0;

export const createCamera = async (req, res, next) => {
  try {
    const {
      name,
      rtspUrl,
      location,
      sourceType: sourceTypeInput,
      deviceId: deviceIdInput,
      deviceIndex: deviceIndexInput,
    } = req.body;

    const sourceType =
      typeof sourceTypeInput === "string" ? sourceTypeInput.trim().toUpperCase() : "RTSP";

    if (!["RTSP", "SYSTEM"].includes(sourceType)) {
      return res.status(400).json({ message: "sourceType must be RTSP or SYSTEM" });
    }

    if (!name) {
      return res.status(400).json({ message: "name is required" });
    }

    const locationValue = typeof location === "string" ? location.trim() : undefined;

    if (sourceType === "SYSTEM") {
      const normalizedDeviceId =
        typeof deviceIdInput === "string" && deviceIdInput.trim()
          ? deviceIdInput.trim()
          : "default";

      const normalizedDeviceIndex =
        normalizeSystemDeviceIndex(deviceIndexInput) ??
        normalizeSystemDeviceIndex(normalizedDeviceId) ??
        0;

      const existingSystemCameras = await Camera.find({ sourceType: "SYSTEM" }).select(
        "_id name sourceType rtspUrl deviceId deviceIndex",
      );

      const conflictingCamera = existingSystemCameras.find(
        (camera) => resolveSystemDeviceIndex(camera) === normalizedDeviceIndex,
      );

      if (conflictingCamera) {
        return res.status(409).json({
          message: `System camera index ${normalizedDeviceIndex} already exists as ${conflictingCamera.name}`,
        });
      }

      const camera = await Camera.create({
        name: name.trim(),
        sourceType: "SYSTEM",
        rtspUrl: `system://${normalizedDeviceIndex}`,
        deviceId: normalizedDeviceId,
        deviceIndex: normalizedDeviceIndex,
        location: locationValue,
      });

      return res.status(201).json({ success: true, data: camera });
    }

    if (!rtspUrl) {
      return res.status(400).json({ message: "rtspUrl is required for RTSP source" });
    }

    if (!isValidCameraUrl(rtspUrl)) {
      return res
        .status(400)
        .json({ message: "Invalid camera URL. Use RTSP/RTSPS/HTTP/HTTPS format." });
    }

    const normalizedRtspUrl = rtspUrl.trim();

    const existingCamera = await Camera.findOne({ rtspUrl: normalizedRtspUrl });
    if (existingCamera) {
      return res.status(409).json({ message: "Camera with this URL already exists" });
    }

    const camera = await Camera.create({
      name: name.trim(),
      sourceType: "RTSP",
      rtspUrl: normalizedRtspUrl,
      location: locationValue,
    });

    return res.status(201).json({ success: true, data: camera });
  } catch (error) {
    return next(error);
  }
};

export const getCameras = async (_req, res, next) => {
  try {
    const cameras = await Camera.find().sort({ createdAt: -1 });
    return res.json({ success: true, data: cameras });
  } catch (error) {
    return next(error);
  }
};

export const getCameraById = async (req, res, next) => {
  try {
    const { cameraId } = req.params;
    if (!isValidObjectId(cameraId)) {
      return res.status(400).json({ message: "Invalid cameraId" });
    }

    const camera = await Camera.findById(cameraId);
    if (!camera) {
      return res.status(404).json({ message: "Camera not found" });
    }

    return res.json({ success: true, data: camera });
  } catch (error) {
    return next(error);
  }
};

export const updateCameraStatus = async (cameraId, status) => {
  const update = {
    status,
  };

  if (status === "ONLINE") {
    update.lastActive = new Date();
  }

  await Camera.findByIdAndUpdate(cameraId, update);
};

export const updateCameraStatusById = async (req, res, next) => {
  try {
    const { cameraId } = req.params;
    const { status } = req.body;

    if (!isValidObjectId(cameraId)) {
      return res.status(400).json({ message: "Invalid cameraId" });
    }

    if (!["ONLINE", "OFFLINE"].includes(status)) {
      return res.status(400).json({ message: "status must be ONLINE or OFFLINE" });
    }

    const camera = await Camera.findById(cameraId);
    if (!camera) {
      return res.status(404).json({ message: "Camera not found" });
    }

    if (status === "ONLINE" && camera.sourceType === "SYSTEM") {
      const targetDeviceIndex = resolveSystemDeviceIndex(camera);

      const onlineSystemCameras = await Camera.find({
        _id: { $ne: camera._id },
        sourceType: "SYSTEM",
        status: "ONLINE",
      }).select("_id name sourceType rtspUrl deviceId deviceIndex");

      const conflictingCamera = onlineSystemCameras.find(
        (otherCamera) => resolveSystemDeviceIndex(otherCamera) === targetDeviceIndex,
      );

      if (conflictingCamera) {
        return res.status(409).json({
          message: `System camera index ${targetDeviceIndex} is already ONLINE as ${conflictingCamera.name}`,
        });
      }

      if (camera.deviceIndex !== targetDeviceIndex) {
        camera.deviceIndex = targetDeviceIndex;
      }
    }

    camera.status = status;
    if (status === "ONLINE") {
      camera.lastActive = new Date();
    }
    await camera.save();

    if (status === "ONLINE") {
      try {
        await startWorkerForCamera(camera);
      } catch (error) {
        camera.status = "OFFLINE";
        await camera.save();

        return res.status(500).json({
          message: `Failed to start RT-DETR worker: ${error.message}`,
        });
      }
    } else {
      await stopWorkerForCamera(camera._id.toString(), { reason: "manual-offline" });
    }

    const io = req.app.get("io");
    emitToMonitoringRoles(io, "camera:status", {
      cameraId: camera._id.toString(),
      status: camera.status,
      lastActive: camera.lastActive,
      timestamp: new Date().toISOString(),
    });

    return res.json({ success: true, data: camera });
  } catch (error) {
    return next(error);
  }
};

export const deleteCameraById = async (req, res, next) => {
  try {
    const { cameraId } = req.params;

    if (!isValidObjectId(cameraId)) {
      return res.status(400).json({ message: "Invalid cameraId" });
    }

    const camera = await Camera.findById(cameraId);
    if (!camera) {
      return res.status(404).json({ message: "Camera not found" });
    }

    try {
      await stopWorkerForCamera(camera._id.toString(), { reason: "camera-deleted" });
    } catch (error) {
      console.error(`[camera:delete] Failed to stop worker for camera=${camera._id}:`, error.message);
    }

    await Camera.findByIdAndDelete(cameraId);

    await Detection.deleteMany({ cameraId: camera._id });

    const io = req.app.get("io");
    emitToMonitoringRoles(io, "camera:deleted", {
      cameraId: camera._id.toString(),
      timestamp: new Date().toISOString(),
    });

    return res.json({ success: true, data: camera });
  } catch (error) {
    return next(error);
  }
};
