import express from "express";
import {
  createIncident,
  getIncidents,
  updateIncidentById,
} from "../controllers/incidentController.js";
import { authenticateRequest, requireApprovedUser, requireRoles } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", authenticateRequest, requireApprovedUser, requireRoles("admin", "operator", "responder"), getIncidents);
router.post("/", authenticateRequest, requireApprovedUser, requireRoles("admin", "operator"), createIncident);
router.patch(
  "/:incidentId",
  authenticateRequest,
  requireApprovedUser,
  requireRoles("admin", "operator", "responder"),
  updateIncidentById,
);

export default router;