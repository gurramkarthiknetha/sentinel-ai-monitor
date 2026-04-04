import Incident from "../models/Incident.js";
import {
  INCIDENT_SEVERITY_SET,
  INCIDENT_STATUS_SET,
  INCIDENT_TYPE_SET,
  getAllowedIncidentTypesForResponder,
} from "../constants/auth.js";
import {
  confirmFireIncidentByOperator,
  rejectFireIncidentByOperator,
} from "../services/fireEscalationService.js";
import { emitIncidentEvent } from "../sockets/socketRooms.js";
import { isValidObjectId } from "../utils/validators.js";

const DEFAULT_LOCATION_CENTER = { lat: 40.7128, lng: -74.006 };

const parseFiniteNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const normalizeConfidence = (value, fallback = null) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = parseFiniteNumber(value);
  if (parsed === null) {
    return null;
  }

  if (parsed >= 0 && parsed <= 1) {
    return parsed;
  }

  if (parsed > 1 && parsed <= 100) {
    return parsed / 100;
  }

  return null;
};

const normalizeLocation = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const lat = parseFiniteNumber(value.lat);
  const lng = parseFiniteNumber(value.lng);

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

const AI_DECISION_SET = new Set(["needs_human_validation", "auto_resolved", "auto_escalated"]);
const DETECTION_METHOD_SET = new Set(["YOLO", "POSE", "CNN", "HYBRID"]);
const RESPONDER_VALIDATION_SET = new Set(["pending", "valid_incident", "false_alert"]);
const RESPONDER_ACTION_SET = new Set([
  "accept",
  "start_progress",
  "mark_valid",
  "mark_false_alert",
  "add_note",
  "resolve",
]);

const normalizeOptionalString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizeAiDecision = (value, fallback = "needs_human_validation") => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return AI_DECISION_SET.has(normalized) ? normalized : fallback;
};

const normalizeDetectionMethod = (value, fallback = "YOLO") => {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return DETECTION_METHOD_SET.has(normalized) ? normalized : fallback;
};

const normalizeResponderValidation = (value, fallback = "pending") => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return RESPONDER_VALIDATION_SET.has(normalized) ? normalized : fallback;
};

const parseDateField = (value) => {
  if (value === undefined) {
    return { present: false, value: undefined, invalid: false };
  }

  if (value === null || value === "") {
    return { present: true, value: undefined, invalid: false };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { present: true, value: undefined, invalid: true };
  }

  return { present: true, value: parsed, invalid: false };
};

const getResponderDisplayName = (authUser) => {
  const trimmedName = typeof authUser?.name === "string" ? authUser.name.trim() : "";
  if (trimmedName) {
    return trimmedName;
  }

  const trimmedEmail = typeof authUser?.email === "string" ? authUser.email.trim() : "";
  if (trimmedEmail) {
    return trimmedEmail;
  }

  return "responder";
};

const appendNote = (incident, actor, message, at = new Date()) => {
  const trimmedMessage = typeof message === "string" ? message.trim() : "";
  if (!trimmedMessage) {
    return;
  }

  const existingNotes = Array.isArray(incident.notes) ? incident.notes : [];
  incident.notes = [...existingNotes, `${at.toISOString()} [${actor}] ${trimmedMessage}`];
};

const responderCanAccessIncident = (authUser, incidentType) => {
  if (authUser?.role !== "responder") {
    return true;
  }

  const allowedTypes = getAllowedIncidentTypesForResponder(authUser.responderType);
  return allowedTypes.includes(incidentType);
};

export const getIncidents = async (req, res, next) => {
  try {
    const { type, severity, status, search } = req.query;
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 300;

    const filter = {};

    if (req.authUser?.role === "responder") {
      const allowedTypes = getAllowedIncidentTypesForResponder(req.authUser.responderType);

      if (allowedTypes.length === 0) {
        return res.json({ success: true, data: [] });
      }

      if (typeof type === "string" && INCIDENT_TYPE_SET.has(type)) {
        if (!allowedTypes.includes(type)) {
          return res.json({ success: true, data: [] });
        }
        filter.type = type;
      } else {
        filter.type = { $in: allowedTypes };
      }
    }

    if (req.authUser?.role !== "responder" && typeof type === "string" && INCIDENT_TYPE_SET.has(type)) {
      filter.type = type;
    }

    if (typeof severity === "string" && INCIDENT_SEVERITY_SET.has(severity)) {
      filter.severity = severity;
    }

    if (typeof status === "string" && INCIDENT_STATUS_SET.has(status)) {
      filter.status = status;
    }

    if (typeof search === "string" && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      filter.$or = [{ id: regex }, { description: regex }, { zone: regex }];
    }

    const incidents = await Incident.find(filter).sort({ timestamp: -1, createdAt: -1 }).limit(limit);

    const visibleIncidents =
      req.authUser?.role === "responder" && req.authUser?.responderType === "fire"
        ? incidents.filter((incident) => incident.status !== "pending_confirmation")
        : incidents;

    return res.json({ success: true, data: visibleIncidents });
  } catch (error) {
    return next(error);
  }
};

export const createIncident = async (req, res, next) => {
  try {
    const {
      type,
      severity,
      status = "active",
      confidence,
      timestamp,
      zone,
      location,
      description,
      assignedTo,
      assignedResponderId,
      assignedAt,
      acceptedAt,
      notes,
      resolvedAt,
      responderValidation,
      aiDecision,
      detectionMethod,
      predictionDetails,
      snapshotUrl,
      snapshotBase64,
      sourceCameraId,
      confirmationDeadline,
      escalatedAt,
    } = req.body;

    if (!INCIDENT_TYPE_SET.has(type)) {
      return res.status(400).json({ message: "type must be fire, crowd, medical, security, or inactivity" });
    }

    if (!INCIDENT_SEVERITY_SET.has(severity)) {
      return res.status(400).json({ message: "severity must be low, medium, high, or critical" });
    }

    if (!INCIDENT_STATUS_SET.has(status)) {
      return res
        .status(400)
        .json({
          message:
            "status must be active, assigned, in_progress, pending_confirmation, escalated, or resolved",
        });
    }

    if (typeof zone !== "string" || !zone.trim()) {
      return res.status(400).json({ message: "zone is required" });
    }

    if (typeof description !== "string" || !description.trim()) {
      return res.status(400).json({ message: "description is required" });
    }

    const normalizedConfidence = normalizeConfidence(confidence, 1);
    if (normalizedConfidence === null) {
      return res.status(400).json({ message: "confidence must be between 0 and 1" });
    }

    const normalizedLocation = normalizeLocation(location) || fallbackLocation();

    const safeNotes = Array.isArray(notes) ? notes.map((note) => String(note)).filter(Boolean) : [];
    const parsedTimestamp = timestamp ? new Date(timestamp) : new Date();

    if (Number.isNaN(parsedTimestamp.getTime())) {
      return res.status(400).json({ message: "timestamp must be a valid ISO date" });
    }

    const parsedResolvedAtField = parseDateField(resolvedAt);
    if (parsedResolvedAtField.invalid) {
      return res.status(400).json({ message: "resolvedAt must be a valid ISO date" });
    }

    const parsedAssignedAtField = parseDateField(assignedAt);
    if (parsedAssignedAtField.invalid) {
      return res.status(400).json({ message: "assignedAt must be a valid ISO date" });
    }

    const parsedAcceptedAtField = parseDateField(acceptedAt);
    if (parsedAcceptedAtField.invalid) {
      return res.status(400).json({ message: "acceptedAt must be a valid ISO date" });
    }

    const parsedConfirmationDeadlineField = parseDateField(confirmationDeadline);
    if (parsedConfirmationDeadlineField.invalid) {
      return res.status(400).json({ message: "confirmationDeadline must be a valid ISO date" });
    }

    const parsedEscalatedAtField = parseDateField(escalatedAt);
    if (parsedEscalatedAtField.invalid) {
      return res.status(400).json({ message: "escalatedAt must be a valid ISO date" });
    }

    const assignedToValue = normalizeOptionalString(assignedTo);

    const assignedResponderIdValue = (() => {
      if (assignedResponderId === undefined || assignedResponderId === null || assignedResponderId === "") {
        return undefined;
      }

      return isValidObjectId(assignedResponderId) ? assignedResponderId : null;
    })();

    if (assignedResponderIdValue === null) {
      return res.status(400).json({ message: "assignedResponderId must be a valid user id" });
    }

    const sourceCameraIdValue = (() => {
      if (sourceCameraId === undefined || sourceCameraId === null || sourceCameraId === "") {
        return undefined;
      }

      return isValidObjectId(sourceCameraId) ? sourceCameraId : null;
    })();

    if (sourceCameraIdValue === null) {
      return res.status(400).json({ message: "sourceCameraId must be a valid camera id" });
    }

    let assignedAtValue = parsedAssignedAtField.present ? parsedAssignedAtField.value : undefined;
    let acceptedAtValue = parsedAcceptedAtField.present ? parsedAcceptedAtField.value : undefined;
    let resolvedAtValue = parsedResolvedAtField.present ? parsedResolvedAtField.value : undefined;
    let confirmationDeadlineValue = parsedConfirmationDeadlineField.present
      ? parsedConfirmationDeadlineField.value
      : undefined;
    let escalatedAtValue = parsedEscalatedAtField.present ? parsedEscalatedAtField.value : undefined;

    if (
      !assignedAtValue &&
      (assignedToValue ||
        assignedResponderIdValue ||
        ["assigned", "in_progress", "escalated", "resolved"].includes(status))
    ) {
      assignedAtValue = new Date();
    }

    if (!acceptedAtValue && ["in_progress", "resolved"].includes(status)) {
      acceptedAtValue = new Date();
    }

    if (!resolvedAtValue && status === "resolved") {
      resolvedAtValue = new Date();
    }

    if (!escalatedAtValue && status === "escalated") {
      escalatedAtValue = new Date();
    }

    if (status !== "pending_confirmation") {
      confirmationDeadlineValue = undefined;
    }

    const predictionDetailsValue = normalizeOptionalString(predictionDetails);
    const snapshotUrlValue = normalizeOptionalString(snapshotUrl);
    const snapshotBase64Value = normalizeOptionalString(snapshotBase64);

    const responderValidationValue = normalizeResponderValidation(responderValidation, "pending");
    const aiDecisionValue = normalizeAiDecision(aiDecision, "needs_human_validation");
    const detectionMethodValue = normalizeDetectionMethod(detectionMethod, "YOLO");

    let created = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const incidentId = await buildNextIncidentId(attempt);

      try {
        created = await Incident.create({
          id: incidentId,
          type,
          severity,
          status,
          confidence: normalizedConfidence,
          timestamp: parsedTimestamp,
          zone: zone.trim(),
          location: normalizedLocation,
          description: description.trim(),
          assignedTo: assignedToValue,
          assignedResponderId: assignedResponderIdValue,
          assignedAt: assignedAtValue,
          acceptedAt: acceptedAtValue,
          responderValidation: responderValidationValue,
          aiDecision: aiDecisionValue,
          detectionMethod: detectionMethodValue,
          predictionDetails: predictionDetailsValue,
          snapshotUrl: snapshotUrlValue,
          snapshotBase64: snapshotBase64Value,
          sourceCameraId: sourceCameraIdValue,
          notes: safeNotes,
          confirmationDeadline: confirmationDeadlineValue,
          escalatedAt: escalatedAtValue,
          resolvedAt: resolvedAtValue,
          resolvedByResponderId:
            status === "resolved" && assignedResponderIdValue ? assignedResponderIdValue : undefined,
        });
        break;
      } catch (error) {
        if (error?.code === 11000) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw new Error("Unable to generate unique incident id");
    }

    emitIncidentEvent(req.app.get("io"), "incident:created", created.toObject());

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    return next(error);
  }
};

export const updateIncidentById = async (req, res, next) => {
  try {
    const { incidentId } = req.params;

    if (!incidentId || typeof incidentId !== "string") {
      return res.status(400).json({ message: "incidentId is required" });
    }

    const incident = await Incident.findOne({ id: incidentId });
    if (!incident) {
      return res.status(404).json({ message: "Incident not found" });
    }

    if (!responderCanAccessIncident(req.authUser, incident.type)) {
      return res.status(403).json({ message: "Responder access is limited to assigned alert type" });
    }

    const updates = {};
    const payload = req.body || {};
    const now = new Date();

    if (payload.type !== undefined) {
      if (!INCIDENT_TYPE_SET.has(payload.type)) {
        return res.status(400).json({ message: "Invalid type value" });
      }

      if (!responderCanAccessIncident(req.authUser, payload.type)) {
        return res.status(403).json({ message: "Responder access is limited to assigned alert type" });
      }

      updates.type = payload.type;
    }

    if (payload.severity !== undefined) {
      if (!INCIDENT_SEVERITY_SET.has(payload.severity)) {
        return res.status(400).json({ message: "Invalid severity value" });
      }
      updates.severity = payload.severity;
    }

    if (payload.status !== undefined) {
      if (!INCIDENT_STATUS_SET.has(payload.status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      updates.status = payload.status;
    }

    if (payload.confidence !== undefined) {
      const normalizedConfidence = normalizeConfidence(payload.confidence);
      if (normalizedConfidence === null) {
        return res.status(400).json({ message: "confidence must be between 0 and 1" });
      }
      updates.confidence = normalizedConfidence;
    }

    if (payload.zone !== undefined) {
      if (typeof payload.zone !== "string" || !payload.zone.trim()) {
        return res.status(400).json({ message: "zone must be a non-empty string" });
      }
      updates.zone = payload.zone.trim();
    }

    if (payload.location !== undefined) {
      const normalizedLocation = normalizeLocation(payload.location);
      if (!normalizedLocation) {
        return res.status(400).json({ message: "location must include valid lat and lng" });
      }
      updates.location = normalizedLocation;
    }

    if (payload.description !== undefined) {
      if (typeof payload.description !== "string" || !payload.description.trim()) {
        return res.status(400).json({ message: "description must be a non-empty string" });
      }
      updates.description = payload.description.trim();
    }

    if (payload.assignedTo !== undefined) {
      const assignedToValue = normalizeOptionalString(payload.assignedTo);
      updates.assignedTo = assignedToValue;

      if (assignedToValue && payload.assignedAt === undefined && !incident.assignedAt) {
        updates.assignedAt = now;
      }

      if (!assignedToValue && payload.assignedResponderId === undefined) {
        updates.assignedResponderId = undefined;
      }
    }

    if (payload.assignedResponderId !== undefined) {
      if (payload.assignedResponderId === null || payload.assignedResponderId === "") {
        updates.assignedResponderId = undefined;
      } else if (!isValidObjectId(payload.assignedResponderId)) {
        return res.status(400).json({ message: "assignedResponderId must be a valid user id" });
      } else {
        updates.assignedResponderId = payload.assignedResponderId;
      }
    }

    if (payload.notes !== undefined) {
      if (!Array.isArray(payload.notes)) {
        return res.status(400).json({ message: "notes must be an array" });
      }
      updates.notes = payload.notes.map((note) => String(note)).filter(Boolean);
    }

    if (payload.timestamp !== undefined) {
      const parsedTimestamp = new Date(payload.timestamp);
      if (Number.isNaN(parsedTimestamp.getTime())) {
        return res.status(400).json({ message: "timestamp must be a valid ISO date" });
      }
      updates.timestamp = parsedTimestamp;
    }

    const resolvedAtField = parseDateField(payload.resolvedAt);
    if (resolvedAtField.invalid) {
      return res.status(400).json({ message: "resolvedAt must be a valid ISO date" });
    }
    if (resolvedAtField.present) {
      updates.resolvedAt = resolvedAtField.value;
    }

    const assignedAtField = parseDateField(payload.assignedAt);
    if (assignedAtField.invalid) {
      return res.status(400).json({ message: "assignedAt must be a valid ISO date" });
    }
    if (assignedAtField.present) {
      updates.assignedAt = assignedAtField.value;
    }

    const acceptedAtField = parseDateField(payload.acceptedAt);
    if (acceptedAtField.invalid) {
      return res.status(400).json({ message: "acceptedAt must be a valid ISO date" });
    }
    if (acceptedAtField.present) {
      updates.acceptedAt = acceptedAtField.value;
    }

    if (payload.resolvedByResponderId !== undefined) {
      if (payload.resolvedByResponderId === null || payload.resolvedByResponderId === "") {
        updates.resolvedByResponderId = undefined;
      } else if (!isValidObjectId(payload.resolvedByResponderId)) {
        return res.status(400).json({ message: "resolvedByResponderId must be a valid user id" });
      } else {
        updates.resolvedByResponderId = payload.resolvedByResponderId;
      }
    }

    if (payload.sourceCameraId !== undefined) {
      if (payload.sourceCameraId === null || payload.sourceCameraId === "") {
        updates.sourceCameraId = undefined;
      } else if (!isValidObjectId(payload.sourceCameraId)) {
        return res.status(400).json({ message: "sourceCameraId must be a valid camera id" });
      } else {
        updates.sourceCameraId = payload.sourceCameraId;
      }
    }

    const confirmationDeadlineField = parseDateField(payload.confirmationDeadline);
    if (confirmationDeadlineField.invalid) {
      return res.status(400).json({ message: "confirmationDeadline must be a valid ISO date" });
    }
    if (confirmationDeadlineField.present) {
      updates.confirmationDeadline = confirmationDeadlineField.value;
    }

    const escalatedAtField = parseDateField(payload.escalatedAt);
    if (escalatedAtField.invalid) {
      return res.status(400).json({ message: "escalatedAt must be a valid ISO date" });
    }
    if (escalatedAtField.present) {
      updates.escalatedAt = escalatedAtField.value;
    }

    if (payload.responderValidation !== undefined) {
      const normalized =
        typeof payload.responderValidation === "string"
          ? payload.responderValidation.trim().toLowerCase()
          : "";

      if (!RESPONDER_VALIDATION_SET.has(normalized)) {
        return res
          .status(400)
          .json({ message: "responderValidation must be pending, valid_incident, or false_alert" });
      }

      updates.responderValidation = normalized;
    }

    if (payload.aiDecision !== undefined) {
      const normalized = typeof payload.aiDecision === "string" ? payload.aiDecision.trim().toLowerCase() : "";

      if (!AI_DECISION_SET.has(normalized)) {
        return res
          .status(400)
          .json({ message: "aiDecision must be needs_human_validation, auto_resolved, or auto_escalated" });
      }

      updates.aiDecision = normalized;
    }

    if (payload.detectionMethod !== undefined) {
      const normalized =
        typeof payload.detectionMethod === "string" ? payload.detectionMethod.trim().toUpperCase() : "";

      if (!DETECTION_METHOD_SET.has(normalized)) {
        return res.status(400).json({ message: "detectionMethod must be YOLO, POSE, CNN, or HYBRID" });
      }

      updates.detectionMethod = normalized;
    }

    if (payload.predictionDetails !== undefined) {
      updates.predictionDetails = normalizeOptionalString(payload.predictionDetails);
    }

    if (payload.snapshotUrl !== undefined) {
      updates.snapshotUrl = normalizeOptionalString(payload.snapshotUrl);
    }

    if (payload.snapshotBase64 !== undefined) {
      updates.snapshotBase64 = normalizeOptionalString(payload.snapshotBase64);
    }

    const nextStatus = updates.status ?? incident.status;

    if (
      ["assigned", "in_progress", "escalated", "resolved"].includes(nextStatus) &&
      payload.assignedAt === undefined &&
      updates.assignedAt === undefined &&
      !incident.assignedAt
    ) {
      updates.assignedAt = now;
    }

    if (
      nextStatus === "pending_confirmation" &&
      payload.confirmationDeadline === undefined &&
      updates.confirmationDeadline === undefined
    ) {
      updates.confirmationDeadline = new Date(now.getTime() + 10_000);
    }

    if (
      nextStatus === "escalated" &&
      payload.escalatedAt === undefined &&
      updates.escalatedAt === undefined &&
      !incident.escalatedAt
    ) {
      updates.escalatedAt = now;
    }

    if (
      ["in_progress", "resolved"].includes(nextStatus) &&
      payload.acceptedAt === undefined &&
      updates.acceptedAt === undefined &&
      !incident.acceptedAt
    ) {
      updates.acceptedAt = now;
    }

    if (nextStatus === "resolved") {
      if (payload.resolvedAt === undefined && updates.resolvedAt === undefined && !incident.resolvedAt) {
        updates.resolvedAt = now;
      }
      if (payload.confirmationDeadline === undefined) {
        updates.confirmationDeadline = undefined;
      }
    } else if (updates.status !== undefined && payload.resolvedAt === undefined) {
      updates.resolvedAt = undefined;
      if (payload.resolvedByResponderId === undefined) {
        updates.resolvedByResponderId = undefined;
      }
    }

    if (nextStatus !== "escalated" && updates.status !== undefined && payload.escalatedAt === undefined) {
      updates.escalatedAt = undefined;
    }

    Object.assign(incident, updates);
    await incident.save();

    emitIncidentEvent(req.app.get("io"), "incident:updated", incident.toObject());

    return res.json({ success: true, data: incident });
  } catch (error) {
    return next(error);
  }
};

export const applyResponderAction = async (req, res, next) => {
  try {
    const { incidentId } = req.params;

    if (!incidentId || typeof incidentId !== "string") {
      return res.status(400).json({ message: "incidentId is required" });
    }

    const incident = await Incident.findOne({ id: incidentId });
    if (!incident) {
      return res.status(404).json({ message: "Incident not found" });
    }

    if (!responderCanAccessIncident(req.authUser, incident.type)) {
      return res.status(403).json({ message: "Responder access is limited to assigned alert type" });
    }

    if (incident.type === "fire" && incident.status === "pending_confirmation") {
      return res.status(403).json({ message: "Fire incident is waiting for operator confirmation" });
    }

    const payload = req.body || {};
    const action = typeof payload.action === "string" ? payload.action.trim().toLowerCase() : "";
    const note = normalizeOptionalString(payload.note);

    if (!RESPONDER_ACTION_SET.has(action)) {
      return res.status(400).json({
        message:
          "action must be accept, start_progress, mark_valid, mark_false_alert, add_note, or resolve",
      });
    }

    if (action === "add_note" && !note) {
      return res.status(400).json({ message: "note is required for add_note action" });
    }

    if (incident.status === "resolved" && action !== "add_note") {
      return res.status(409).json({ message: "Incident is already resolved" });
    }

    const now = new Date();
    const actorName = getResponderDisplayName(req.authUser);

    const ensureOwnership = () => {
      if (!incident.assignedTo) {
        incident.assignedTo = actorName;
      }

      if (!incident.assignedResponderId && req.authUser?._id) {
        incident.assignedResponderId = req.authUser._id;
      }

      if (!incident.assignedAt) {
        incident.assignedAt = now;
      }
    };

    switch (action) {
      case "accept": {
        ensureOwnership();
        if (["active", "pending_confirmation", "escalated"].includes(incident.status)) {
          incident.status = "assigned";
        }

        appendNote(incident, actorName, note || "Accepted incident ownership", now);
        break;
      }

      case "start_progress": {
        ensureOwnership();
        incident.status = "in_progress";

        if (!incident.acceptedAt) {
          incident.acceptedAt = now;
        }

        appendNote(incident, actorName, note || "Started incident response", now);
        break;
      }

      case "mark_valid": {
        ensureOwnership();
        incident.responderValidation = "valid_incident";

        if (!incident.acceptedAt) {
          incident.acceptedAt = now;
        }

        if (["active", "assigned", "escalated"].includes(incident.status)) {
          incident.status = "in_progress";
        }

        appendNote(incident, actorName, note || "Marked as valid incident", now);
        break;
      }

      case "mark_false_alert": {
        ensureOwnership();
        incident.responderValidation = "false_alert";
        incident.status = "resolved";
        incident.resolvedAt = now;

        if (!incident.acceptedAt) {
          incident.acceptedAt = now;
        }

        if (req.authUser?._id) {
          incident.resolvedByResponderId = req.authUser._id;
        }

        appendNote(incident, actorName, note || "Marked as false alert", now);
        break;
      }

      case "resolve": {
        ensureOwnership();
        incident.status = "resolved";
        incident.resolvedAt = now;

        if (!incident.acceptedAt) {
          incident.acceptedAt = now;
        }

        if (req.authUser?._id) {
          incident.resolvedByResponderId = req.authUser._id;
        }

        appendNote(incident, actorName, note || "Marked as resolved", now);
        break;
      }

      case "add_note": {
        appendNote(incident, actorName, note, now);
        break;
      }

      default:
        break;
    }

    await incident.save();

    emitIncidentEvent(req.app.get("io"), "incident:updated", incident.toObject());

    return res.json({ success: true, data: incident });
  } catch (error) {
    return next(error);
  }
};

export const resolveFireConfirmationById = async (req, res, next) => {
  try {
    const { incidentId } = req.params;
    const action = typeof req.body?.action === "string" ? req.body.action.trim().toLowerCase() : "";

    if (!incidentId || typeof incidentId !== "string") {
      return res.status(400).json({ message: "incidentId is required" });
    }

    if (!["confirm", "reject"].includes(action)) {
      return res.status(400).json({ message: "action must be confirm or reject" });
    }

    const io = req.app.get("io");

    const updatedIncident =
      action === "confirm"
        ? await confirmFireIncidentByOperator({ incidentId, authUser: req.authUser, io })
        : await rejectFireIncidentByOperator({ incidentId, authUser: req.authUser, io });

    return res.json({ success: true, data: updatedIncident });
  } catch (error) {
    return next(error);
  }
};