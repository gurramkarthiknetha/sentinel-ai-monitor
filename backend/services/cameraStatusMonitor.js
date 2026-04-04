import Camera from "../models/Camera.js";
import { stopWorkerForCamera } from "./yoloWorkerManager.js";

export const startCameraStatusMonitor = ({
  io,
  offlineTimeoutSeconds,
  checkIntervalSeconds,
}) => {
  const checkForOfflineCameras = async () => {
    const cutoff = new Date(Date.now() - offlineTimeoutSeconds * 1000);

    const staleCameras = await Camera.find({
      status: "ONLINE",
      lastActive: { $lte: cutoff },
    }).select("_id lastActive");

    if (staleCameras.length === 0) {
      return;
    }

    const cameraIds = staleCameras.map((camera) => camera._id);

    await Camera.updateMany(
      { _id: { $in: cameraIds } },
      {
        $set: {
          status: "OFFLINE",
        },
      },
    );

    await Promise.all(
      staleCameras.map(async (camera) => {
        try {
          await stopWorkerForCamera(camera._id.toString(), { reason: "offline-timeout" });
        } catch (error) {
          console.error(
            `[camera-status-monitor] Failed to stop worker for camera=${camera._id}:`,
            error.message,
          );
        }
      }),
    );

    for (const camera of staleCameras) {
      io.emit("camera:status", {
        cameraId: camera._id.toString(),
        status: "OFFLINE",
        lastActive: camera.lastActive,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[camera-status-monitor] Marked ${staleCameras.length} camera(s) OFFLINE`);
  };

  const intervalId = setInterval(() => {
    checkForOfflineCameras().catch((error) => {
      console.error("[camera-status-monitor] Failed to evaluate camera status:", error.message);
    });
  }, checkIntervalSeconds * 1000);

  if (typeof intervalId.unref === "function") {
    intervalId.unref();
  }

  return () => clearInterval(intervalId);
};
