import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Flame, Siren } from "lucide-react";
import { useLocation } from "react-router-dom";
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
  confirmationDeadline?: string;
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

  if (!payload.incidentId) {
    return null;
  }

  return {
    incidentId: payload.incidentId,
    confidence: normalizeConfidence(payload.confidence),
    zone: payload.zone || "Unspecified zone",
    confirmationDeadline: deadline || undefined,
  };
};

export function FireEscalationRealtime() {
  const { toast } = useToast();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const [pendingPrompt, setPendingPrompt] = useState<FirePromptState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());

  const isOperator = user?.role === "operator";
  const isFireResponder = user?.role === "responder" && user.responderType === "fire";
  const isMonitoringRoute = location.pathname === "/monitoring";

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
    if (!pendingPrompt?.confirmationDeadline) {
      return null;
    }

    const deadlineMs = new Date(pendingPrompt.confirmationDeadline).getTime();
    if (!Number.isFinite(deadlineMs)) {
      return null;
    }

    return Math.max(0, Math.ceil((deadlineMs - clockNowMs) / 1000));
  }, [clockNowMs, pendingPrompt]);

  const hasCountdown = secondsRemaining !== null;

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

      if (
        payload.type === "fire" &&
        payload.status === "pending_confirmation" &&
        isOperator &&
        !isMonitoringRoute
      ) {
        const deadline =
          typeof payload.confirmationDeadline === "string" && payload.confirmationDeadline.trim()
            ? payload.confirmationDeadline
            : undefined;

        setPendingPrompt({
          incidentId: payload.id,
          confidence: normalizeConfidence(payload.confidence),
          zone: payload.zone || "Unspecified zone",
          confirmationDeadline: deadline,
        });
      }

      if (payload.status !== "pending_confirmation" && pendingPrompt?.incidentId === payload.id) {
        setPendingPrompt(null);
      }
    };

    const onConfirmationRequested = (payload: FireRealtimePayload) => {
      if (!isOperator || isMonitoringRoute) {
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

    };

    const onResponderAlert = (payload: FireRealtimePayload) => {
      if (!isFireResponder || !payload.incidentId) {
        return;
      }

      if (payload.incident && payload.incident.id) {
        upsertIncidentInStore(payload.incident);
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
  }, [isFireResponder, isMonitoringRoute, isOperator, pendingPrompt?.incidentId, toast]);

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

  if (!isOperator || !pendingPrompt || isMonitoringRoute) {
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
            Confirm action for incident {pendingPrompt.incidentId}. Escalation to responders happens only
            after operator confirmation.
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
            {hasCountdown ? (
              <Badge variant="outline" className="border-destructive/60 text-destructive">
                <Siren className="mr-1 h-3.5 w-3.5" /> {secondsRemaining}s
              </Badge>
            ) : (
              <Badge variant="outline" className="border-warning/60 text-warning">
                Manual confirmation required
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            className="flex-1"
            disabled={isSubmitting || (hasCountdown && (secondsRemaining || 0) <= 0)}
            onClick={() => {
              void resolveConfirmation("confirm");
            }}
          >
            Confirm and escalate
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-warning/50 text-warning"
            disabled={isSubmitting || (hasCountdown && (secondsRemaining || 0) <= 0)}
            onClick={() => {
              void resolveConfirmation("reject");
            }}
          >
            Reject as false alert
          </Button>
        </div>

        {hasCountdown && (secondsRemaining || 0) <= 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Escalating automatically...
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
