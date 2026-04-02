import type {
  CameraEntity,
  CameraStatus,
  CreateCameraInput,
  DetectionBox,
} from "@/types/monitoring";
import { getAuthToken, useAuthStore } from "@/store/auth";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface DetectionRecord {
  _id: string;
  cameraId: string;
  detections: DetectionBox[];
  timestamp: string;
  createdAt: string;
  updatedAt: string;
}

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

export const getCameras = () => request<CameraEntity[]>("/cameras");

export const addCamera = (input: CreateCameraInput) =>
  request<CameraEntity>("/cameras", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteCamera = (cameraId: string) =>
  request<CameraEntity>(`/cameras/${cameraId}`, {
    method: "DELETE",
  });

export const updateCameraStatus = (cameraId: string, status: CameraStatus) =>
  request<CameraEntity>(`/cameras/${cameraId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

export const getDetectionsByCamera = (cameraId: string, limit = 25) =>
  request<DetectionRecord[]>(`/detections/camera/${cameraId}?limit=${Math.max(1, limit)}`);
