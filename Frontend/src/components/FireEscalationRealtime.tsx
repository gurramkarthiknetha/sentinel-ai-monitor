import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Flame, Siren } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { resolveFireIncidentConfirmation } from "@/lib/incidentsApi";
import { createMonitoringSocket } from "@/lib/monitoringSocket";
import { useAuthStore } from "@/store/auth";
import { useIncidentStore, type Incident } from "@/store/incidents";

interface FireRealtimePayload {
  incidentId: string;
  status?: string;
  confidence?: number;
  zone?: string;
  confirmationDeadline?: string | null;
  mode?: string;
  incident?: Incident;
}

interface FirePromptState {
  incidentId: string;
  confidence: number;
  zone: string;
  confirmationDeadline: string;
}

const upsertIncidentInStore = (incoming: Incident) => {
  useIncidentStore.setState((state) => {
    const existingIndex = state.incidents.findIndex((incident) => incident.id === incoming.id);

    if (existingIndex === -1) {
      return {
        incidents: [incoming, ...state.incidents],
      };
    }

    const nextIncidents = [...state.incidents];
    nextIncidents[existingIndex] = incoming;

    return {
      incidents: nextIncidents,
    };
  });
};

const normalizeConfidence = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  if (parsed >= 0 && parsed <= 1) {
    return parsed;
  }

  if (parsed > 1 && parsed <= 100) {
    return parsed / 100;
  }

  return 0;
};

const extractPromptState = (payload: FireRealtimePayload): FirePromptState | null => {
  const deadline =
    typeof payload.confirmationDeadline === "string" && payload.confirmationDeadline.trim()
      ? payload.confirmationDeadline
      : "";

  if (!payload.incidentId || !deadline) {
    return null;
  }

  return {
    incidentId: payload.incidentId,
    confidence: normalizeConfidence(payload.confidence),
    zone: payload.zone || "Unspecified zone",
    confirmationDeadline: deadline,
  };
};

export function FireEscalationRealtime() {
  const { toast } = useToast();
  const user = useAuthStore((state) => state.user);
  const [pendingPrompt, setPendingPrompt] = useState<FirePromptState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());

  const alarmRef = useRef<HTMLAudioElement | null>(null);
  const escalatedAlarmedIdsRef = useRef<Set<string>>(new Set());

  const isOperator = user?.role === "operator";
  const isFireResponder = user?.role === "responder" && user.responderType === "fire";

  const playAlarm = useCallback(async () => {
    if (!alarmRef.current) {
      return;
    }

    try {
      alarmRef.current.currentTime = 0;
      await alarmRef.current.play();
    } catch {
      // Browsers can block autoplay without prior user gesture.
    }
  }, []);

  useEffect(() => {
    const audio = new Audio("/Alarm.mp3");
    audio.preload = "auto";
    alarmRef.current = audio;

    return () => {
      if (alarmRef.current) {
        alarmRef.current.pause();
        alarmRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingPrompt) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pendingPrompt]);

  const secondsRemaining = useMemo(() => {
    if (!pendingPrompt) {
      return 0;
    }

    const deadlineMs = new Date(pendingPrompt.confirmationDeadline).getTime();
    if (!Number.isFinite(deadlineMs)) {
      return 0;
    }

    return Math.max(0, Math.ceil((deadlineMs - clockNowMs) / 1000));
  }, [clockNowMs, pendingPrompt]);

  useEffect(() => {
    let socket: ReturnType<typeof createMonitoringSocket> | undefined;

    try {
      socket = createMonitoringSocket();
    } catch {
      return undefined;
    }

    const handleIncidentUpsert = (payload: Incident) => {
      if (!payload?.id) {
        return;
      }

      upsertIncidentInStore(payload);

      if (payload.type === "fire" && payload.status === "pending_confirmation" && isOperator) {
        const deadline =
          typeof payload.confirmationDeadline === "string" && payload.confirmationDeadline.trim()
            ? payload.confirmationDeadline
            : new Date(Date.now() + 10_000).toISOString();

        setPendingPrompt({
          incidentId: payload.id,
          confidence: normalizeConfidence(payload.confidence),
          zone: payload.zone || "Unspecified zone",
          confirmationDeadline: deadline,
        });
      }

      if (
        payload.type === "fire" &&
        payload.status === "escalated" &&
        (isOperator || isFireResponder) &&
        !escalatedAlarmedIdsRef.current.has(payload.id)
      ) {
        escalatedAlarmedIdsRef.current.add(payload.id);
        void playAlarm();
      }

      if (payload.status !== "pending_confirmation" && pendingPrompt?.incidentId === payload.id) {
        setPendingPrompt(null);
      }
    };

    const onConfirmationRequested = (payload: FireRealtimePayload) => {
      if (!isOperator) {
        return;
      }

      if (payload.incident?.id) {
        upsertIncidentInStore(payload.incident);
      }

      const prompt = extractPromptState(payload);
      if (prompt) {
        setPendingPrompt(prompt);
      }
    };

    const onWorkflowUpdated = (payload: FireRealtimePayload) => {
      if (payload.incident?.id) {
        upsertIncidentInStore(payload.incident);
      }

      if (payload.status !== "pending_confirmation" && pendingPrompt?.incidentId === payload.incidentId) {
        setPendingPrompt(null);
      }

      if (
        payload.status === "escalated" &&
        payload.incidentId &&
        (isOperator || isFireResponder) &&
        !escalatedAlarmedIdsRef.current.has(payload.incidentId)
      ) {
        escalatedAlarmedIdsRef.current.add(payload.incidentId);
        void playAlarm();
      }
    };

    const onResponderAlert = (payload: FireRealtimePayload) => {
      if (!isFireResponder || !payload.incidentId) {
        return;
      }

      if (payload.incident && payload.incident.id) {
        upsertIncidentInStore(payload.incident);
      }

      if (!escalatedAlarmedIdsRef.current.has(payload.incidentId)) {
        escalatedAlarmedIdsRef.current.add(payload.incidentId);
        void playAlarm();
      }

      toast({
        title: "Fire escalation alert",
        description: `${payload.incidentId} escalated for fire response`,
        variant: "destructive",
      });
    };

    socket.on("incident:created", handleIncidentUpsert);
    socket.on("incident:updated", handleIncidentUpsert);
    socket.on("fire:confirmation_requested", onConfirmationRequested);
    socket.on("fire:workflow_updated", onWorkflowUpdated);
    socket.on("fire:responder_alert", onResponderAlert);

    return () => {
      socket?.off("incident:created", handleIncidentUpsert);
      socket?.off("incident:updated", handleIncidentUpsert);
      socket?.off("fire:confirmation_requested", onConfirmationRequested);
      socket?.off("fire:workflow_updated", onWorkflowUpdated);
      socket?.off("fire:responder_alert", onResponderAlert);
      socket?.disconnect();
    };
  }, [isFireResponder, isOperator, pendingPrompt?.incidentId, playAlarm, toast]);

  const resolveConfirmation = useCallback(
    async (action: "confirm" | "reject") => {
      if (!pendingPrompt) {
        return;
      }

      try {
        setIsSubmitting(true);
        const updated = await resolveFireIncidentConfirmation(pendingPrompt.incidentId, { action });
        upsertIncidentInStore(updated);
        setPendingPrompt(null);
      } catch (error) {
        toast({
          title: "Unable to update fire workflow",
          description: error instanceof Error ? error.message : "Unexpected error",
          variant: "destructive",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [pendingPrompt, toast],
  );

  if (!isOperator || !pendingPrompt) {
    return null;
  }

  return (
    <Dialog open>
      <DialogContent
        className="max-w-md border-destructive/50"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Flame className="h-5 w-5" />
            High-confidence fire detected
          </DialogTitle>
          <DialogDescription>
            Confirm action for incident {pendingPrompt.incidentId}. If no response is received in 10 seconds,
            the system auto-escalates to fire responders.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Location</span>
            <span className="font-medium">{pendingPrompt.zone}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Confidence</span>
            <span className="font-medium">{Math.round(pendingPrompt.confidence * 100)}%</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Countdown</span>
            <Badge variant="outline" className="border-destructive/60 text-destructive">
              <Siren className="mr-1 h-3.5 w-3.5" /> {secondsRemaining}s
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            className="flex-1"
            disabled={isSubmitting || secondsRemaining <= 0}
            onClick={() => {
              void resolveConfirmation("confirm");
            }}
          >
            Confirm and escalate
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-warning/50 text-warning"
            disabled={isSubmitting || secondsRemaining <= 0}
            onClick={() => {
              void resolveConfirmation("reject");
            }}
          >
            Reject as false alert
          </Button>
        </div>

        {secondsRemaining <= 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Escalating automatically...
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
