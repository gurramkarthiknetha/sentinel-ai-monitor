import { create } from 'zustand';

export type IncidentType = 'fire' | 'crowd' | 'medical' | 'security' | 'inactivity';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus =
  | 'active'
  | 'assigned'
  | 'in_progress'
  | 'pending_confirmation'
  | 'escalated'
  | 'resolved';
export type ResponderValidation = 'pending' | 'valid_incident' | 'false_alert';
export type AIDecision = 'needs_human_validation' | 'auto_resolved' | 'auto_escalated';
export type DetectionMethod = 'YOLO' | 'POSE' | 'CNN' | 'HYBRID';

export interface Incident {
  id: string;
  type: IncidentType;
  severity: Severity;
  status: IncidentStatus;
  confidence: number;
  timestamp: string;
  zone: string;
  location: { lat: number; lng: number };
  description: string;
  assignedTo?: string;
  assignedResponderId?: string;
  assignedAt?: string;
  acceptedAt?: string;
  resolvedByResponderId?: string;
  responderValidation?: ResponderValidation;
  aiDecision?: AIDecision;
  detectionMethod?: DetectionMethod;
  predictionDetails?: string;
  snapshotUrl?: string;
  snapshotBase64?: string;
  sourceCameraId?: string;
  confirmationDeadline?: string;
  escalatedAt?: string;
  notes: string[];
  resolvedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Detection {
  id: string;
  cameraId: string;
  type: IncidentType;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
  timestamp: string;
}

interface IncidentStore {
  incidents: Incident[];
  detections: Detection[];
  setIncidents: (incidents: Incident[]) => void;
  addIncident: (incident: Incident) => void;
  updateIncident: (id: string, updates: Partial<Incident>) => void;
  addDetection: (detection: Detection) => void;
  clearDetections: (cameraId: string) => void;
}

export const useIncidentStore = create<IncidentStore>((set) => ({
  incidents: [],
  detections: [],
  setIncidents: (incidents) => set(() => ({ incidents })),
  addIncident: (incident) => set((s) => ({ incidents: [incident, ...s.incidents] })),
  updateIncident: (id, updates) =>
    set((s) => ({
      incidents: s.incidents.map((inc) => (inc.id === id ? { ...inc, ...updates } : inc)),
    })),
  addDetection: (detection) => set((s) => ({ detections: [...s.detections, detection] })),
  clearDetections: (cameraId) =>
    set((s) => ({ detections: s.detections.filter((d) => d.cameraId !== cameraId) })),
}));
