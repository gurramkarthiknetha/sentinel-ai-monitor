export const USER_ROLES = ["admin", "operator", "responder"];
export const RESPONDER_TYPES = ["medical", "fire", "crowd", "inactivity"];
export const APPROVAL_STATUSES = ["pending", "approved", "rejected"];

export const INCIDENT_TYPES = ["fire", "crowd", "medical", "security", "inactivity"];
export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"];
export const INCIDENT_STATUSES = ["active", "assigned", "in_progress", "resolved"];

export const USER_ROLE_SET = new Set(USER_ROLES);
export const RESPONDER_TYPE_SET = new Set(RESPONDER_TYPES);
export const APPROVAL_STATUS_SET = new Set(APPROVAL_STATUSES);
export const INCIDENT_TYPE_SET = new Set(INCIDENT_TYPES);
export const INCIDENT_SEVERITY_SET = new Set(INCIDENT_SEVERITIES);
export const INCIDENT_STATUS_SET = new Set(INCIDENT_STATUSES);

export const RESPONDER_INCIDENT_TYPES = {
  medical: ["medical"],
  fire: ["fire"],
  crowd: ["crowd"],
  inactivity: ["inactivity"],
};

export const normalizeRole = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const normalizeResponderType = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const normalizeApprovalStatus = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const getAllowedIncidentTypesForResponder = (responderType) =>
  RESPONDER_INCIDENT_TYPES[normalizeResponderType(responderType)] || [];
