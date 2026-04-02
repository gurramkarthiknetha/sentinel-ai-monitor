import type { Incident, IncidentStatus, IncidentType, Severity } from "@/store/incidents";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface CreateIncidentInput {
  type: IncidentType;
  severity: Severity;
  status?: IncidentStatus;
  confidence?: number;
  zone: string;
  location?: { lat: number; lng: number };
  description: string;
  assignedTo?: string;
  notes?: string[];
  timestamp?: string;
  resolvedAt?: string;
}

export interface UpdateIncidentInput extends Partial<CreateIncidentInput> {}

const getApiBaseUrl = () => {
  const value = import.meta.env.VITE_API_BASE_URL;
  if (!value) {
    throw new Error("Missing VITE_API_BASE_URL in frontend environment.");
  }

  return value.endsWith("/") ? value.slice(0, -1) : value;
};

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });

  const payload = (await response.json()) as ApiEnvelope<T> | { message?: string };

  if (!response.ok) {
    throw new Error(payload.message || "Request failed");
  }

  if (!("data" in payload)) {
    throw new Error("Malformed API response");
  }

  return payload.data;
};

export const getIncidents = () => request<Incident[]>("/incidents");

export const createIncident = (input: CreateIncidentInput) =>
  request<Incident>("/incidents", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateIncidentById = (incidentId: string, updates: UpdateIncidentInput) =>
  request<Incident>(`/incidents/${incidentId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });