import type { CameraEntity, CameraStatus, CreateCameraInput } from "@/types/monitoring";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

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
