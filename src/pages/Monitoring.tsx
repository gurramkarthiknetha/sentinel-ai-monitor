import { useEffect, useRef, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useIncidentStore, type IncidentType } from "@/store/incidents";
import { motion } from "framer-motion";
import { Camera, AlertTriangle, Maximize2 } from "lucide-react";

interface CameraFeed {
  id: string;
  name: string;
  zone: string;
  status: 'online' | 'offline';
}

const CAMERAS: CameraFeed[] = [
  { id: 'cam-1', name: 'CAM-01', zone: 'Main Stage', status: 'online' },
  { id: 'cam-2', name: 'CAM-02', zone: 'North Gate', status: 'online' },
  { id: 'cam-3', name: 'CAM-03', zone: 'Food Court', status: 'online' },
  { id: 'cam-4', name: 'CAM-04', zone: 'Parking Lot', status: 'online' },
  { id: 'cam-5', name: 'CAM-05', zone: 'VIP Area', status: 'online' },
  { id: 'cam-6', name: 'CAM-06', zone: 'East Wing', status: 'offline' },
];

const DETECTION_COLORS: Record<IncidentType, string> = {
  fire: '#ef4444',
  crowd: '#f59e0b',
  medical: '#3b82f6',
  security: '#a855f7',
};

function MockVideoFeed({ camera }: { camera: CameraFeed }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [detections, setDetections] = useState<
    { type: IncidentType; confidence: number; x: number; y: number; w: number; h: number }[]
  >([]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Dark noise background simulating video
    ctx.fillStyle = `hsl(220, 15%, ${8 + Math.random() * 3}%)`;
    ctx.fillRect(0, 0, w, h);

    // Grid overlay
    ctx.strokeStyle = 'hsla(160, 84%, 39%, 0.06)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += 30) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 30) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Scanline
    const scanY = (Date.now() / 20) % h;
    ctx.strokeStyle = 'hsla(160, 84%, 39%, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, scanY); ctx.lineTo(w, scanY); ctx.stroke();

    // Simulate people shapes
    for (let i = 0; i < 6; i++) {
      const px = 40 + (i * (w - 80)) / 5 + Math.sin(Date.now() / 1000 + i) * 5;
      const py = h * 0.5 + Math.cos(Date.now() / 800 + i * 2) * 10;
      ctx.fillStyle = `hsla(210, 10%, ${35 + Math.random() * 10}%, 0.6)`;
      ctx.beginPath();
      ctx.ellipse(px, py - 15, 5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(px - 4, py - 8, 8, 20);
    }

    // Draw detections
    detections.forEach((det) => {
      const color = DETECTION_COLORS[det.type];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(det.x * w, det.y * h, det.w * w, det.h * h);
      ctx.setLineDash([]);

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(det.x * w, det.y * h, det.w * w, det.h * h);
      ctx.globalAlpha = 1;

      // Label
      const label = `${det.type.toUpperCase()} ${(det.confidence * 100).toFixed(0)}%`;
      ctx.font = '10px JetBrains Mono, monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(det.x * w, det.y * h - 14, tw + 8, 14);
      ctx.fillStyle = '#000';
      ctx.fillText(label, det.x * w + 4, det.y * h - 3);
    });

    // Timestamp
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillStyle = 'hsla(160, 84%, 39%, 0.7)';
    ctx.fillText(new Date().toLocaleTimeString(), 8, h - 8);
    ctx.fillText(camera.name, w - 50, h - 8);
  }, [camera.name, detections]);

  useEffect(() => {
    if (camera.status === 'offline') return;

    let animId: number;
    const loop = () => {
      drawFrame();
      animId = requestAnimationFrame(loop);
    };
    loop();

    // Random detection simulation
    const interval = setInterval(() => {
      if (Math.random() > 0.6) {
        const types: IncidentType[] = ['fire', 'crowd', 'medical', 'security'];
        const type = types[Math.floor(Math.random() * types.length)];
        setDetections([
          {
            type,
            confidence: 0.7 + Math.random() * 0.25,
            x: 0.1 + Math.random() * 0.5,
            y: 0.2 + Math.random() * 0.3,
            w: 0.1 + Math.random() * 0.15,
            h: 0.15 + Math.random() * 0.2,
          },
        ]);
      } else {
        setDetections([]);
      }
    }, 3000);

    return () => {
      cancelAnimationFrame(animId);
      clearInterval(interval);
    };
  }, [camera.status, drawFrame]);

  if (camera.status === 'offline') {
    return (
      <div className="w-full aspect-video bg-muted/30 rounded-lg flex items-center justify-center">
        <p className="text-muted-foreground text-sm font-mono">OFFLINE</p>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={270}
      className="w-full aspect-video rounded-lg"
    />
  );
}

export default function MonitoringPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold tracking-tight">Video Monitoring</h1>
        <p className="text-muted-foreground text-sm mt-1">Live camera feeds with AI detection</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {CAMERAS.map((cam, i) => (
          <motion.div
            key={cam.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.08 }}
          >
            <Card className="bg-card border-border overflow-hidden">
              <div className="relative">
                <MockVideoFeed camera={cam} />
                <div className="absolute top-2 left-2 flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      cam.status === 'online'
                        ? 'border-success text-success'
                        : 'border-destructive text-destructive'
                    }`}
                  >
                    <div className={`h-1.5 w-1.5 rounded-full mr-1 ${
                      cam.status === 'online' ? 'bg-success' : 'bg-destructive'
                    }`} />
                    {cam.status.toUpperCase()}
                  </Badge>
                </div>
              </div>
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-heading font-medium">{cam.name}</span>
                  <span className="text-xs text-muted-foreground">• {cam.zone}</span>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
