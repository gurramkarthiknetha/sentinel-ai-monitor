import { FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Camera,
  Maximize2,
  Plus,
  RefreshCcw,
  Trash2,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
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
import {
  createIncident,
  getIncidents,
  resolveFireIncidentConfirmation,
  updateIncidentById,
} from "@/lib/incidentsApi";
import {
  addCamera,
  analyzeCameraFrame,
  deleteCamera,
  getCameras,
  updateCameraStatus,
} from "@/lib/monitoringApi";
import { createMonitoringSocket } from "@/lib/monitoringSocket";
import type { Incident } from "@/store/incidents";
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
  80: "fire",
  81: "smoke",
  82: "stampede",
  83: "medical emergency",
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
const isHttpCameraUrl = (value?: string) => /^https?:\/\//i.test((value || "").trim());

const isLikelyHlsUrl = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes(".m3u8") ||
    normalized.includes("format=m3u8") ||
    normalized.includes("type=hls")
  );
};

const withCacheBuster = (url: string) => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
};

const parseCoordinatesFromLocation = (value?: string) => {
  if (!value) {
    return undefined;
  }

  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) {
    return undefined;
  }

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return undefined;
  }

  return { lat, lng };
};

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

const FIRE_CLASS_ID = 80;
const STAMPEDE_CLASS_ID = 82;
const CONFIRMED_ALERT_CLASS_IDS = new Set([FIRE_CLASS_ID, STAMPEDE_CLASS_ID]);
const FIRE_CONFIDENCE_THRESHOLD = 0.9;
const FIRE_ALERT_STALE_MS = 15000;
const FIRE_ALERT_ROTATE_MS = 6500;
const FIRE_ALERT_SOUND_COOLDOWN_MS = 1800;
const CAMERA_ALERT_MUTE_STORAGE_KEY = "sentinel-monitoring-muted-camera-alerts-v1";

const readMutedCameraAlerts = (): Record<string, true> => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(CAMERA_ALERT_MUTE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const next: Record<string, true> = {};
    for (const [cameraId, isMuted] of Object.entries(parsed)) {
      if (isMuted) {
        next[cameraId] = true;
      }
    }

    return next;
  } catch {
    return {};
  }
};

interface FireAlertState {
  cameraId: string;
  firstDetectedAt: number;
  lastDetectedAt: number;
  latestConfidence: number;
  maxConfidence: number;
  latestFireCount: number;
  latestEventClassId: number;
  triggerCount: number;
}

interface FireWorkflowEventPayload {
  incidentId?: string;
  status?: string;
  confidence?: number;
  zone?: string;
  timestamp?: string;
  incident?: Incident;
}

interface BrowserVideoDevice {
  deviceId: string;
  label: string;
}

type BrowserFrameElement = HTMLVideoElement | HTMLImageElement;

const getConfirmedAlertDetections = (detections: DetectionBox[] | undefined) => {
  if (!Array.isArray(detections)) {
    return [];
  }

  return detections.filter(
    (detection) =>
      CONFIRMED_ALERT_CLASS_IDS.has(detection.class) &&
      detection.confidence >= FIRE_CONFIDENCE_THRESHOLD,
  );
};

const getHighestConfidenceDetection = (detections: DetectionBox[]) => {
  if (detections.length === 0) {
    return undefined;
  }

  return detections.reduce((highest, detection) =>
    detection.confidence > highest.confidence ? detection : highest,
  );
};

const SystemCameraStream = memo(function SystemCameraStream({
  deviceId,
  onFrameElement,
}: {
  deviceId?: string;
  onFrameElement?: (element: BrowserFrameElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onFrameElementRef = useRef(onFrameElement);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onFrameElementRef.current = onFrameElement;
  }, [onFrameElement]);

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
          onFrameElementRef.current?.(videoRef.current);
        }

        setError(null);
      } catch {
        setError("Unable to access system camera. Check permissions and retry.");
      }
    };

    void start();

    return () => {
      cancelled = true;
      onFrameElementRef.current?.(null);
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

const HttpCameraStream = memo(function HttpCameraStream({
  streamUrl,
  onFrameElement,
}: {
  streamUrl: string;
  onFrameElement?: (element: BrowserFrameElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const onFrameElementRef = useRef(onFrameElement);
  const [mode, setMode] = useState<"video" | "image">("video");
  const [imageSrc, setImageSrc] = useState(streamUrl);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onFrameElementRef.current = onFrameElement;
  }, [onFrameElement]);

  useEffect(() => {
    setMode("video");
    setImageSrc(streamUrl);
    setError(null);
  }, [streamUrl]);

  const switchToImageMode = useCallback(
    (nextError?: string) => {
      setMode("image");
      setImageSrc(withCacheBuster(streamUrl));
      if (nextError) {
        setError(nextError);
      }
    },
    [streamUrl],
  );

  useEffect(() => {
    if (mode !== "video") {
      onFrameElementRef.current?.(null);
      return;
    }

    const video = videoRef.current;
    if (!video) {
      onFrameElementRef.current?.(null);
      return;
    }

    onFrameElementRef.current?.(video);

    let cancelled = false;
    let hlsInstance: { destroy: () => void } | null = null;

    const start = async () => {
      const normalizedUrl = streamUrl.trim();
      if (!normalizedUrl) {
        switchToImageMode("Stream URL is empty.");
        return;
      }

      if (isLikelyHlsUrl(normalizedUrl)) {
        const canUseNativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";
        if (!canUseNativeHls) {
          try {
            const hlsModule = await import("hls.js");
            if (cancelled) {
              return;
            }

            const Hls = hlsModule.default;
            if (Hls.isSupported()) {
              const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
              });

              hlsInstance = hls;
              hls.attachMedia(video);

              hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                hls.loadSource(normalizedUrl);
              });

              hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data?.fatal) {
                  switchToImageMode("HLS playback failed. Trying MJPEG fallback.");
                }
              });

              return;
            }
          } catch {
            switchToImageMode("HLS playback is unavailable. Trying MJPEG fallback.");
            return;
          }
        }
      }

      video.src = normalizedUrl;
      video.load();
      await video.play().catch(() => undefined);
    };

    void start();

    return () => {
      cancelled = true;
      onFrameElementRef.current?.(null);
      if (hlsInstance) {
        hlsInstance.destroy();
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [mode, streamUrl, switchToImageMode]);

  useEffect(() => {
    if (mode !== "image") {
      return;
    }

    const image = imageRef.current;
    if (!image) {
      onFrameElementRef.current?.(null);
      return;
    }

    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      onFrameElementRef.current?.(image);
    }

    return () => {
      onFrameElementRef.current?.(null);
    };
  }, [imageSrc, mode]);

  if (mode === "image") {
    return (
      <>
        <img
          ref={imageRef}
          src={imageSrc}
          alt="Camera stream"
          className="absolute inset-0 h-full w-full object-cover"
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            setError(null);
            onFrameElementRef.current?.(event.currentTarget);
          }}
          onError={() => {
            onFrameElementRef.current?.(null);
            setError("Unable to render this HTTP stream in browser mode.");
          }}
        />
        {error ? (
          <div className="absolute inset-x-2 bottom-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white/85">
            {error}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        crossOrigin="anonymous"
        autoPlay
        muted
        playsInline
        onLoadedData={() => setError(null)}
        onError={() => switchToImageMode("Video playback failed. Trying MJPEG fallback.")}
      />
      {error ? (
        <div className="absolute inset-x-2 bottom-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white/85">
          {error}
        </div>
      ) : null}
    </>
  );
});

const CameraViewport = memo(function CameraViewport({
  camera,
  liveDetections,
  onFrameElement,
}: {
  camera: CameraEntity;
  liveDetections?: DetectionUpdateEvent;
  onFrameElement?: (element: BrowserFrameElement | null) => void;
}) {
  const sourceType = camera.sourceType || "RTSP";
  const isSystemCamera = sourceType === "SYSTEM";
  const streamUrl = typeof camera.rtspUrl === "string" ? camera.rtspUrl.trim() : "";
  const supportsBrowserPlayback = !isSystemCamera && isHttpCameraUrl(streamUrl);

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-muted/20">
      {isSystemCamera ? (
        <SystemCameraStream deviceId={camera.deviceId} onFrameElement={onFrameElement} />
      ) : supportsBrowserPlayback ? (
        <HttpCameraStream streamUrl={streamUrl} onFrameElement={onFrameElement} />
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
  const [fireAlerts, setFireAlerts] = useState<Record<string, FireAlertState>>({});
  const [pendingFireConfirmations, setPendingFireConfirmations] = useState<Record<string, Incident>>({});
  const [activeConfirmationIncidentId, setActiveConfirmationIncidentId] = useState<string | null>(null);
  const [confirmingIncidentId, setConfirmingIncidentId] = useState<string | null>(null);
  const [sendingResponderCameraId, setSendingResponderCameraId] = useState<string | null>(null);
  const [mutedCameraAlerts, setMutedCameraAlerts] = useState<Record<string, true>>(() =>
    readMutedCameraAlerts(),
  );

  const camerasRef = useRef<CameraEntity[]>([]);
  const cameraFrameElementsRef = useRef<Record<string, BrowserFrameElement>>({});
  const analysisInFlightRef = useRef<Set<string>>(new Set());
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dispatchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastAnalyzeErrorAtRef = useRef(0);
  const fireAlertOrderRef = useRef<string[]>([]);
  const fireAlertRotationCursorRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const responderAlarmAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastFireAlertToneAtRef = useRef(0);
  const mutedCameraAlertsRef = useRef<Record<string, true>>({});

  const isFocusOpen = focusedCameraId !== null;

  const onlineCount = useMemo(
    () => cameras.filter((camera) => camera.status === "ONLINE").length,
    [cameras],
  );

  const cameraById = useMemo(() => {
    const map = new Map<string, CameraEntity>();
    for (const camera of cameras) {
      map.set(camera._id, camera);
    }
    return map;
  }, [cameras]);

  const prioritizedFireAlerts = useMemo(() => {
    return Object.values(fireAlerts).sort((a, b) => {
      if (b.maxConfidence !== a.maxConfidence) {
        return b.maxConfidence - a.maxConfidence;
      }

      if (b.latestFireCount !== a.latestFireCount) {
        return b.latestFireCount - a.latestFireCount;
      }

      if (b.triggerCount !== a.triggerCount) {
        return b.triggerCount - a.triggerCount;
      }

      return b.lastDetectedAt - a.lastDetectedAt;
    });
  }, [fireAlerts]);

  const activeFireAlertCount = prioritizedFireAlerts.length;
  const primaryFireAlert = prioritizedFireAlerts[0];
  const focusedFireAlert =
    focusedCameraId && fireAlerts[focusedCameraId] ? fireAlerts[focusedCameraId] : undefined;

  const pendingFireConfirmationQueue = useMemo(() => {
    return Object.values(pendingFireConfirmations).sort((a, b) => {
      const confidenceDelta = Number(b.confidence || 0) - Number(a.confidence || 0);
      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }

      return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
    });
  }, [pendingFireConfirmations]);

  const pendingConfirmationCount = pendingFireConfirmationQueue.length;
  const mutedCameraCount = useMemo(
    () => Object.keys(mutedCameraAlerts).length,
    [mutedCameraAlerts],
  );
  const activeConfirmationIncident = useMemo(() => {
    if (pendingFireConfirmationQueue.length === 0) {
      return undefined;
    }

    if (activeConfirmationIncidentId && pendingFireConfirmations[activeConfirmationIncidentId]) {
      return pendingFireConfirmations[activeConfirmationIncidentId];
    }

    return pendingFireConfirmationQueue[0];
  }, [activeConfirmationIncidentId, pendingFireConfirmationQueue, pendingFireConfirmations]);

  const activeConfirmationIndex = useMemo(() => {
    if (!activeConfirmationIncident) {
      return 0;
    }

    return pendingFireConfirmationQueue.findIndex((incident) => incident.id === activeConfirmationIncident.id);
  }, [activeConfirmationIncident, pendingFireConfirmationQueue]);

  const activeConfirmationCamera = useMemo(() => {
    const sourceCameraId = activeConfirmationIncident?.sourceCameraId;
    if (!sourceCameraId) {
      return undefined;
    }

    return cameraById.get(sourceCameraId);
  }, [activeConfirmationIncident?.sourceCameraId, cameraById]);

  const activeConfirmationOverlay = useMemo(() => {
    if (!activeConfirmationCamera?._id) {
      return undefined;
    }

    return liveDetections[activeConfirmationCamera._id];
  }, [activeConfirmationCamera?._id, liveDetections]);

  const playFireAlertTone = useCallback((confidence: number) => {
    const now = Date.now();
    if (now - lastFireAlertToneAtRef.current < FIRE_ALERT_SOUND_COOLDOWN_MS) {
      return;
    }
    lastFireAlertToneAtRef.current = now;

    try {
      const AudioContextCtor = window.AudioContext;
      if (!AudioContextCtor) {
        return;
      }

      const context = audioContextRef.current || new AudioContextCtor();
      audioContextRef.current = context;

      if (context.state === "suspended") {
        void context.resume();
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const clampedConfidence = clamp(confidence);
      const frequency = 660 + clampedConfidence * 320;

      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.34);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.38);
    } catch {
      // Ignore audio failures caused by browser autoplay restrictions.
    }
  }, []);

  const playResponderAlarmSound = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      let alarmAudio = responderAlarmAudioRef.current;
      if (!alarmAudio) {
        alarmAudio = new Audio("/Alarm.mp3");
        alarmAudio.preload = "auto";
        responderAlarmAudioRef.current = alarmAudio;
      }

      alarmAudio.currentTime = 0;
      void alarmAudio.play().catch(() => {
        playFireAlertTone(1);
      });
    } catch {
      playFireAlertTone(1);
    }
  }, [playFireAlertTone]);

  const trackFireAlert = useCallback(
    (payload: DetectionUpdateEvent) => {
      if (mutedCameraAlertsRef.current[payload.cameraId]) {
        return;
      }

      const fireDetections = getConfirmedAlertDetections(payload.detections);

      if (fireDetections.length === 0) {
        return;
      }

      const highestDetection = getHighestConfidenceDetection(fireDetections);
      if (!highestDetection) {
        return;
      }

      const maxConfidence = fireDetections.reduce(
        (highest, detection) => Math.max(highest, detection.confidence),
        0,
      );
      const parsedTimestamp = Date.parse(payload.timestamp || "");
      const detectedAt = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now();

      setFireAlerts((current) => {
        const existing = current[payload.cameraId];
        const nextAlert: FireAlertState = existing
          ? {
              ...existing,
              lastDetectedAt: detectedAt,
              latestConfidence: maxConfidence,
              maxConfidence: Math.max(existing.maxConfidence, maxConfidence),
              latestFireCount: fireDetections.length,
              latestEventClassId: highestDetection.class,
              triggerCount: existing.triggerCount + 1,
            }
          : {
              cameraId: payload.cameraId,
              firstDetectedAt: detectedAt,
              lastDetectedAt: detectedAt,
              latestConfidence: maxConfidence,
              maxConfidence,
              latestFireCount: fireDetections.length,
              latestEventClassId: highestDetection.class,
              triggerCount: 1,
            };

        return {
          ...current,
          [payload.cameraId]: nextAlert,
        };
      });

      setFocusedCameraId(payload.cameraId);
    },
    [],
  );

  const clearFireAlert = useCallback((cameraId: string) => {
    setFireAlerts((current) => {
      if (!current[cameraId]) {
        return current;
      }

      const next = { ...current };
      delete next[cameraId];
      return next;
    });

    setFocusedCameraId((current) => (current === cameraId ? null : current));
  }, []);

  const focusPrimaryFireAlert = useCallback(() => {
    if (primaryFireAlert) {
      setFocusedCameraId(primaryFireAlert.cameraId);
    }
  }, [primaryFireAlert]);

  const focusNextFireAlert = useCallback(() => {
    const alertIds = fireAlertOrderRef.current;
    if (alertIds.length === 0) {
      return;
    }

    setFocusedCameraId((current) => {
      const currentIndex = current ? alertIds.indexOf(current) : -1;
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % alertIds.length : 0;
      fireAlertRotationCursorRef.current = nextIndex + 1;
      return alertIds[nextIndex];
    });
  }, []);

  const acknowledgeFocusedFireAlert = useCallback(() => {
    const targetCameraId = focusedFireAlert?.cameraId || primaryFireAlert?.cameraId;
    if (!targetCameraId) {
      return;
    }

    const targetCameraName = cameraById.get(targetCameraId)?.name || "Camera";
    clearFireAlert(targetCameraId);
    toast({
      title: "Alert acknowledged",
      description: `${targetCameraName} removed from active confirmed alert queue.`,
    });
  }, [cameraById, clearFireAlert, focusedFireAlert?.cameraId, primaryFireAlert?.cameraId, toast]);

  const upsertPendingFireConfirmation = useCallback((incident: Incident) => {
    if (!incident?.id || incident.type !== "fire") {
      return;
    }

    const sourceCameraId = typeof incident.sourceCameraId === "string" ? incident.sourceCameraId : "";
    if (sourceCameraId && mutedCameraAlertsRef.current[sourceCameraId]) {
      setPendingFireConfirmations((current) => {
        if (!current[incident.id]) {
          return current;
        }

        const next = { ...current };
        delete next[incident.id];
        return next;
      });
      return;
    }

    setPendingFireConfirmations((current) => {
      if (incident.status !== "pending_confirmation") {
        if (!current[incident.id]) {
          return current;
        }

        const next = { ...current };
        delete next[incident.id];
        return next;
      }

      return {
        ...current,
        [incident.id]: incident,
      };
    });
  }, []);

  const clearPendingFireConfirmation = useCallback((incidentId: string) => {
    setPendingFireConfirmations((current) => {
      if (!current[incidentId]) {
        return current;
      }

      const next = { ...current };
      delete next[incidentId];
      return next;
    });

    setActiveConfirmationIncidentId((current) => (current === incidentId ? null : current));
  }, []);

  const clearPendingFireConfirmationsByCamera = useCallback((cameraId: string) => {
    setPendingFireConfirmations((current) => {
      let changed = false;
      const next: Record<string, Incident> = {};

      for (const [incidentId, incident] of Object.entries(current)) {
        if (incident.sourceCameraId === cameraId) {
          changed = true;
          continue;
        }

        next[incidentId] = incident;
      }

      return changed ? next : current;
    });
  }, []);

  const toggleCameraAlertMute = useCallback(
    (camera: CameraEntity) => {
      const isMuted = Boolean(mutedCameraAlertsRef.current[camera._id]);

      setMutedCameraAlerts((current) => {
        if (isMuted) {
          if (!current[camera._id]) {
            return current;
          }

          const next = { ...current };
          delete next[camera._id];
          return next;
        }

        return {
          ...current,
          [camera._id]: true,
        };
      });

      if (isMuted) {
        toast({
          title: "Camera alerts unmuted",
          description: `${camera.name} alert notifications are active again.`,
        });
        return;
      }

      clearFireAlert(camera._id);
      clearPendingFireConfirmationsByCamera(camera._id);

      toast({
        title: "Camera alerts muted",
        description: `${camera.name} fire/stampede alerts are temporarily suppressed.`,
      });
    },
    [clearFireAlert, clearPendingFireConfirmationsByCamera, toast],
  );

  const focusNextPendingConfirmation = useCallback(() => {
    if (pendingFireConfirmationQueue.length <= 1) {
      return;
    }

    const currentIndex = activeConfirmationIncident
      ? pendingFireConfirmationQueue.findIndex((incident) => incident.id === activeConfirmationIncident.id)
      : -1;
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % pendingFireConfirmationQueue.length
      : 0;

    setActiveConfirmationIncidentId(pendingFireConfirmationQueue[nextIndex].id);
  }, [activeConfirmationIncident, pendingFireConfirmationQueue]);

  const resolveActiveConfirmation = useCallback(
    async (action: "confirm" | "reject") => {
      if (!activeConfirmationIncident?.id || confirmingIncidentId) {
        return;
      }

      try {
        setConfirmingIncidentId(activeConfirmationIncident.id);
        const updated = await resolveFireIncidentConfirmation(activeConfirmationIncident.id, { action });

        upsertPendingFireConfirmation(updated);
        setActiveConfirmationIncidentId(null);

        if (action === "confirm") {
          playFireAlertTone(Number(updated.confidence || 0));
        }

        toast({
          title: action === "confirm" ? "Alert sent to responders" : "Alert dismissed",
          description:
            action === "confirm"
              ? `${updated.id} has been forwarded to the emergency responder team.`
              : `${updated.id} has been marked as ignored/false alert.`,
        });
      } catch (error) {
        toast({
          title: "Unable to update fire confirmation",
          description: error instanceof Error ? error.message : "Unexpected error",
          variant: "destructive",
        });
      } finally {
        setConfirmingIncidentId(null);
      }
    },
    [activeConfirmationIncident, confirmingIncidentId, playFireAlertTone, toast, upsertPendingFireConfirmation],
  );

  const captureCameraSnapshot = useCallback((cameraId: string) => {
    const frameElement = cameraFrameElementsRef.current[cameraId];
    if (!frameElement) {
      return undefined;
    }

    let sourceWidth = 0;
    let sourceHeight = 0;

    if (frameElement instanceof HTMLVideoElement) {
      if (
        frameElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        frameElement.videoWidth <= 0 ||
        frameElement.videoHeight <= 0
      ) {
        return undefined;
      }

      sourceWidth = frameElement.videoWidth;
      sourceHeight = frameElement.videoHeight;
    } else if (frameElement instanceof HTMLImageElement) {
      if (!frameElement.complete || frameElement.naturalWidth <= 0 || frameElement.naturalHeight <= 0) {
        return undefined;
      }

      sourceWidth = frameElement.naturalWidth;
      sourceHeight = frameElement.naturalHeight;
    } else {
      return undefined;
    }

    try {
      const width = Math.min(960, sourceWidth);
      const height = Math.max(1, Math.round((width * sourceHeight) / sourceWidth));
      let canvas = dispatchCanvasRef.current;

      if (!canvas) {
        canvas = document.createElement("canvas");
        dispatchCanvasRef.current = canvas;
      }

      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) {
        return undefined;
      }

      context.drawImage(frameElement, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", 0.84);
    } catch {
      return undefined;
    }
  }, []);

  const onSendToResponders = useCallback(
    async (camera: CameraEntity) => {
      if (sendingResponderCameraId) {
        return;
      }

      if (mutedCameraAlertsRef.current[camera._id]) {
        toast({
          title: "Camera alerts are muted",
          description: "Unmute this camera to resume alert-driven responder dispatch.",
        });
        return;
      }

      const overlay = liveDetections[camera._id];
      const detections = Array.isArray(overlay?.detections) ? overlay.detections : [];
      const confirmedAlertDetections = getConfirmedAlertDetections(detections);
      const pendingFireForCamera = pendingFireConfirmationQueue.find(
        (incident) =>
          incident.sourceCameraId === camera._id &&
          incident.status === "pending_confirmation" &&
          incident.type === "fire",
      );
      const trackedAlert = fireAlerts[camera._id];

      if (
        confirmedAlertDetections.length === 0 &&
        !pendingFireForCamera &&
        !trackedAlert
      ) {
        toast({
          title: "Confirmation required",
          description:
            "Send to Responders is allowed only after confirmed fire or stampede detection.",
          variant: "destructive",
        });
        return;
      }

      const highestConfirmedDetection = getHighestConfidenceDetection(confirmedAlertDetections);
      const resolvedAlertClassId = pendingFireForCamera
        ? FIRE_CLASS_ID
        : highestConfirmedDetection?.class || trackedAlert?.latestEventClassId || FIRE_CLASS_ID;
      const isStampedeAlert = resolvedAlertClassId === STAMPEDE_CLASS_ID;
      const incidentType = isStampedeAlert ? "crowd" : "fire";
      const responderTeam = isStampedeAlert ? "Crowd Responder Team" : "Fire Responder Team";
      const alertLabel = isStampedeAlert ? "stampede" : "fire";

      const maxConfidenceFromOverlay = confirmedAlertDetections.reduce(
        (maxValue, detection) => Math.max(maxValue, detection.confidence),
        0,
      );
      const fallbackConfidence = trackedAlert?.maxConfidence || FIRE_CONFIDENCE_THRESHOLD;
      const normalizedConfidence = clamp(
        maxConfidenceFromOverlay > 0 ? maxConfidenceFromOverlay : fallbackConfidence,
      );

      const timestampIso =
        (overlay?.timestamp && !Number.isNaN(new Date(overlay.timestamp).getTime())
          ? new Date(overlay.timestamp)
          : new Date()
        ).toISOString();

      const zone = (camera.location || camera.name || "Unassigned zone").trim();
      const parsedLocation = parseCoordinatesFromLocation(camera.location);
      const snapshotBase64 = captureCameraSnapshot(camera._id);
      const detectionOverlayPayload = detections.map((detection) => ({
        classId: detection.class,
        label: getClassLabel(detection.class),
        confidence: Number(detection.confidence.toFixed(4)),
        bbox: detection.bbox,
        bboxFormat: detection.bboxFormat || "xywh",
      }));
      const confirmedAlertOverlayPayload = confirmedAlertDetections.map((detection) => ({
        classId: detection.class,
        label: getClassLabel(detection.class),
        confidence: Number(detection.confidence.toFixed(4)),
      }));

      const predictionDetails = JSON.stringify({
        source: "monitoring_manual_dispatch",
        cameraId: camera._id,
        cameraName: camera.name,
        confirmedAlertType: alertLabel,
        confirmedAlertClassId: resolvedAlertClassId,
        sourceType: camera.sourceType || "RTSP",
        forwardedAt: new Date().toISOString(),
        detectionTimestamp: timestampIso,
        snapshotIncluded: Boolean(snapshotBase64),
        confirmedDetections: confirmedAlertOverlayPayload,
        detections: detectionOverlayPayload,
      });

      const description = `Operator-forwarded ${alertLabel} alert from ${camera.name}`;

      try {
        setSendingResponderCameraId(camera._id);

        if (pendingFireForCamera?.id) {
          await updateIncidentById(pendingFireForCamera.id, {
            confidence: normalizedConfidence,
            zone,
            location: parsedLocation,
            description,
            timestamp: timestampIso,
            detectionMethod: "YOLO",
            predictionDetails,
            snapshotBase64,
            sourceCameraId: camera._id,
            assignedTo: responderTeam,
          });

          const escalatedIncident = await resolveFireIncidentConfirmation(pendingFireForCamera.id, {
            action: "confirm",
          });
          upsertPendingFireConfirmation(escalatedIncident);
        } else {
          const createdIncident = await createIncident({
            type: incidentType,
            severity: normalizedConfidence >= 0.85 ? "critical" : "high",
            status: "escalated",
            confidence: normalizedConfidence,
            zone,
            location: parsedLocation,
            description,
            timestamp: timestampIso,
            assignedTo: responderTeam,
            aiDecision: "auto_escalated",
            detectionMethod: "YOLO",
            predictionDetails,
            snapshotBase64,
            sourceCameraId: camera._id,
            notes: [
              `${new Date().toISOString()} [operator] Manual dispatch triggered from monitoring panel`,
            ],
          });

          upsertPendingFireConfirmation(createdIncident);
        }

        clearFireAlert(camera._id);
        playFireAlertTone(normalizedConfidence);
        toast({
          title: "Sent to responders",
          description: `${camera.name} ${alertLabel} incident was forwarded with live snapshot and overlay metadata.`,
        });
      } catch (error) {
        toast({
          title: "Failed to send responder alert",
          description: error instanceof Error ? error.message : "Unexpected error",
          variant: "destructive",
        });
      } finally {
        setSendingResponderCameraId(null);
      }
    },
    [
      captureCameraSnapshot,
      fireAlerts,
      liveDetections,
      pendingFireConfirmationQueue,
      sendingResponderCameraId,
      playFireAlertTone,
      toast,
      upsertPendingFireConfirmation,
      clearFireAlert,
    ],
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
    mutedCameraAlertsRef.current = mutedCameraAlerts;
  }, [mutedCameraAlerts]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(CAMERA_ALERT_MUTE_STORAGE_KEY, JSON.stringify(mutedCameraAlerts));
    } catch {
      // Ignore storage quota and privacy mode write failures.
    }
  }, [mutedCameraAlerts]);

  useEffect(() => {
    let cancelled = false;

    const loadPendingFireConfirmations = async () => {
      try {
        const incidents = await getIncidents();
        if (cancelled) {
          return;
        }

        const next: Record<string, Incident> = {};
        for (const incident of incidents) {
          const sourceCameraId = typeof incident.sourceCameraId === "string" ? incident.sourceCameraId : "";
          if (incident.type === "fire" && incident.status === "pending_confirmation" && incident.id) {
            if (sourceCameraId && mutedCameraAlertsRef.current[sourceCameraId]) {
              continue;
            }
            next[incident.id] = incident;
          }
        }

        setPendingFireConfirmations(next);
      } catch {
        // Socket updates continue to hydrate pending confirmations when initial fetch fails.
      }
    };

    void loadPendingFireConfirmations();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pendingFireConfirmationQueue.length === 0) {
      setActiveConfirmationIncidentId(null);
      return;
    }

    if (!activeConfirmationIncidentId || !pendingFireConfirmations[activeConfirmationIncidentId]) {
      setActiveConfirmationIncidentId(pendingFireConfirmationQueue[0].id);
    }
  }, [activeConfirmationIncidentId, pendingFireConfirmationQueue, pendingFireConfirmations]);

  useEffect(() => {
    return () => {
      const alarmAudio = responderAlarmAudioRef.current;
      if (alarmAudio) {
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
      }

      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    fireAlertOrderRef.current = prioritizedFireAlerts.map((alert) => alert.cameraId);
    if (fireAlertOrderRef.current.length === 0) {
      fireAlertRotationCursorRef.current = 0;
    }
  }, [prioritizedFireAlerts]);

  useEffect(() => {
    if (activeConfirmationIncident) {
      return;
    }

    if (prioritizedFireAlerts.length === 0) {
      return;
    }

    const activeAlertIds = new Set(prioritizedFireAlerts.map((alert) => alert.cameraId));
    setFocusedCameraId((current) =>
      current && activeAlertIds.has(current) ? current : prioritizedFireAlerts[0].cameraId,
    );
  }, [activeConfirmationIncident, prioritizedFireAlerts]);

  useEffect(() => {
    if (activeConfirmationIncident) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const alertIds = fireAlertOrderRef.current;
      if (alertIds.length <= 1) {
        return;
      }

      setFocusedCameraId((current) => {
        const currentIndex = current ? alertIds.indexOf(current) : -1;
        const nextIndex =
          currentIndex >= 0
            ? (currentIndex + 1) % alertIds.length
            : fireAlertRotationCursorRef.current % alertIds.length;
        fireAlertRotationCursorRef.current = nextIndex + 1;
        return alertIds[nextIndex];
      });
    }, FIRE_ALERT_ROTATE_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeConfirmationIncident]);

  useEffect(() => {
    const pruneStaleAlerts = () => {
      const now = Date.now();

      setFireAlerts((current) => {
        let changed = false;
        const next: Record<string, FireAlertState> = {};

        for (const [cameraId, alert] of Object.entries(current)) {
          if (now - alert.lastDetectedAt <= FIRE_ALERT_STALE_MS) {
            next[cameraId] = alert;
          } else {
            changed = true;
          }
        }

        return changed ? next : current;
      });
    };

    pruneStaleAlerts();
    const intervalId = window.setInterval(pruneStaleAlerts, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

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
    camerasRef.current = cameras;

    const knownCameraIds = new Set(cameras.map((camera) => camera._id));
    setFireAlerts((current) => {
      let changed = false;
      const next: Record<string, FireAlertState> = {};

      for (const [cameraId, alert] of Object.entries(current)) {
        if (knownCameraIds.has(cameraId)) {
          next[cameraId] = alert;
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });

    if (!isLoading) {
      setPendingFireConfirmations((current) => {
        let changed = false;
        const next: Record<string, Incident> = {};

        for (const [incidentId, incident] of Object.entries(current)) {
          if (!incident.sourceCameraId || knownCameraIds.has(incident.sourceCameraId)) {
            next[incidentId] = incident;
          } else {
            changed = true;
          }
        }

        return changed ? next : current;
      });

      setMutedCameraAlerts((current) => {
        let changed = false;
        const next: Record<string, true> = {};

        for (const cameraId of Object.keys(current)) {
          if (knownCameraIds.has(cameraId)) {
            next[cameraId] = true;
          } else {
            changed = true;
          }
        }

        return changed ? next : current;
      });
    }
  }, [cameras, isLoading]);

  const bindCameraFrameElement = useCallback((cameraId: string, element: BrowserFrameElement | null) => {
    if (element) {
      cameraFrameElementsRef.current[cameraId] = element;
      return;
    }

    delete cameraFrameElementsRef.current[cameraId];
    analysisInFlightRef.current.delete(cameraId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const inFlight = analysisInFlightRef.current;

    const runAnalyzeCycle = async () => {
      const activeCameras = camerasRef.current;

      for (const camera of activeCameras) {
        if (cancelled) {
          return;
        }

        const sourceType = camera.sourceType || "RTSP";
        const supportsBrowserFrameCapture = sourceType === "SYSTEM" || isHttpCameraUrl(camera.rtspUrl);
        if (!supportsBrowserFrameCapture) {
          continue;
        }

        if (inFlight.has(camera._id)) {
          continue;
        }

        const frameElement = cameraFrameElementsRef.current[camera._id];
        if (!frameElement) {
          continue;
        }

        let sourceWidth = 0;
        let sourceHeight = 0;

        if (frameElement instanceof HTMLVideoElement) {
          if (
            frameElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            frameElement.videoWidth <= 0 ||
            frameElement.videoHeight <= 0
          ) {
            continue;
          }

          sourceWidth = frameElement.videoWidth;
          sourceHeight = frameElement.videoHeight;
        } else if (frameElement instanceof HTMLImageElement) {
          if (!frameElement.complete || frameElement.naturalWidth <= 0 || frameElement.naturalHeight <= 0) {
            continue;
          }

          sourceWidth = frameElement.naturalWidth;
          sourceHeight = frameElement.naturalHeight;
        } else {
          continue;
        }

        inFlight.add(camera._id);

        try {
          const width = Math.min(640, sourceWidth);
          const height = Math.max(1, Math.round((width * sourceHeight) / sourceWidth));

          let canvas = captureCanvasRef.current;
          if (!canvas) {
            canvas = document.createElement("canvas");
            captureCanvasRef.current = canvas;
          }

          canvas.width = width;
          canvas.height = height;

          const context = canvas.getContext("2d");
          if (!context) {
            continue;
          }

          context.drawImage(frameElement, 0, 0, width, height);
          const imageBase64 = canvas.toDataURL("image/jpeg", 0.72);

          await analyzeCameraFrame(camera._id, imageBase64);
        } catch (error) {
          const now = Date.now();
          if (now - lastAnalyzeErrorAtRef.current > 12000) {
            lastAnalyzeErrorAtRef.current = now;
            const description =
              error instanceof DOMException && error.name === "SecurityError"
                ? "Browser blocked frame capture for this stream. Enable CORS on the camera gateway."
                : error instanceof Error
                  ? error.message
                  : "Unexpected error";
            toast({
              title: "YOLO analysis temporarily unavailable",
              description,
              variant: "destructive",
            });
          }
        } finally {
          inFlight.delete(camera._id);
        }
      }
    };

    void runAnalyzeCycle();

    const intervalId = window.setInterval(() => {
      void runAnalyzeCycle();
    }, 2200);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      inFlight.clear();
    };
  }, [toast]);

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

      trackFireAlert(payload);
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
        clearFireAlert(payload.cameraId);
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
      clearFireAlert(payload.cameraId);
      clearPendingFireConfirmationsByCamera(payload.cameraId);
    };

    const onIncidentUpsert = (payload: Incident) => {
      if (!payload?.id || payload.type !== "fire") {
        return;
      }

      upsertPendingFireConfirmation(payload);
    };

    const onFireConfirmationRequested = (payload: FireWorkflowEventPayload) => {
      if (payload?.incident?.id) {
        upsertPendingFireConfirmation(payload.incident);
        return;
      }

      if (payload?.incidentId && payload.status && payload.status !== "pending_confirmation") {
        clearPendingFireConfirmation(payload.incidentId);
      }
    };

    const onFireWorkflowUpdated = (payload: FireWorkflowEventPayload) => {
      if (payload?.incident?.id) {
        upsertPendingFireConfirmation(payload.incident);
        return;
      }

      if (payload?.incidentId && payload.status && payload.status !== "pending_confirmation") {
        clearPendingFireConfirmation(payload.incidentId);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onDisconnect);
    socket.on("detection:update", onDetectionUpdate);
    socket.on("camera:status", onCameraStatus);
    socket.on("camera:deleted", onCameraDeleted);
    socket.on("incident:created", onIncidentUpsert);
    socket.on("incident:updated", onIncidentUpsert);
    socket.on("fire:confirmation_requested", onFireConfirmationRequested);
    socket.on("fire:workflow_updated", onFireWorkflowUpdated);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect);
      socket.off("detection:update", onDetectionUpdate);
      socket.off("camera:status", onCameraStatus);
      socket.off("camera:deleted", onCameraDeleted);
      socket.off("incident:created", onIncidentUpsert);
      socket.off("incident:updated", onIncidentUpsert);
      socket.off("fire:confirmation_requested", onFireConfirmationRequested);
      socket.off("fire:workflow_updated", onFireWorkflowUpdated);
      socket.disconnect();
    };
  }, [
    clearFireAlert,
    clearPendingFireConfirmation,
    clearPendingFireConfirmationsByCamera,
    toast,
    trackFireAlert,
    upsertPendingFireConfirmation,
  ]);

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
      clearFireAlert(camera._id);
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
            Live camera grid with Socket.IO status updates and YOLOv8 bounding boxes
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

          {activeFireAlertCount > 0 ? (
            <Badge
              variant="destructive"
              className="animate-pulse border-destructive/80 bg-destructive text-destructive-foreground"
            >
              <AlertTriangle className="mr-1 h-3 w-3" />
              {activeFireAlertCount} confirmed alert{activeFireAlertCount > 1 ? "s" : ""}
            </Badge>
          ) : null}

          {pendingConfirmationCount > 0 ? (
            <Badge variant="outline" className="border-destructive/60 text-destructive">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {pendingConfirmationCount} awaiting responder confirmation
            </Badge>
          ) : null}

          {mutedCameraCount > 0 ? (
            <Badge variant="outline" className="border-warning/60 text-warning">
              <VolumeX className="mr-1 h-3 w-3" />
              {mutedCameraCount} muted camera{mutedCameraCount > 1 ? "s" : ""}
            </Badge>
          ) : null}

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
                  Add either an RTSP/HTTP stream or a local system webcam.
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
                      <SelectItem value="RTSP">RTSP / IP / HTTP Camera</SelectItem>
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
                    <Label htmlFor="rtspUrl">Stream URL</Label>
                    <Input
                      id="rtspUrl"
                      name="rtspUrl"
                      placeholder="rtsp://username:password@192.168.1.20:554/stream1 or https://cam.staysync.io/be/live/"
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
            No cameras configured yet. Add your first RTSP/IP/HTTP camera to begin monitoring.
          </p>
        </Card>
      ) : null}

      {activeFireAlertCount > 0 ? (
        <Card className="border-destructive/70 bg-destructive/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4 animate-pulse" />
                FIRE / STAMPEDE DETECTED in {activeFireAlertCount} camera{activeFireAlertCount > 1 ? "s" : ""}
              </p>
              {primaryFireAlert ? (
                <p className="mt-1 text-xs text-destructive/90">
                  Primary alert focus: {cameraById.get(primaryFireAlert.cameraId)?.name || "Unknown camera"} ({Math.round(
                    primaryFireAlert.maxConfidence * 100,
                  )}% confidence)
                </p>
              ) : null}
              {activeFireAlertCount > 1 ? (
                <p className="mt-1 text-[11px] text-destructive/80">
                  Multiple incidents active. Main focus auto-rotates every {Math.round(FIRE_ALERT_ROTATE_MS / 1000)} seconds.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="destructive" onClick={focusPrimaryFireAlert}>
                <AlertTriangle className="mr-1.5 h-3.5 w-3.5" /> Focus Primary
              </Button>

              {activeFireAlertCount > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={focusNextFireAlert}
                >
                  Next Alert
                </Button>
              ) : null}

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={acknowledgeFocusedFireAlert}
              >
                Acknowledge Current
              </Button>
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {prioritizedFireAlerts.map((alert, index) => {
              const camera = cameraById.get(alert.cameraId);
              const isActive = focusedCameraId === alert.cameraId;

              return (
                <button
                  key={alert.cameraId}
                  type="button"
                  onClick={() => setFocusedCameraId(alert.cameraId)}
                  className={cn(
                    "rounded border px-3 py-2 text-left transition",
                    isActive
                      ? "border-destructive bg-destructive text-destructive-foreground"
                      : "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/15",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold uppercase tracking-wide">
                      #{index + 1} {camera?.name || "Unknown camera"}
                    </span>
                    <span className="text-[11px] font-mono">{Math.round(alert.latestConfidence * 100)}%</span>
                  </div>
                  <p className="mt-1 text-[11px] opacity-90">
                    {alert.latestFireCount} confirmed event{alert.latestFireCount === 1 ? "" : "s"} | last seen{" "}
                    {new Date(alert.lastDetectedAt).toLocaleTimeString()}
                  </p>
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      {activeConfirmationIncident ? (
        <Dialog open>
          <DialogContent
            className="max-w-4xl border-destructive/60 [&>button]:hidden"
            onEscapeKeyDown={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5 animate-pulse" /> Fire Alert - Confirmation Required
              </DialogTitle>
              <DialogDescription>
                Review the live feed and confirm whether this alert should be forwarded to responders.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
              <div className="space-y-2">
                {activeConfirmationCamera ? (
                  <CameraViewport camera={activeConfirmationCamera} liveDetections={activeConfirmationOverlay} />
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-lg border border-destructive/40 bg-destructive/5 text-sm text-destructive">
                    Live feed unavailable for this alert.
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Incident {activeConfirmationIncident.id} | Queue {Math.max(activeConfirmationIndex + 1, 1)}/
                  {pendingConfirmationCount}
                </p>
              </div>

              <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Fire Alert</p>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Camera</span>
                    <span className="text-right font-medium">
                      {activeConfirmationCamera?.name || activeConfirmationIncident.sourceCameraId || "Unknown camera"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Location</span>
                    <span className="text-right font-medium">
                      {activeConfirmationCamera?.location || activeConfirmationIncident.zone || "Unassigned location"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Timestamp</span>
                    <span className="text-right font-medium">
                      {new Date(activeConfirmationIncident.timestamp || Date.now()).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Confidence</span>
                    <span className="text-right font-medium">
                      {Math.round(Number(activeConfirmationIncident.confidence || 0) * 100)}%
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant="destructive" className="text-[11px]">
                      Fire Alert
                    </Badge>
                  </div>
                </div>

                {pendingConfirmationCount > 1 ? (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Pending Queue
                    </p>

                    <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                      {pendingFireConfirmationQueue.map((incident, index) => {
                        const isActive = incident.id === activeConfirmationIncident.id;
                        const queueCameraName =
                          (incident.sourceCameraId && cameraById.get(incident.sourceCameraId)?.name) ||
                          incident.zone ||
                          "Unknown camera";

                        return (
                          <button
                            key={incident.id}
                            type="button"
                            onClick={() => setActiveConfirmationIncidentId(incident.id)}
                            className={cn(
                              "w-full rounded border px-2 py-1 text-left text-[11px] transition",
                              isActive
                                ? "border-destructive bg-destructive text-destructive-foreground"
                                : "border-destructive/30 bg-background/70 text-foreground hover:border-destructive/50",
                            )}
                          >
                            #{index + 1} {queueCameraName} ({Math.round(Number(incident.confidence || 0) * 100)}%)
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={confirmingIncidentId !== null}
                onClick={() => {
                  void resolveActiveConfirmation("confirm");
                }}
              >
                Send Alert to Responders
              </Button>

              <Button
                type="button"
                variant="outline"
                className="border-warning/50 text-warning hover:bg-warning/10 hover:text-warning"
                disabled={confirmingIncidentId !== null}
                onClick={() => {
                  void resolveActiveConfirmation("reject");
                }}
              >
                Dismiss / Ignore
              </Button>

              {pendingConfirmationCount > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={confirmingIncidentId !== null}
                  onClick={focusNextPendingConfirmation}
                >
                  View Next Alert
                </Button>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
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
          const fireAlert = fireAlerts[camera._id];
          const isFireAlert = Boolean(fireAlert);
          const sourceType = camera.sourceType || "RTSP";
          const isSystemCamera = sourceType === "SYSTEM";
          const displaySourceType = isSystemCamera
            ? "SYSTEM"
            : isHttpCameraUrl(camera.rtspUrl)
            ? "HTTP"
            : "RTSP";
          const isFocused = focusedCameraId === camera._id;
          const dimmed = isFocusOpen && !isFocused;
          const isSendingResponderAlert = sendingResponderCameraId === camera._id;
          const isAlertsMuted = Boolean(mutedCameraAlerts[camera._id]);

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
                isFireAlert && !isFocused && "z-10",
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
                  isFireAlert && !isFocused &&
                    "border-destructive/70 shadow-[0_0_0_1px_rgba(239,68,68,0.35),0_0_30px_rgba(239,68,68,0.18)]",
                  isFireAlert && isFocused && "border-destructive shadow-[0_0_40px_rgba(239,68,68,0.32)]",
                  isAlertsMuted && !isFireAlert && "border-warning/40",
                  !isFocused && "cursor-zoom-in hover:border-primary/50",
                  isFocused && "w-full max-w-6xl cursor-default border-primary/60 shadow-2xl",
                )}
              >
                <div className="relative p-3 pb-0">
                  <CameraViewport
                    camera={camera}
                    liveDetections={overlay}
                    onFrameElement={(element) => bindCameraFrameElement(camera._id, element)}
                  />

                  {isFireAlert && fireAlert ? (
                    <div className="pointer-events-none absolute left-6 top-6 z-10 inline-flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-destructive-foreground shadow-lg animate-pulse">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {getClassLabel(fireAlert.latestEventClassId)} {Math.round(fireAlert.latestConfidence * 100)}%
                    </div>
                  ) : null}

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
                        {displaySourceType}
                      </Badge>
                      {isAlertsMuted ? (
                        <Badge variant="outline" className="border-warning/60 text-[10px] text-warning">
                          <VolumeX className="mr-1 h-3 w-3" /> Muted
                        </Badge>
                      ) : null}
                      {isFireAlert ? (
                        <Badge variant="destructive" className="animate-pulse text-[10px]">
                          Fire Alert
                        </Badge>
                      ) : null}
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-7 whitespace-nowrap px-2 text-[11px]",
                        isAlertsMuted
                          ? "border-warning/60 text-warning hover:bg-warning/10 hover:text-warning"
                          : "border-warning/40 text-warning hover:bg-warning/10 hover:text-warning",
                      )}
                      disabled={sendingResponderCameraId !== null}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleCameraAlertMute(camera);
                      }}
                    >
                      {isAlertsMuted ? (
                        <>
                          <Volume2 className="mr-1 h-3.5 w-3.5" /> Unmute Alerts
                        </>
                      ) : (
                        <>
                          <VolumeX className="mr-1 h-3.5 w-3.5" /> Mute Camera Alerts
                        </>
                      )}
                    </Button>

                    {isFireAlert ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 bg-destructive px-2 text-[11px] text-destructive-foreground hover:bg-destructive/90"
                        disabled={
                          deletingCameraId !== null ||
                          updatingStatusCameraId !== null ||
                          sendingResponderCameraId !== null
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          playResponderAlarmSound();
                          void onSendToResponders(camera);
                        }}
                      >
                        {isSendingResponderAlert ? "Sending..." : "Send to Responders"}
                      </Button>
                    ) : null}

                    {isFireAlert ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 border-destructive/50 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={sendingResponderCameraId !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          clearFireAlert(camera._id);
                        }}
                      >
                        Acknowledge
                      </Button>
                    ) : null}

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
                  {isAlertsMuted ? (
                    <p className="text-[11px] text-warning">Camera alerts muted for fire/stampede events.</p>
                  ) : null}
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {sourceType === "SYSTEM"
                      ? `system://${camera.deviceId || "default"}`
                      : camera.rtspUrl}
                  </p>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {isFireAlert && fireAlert
                        ? `${fireAlert.latestFireCount} confirmed event(s), ${Math.round(fireAlert.maxConfidence * 100)}% max confidence`
                        : overlay?.detections.length
                          ? `${overlay.detections.length} active detection(s)`
                          : "No active detections"}
                    </span>
                    <span>
                      {isFireAlert && fireAlert
                        ? `Alert seen ${new Date(fireAlert.firstDetectedAt).toLocaleTimeString()}`
                        : camera.lastActive
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
