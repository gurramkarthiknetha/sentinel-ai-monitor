import { getYOLOHealth } from "./yoloService.js";

const activeCameraIds = new Set();
let initialized = false;

const resolveCameraId = (cameraOrCameraId) => {
  if (typeof cameraOrCameraId === "string" && cameraOrCameraId.trim()) {
    return cameraOrCameraId.trim();
  }

  const candidate = cameraOrCameraId?._id;
  if (candidate) {
    return String(candidate);
  }

  return "";
};

export const initializeYOLOWorkerManager = async () => {
  if (initialized) {
    return;
  }

  initialized = true;

  try {
    const { baseUrl, health } = await getYOLOHealth();
    console.log(
      `[yolo-worker-manager] Connected to ${baseUrl} (model loaded: ${Boolean(
        health?.yolo_loaded,
      )})`,
    );
  } catch (error) {
    console.warn(`[yolo-worker-manager] Startup health check failed: ${error.message}`);
  }
};

export const shutdownYOLOWorkerManager = async () => {
  activeCameraIds.clear();
  initialized = false;
};

export const startWorkerForCamera = async (camera) => {
  const cameraId = resolveCameraId(camera);
  if (!cameraId) {
    throw new Error("Unable to start YOLO processing without a valid camera id");
  }

  await getYOLOHealth();
  activeCameraIds.add(cameraId);

  console.log(`[yolo-worker-manager] Camera ${cameraId} marked active for YOLO processing`);
};

export const stopWorkerForCamera = async (cameraId, { reason } = {}) => {
  const normalizedCameraId = resolveCameraId(cameraId);
  if (!normalizedCameraId) {
    return;
  }

  const removed = activeCameraIds.delete(normalizedCameraId);
  if (removed) {
    console.log(
      `[yolo-worker-manager] Camera ${normalizedCameraId} stopped${
        reason ? ` (${reason})` : ""
      }`,
    );
  }
};

export const getActiveYOLOCameras = () => Array.from(activeCameraIds);
