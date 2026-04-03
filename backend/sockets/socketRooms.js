import { normalizeResponderType, RESPONDER_TYPE_SET } from "../constants/auth.js";

export const MONITORING_SOCKET_ROLES = new Set(["admin", "operator"]);
export const INCIDENT_SOCKET_ROLES = new Set(["admin", "operator", "responder"]);

export const roleRoom = (role) => `role:${String(role || "").trim().toLowerCase()}`;

export const responderTypeRoom = (responderType) =>
  `responderType:${normalizeResponderType(responderType)}`;

export const emitToRoles = (io, roles, eventName, payload) => {
  if (!io) {
    return;
  }

  for (const role of roles) {
    io.to(roleRoom(role)).emit(eventName, payload);
  }
};

export const emitToMonitoringRoles = (io, eventName, payload) => {
  emitToRoles(io, MONITORING_SOCKET_ROLES, eventName, payload);
};

export const emitIncidentEvent = (io, eventName, incident) => {
  if (!io || !incident) {
    return;
  }

  emitToRoles(io, ["admin", "operator"], eventName, incident);

  const incidentType = normalizeResponderType(incident.type);
  if (RESPONDER_TYPE_SET.has(incidentType)) {
    io.to(responderTypeRoom(incidentType)).emit(eventName, incident);
  }
};
