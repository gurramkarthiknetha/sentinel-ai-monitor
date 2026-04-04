import express from "express";
import {
  applyResponderAction,
  createIncident,
  getIncidents,
  resolveFireConfirmationById,
  updateIncidentById,
} from "../controllers/incidentController.js";
import { authenticateRequest, requireApprovedUser, requireRoles } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", authenticateRequest, requireApprovedUser, requireRoles("admin", "operator", "responder"), getIncidents);
router.post("/", authenticateRequest, requireApprovedUser, requireRoles("admin", "operator"), createIncident);
router.patch(
  "/:incidentId/fire-confirmation",
  authenticateRequest,
  requireApprovedUser,
  requireRoles("admin", "operator"),
  resolveFireConfirmationById,
);
router.patch(
  "/:incidentId/respond",
  authenticateRequest,
  requireApprovedUser,
  requireRoles("responder"),
  applyResponderAction,
);
router.patch(
  "/:incidentId",
  authenticateRequest,
  requireApprovedUser,
  requireRoles("admin", "operator"),
  updateIncidentById,
);

export default router;