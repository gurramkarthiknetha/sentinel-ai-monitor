import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIncidentStore, type Severity, type IncidentType } from "@/store/incidents";
import { Card } from "@/components/ui/card";
import { CircleF, GoogleMap, InfoWindowF, useJsApiLoader } from "@react-google-maps/api";

const SEVERITY_COLORS: Record<Severity, string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#f97316",
  critical: "#ef4444",
};

const TYPE_LABELS: Record<IncidentType, string> = {
  fire: "🔥",
  crowd: "👥",
  medical: "🏥",
  security: "🛡️",
};

const SEVERITY_RADIUS_METERS: Record<Severity, number> = {
  low: 55,
  medium: 70,
  high: 85,
  critical: 100,
};

const FALLBACK_CENTER = { lat: 40.7128, lng: -74.006 };

const DARK_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#0a0f1f" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8b9bb7" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0f1f" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#1f2b44" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#101a2e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a2942" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0d172b" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#050b18" }] },
];

export default function ZoneMapPage() {
  const incidents = useIncidentStore((s) => s.incidents);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";

  const { isLoaded, loadError } = useJsApiLoader({
    id: "sentinel-zone-map",
    googleMapsApiKey,
  });

  const selectedIncident = useMemo(
    () => incidents.find((incident) => incident.id === selectedIncidentId) || null,
    [incidents, selectedIncidentId],
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      return;
    }

    let cancelled = false;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) {
          return;
        }

        setCurrentLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        // Keep map usable with incident/fallback center when location is unavailable.
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000,
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const center = useMemo(() => {
    if (currentLocation) {
      return currentLocation;
    }

    if (incidents.length === 0) {
      return FALLBACK_CENTER;
    }

    const totals = incidents.reduce(
      (accumulator, current) => ({
        lat: accumulator.lat + current.location.lat,
        lng: accumulator.lng + current.location.lng,
      }),
      { lat: 0, lng: 0 },
    );

    return {
      lat: totals.lat / incidents.length,
      lng: totals.lng / incidents.length,
    };
  }, [currentLocation, incidents]);

  const fitMapToIncidents = useCallback((map: any) => {
    if (!map || incidents.length < 2 || currentLocation) {
      return;
    }

    const googleMaps = (window as any).google?.maps;
    if (!googleMaps) {
      return;
    }

    const bounds = new googleMaps.LatLngBounds();
    incidents.forEach((incident) => {
      bounds.extend({ lat: incident.location.lat, lng: incident.location.lng });
    });
    map.fitBounds(bounds, 80);
  }, [currentLocation, incidents]);

  const handleMapLoad = useCallback((map: any) => {
    mapInstanceRef.current = map;
    fitMapToIncidents(map);
  }, [fitMapToIncidents]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !currentLocation) {
      return;
    }

    map.panTo(currentLocation);
    if (typeof map.getZoom === "function" && map.getZoom() < 14) {
      map.setZoom(14);
    }
  }, [currentLocation]);

  if (!googleMapsApiKey) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-heading font-bold tracking-tight">Zone Map</h1>
          <p className="text-muted-foreground text-sm mt-1">Interactive incident mapping</p>
        </div>
        <Card className="bg-card border-border p-4 text-sm text-muted-foreground">
          Missing VITE_GOOGLE_MAPS_API_KEY in frontend environment.
        </Card>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-heading font-bold tracking-tight">Zone Map</h1>
          <p className="text-muted-foreground text-sm mt-1">Interactive incident mapping</p>
        </div>
        <Card className="bg-card border-border p-4 text-sm text-destructive">
          Failed to load Google Maps. Check API key and billing restrictions.
        </Card>
      </div>
    );
  }

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
        {!isLoaded ? (
          <div className="h-[calc(100vh-280px)] min-h-[400px] w-full flex items-center justify-center text-sm text-muted-foreground">
            Loading Google Maps...
          </div>
        ) : (
          <GoogleMap
            mapContainerClassName="h-[calc(100vh-280px)] min-h-[400px] w-full"
            center={center}
            zoom={15}
            onLoad={handleMapLoad}
            options={{
              styles: DARK_MAP_STYLES as any,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: false,
            }}
            onClick={() => setSelectedIncidentId(null)}
          >
            {currentLocation ? (
              <CircleF
                center={currentLocation}
                radius={35}
                options={{
                  fillColor: "#3b82f6",
                  fillOpacity: 0.4,
                  strokeColor: "#93c5fd",
                  strokeOpacity: 0.95,
                  strokeWeight: 2,
                  clickable: false,
                }}
              />
            ) : null}

            {incidents.map((incident) => {
              const color = SEVERITY_COLORS[incident.severity];

              return (
                <CircleF
                  key={incident.id}
                  center={{ lat: incident.location.lat, lng: incident.location.lng }}
                  radius={SEVERITY_RADIUS_METERS[incident.severity]}
                  options={{
                    fillColor: color,
                    fillOpacity: incident.status === "resolved" ? 0.25 : 0.55,
                    strokeColor: color,
                    strokeOpacity: 0.9,
                    strokeWeight: 2,
                    clickable: true,
                  }}
                  onClick={() => setSelectedIncidentId(incident.id)}
                />
              );
            })}

            {selectedIncident ? (
              <InfoWindowF
                position={{ lat: selectedIncident.location.lat, lng: selectedIncident.location.lng }}
                onCloseClick={() => setSelectedIncidentId(null)}
              >
                <div className="text-xs min-w-[180px] text-slate-800">
                  <div className="font-semibold mb-1">
                    {TYPE_LABELS[selectedIncident.type]} {selectedIncident.id}
                  </div>
                  <div>Type: {selectedIncident.type}</div>
                  <div style={{ color: SEVERITY_COLORS[selectedIncident.severity] }}>
                    Severity: {selectedIncident.severity}
                  </div>
                  <div>Status: {selectedIncident.status.replace("_", " ")}</div>
                  <div>Zone: {selectedIncident.zone}</div>
                  <div className="text-[10px] mt-1 text-slate-500">
                    {new Date(selectedIncident.timestamp).toLocaleString()}
                  </div>
                </div>
              </InfoWindowF>
            ) : null}
          </GoogleMap>
        )}
      </Card>
    </div>
  );
}
