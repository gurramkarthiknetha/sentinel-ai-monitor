import express from "express";
import {
  createCamera,
  deleteCameraById,
  getCameraById,
  getCameras,
  updateCameraStatusById,
} from "../controllers/cameraController.js";

const router = express.Router();

router.post("/", createCamera);
router.get("/", getCameras);
router.get("/:cameraId", getCameraById);
router.patch("/:cameraId/status", updateCameraStatusById);
router.delete("/:cameraId", deleteCameraById);

export default router;
