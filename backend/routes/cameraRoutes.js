import express from "express";
import {
  createCamera,
  deleteCameraById,
  getCameraById,
  getCameras,
  updateCameraStatusById,
} from "../controllers/cameraController.js";
import {
  authenticateRequest,
  authenticateWorkerOrRoles,
  requireApprovedUser,
  requireRoles,
} from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/", authenticateRequest, requireApprovedUser, requireRoles("admin", "operator"), createCamera);
router.get("/", authenticateRequest, requireApprovedUser, requireRoles("admin", "operator"), getCameras);
router.get("/:cameraId", authenticateWorkerOrRoles("admin", "operator"), getCameraById);
router.patch("/:cameraId/status", authenticateWorkerOrRoles("admin", "operator"), updateCameraStatusById);
router.delete(
  "/:cameraId",
  authenticateRequest,
  requireApprovedUser,
  requireRoles("admin", "operator"),
  deleteCameraById,
);

export default router;
