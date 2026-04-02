import type { Incident } from "@/store/incidents";

export type DecisionMode = "auto" | "manual";

export interface DecisionOverride {
  mode: DecisionMode;
  actor: string;
  reason: string;
  at: string;
}

export interface IncidentDecisionResult {
  mode: DecisionMode;
  reason: string;
  overridden: boolean;
  override: DecisionOverride | null;
}

export const DEFAULT_DECISION_THRESHOLD = 0.7;
export const DECISION_THRESHOLD_STORAGE_KEY = "sentinel.admin.decisionThreshold";

const OVERRIDE_PREFIX = "[system:decision-override]";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const toPercent = (value: number) => `${Math.round(clamp(value, 0, 1) * 100)}%`;

export const getStoredDecisionThreshold = () => {
  if (typeof window === "undefined") {
    return DEFAULT_DECISION_THRESHOLD;
  }

  const raw = window.localStorage.getItem(DECISION_THRESHOLD_STORAGE_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;

  return Number.isFinite(parsed) ? clamp(parsed, 0.1, 0.99) : DEFAULT_DECISION_THRESHOLD;
};

export const persistDecisionThreshold = (value: number) => {
  const normalized = clamp(value, 0.1, 0.99);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(DECISION_THRESHOLD_STORAGE_KEY, String(normalized));
  }

  return normalized;
};

export const createDecisionOverrideNote = (override: DecisionOverride) =>
  `${OVERRIDE_PREFIX}${JSON.stringify(override)}`;

export const parseDecisionOverride = (notes: string[] = []) => {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = String(notes[index] || "").trim();

    if (!note.startsWith(OVERRIDE_PREFIX)) {
      continue;
    }

    const encoded = note.slice(OVERRIDE_PREFIX.length);

    try {
      const parsed = JSON.parse(encoded) as Partial<DecisionOverride>;
      if (!parsed || (parsed.mode !== "auto" && parsed.mode !== "manual")) {
        continue;
      }

      return {
        mode: parsed.mode,
        actor: String(parsed.actor || "admin").trim() || "admin",
        reason: String(parsed.reason || "Decision manually adjusted").trim() || "Decision manually adjusted",
        at: String(parsed.at || new Date().toISOString()),
      } satisfies DecisionOverride;
    } catch {
      continue;
    }
  }

  return null;
};

export const getIncidentDecision = (
  incident: Pick<Incident, "confidence" | "notes">,
  threshold: number,
): IncidentDecisionResult => {
  const normalizedThreshold = clamp(threshold, 0.1, 0.99);
  const override = parseDecisionOverride(incident.notes || []);

  if (override) {
    return {
      mode: override.mode,
      reason: `${override.reason} (overridden by ${override.actor})`,
      overridden: true,
      override,
    };
  }

  const mode: DecisionMode = incident.confidence >= normalizedThreshold ? "auto" : "manual";

  return {
    mode,
    overridden: false,
    override: null,
    reason:
      mode === "auto"
        ? `Confidence ${toPercent(incident.confidence)} is above threshold ${toPercent(normalizedThreshold)}`
        : `Confidence ${toPercent(incident.confidence)} is below threshold ${toPercent(normalizedThreshold)}`,
  };
};

export const getResponseTimeMs = (incident: Pick<Incident, "timestamp" | "resolvedAt">) => {
  const start = new Date(incident.timestamp).getTime();
  const end = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : Date.now();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }

  return end - start;
};

export const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
};
