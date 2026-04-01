import express from "express";
import { createDetection, getDetectionsByCamera } from "../controllers/detectionController.js";

const router = express.Router();

router.post("/", createDetection);
router.get("/camera/:cameraId", getDetectionsByCamera);

export default router;
