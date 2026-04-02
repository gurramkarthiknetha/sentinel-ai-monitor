import { create } from 'zustand';

export type IncidentType = 'fire' | 'crowd' | 'medical' | 'security' | 'inactivity';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'active' | 'assigned' | 'in_progress' | 'resolved';

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
  notes: string[];
  resolvedAt?: string;
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
