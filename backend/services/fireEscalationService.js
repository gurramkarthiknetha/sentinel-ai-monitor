import Incident from "../models/Incident.js";
import { emitIncidentEvent, emitToRoles, responderTypeRoom } from "../sockets/socketRooms.js";

const HIGH_CONFIDENCE_FIRE_THRESHOLD = 0.8;
const DEFAULT_CONFIRMATION_WINDOW_MS = 10_000;
const DEFAULT_LOCATION_CENTER = { lat: 40.7128, lng: -74.006 };
const pendingEscalationTimers = new Map();

const getConfirmationWindowMs = () => {
  const raw = Number.parseInt(String(process.env.FIRE_CONFIRMATION_WINDOW_MS || ""), 10);
  if (!Number.isFinite(raw)) {
    return DEFAULT_CONFIRMATION_WINDOW_MS;
  }

  return Math.min(Math.max(raw, 3000), 60_000);
};

const FIRE_CONFIRMATION_WINDOW_MS = getConfirmationWindowMs();

const asStatusError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parseFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseCameraCoordinates = (camera) => {
  const raw = typeof camera?.location === "string" ? camera.location.trim() : "";
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const lat = parseFiniteNumber(match[1]);
  const lng = parseFiniteNumber(match[2]);

  if (lat === null || lng === null) {
    return null;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return { lat, lng };
};

const fallbackLocation = () => ({
  lat: DEFAULT_LOCATION_CENTER.lat + (Math.random() - 0.5) * 0.01,
  lng: DEFAULT_LOCATION_CENTER.lng + (Math.random() - 0.5) * 0.01,
});

const resolveIncidentLocation = (camera) => parseCameraCoordinates(camera) || fallbackLocation();

const resolveZone = (camera) => {
  const locationLabel = typeof camera?.location === "string" ? camera.location.trim() : "";
  if (locationLabel) {
    return locationLabel;
  }

  const nameLabel = typeof camera?.name === "string" ? camera.name.trim() : "";
  if (nameLabel) {
    return nameLabel;
  }

  return "Unspecified zone";
};

const appendSystemNote = (incident, message, at = new Date()) => {
  const notes = Array.isArray(incident.notes) ? incident.notes : [];
  incident.notes = [...notes, `${at.toISOString()} [system] ${message}`];
};

const buildNextIncidentId = async (offset = 0) => {
  const latest = await Incident.findOne({ id: /^INC-\d+$/ })
    .sort({ createdAt: -1, _id: -1 })
    .select("id")
    .lean();

  const lastNumeric = latest?.id?.match(/^INC-(\d+)$/)?.[1];
  const base = lastNumeric ? Number.parseInt(lastNumeric, 10) : 0;
  const next = Math.max(1, base + 1 + offset);

  return `INC-${String(next).padStart(4, "0")}`;
};

const buildRealtimePayload = (incident, extra = {}) => ({
  incidentId: incident.id,
  type: incident.type,
  status: incident.status,
  confidence: incident.confidence,
  zone: incident.zone,
  location: incident.location,
  confirmationDeadline: incident.confirmationDeadline
    ? new Date(incident.confirmationDeadline).toISOString()
    : null,
  escalatedAt: incident.escalatedAt ? new Date(incident.escalatedAt).toISOString() : null,
  timestamp: new Date().toISOString(),
  incident,
  ...extra,
});

const emitConfirmationRequested = (io, incident, source = "detected") => {
  emitToRoles(io, ["admin", "operator"], "fire:confirmation_requested", {
    ...buildRealtimePayload(incident, { source }),
    timeoutMs: FIRE_CONFIRMATION_WINDOW_MS,
  });
};

const emitWorkflowUpdated = (io, incident, mode) => {
  const payload = buildRealtimePayload(incident, { mode });
  emitToRoles(io, ["admin", "operator"], "fire:workflow_updated", payload);

  if (incident.status === "escalated") {
    io.to(responderTypeRoom("fire")).emit("fire:workflow_updated", payload);
    io.to(responderTypeRoom("fire")).emit("fire:responder_alert", payload);
  }
};

const clearEscalationTimer = (incidentId) => {
  const timer = pendingEscalationTimers.get(incidentId);
  if (timer) {
    clearTimeout(timer);
    pendingEscalationTimers.delete(incidentId);
  }
};

const autoEscalatePendingIncident = async ({ incidentId, io }) => {
  clearEscalationTimer(incidentId);

  const incident = await Incident.findOne({ id: incidentId, type: "fire" });
  if (!incident || incident.status !== "pending_confirmation") {
    return incident;
  }

  const now = new Date();

  incident.status = "escalated";
  incident.escalatedAt = now;
  incident.confirmationDeadline = undefined;
  incident.aiDecision = "auto_escalated";
  incident.assignedTo = incident.assignedTo || "Fire Responder Team";
  appendSystemNote(incident, "Auto-escalated after 10s without operator confirmation", now);

  await incident.save();

  emitIncidentEvent(io, "incident:updated", incident.toObject());
  emitWorkflowUpdated(io, incident.toObject(), "auto_timeout");

  return incident;
};

const scheduleEscalationTimer = ({ incident, io, notifyOperators = false, source = "detected" }) => {
  if (!incident || incident.status !== "pending_confirmation") {
    return;
  }

  clearEscalationTimer(incident.id);

  const deadlineDate = incident.confirmationDeadline
    ? new Date(incident.confirmationDeadline)
    : new Date(Date.now() + FIRE_CONFIRMATION_WINDOW_MS);

  const delayMs = deadlineDate.getTime() - Date.now();

  if (notifyOperators) {
    emitConfirmationRequested(io, incident, source);
  }

  if (delayMs <= 0) {
    void autoEscalatePendingIncident({ incidentId: incident.id, io });
    return;
  }

  const timer = setTimeout(() => {
    void autoEscalatePendingIncident({ incidentId: incident.id, io });
  }, delayMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  pendingEscalationTimers.set(incident.id, timer);
};

export const isHighConfidenceFire = (confidence) => {
  const normalized = Number(confidence);
  return Number.isFinite(normalized) && normalized >= HIGH_CONFIDENCE_FIRE_THRESHOLD;
};

export const createOrRefreshFireIncidentFromDetection = async ({
  io,
  camera,
  confidence,
  snapshotBase64,
  predictionDetails,
}) => {
  if (!camera?._id || !isHighConfidenceFire(confidence)) {
    return { incident: null, created: false };
  }

  const sourceCameraId = camera._id;

  const existing = await Incident.findOne({
    type: "fire",
    sourceCameraId,
    status: { $in: ["pending_confirmation", "escalated", "assigned", "in_progress", "active"] },
  }).sort({ timestamp: -1, createdAt: -1 });

  if (existing) {
    let changed = false;

    if (confidence > Number(existing.confidence || 0)) {
      existing.confidence = confidence;
      changed = true;
    }

    if (!existing.confirmationDeadline && existing.status === "pending_confirmation") {
      existing.confirmationDeadline = new Date(Date.now() + FIRE_CONFIRMATION_WINDOW_MS);
      changed = true;
    }

    if (snapshotBase64 && !existing.snapshotBase64) {
      existing.snapshotBase64 = snapshotBase64;
      changed = true;
    }

    if (typeof predictionDetails === "string" && predictionDetails.trim()) {
      const normalizedDetails = predictionDetails.trim();
      if (existing.predictionDetails !== normalizedDetails) {
        existing.predictionDetails = normalizedDetails;
        changed = true;
      }
    }

    if (changed) {
      await existing.save();
      emitIncidentEvent(io, "incident:updated", existing.toObject());
    }

    if (existing.status === "pending_confirmation") {
      scheduleEscalationTimer({ incident: existing.toObject(), io });
    }

    return { incident: existing, created: false };
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + FIRE_CONFIRMATION_WINDOW_MS);
  const cameraName = typeof camera?.name === "string" && camera.name.trim() ? camera.name.trim() : "camera";

  let createdIncident = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextIncidentId = await buildNextIncidentId(attempt);

    try {
      createdIncident = await Incident.create({
        id: nextIncidentId,
        type: "fire",
        severity: "critical",
        status: "pending_confirmation",
        confidence,
        timestamp: now,
        zone: resolveZone(camera),
        location: resolveIncidentLocation(camera),
        description: `High-confidence fire detected by AI on ${cameraName}`,
        sourceCameraId,
        aiDecision: "needs_human_validation",
        detectionMethod: "YOLO",
        predictionDetails:
          typeof predictionDetails === "string" && predictionDetails.trim()
            ? predictionDetails.trim()
            : `AI fire confidence ${Math.round(confidence * 100)}%`,
        snapshotBase64:
          typeof snapshotBase64 === "string" && snapshotBase64.trim() ? snapshotBase64.trim() : undefined,
        notes: [],
        confirmationDeadline: deadline,
      });
      break;
    } catch (error) {
      if (error?.code === 11000) {
        continue;
      }
      throw error;
    }
  }

  if (!createdIncident) {
    throw new Error("Unable to generate unique incident id");
  }

  emitIncidentEvent(io, "incident:created", createdIncident.toObject());
  scheduleEscalationTimer({
    incident: createdIncident.toObject(),
    io,
    notifyOperators: true,
    source: "detected",
  });

  return { incident: createdIncident, created: true };
};

export const confirmFireIncidentByOperator = async ({ incidentId, authUser, io }) => {
  const incident = await Incident.findOne({ id: incidentId, type: "fire" });
  if (!incident) {
    throw asStatusError(404, "Incident not found");
  }

  if (incident.status !== "pending_confirmation") {
    throw asStatusError(409, "Incident is no longer awaiting operator confirmation");
  }

  clearEscalationTimer(incident.id);

  const now = new Date();
  const actor =
    (typeof authUser?.name === "string" && authUser.name.trim()) ||
    (typeof authUser?.email === "string" && authUser.email.trim()) ||
    "operator";

  incident.status = "escalated";
  incident.escalatedAt = now;
  incident.confirmationDeadline = undefined;
  incident.aiDecision = "auto_escalated";
  incident.assignedTo = incident.assignedTo || "Fire Responder Team";
  appendSystemNote(incident, `Escalated by operator ${actor}`, now);

  await incident.save();

  emitIncidentEvent(io, "incident:updated", incident.toObject());
  emitWorkflowUpdated(io, incident.toObject(), "manual_confirm");

  return incident;
};

export const rejectFireIncidentByOperator = async ({ incidentId, authUser, io }) => {
  const incident = await Incident.findOne({ id: incidentId, type: "fire" });
  if (!incident) {
    throw asStatusError(404, "Incident not found");
  }

  if (incident.status !== "pending_confirmation") {
    throw asStatusError(409, "Incident is no longer awaiting operator confirmation");
  }

  clearEscalationTimer(incident.id);

  const now = new Date();
  const actor =
    (typeof authUser?.name === "string" && authUser.name.trim()) ||
    (typeof authUser?.email === "string" && authUser.email.trim()) ||
    "operator";

  incident.status = "resolved";
  incident.confirmationDeadline = undefined;
  incident.resolvedAt = now;
  incident.aiDecision = "auto_resolved";
  incident.responderValidation = "false_alert";
  appendSystemNote(incident, `Rejected as false alert by operator ${actor}`, now);

  await incident.save();

  emitIncidentEvent(io, "incident:updated", incident.toObject());
  emitWorkflowUpdated(io, incident.toObject(), "manual_reject");

  return incident;
};

export const initializeFireEscalationService = async (io) => {
  const pendingIncidents = await Incident.find({
    type: "fire",
    status: "pending_confirmation",
  }).sort({ timestamp: -1 });

  for (const incident of pendingIncidents) {
    scheduleEscalationTimer({
      incident: incident.toObject(),
      io,
      notifyOperators: true,
      source: "recovered",
    });
  }
};

export const shutdownFireEscalationService = () => {
  const pendingIds = Array.from(pendingEscalationTimers.keys());
  for (const incidentId of pendingIds) {
    clearEscalationTimer(incidentId);
  }
};

export const fireEscalationConfig = {
  highConfidenceThreshold: HIGH_CONFIDENCE_FIRE_THRESHOLD,
  confirmationWindowMs: FIRE_CONFIRMATION_WINDOW_MS,
};
