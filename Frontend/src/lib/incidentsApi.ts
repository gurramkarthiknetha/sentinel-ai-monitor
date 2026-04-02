import type { Incident, IncidentStatus, IncidentType, Severity } from "@/store/incidents";
import { getAuthToken, useAuthStore } from "@/store/auth";

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
  const token = getAuthToken();

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
    ...options,
  });

  const payload = (await response.json().catch(() => ({}))) as
    | ApiEnvelope<T>
    | { message?: string; code?: string };

  if (!response.ok) {
    if (response.status === 401) {
      useAuthStore.getState().clearSession();
    }

    const payloadCode =
      payload && typeof payload === "object" && "code" in payload ? payload.code : undefined;

    const error = new Error(payload.message || "Request failed");
    (error as Error & { code?: string }).code =
      typeof payloadCode === "string" ? payloadCode : undefined;
    throw error;
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