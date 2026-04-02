import express from "express";
import {
  createIncident,
  getIncidents,
  updateIncidentById,
} from "../controllers/incidentController.js";

const router = express.Router();

router.get("/", getIncidents);
router.post("/", createIncident);
router.patch("/:incidentId", updateIncidentById);

export default router;