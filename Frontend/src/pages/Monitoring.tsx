import { FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, Maximize2, Plus, RefreshCcw, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { addCamera, deleteCamera, getCameras, updateCameraStatus } from "@/lib/monitoringApi";
import { createMonitoringSocket } from "@/lib/monitoringSocket";
import { cn } from "@/lib/utils";
import type {
  CameraDeletedEvent,
  CameraEntity,
  CameraSourceType,
  CameraStatusEvent,
  DetectionBox,
  DetectionUpdateEvent,
} from "@/types/monitoring";

const CLASS_LABELS: Record<number, string> = {
  0: "person",
  1: "bicycle",
  2: "car",
  3: "motorcycle",
  4: "airplane",
  5: "bus",
  6: "train",
  7: "truck",
  8: "boat",
  9: "traffic light",
  10: "fire hydrant",
  11: "stop sign",
  12: "parking meter",
  13: "bench",
  14: "bird",
  15: "cat",
  16: "dog",
  17: "horse",
  18: "sheep",
  19: "cow",
  20: "elephant",
  21: "bear",
  22: "zebra",
  23: "giraffe",
  24: "backpack",
  25: "umbrella",
  26: "handbag",
  27: "tie",
  28: "suitcase",
  29: "frisbee",
  30: "skis",
  31: "snowboard",
  32: "sports ball",
  33: "kite",
  34: "baseball bat",
  35: "baseball glove",
  36: "skateboard",
  37: "surfboard",
  38: "tennis racket",
  39: "bottle",
  40: "wine glass",
  41: "cup",
  42: "fork",
  43: "knife",
  44: "spoon",
  45: "bowl",
  46: "banana",
  47: "apple",
  48: "sandwich",
  49: "orange",
  50: "broccoli",
  51: "carrot",
  52: "hot dog",
  53: "pizza",
  54: "donut",
  55: "cake",
  56: "chair",
  57: "couch",
  58: "potted plant",
  59: "bed",
  60: "dining table",
  61: "toilet",
  62: "tv",
  63: "laptop",
  64: "mouse",
  65: "remote",
  66: "keyboard",
  67: "cell phone",
  68: "microwave",
  69: "oven",
  70: "toaster",
  71: "sink",
  72: "refrigerator",
  73: "book",
  74: "clock",
  75: "vase",
  76: "scissors",
  77: "teddy bear",
  78: "hair drier",
  79: "toothbrush",
};

const BOX_COLORS = [
  "rgba(239, 68, 68, 0.9)",
  "rgba(249, 115, 22, 0.9)",
  "rgba(234, 179, 8, 0.9)",
  "rgba(34, 197, 94, 0.9)",
  "rgba(59, 130, 246, 0.9)",
  "rgba(168, 85, 247, 0.9)",
];

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const normalizeBbox = (detection: DetectionBox) => {
  const [x1, y1, third, fourth] = detection.bbox;
  const bboxFormat = detection.bboxFormat || "xywh";

  const x = x1;
  const y = y1;
  const w = bboxFormat === "xyxy" ? third - x1 : third;
  const h = bboxFormat === "xyxy" ? fourth - y1 : fourth;

  if (w <= 0 || h <= 0) {
    return {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };
  }

  const maxAbs = Math.max(Math.abs(x), Math.abs(y), Math.abs(w), Math.abs(h));

  if (maxAbs <= 1) {
    return {
      x: clamp(x),
      y: clamp(y),
      w: clamp(w),
      h: clamp(h),
    };
  }

  // Fallback for pixel-based payloads when source frame dimensions are unknown.
  return {
    x: clamp(x / 640),
    y: clamp(y / 360),
    w: clamp(w / 640),
    h: clamp(h / 360),
  };
};

const getClassLabel = (classId: number) => CLASS_LABELS[classId] || `class-${classId}`;

interface BrowserVideoDevice {
  deviceId: string;
  label: string;
}

const SystemCameraStream = memo(function SystemCameraStream({ deviceId }: { deviceId?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("System camera is not supported in this browser.");
        return;
      }

      try {
        const videoConstraints: MediaTrackConstraints | boolean =
          deviceId && deviceId !== "default" ? { deviceId: { exact: deviceId } } : true;

        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setError(null);
      } catch {
        setError("Unable to access system camera. Check permissions and retry.");
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [deviceId]);

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/30 p-4 text-center text-xs text-muted-foreground">
        {error}
      </div>
    );
  }

  return <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" autoPlay muted playsInline />;
});

const CameraViewport = memo(function CameraViewport({
  camera,
  liveDetections,
}: {
  camera: CameraEntity;
  liveDetections?: DetectionUpdateEvent;
}) {
  const sourceType = camera.sourceType || "RTSP";
  const isSystemCamera = sourceType === "SYSTEM";
  const supportsBrowserPlayback =
    !isSystemCamera && (camera.rtspUrl.startsWith("http://") || camera.rtspUrl.startsWith("https://"));

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-muted/20">
      {isSystemCamera ? (
        <SystemCameraStream deviceId={camera.deviceId} />
      ) : supportsBrowserPlayback ? (
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={camera.rtspUrl}
          autoPlay
          muted
          playsInline
          loop
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,hsl(var(--card)),transparent_45%),radial-gradient(circle_at_80%_80%,hsl(var(--muted)),transparent_40%),linear-gradient(130deg,hsl(var(--background)),hsl(var(--card)))]" />
      )}

      <div className="absolute inset-0 bg-[linear-gradient(transparent_95%,rgba(255,255,255,0.04)_96%),linear-gradient(90deg,transparent_95%,rgba(255,255,255,0.03)_96%)] bg-[length:16px_16px]" />

      {liveDetections?.detections.map((detection, index) => {
        const box = normalizeBbox(detection);
        const color = BOX_COLORS[index % BOX_COLORS.length];

        return (
          <div
            key={`${camera._id}-${index}-${detection.class}`}
            className="absolute border-2"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              borderColor: color,
              boxShadow: `0 0 0 1px rgba(0, 0, 0, 0.25), inset 0 0 20px rgba(0, 0, 0, 0.2)`,
              backgroundColor: color.replace("0.9", "0.12"),
            }}
          >
            <span
              className="absolute left-0 top-0 -translate-y-full px-1.5 py-0.5 text-[10px] font-heading uppercase"
              style={{
                backgroundColor: color,
                color: "#06070a",
              }}
            >
              {getClassLabel(detection.class)} {Math.round(detection.confidence * 100)}%
            </span>
          </div>
        );
      })}

      {!isSystemCamera && !supportsBrowserPlayback && (
        <p className="absolute bottom-2 left-2 rounded bg-black/45 px-2 py-1 text-[10px] font-mono text-muted-foreground">
          RTSP streams need HLS/WebRTC gateway for browser playback
        </p>
      )}
    </div>
  );
});

export default function MonitoringPage() {
  const { toast } = useToast();

  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [liveDetections, setLiveDetections] = useState<Record<string, DetectionUpdateEvent>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingCamera, setIsCreatingCamera] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [createSourceType, setCreateSourceType] = useState<CameraSourceType>("RTSP");
  const [systemDevices, setSystemDevices] = useState<BrowserVideoDevice[]>([]);
  const [selectedSystemDeviceId, setSelectedSystemDeviceId] = useState("default");
  const [isLoadingSystemDevices, setIsLoadingSystemDevices] = useState(false);
  const [deletingCameraId, setDeletingCameraId] = useState<string | null>(null);
  const [updatingStatusCameraId, setUpdatingStatusCameraId] = useState<string | null>(null);
  const [focusedCameraId, setFocusedCameraId] = useState<string | null>(null);

  const isFocusOpen = focusedCameraId !== null;

  const onlineCount = useMemo(
    () => cameras.filter((camera) => camera.status === "ONLINE").length,
    [cameras],
  );

  const fetchCameraList = useCallback(async () => {
    try {
      const list = await getCameras();
      setCameras(list);
    } catch (error) {
      toast({
        title: "Failed to load cameras",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchCameraList();
  }, [fetchCameraList]);

  useEffect(() => {
    if (!focusedCameraId) {
      return;
    }

    const stillExists = cameras.some((camera) => camera._id === focusedCameraId);
    if (!stillExists) {
      setFocusedCameraId(null);
    }
  }, [cameras, focusedCameraId]);

  useEffect(() => {
    if (!focusedCameraId) {
      return;
    }

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocusedCameraId(null);
      }
    };

    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onEscape);
    };
  }, [focusedCameraId]);

  const loadSystemCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) {
      toast({
        title: "System camera not supported",
        description: "This browser does not provide camera device APIs.",
        variant: "destructive",
      });
      return;
    }

    let permissionStream: MediaStream | null = null;
    setIsLoadingSystemDevices(true);

    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const devices = await navigator.mediaDevices.enumerateDevices();

      const uniqueDevices = new Map<string, BrowserVideoDevice>();
      let unnamedCount = 0;

      for (const device of devices) {
        if (device.kind !== "videoinput") {
          continue;
        }

        const id = device.deviceId || "default";
        if (!uniqueDevices.has(id)) {
          unnamedCount += 1;
          uniqueDevices.set(id, {
            deviceId: id,
            label: device.label || `System Camera ${unnamedCount}`,
          });
        }
      }

      const cameraDevices = Array.from(uniqueDevices.values());
      setSystemDevices(cameraDevices);

      if (cameraDevices.length > 0) {
        setSelectedSystemDeviceId((current) => {
          const match = cameraDevices.find((device) => device.deviceId === current);
          return match ? match.deviceId : cameraDevices[0].deviceId;
        });
      } else {
        setSelectedSystemDeviceId("default");
      }
    } catch {
      toast({
        title: "Unable to read system cameras",
        description: "Allow browser camera access, then retry.",
        variant: "destructive",
      });
    } finally {
      if (permissionStream) {
        permissionStream.getTracks().forEach((track) => track.stop());
      }
      setIsLoadingSystemDevices(false);
    }
  }, [toast]);

  useEffect(() => {
    if (createDialogOpen && createSourceType === "SYSTEM") {
      void loadSystemCameraDevices();
    }
  }, [createDialogOpen, createSourceType, loadSystemCameraDevices]);

  useEffect(() => {
    let socket: ReturnType<typeof createMonitoringSocket> | undefined;

    try {
      socket = createMonitoringSocket();
    } catch (error) {
      toast({
        title: "Socket setup error",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
      return;
    }

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    const onDetectionUpdate = (payload: DetectionUpdateEvent) => {
      if (!payload?.cameraId || !Array.isArray(payload.detections)) {
        return;
      }

      setLiveDetections((current) => ({
        ...current,
        [payload.cameraId]: payload,
      }));

      setCameras((current) =>
        current.map((camera) =>
          camera._id === payload.cameraId
            ? {
                ...camera,
                status: "ONLINE",
                lastActive: payload.timestamp,
              }
            : camera,
        ),
      );
    };

    const onCameraStatus = (payload: CameraStatusEvent) => {
      if (!payload?.cameraId || !payload.status) {
        return;
      }

      setCameras((current) =>
        current.map((camera) =>
          camera._id === payload.cameraId
            ? {
                ...camera,
                status: payload.status,
                lastActive: payload.lastActive || camera.lastActive,
              }
            : camera,
        ),
      );

      if (payload.status === "OFFLINE") {
        setLiveDetections((current) => {
          const next = { ...current };
          delete next[payload.cameraId];
          return next;
        });
      }
    };

    const onCameraDeleted = (payload: CameraDeletedEvent) => {
      if (!payload?.cameraId) {
        return;
      }

      setCameras((current) => current.filter((camera) => camera._id !== payload.cameraId));
      setFocusedCameraId((current) => (current === payload.cameraId ? null : current));
      setLiveDetections((current) => {
        const next = { ...current };
        delete next[payload.cameraId];
        return next;
      });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onDisconnect);
    socket.on("detection:update", onDetectionUpdate);
    socket.on("camera:status", onCameraStatus);
    socket.on("camera:deleted", onCameraDeleted);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect);
      socket.off("detection:update", onDetectionUpdate);
      socket.off("camera:status", onCameraStatus);
      socket.off("camera:deleted", onCameraDeleted);
      socket.disconnect();
    };
  }, [toast]);

  const onCreateCamera = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    const name = String(formData.get("name") || "").trim();
    const location = String(formData.get("location") || "").trim();

    if (!name) {
      toast({
        title: "Missing required fields",
        description: "Camera name is required",
        variant: "destructive",
      });
      return;
    }

    let payload:
      | {
          name: string;
          sourceType: "RTSP";
          rtspUrl: string;
          location?: string;
        }
      | {
          name: string;
          sourceType: "SYSTEM";
          deviceId: string;
          location?: string;
        };

    if (createSourceType === "SYSTEM") {
      payload = {
        name,
        sourceType: "SYSTEM",
        deviceId: selectedSystemDeviceId || "default",
        location: location || undefined,
      };
    } else {
      const rtspUrl = String(formData.get("rtspUrl") || "").trim();
      if (!rtspUrl) {
        toast({
          title: "Missing required fields",
          description: "RTSP / stream URL is required for RTSP source",
          variant: "destructive",
        });
        return;
      }

      payload = {
        name,
        sourceType: "RTSP",
        rtspUrl,
        location: location || undefined,
      };
    }

    try {
      setIsCreatingCamera(true);
      const created = await addCamera(payload);

      setCameras((current) => [created, ...current]);
      setCreateDialogOpen(false);
      form.reset();
      setCreateSourceType("RTSP");
      setSystemDevices([]);
      setSelectedSystemDeviceId("default");

      toast({
        title: "Camera added",
        description: `${created.name} is ready for detections`,
      });
    } catch (error) {
      toast({
        title: "Unable to add camera",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setIsCreatingCamera(false);
    }
  };

  const onDeleteCamera = async (camera: CameraEntity) => {
    if (deletingCameraId || updatingStatusCameraId) {
      return;
    }

    const confirmed = window.confirm(`Delete camera ${camera.name}? This removes saved detections too.`);
    if (!confirmed) {
      return;
    }

    try {
      setDeletingCameraId(camera._id);
      await deleteCamera(camera._id);

      setCameras((current) => current.filter((item) => item._id !== camera._id));
      setLiveDetections((current) => {
        const next = { ...current };
        delete next[camera._id];
        return next;
      });
      setFocusedCameraId((current) => (current === camera._id ? null : current));

      toast({
        title: "Camera deleted",
        description: `${camera.name} has been removed`,
      });
    } catch (error) {
      toast({
        title: "Unable to delete camera",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setDeletingCameraId(null);
    }
  };

  const onSetCameraOnline = async (camera: CameraEntity) => {
    if (updatingStatusCameraId || deletingCameraId || camera.status === "ONLINE") {
      return;
    }

    try {
      setUpdatingStatusCameraId(camera._id);
      const updated = await updateCameraStatus(camera._id, "ONLINE");

      setCameras((current) =>
        current.map((item) =>
          item._id === camera._id
            ? {
                ...item,
                status: updated.status,
                lastActive: updated.lastActive || item.lastActive,
              }
            : item,
        ),
      );

      toast({
        title: "Camera is online",
        description: `${camera.name} marked as ONLINE`,
      });
    } catch (error) {
      toast({
        title: "Unable to set camera online",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setUpdatingStatusCameraId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold tracking-tight">Video Monitoring</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live camera grid with Socket.IO status updates and RT-DETR bounding boxes
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={socketConnected ? "border-success text-success" : "border-warning text-warning"}
          >
            {socketConnected ? (
              <>
                <Wifi className="mr-1 h-3 w-3" /> Socket Connected
              </>
            ) : (
              <>
                <WifiOff className="mr-1 h-3 w-3" /> Socket Disconnected
              </>
            )}
          </Badge>

          <Badge variant="outline" className="border-primary/50 text-primary">
            {onlineCount}/{cameras.length} online
          </Badge>

          <Button variant="outline" size="sm" onClick={() => void fetchCameraList()}>
            <RefreshCcw className="mr-2 h-3.5 w-3.5" /> Refresh
          </Button>

          <Dialog
            open={createDialogOpen}
            onOpenChange={(open) => {
              setCreateDialogOpen(open);
              if (!open) {
                setCreateSourceType("RTSP");
                setSystemDevices([]);
                setSelectedSystemDeviceId("default");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" /> Add Camera
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle>Add New Camera</DialogTitle>
                <DialogDescription>
                  Add either an RTSP/IP stream or a local system webcam.
                </DialogDescription>
              </DialogHeader>

              <form className="space-y-4" onSubmit={onCreateCamera}>
                <div className="space-y-2">
                  <Label htmlFor="sourceType">Source Type</Label>
                  <Select
                    value={createSourceType}
                    onValueChange={(value) => setCreateSourceType(value as CameraSourceType)}
                  >
                    <SelectTrigger id="sourceType">
                      <SelectValue placeholder="Select camera source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RTSP">RTSP / IP Camera</SelectItem>
                      <SelectItem value="SYSTEM">System Camera</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Camera Name</Label>
                  <Input id="name" name="name" placeholder="CAM-01" required />
                </div>

                {createSourceType === "RTSP" ? (
                  <div className="space-y-2">
                    <Label htmlFor="rtspUrl">RTSP / Stream URL</Label>
                    <Input
                      id="rtspUrl"
                      name="rtspUrl"
                      placeholder="rtsp://username:password@192.168.1.20:554/stream1"
                      required
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="systemDeviceId">System Camera Device</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void loadSystemCameraDevices()}
                        disabled={isLoadingSystemDevices}
                      >
                        <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                        {isLoadingSystemDevices ? "Scanning..." : "Scan"}
                      </Button>
                    </div>

                    <Select value={selectedSystemDeviceId} onValueChange={setSelectedSystemDeviceId}>
                      <SelectTrigger id="systemDeviceId">
                        <SelectValue placeholder="Choose system camera" />
                      </SelectTrigger>
                      <SelectContent>
                        {systemDevices.length > 0 ? (
                          systemDevices.map((device) => (
                            <SelectItem key={device.deviceId} value={device.deviceId}>
                              {device.label}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="default">Default System Camera</SelectItem>
                        )}
                      </SelectContent>
                    </Select>

                    <p className="text-xs text-muted-foreground">
                      Browser permission is required to detect and preview local webcams.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input id="location" name="location" placeholder="North Gate" />
                </div>

                <Button type="submit" className="w-full" disabled={isCreatingCamera}>
                  {isCreatingCamera ? "Creating..." : "Create Camera"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading camera inventory...</Card>
      ) : null}

      {!isLoading && cameras.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No cameras configured yet. Add your first RTSP/IP camera to begin monitoring.
          </p>
        </Card>
      ) : null}

      {isFocusOpen ? (
        <button
          type="button"
          aria-label="Close expanded camera view"
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity duration-300"
          onClick={() => setFocusedCameraId(null)}
        />
      ) : null}

      <div className="relative grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cameras.map((camera, index) => {
          const overlay = liveDetections[camera._id];
          const sourceType = camera.sourceType || "RTSP";
          const isFocused = focusedCameraId === camera._id;
          const dimmed = isFocusOpen && !isFocused;

          return (
            <motion.div
              key={camera._id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={cn(
                "relative transition-all duration-300",
                dimmed && "pointer-events-none opacity-25 blur-[2px]",
                isFocused && "fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6",
              )}
            >
              <Card
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!isFocused) {
                    setFocusedCameraId(camera._id);
                  }
                }}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && !isFocused) {
                    event.preventDefault();
                    setFocusedCameraId(camera._id);
                  }

                  if (event.key === "Escape" && isFocused) {
                    event.stopPropagation();
                    setFocusedCameraId(null);
                  }
                }}
                className={cn(
                  "overflow-hidden border-border bg-card transition-all duration-300",
                  !isFocused && "cursor-zoom-in hover:border-primary/50",
                  isFocused && "w-full max-w-6xl cursor-default border-primary/60 shadow-2xl",
                )}
              >
                <div className="relative p-3 pb-0">
                  <CameraViewport camera={camera} liveDetections={overlay} />

                  {isFocused ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="absolute right-6 top-6 z-10"
                      onClick={(event) => {
                        event.stopPropagation();
                        setFocusedCameraId(null);
                      }}
                    >
                      <X className="mr-1.5 h-4 w-4" /> Close
                    </Button>
                  ) : (
                    <div className="pointer-events-none absolute right-6 top-6 z-10 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/90">
                      <Maximize2 className="h-3 w-3" /> Focus
                    </div>
                  )}
                </div>

                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Camera className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate text-sm font-heading font-medium">{camera.name}</span>
                      <Badge variant="outline" className="border-accent/40 text-[10px] text-accent">
                        {sourceType === "SYSTEM" ? "SYSTEM" : "RTSP"}
                      </Badge>
                    </div>

                    <Badge
                      variant="outline"
                      className={
                        camera.status === "ONLINE"
                          ? "border-success text-success"
                          : "border-destructive text-destructive"
                      }
                    >
                      <span
                        className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
                          camera.status === "ONLINE" ? "bg-success" : "bg-destructive"
                        }`}
                      />
                      {camera.status}
                    </Badge>
                  </div>

                  <div className="flex justify-end gap-2">
                    {camera.status === "OFFLINE" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 border-success/40 px-2 text-[11px] text-success hover:bg-success/10 hover:text-success"
                        disabled={updatingStatusCameraId !== null || deletingCameraId !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          void onSetCameraOnline(camera);
                        }}
                      >
                        {updatingStatusCameraId === camera._id ? "Bringing Online..." : "Go Online"}
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      disabled={deletingCameraId !== null || updatingStatusCameraId !== null}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDeleteCamera(camera);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {deletingCameraId === camera._id ? "Deleting..." : "Delete"}
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">{camera.location || "Unassigned location"}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {sourceType === "SYSTEM"
                      ? `system://${camera.deviceId || "default"}`
                      : camera.rtspUrl}
                  </p>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {overlay?.detections.length ? `${overlay.detections.length} active detection(s)` : "No active detections"}
                    </span>
                    <span>
                      {camera.lastActive
                        ? `Last active ${new Date(camera.lastActive).toLocaleTimeString()}`
                        : "No activity yet"}
                    </span>
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
