import Incident from "../models/Incident.js";
import {
  INCIDENT_SEVERITY_SET,
  INCIDENT_STATUS_SET,
  INCIDENT_TYPE_SET,
  getAllowedIncidentTypesForResponder,
} from "../constants/auth.js";

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

    return res.json({ success: true, data: incidents });
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
      notes,
      resolvedAt,
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
        .json({ message: "status must be active, assigned, in_progress, or resolved" });
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

    const parsedResolvedAt = resolvedAt ? new Date(resolvedAt) : status === "resolved" ? new Date() : undefined;
    if (parsedResolvedAt && Number.isNaN(parsedResolvedAt.getTime())) {
      return res.status(400).json({ message: "resolvedAt must be a valid ISO date" });
    }

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
          assignedTo: typeof assignedTo === "string" && assignedTo.trim() ? assignedTo.trim() : undefined,
          notes: safeNotes,
          resolvedAt: parsedResolvedAt,
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

    const responderAllowedTypes =
      req.authUser?.role === "responder"
        ? getAllowedIncidentTypesForResponder(req.authUser.responderType)
        : null;

    if (Array.isArray(responderAllowedTypes)) {
      if (responderAllowedTypes.length === 0 || !responderAllowedTypes.includes(incident.type)) {
        return res.status(403).json({ message: "Responder access is limited to assigned alert type" });
      }
    }

    const updates = {};
    const payload = req.body || {};

    if (payload.type !== undefined) {
      if (!INCIDENT_TYPE_SET.has(payload.type)) {
        return res.status(400).json({ message: "Invalid type value" });
      }

      if (Array.isArray(responderAllowedTypes) && !responderAllowedTypes.includes(payload.type)) {
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
      if (payload.status === "resolved" && payload.resolvedAt === undefined) {
        updates.resolvedAt = new Date();
      }
      if (payload.status !== "resolved" && payload.resolvedAt === undefined) {
        updates.resolvedAt = undefined;
      }
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
      updates.assignedTo =
        typeof payload.assignedTo === "string" && payload.assignedTo.trim()
          ? payload.assignedTo.trim()
          : undefined;
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

    if (payload.resolvedAt !== undefined) {
      if (payload.resolvedAt === null || payload.resolvedAt === "") {
        updates.resolvedAt = undefined;
      } else {
        const parsedResolvedAt = new Date(payload.resolvedAt);
        if (Number.isNaN(parsedResolvedAt.getTime())) {
          return res.status(400).json({ message: "resolvedAt must be a valid ISO date" });
        }
        updates.resolvedAt = parsedResolvedAt;
      }
    }

    Object.assign(incident, updates);
    await incident.save();

    return res.json({ success: true, data: incident });
  } catch (error) {
    return next(error);
  }
};