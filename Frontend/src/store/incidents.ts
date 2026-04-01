import { create } from 'zustand';

export type IncidentType = 'fire' | 'crowd' | 'medical' | 'security';
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
  addIncident: (incident: Incident) => void;
  updateIncident: (id: string, updates: Partial<Incident>) => void;
  addDetection: (detection: Detection) => void;
  clearDetections: (cameraId: string) => void;
}

const ZONES = ['Main Stage', 'North Gate', 'Food Court', 'Parking Lot', 'VIP Area', 'East Wing', 'Medical Tent', 'South Exit'];
const TYPES: IncidentType[] = ['fire', 'crowd', 'medical', 'security'];
const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

function generateMockIncidents(): Incident[] {
  const incidents: Incident[] = [];
  const now = Date.now();
  for (let i = 0; i < 12; i++) {
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    const severity = SEVERITIES[Math.floor(Math.random() * SEVERITIES.length)];
    const status: IncidentStatus = ['active', 'assigned', 'in_progress', 'resolved'][Math.floor(Math.random() * 4)] as IncidentStatus;
    incidents.push({
      id: `INC-${String(i + 1).padStart(4, '0')}`,
      type,
      severity,
      status,
      confidence: 0.65 + Math.random() * 0.3,
      timestamp: new Date(now - Math.random() * 86400000 * 3).toISOString(),
      zone: ZONES[Math.floor(Math.random() * ZONES.length)],
      location: {
        lat: 40.7128 + (Math.random() - 0.5) * 0.01,
        lng: -74.006 + (Math.random() - 0.5) * 0.01,
      },
      description: `AI-detected ${type} incident in ${ZONES[Math.floor(Math.random() * ZONES.length)]}`,
      assignedTo: status !== 'active' ? ['Officer Chen', 'Medic Rivera', 'Guard Patel', 'Chief Adams'][Math.floor(Math.random() * 4)] : undefined,
      notes: status === 'resolved' ? ['Incident contained', 'Area cleared'] : [],
      resolvedAt: status === 'resolved' ? new Date(now - Math.random() * 3600000).toISOString() : undefined,
    });
  }
  return incidents;
}

export const useIncidentStore = create<IncidentStore>((set) => ({
  incidents: generateMockIncidents(),
  detections: [],
  addIncident: (incident) => set((s) => ({ incidents: [incident, ...s.incidents] })),
  updateIncident: (id, updates) =>
    set((s) => ({
      incidents: s.incidents.map((inc) => (inc.id === id ? { ...inc, ...updates } : inc)),
    })),
  addDetection: (detection) => set((s) => ({ detections: [...s.detections, detection] })),
  clearDetections: (cameraId) =>
    set((s) => ({ detections: s.detections.filter((d) => d.cameraId !== cameraId) })),
}));
