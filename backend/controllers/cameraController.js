import Camera from "../models/Camera.js";
import Detection from "../models/Detection.js";
import { isValidCameraUrl, isValidObjectId } from "../utils/validators.js";

export const createCamera = async (req, res, next) => {
  try {
    const { name, rtspUrl, location, sourceType: sourceTypeInput, deviceId: deviceIdInput } =
      req.body;

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
      const systemUrl = `system://${encodeURIComponent(normalizedDeviceId)}`;

      const existingCamera = await Camera.findOne({ rtspUrl: systemUrl });
      if (existingCamera) {
        return res.status(409).json({ message: "System camera already exists" });
      }

      const camera = await Camera.create({
        name: name.trim(),
        sourceType: "SYSTEM",
        rtspUrl: systemUrl,
        deviceId: normalizedDeviceId,
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

    camera.status = status;
    if (status === "ONLINE") {
      camera.lastActive = new Date();
    }
    await camera.save();

    const io = req.app.get("io");
    io?.emit("camera:status", {
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

    const camera = await Camera.findByIdAndDelete(cameraId);
    if (!camera) {
      return res.status(404).json({ message: "Camera not found" });
    }

    await Detection.deleteMany({ cameraId: camera._id });

    const io = req.app.get("io");
    io?.emit("camera:deleted", {
      cameraId: camera._id.toString(),
      timestamp: new Date().toISOString(),
    });

    return res.json({ success: true, data: camera });
  } catch (error) {
    return next(error);
  }
};
