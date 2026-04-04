import express from "express";
import {
	analyzeDetectionFrame,
	createDetection,
	getDetectionsByCamera,
} from "../controllers/detectionController.js";
import {
	authenticateRequest,
	authenticateWorkerOrRoles,
	requireApprovedUser,
	requireRoles,
} from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/", authenticateWorkerOrRoles("admin", "operator"), createDetection);
router.post(
	"/analyze",
	authenticateWorkerOrRoles("admin", "operator"),
	analyzeDetectionFrame,
);
router.get(
	"/camera/:cameraId",
	authenticateRequest,
	requireApprovedUser,
	requireRoles("admin", "operator"),
	getDetectionsByCamera,
);

export default router;
