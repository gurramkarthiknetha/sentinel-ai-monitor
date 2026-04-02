import {
  getAuthToken,
  useAuthStore,
  type ApprovalStatus,
  type AuthUser,
  type ResponderType,
  type UserRole,
} from "@/store/auth";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  code?: string;
}

interface ApiErrorPayload {
  success?: boolean;
  message?: string;
  code?: string;
}

export type AuthState = "approved" | "onboarding_required" | "pending_approval" | "rejected";

export interface GoogleAuthResponseData {
  authState: AuthState;
  token?: string;
  user?: AuthUser;
  message?: string;
  code?: string;
  profile?: {
    googleId: string;
    email: string;
    name: string;
    avatar?: string;
  };
}

export type GoogleAuthResult = GoogleAuthResponseData;
export type GoogleProfile = NonNullable<GoogleAuthResponseData["profile"]>;

interface GoogleLoginInput {
  credential: string;
  role?: Exclude<UserRole, "admin">;
  responderType?: ResponderType;
}

interface UpdateUserInput {
  role?: UserRole;
  responderType?: ResponderType;
  approvalStatus?: ApprovalStatus;
}

const getApiBaseUrl = () => {
  const value = import.meta.env.VITE_API_BASE_URL;
  if (!value) {
    throw new Error("Missing VITE_API_BASE_URL in frontend environment.");
  }

  return value.endsWith("/") ? value.slice(0, -1) : value;
};

const withAuthHeaders = (headers?: HeadersInit): HeadersInit => {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(headers || {}),
  };
};

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: withAuthHeaders(options?.headers),
  });

  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T> | ApiErrorPayload;

  if (!response.ok) {
    if (response.status === 401) {
      useAuthStore.getState().clearSession();
    }

    const error = new Error(payload.message || "Request failed");
    (error as Error & { code?: string }).code = payload.code;
    throw error;
  }

  if (!("data" in payload)) {
    throw new Error("Malformed API response");
  }

  return payload.data;
};

const requestWithoutAuth = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T> | ApiErrorPayload;

  if (!response.ok) {
    const error = new Error(payload.message || "Request failed");
    (error as Error & { code?: string }).code = payload.code;
    throw error;
  }

  if (!("data" in payload)) {
    throw new Error("Malformed API response");
  }

  return payload.data;
};

export const loginWithGoogle = (input: GoogleLoginInput) =>
  requestWithoutAuth<GoogleAuthResponseData>("/auth/google", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const getGoogleAuthConfig = () => requestWithoutAuth<{ clientId: string }>("/auth/google/config");

export const getCurrentUser = () => request<AuthUser>("/auth/me");

export const getUsers = (status?: ApprovalStatus) =>
  request<AuthUser[]>(`/auth/users${status ? `?status=${status}` : ""}`);

export const getPendingUsers = () => request<AuthUser[]>("/auth/users/pending");

export const updateUserById = (userId: string, updates: UpdateUserInput) =>
  request<AuthUser>(`/auth/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
