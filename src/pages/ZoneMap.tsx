import { useEffect, useRef } from "react";
import { useIncidentStore, type Severity, type IncidentType } from "@/store/incidents";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const SEVERITY_COLORS: Record<Severity, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

const TYPE_LABELS: Record<IncidentType, string> = {
  fire: '🔥', crowd: '👥', medical: '🏥', security: '🛡️',
};

export default function ZoneMapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const incidents = useIncidentStore((s) => s.incidents);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [40.7128, -74.006],
      zoom: 15,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker) map.removeLayer(layer);
    });

    incidents.forEach((inc) => {
      const color = SEVERITY_COLORS[inc.severity];
      const marker = L.circleMarker([inc.location.lat, inc.location.lng], {
        radius: inc.severity === 'critical' ? 12 : inc.severity === 'high' ? 10 : 8,
        fillColor: color,
        color: color,
        weight: 2,
        opacity: 0.8,
        fillOpacity: inc.status === 'resolved' ? 0.2 : 0.5,
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #e2e8f0; background: hsl(220, 18%, 10%); padding: 8px; border-radius: 6px; min-width: 180px;">
          <div style="font-weight: bold; margin-bottom: 4px;">${TYPE_LABELS[inc.type]} ${inc.id}</div>
          <div style="color: #94a3b8;">Type: ${inc.type}</div>
          <div style="color: ${color};">Severity: ${inc.severity}</div>
          <div style="color: #94a3b8;">Status: ${inc.status.replace('_', ' ')}</div>
          <div style="color: #94a3b8;">Zone: ${inc.zone}</div>
          <div style="color: #94a3b8; font-size: 10px; margin-top: 4px;">${new Date(inc.timestamp).toLocaleString()}</div>
        </div>
      `, {
        className: 'dark-popup',
      });
    });
  }, [incidents]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold tracking-tight">Zone Map</h1>
        <p className="text-muted-foreground text-sm mt-1">Interactive incident mapping</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        {(['low', 'medium', 'high', 'critical'] as Severity[]).map((sev) => (
          <div key={sev} className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: SEVERITY_COLORS[sev] }} />
            <span className="text-xs text-muted-foreground capitalize">{sev}</span>
          </div>
        ))}
      </div>

      <Card className="bg-card border-border overflow-hidden">
        <div ref={mapRef} className="h-[calc(100vh-280px)] min-h-[400px] w-full" />
      </Card>
    </div>
  );
}
