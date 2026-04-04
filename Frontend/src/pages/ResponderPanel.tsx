import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MapPin,
  ShieldAlert,
  UserCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getIncidents, respondToIncident, type ResponderIncidentActionInput } from "@/lib/incidentsApi";
import { createMonitoringSocket } from "@/lib/monitoringSocket";
import { cn } from "@/lib/utils";
import { useAuthStore, type ResponderType } from "@/store/auth";
import {
  useIncidentStore,
  type Incident,
  type IncidentStatus,
  type IncidentType,
  type Severity,
} from "@/store/incidents";

type QueueStatus = "pending" | "in_progress" | "resolved";
type PriorityLevel = "critical" | "high" | "medium" | "low";

const QUEUE_STATUS_LABELS: Record<IncidentStatus, QueueStatus> = {
  active: "pending",
  pending_confirmation: "pending",
  escalated: "pending",
  assigned: "pending",
  in_progress: "in_progress",
  resolved: "resolved",
};

const PRIORITY_BADGE_CLASS: Record<PriorityLevel, string> = {
  critical: "border-destructive/70 text-destructive",
  high: "border-warning/70 text-warning",
  medium: "border-primary/60 text-primary",
  low: "border-muted-foreground/40 text-muted-foreground",
};

const PRIORITY_CARD_CLASS: Record<PriorityLevel, string> = {
  critical: "border-destructive/70 bg-destructive/5",
  high: "border-warning/50 bg-warning/5",
  medium: "border-primary/40 bg-primary/5",
  low: "border-border bg-card",
};

const TYPE_LABEL: Record<IncidentType, string> = {
  fire: "Fire",
  crowd: "Crowd",
  medical: "Medical",
  security: "Security",
  inactivity: "Inactivity",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const RESPONDER_TYPE_LABEL: Record<ResponderType, string> = {
  medical: "Medical Responder",
  fire: "Fire Responder",
  crowd: "Crowd Control Responder",
  inactivity: "Inactivity Monitor Responder",
};

const AI_DECISION_LABELS: Record<string, string> = {
  needs_human_validation: "Needs Human Validation",
  auto_resolved: "Auto Resolved",
  auto_escalated: "Auto Escalated",
};

const DETECTION_METHOD_LABELS: Record<string, string> = {
  YOLO: "YOLO",
  POSE: "Pose",
  CNN: "CNN",
  HYBRID: "Hybrid",
};

const LOW_CONFIDENCE_THRESHOLD = 0.6;

const formatDateTime = (value?: string) => {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString();
};

const toPercent = (value: number) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

const getPriorityScore = (incident: Incident) => {
  let score = 0;

  if (incident.type === "fire" || incident.type === "medical") {
    score += 2;
  } else if (incident.type === "crowd" || incident.type === "inactivity") {
    score += 1;
  }

  if (incident.severity === "critical") {
    score += 3;
  } else if (incident.severity === "high") {
    score += 2;
  } else if (incident.severity === "medium") {
    score += 1;
  }

  if (incident.confidence < 0.45) {
    score += 2;
  } else if (incident.confidence < 0.65) {
    score += 1;
  }

  return score;
};

const getPriority = (incident: Incident): PriorityLevel => {
  const score = getPriorityScore(incident);

  if (score >= 5) {
    return "critical";
  }

  if (score >= 4) {
    return "high";
  }

  if (score >= 2) {
    return "medium";
  }

  return "low";
};

const getSnapshotSource = (incident: Incident) => {
  if (incident.snapshotUrl) {
    return incident.snapshotUrl;
  }

  if (!incident.snapshotBase64) {
    return "";
  }

  const trimmed = incident.snapshotBase64.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("data:") ? trimmed : `data:image/jpeg;base64,${trimmed}`;
};

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

export default function ResponderPanelPage() {
  const { toast } = useToast();
  const user = useAuthStore((state) => state.user);

  const incidents = useIncidentStore((state) => state.incidents);
  const setIncidents = useIncidentStore((state) => state.setIncidents);

  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | QueueStatus>("all");
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [busyActionKey, setBusyActionKey] = useState("");

  const initializedRef = useRef(false);
  const knownIncidentIdsRef = useRef<Set<string>>(new Set());

  const responderType = user?.responderType || null;

  const loadQueue = useCallback(
    async (silent = false) => {
      try {
        if (!silent) {
          setIsLoading(true);
        } else {
          setIsSyncing(true);
        }

        const latest = await getIncidents();
        setIncidents(latest);

        latest.forEach((incident) => {
          knownIncidentIdsRef.current.add(incident.id);
        });
      } catch (error) {
        if (!silent) {
          toast({
            title: "Unable to load incidents",
            description: error instanceof Error ? error.message : "Unexpected error",
            variant: "destructive",
          });
        }
      } finally {
        if (!silent) {
          setIsLoading(false);
        } else {
          setIsSyncing(false);
        }
      }
    },
    [setIncidents, toast],
  );

  useEffect(() => {
    void loadQueue(false);

    const interval = window.setInterval(() => {
      void loadQueue(true);
    }, 12000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadQueue]);

  useEffect(() => {
    if (!initializedRef.current && incidents.length > 0) {
      initializedRef.current = true;
      setSelectedIncidentId(incidents[0].id);
      return;
    }

    if (!selectedIncidentId && incidents.length > 0) {
      setSelectedIncidentId(incidents[0].id);
      return;
    }

    if (selectedIncidentId && !incidents.some((incident) => incident.id === selectedIncidentId)) {
      setSelectedIncidentId(incidents[0]?.id || null);
    }
  }, [incidents, selectedIncidentId]);

  useEffect(() => {
    let socket: ReturnType<typeof createMonitoringSocket> | undefined;

    try {
      socket = createMonitoringSocket();
    } catch (error) {
      toast({
        title: "Realtime unavailable",
        description: error instanceof Error ? error.message : "Unexpected socket error",
        variant: "destructive",
      });
      return;
    }

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    const onIncidentCreated = (payload: Incident) => {
      if (!payload?.id) {
        return;
      }

      upsertIncidentInStore(payload);

      const isKnown = knownIncidentIdsRef.current.has(payload.id);
      knownIncidentIdsRef.current.add(payload.id);

      if (!isKnown) {
        const priority = getPriority(payload);
        const isUrgent = priority === "critical" || priority === "high";

        toast({
          title: isUrgent ? "High-priority alert assigned" : "New incident assigned",
          description: `${payload.id} • ${TYPE_LABEL[payload.type]} • ${payload.zone}`,
          variant: isUrgent ? "destructive" : undefined,
        });
      }
    };

    const onIncidentUpdated = (payload: Incident) => {
      if (!payload?.id) {
        return;
      }

      knownIncidentIdsRef.current.add(payload.id);
      upsertIncidentInStore(payload);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onDisconnect);
    socket.on("incident:created", onIncidentCreated);
    socket.on("incident:updated", onIncidentUpdated);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect);
      socket.off("incident:created", onIncidentCreated);
      socket.off("incident:updated", onIncidentUpdated);
      socket.disconnect();
    };
  }, [toast]);

  const selectedIncident = useMemo(
    () => incidents.find((incident) => incident.id === selectedIncidentId) || null,
    [incidents, selectedIncidentId],
  );

  const queueRows = useMemo(() => {
    const lowered = query.trim().toLowerCase();

    return incidents
      .filter((incident) => {
        const queueStatus = QUEUE_STATUS_LABELS[incident.status];

        if (statusFilter !== "all" && queueStatus !== statusFilter) {
          return false;
        }

        if (!lowered) {
          return true;
        }

        return (
          incident.id.toLowerCase().includes(lowered) ||
          incident.zone.toLowerCase().includes(lowered) ||
          incident.description.toLowerCase().includes(lowered)
        );
      })
      .sort((left, right) => {
        const priorityDelta = getPriorityScore(right) - getPriorityScore(left);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
      });
  }, [incidents, query, statusFilter]);

  const openCount = queueRows.filter((incident) => incident.status !== "resolved").length;

  const executeAction = async (input: ResponderIncidentActionInput) => {
    if (!selectedIncident) {
      return;
    }

    if (input.action === "add_note" && !String(input.note || "").trim()) {
      toast({
        title: "Note required",
        description: "Enter a remark before adding a note.",
        variant: "destructive",
      });
      return;
    }

    const actionKey = `${selectedIncident.id}:${input.action}`;

    try {
      setBusyActionKey(actionKey);

      const updated = await respondToIncident(selectedIncident.id, input);
      upsertIncidentInStore(updated);

      if (input.action === "add_note") {
        setNoteDraft("");
      }

      toast({
        title: "Incident updated",
        description: `${selectedIncident.id} updated successfully`,
      });
    } catch (error) {
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setBusyActionKey("");
    }
  };

  const selectedPriority = selectedIncident ? getPriority(selectedIncident) : "low";
  const selectedSnapshot = selectedIncident ? getSnapshotSource(selectedIncident) : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold tracking-tight">Responder Panel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Validate AI flags, take ownership, and execute incident response quickly.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {responderType ? (
            <Badge variant="outline" className="border-primary/50 text-primary">
              <UserCheck className="mr-1 h-3.5 w-3.5" /> {RESPONDER_TYPE_LABEL[responderType]}
            </Badge>
          ) : null}

          <Badge
            variant="outline"
            className={socketConnected ? "border-success/60 text-success" : "border-warning/60 text-warning"}
          >
            {socketConnected ? (
              <>
                <Wifi className="mr-1 h-3.5 w-3.5" /> Realtime Connected
              </>
            ) : (
              <>
                <WifiOff className="mr-1 h-3.5 w-3.5" /> Realtime Disconnected
              </>
            )}
          </Badge>

          <Badge variant="outline" className="border-warning/40 text-warning">
            <AlertTriangle className="mr-1 h-3.5 w-3.5" /> {openCount} open
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1.45fr]">
        <Card className="space-y-3 p-4">
          <div className="space-y-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search queue by ID, zone, or description"
            />
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "all" | QueueStatus)}>
              <SelectTrigger>
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading responder queue...</p>
          ) : queueRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No incidents match current filters.</p>
          ) : (
            <div className="space-y-2">
              {queueRows.map((incident) => {
                const queueStatus = QUEUE_STATUS_LABELS[incident.status];
                const priority = getPriority(incident);
                const isSelected = selectedIncidentId === incident.id;
                const lowConfidence = incident.confidence < LOW_CONFIDENCE_THRESHOLD;

                return (
                  <button
                    type="button"
                    key={incident.id}
                    onClick={() => setSelectedIncidentId(incident.id)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors",
                      PRIORITY_CARD_CLASS[priority],
                      isSelected && "ring-2 ring-primary/60",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{incident.id}</p>
                      <Badge variant="outline" className={PRIORITY_BADGE_CLASS[priority]}>
                        {priority} priority
                      </Badge>
                    </div>

                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{incident.description}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{TYPE_LABEL[incident.type]}</span>
                      <span>•</span>
                      <span>{SEVERITY_LABEL[incident.severity]}</span>
                      <span>•</span>
                      <span>{toPercent(incident.confidence)}</span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-primary/40 text-primary">
                        Needs Human Validation
                      </Badge>
                      <Badge variant="outline" className="capitalize">
                        {queueStatus.replace("_", " ")}
                      </Badge>
                      {lowConfidence ? (
                        <Badge variant="outline" className="border-warning/60 text-warning">
                          Low confidence
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{formatDateTime(incident.timestamp)}</span>
                      <span className="truncate pl-2">{incident.zone}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {!selectedIncident ? (
            <Card className="p-6 text-sm text-muted-foreground">Select an incident from the queue.</Card>
          ) : (
            <>
              <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-heading text-lg font-semibold">{selectedIncident.id}</h2>
                    <p className="text-sm text-muted-foreground">{selectedIncident.description}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={PRIORITY_BADGE_CLASS[selectedPriority]}>
                      {selectedPriority} priority
                    </Badge>
                    <Badge variant="outline" className="capitalize">
                      {QUEUE_STATUS_LABELS[selectedIncident.status].replace("_", " ")}
                    </Badge>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <p>
                    <span className="text-muted-foreground">Type:</span> {TYPE_LABEL[selectedIncident.type]}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Severity:</span> {SEVERITY_LABEL[selectedIncident.severity]}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Confidence:</span> {toPercent(selectedIncident.confidence)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Detected at:</span> {formatDateTime(selectedIncident.timestamp)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Location:</span> {selectedIncident.zone}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Assigned:</span> {selectedIncident.assignedTo || "Unassigned"}
                  </p>
                </div>
              </Card>

              <Card className="grid gap-4 p-4 lg:grid-cols-[1.05fr_1fr]">
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Incident snapshot</p>
                  {selectedSnapshot ? (
                    <img
                      src={selectedSnapshot}
                      alt={`Snapshot for ${selectedIncident.id}`}
                      className="aspect-video w-full rounded-md border border-border object-cover"
                    />
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                      No snapshot/frame available for this incident.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">AI prediction details</p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">AI Decision:</span>{" "}
                    {AI_DECISION_LABELS[selectedIncident.aiDecision || "needs_human_validation"] || "Needs Human Validation"}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Detection Method:</span>{" "}
                    {DETECTION_METHOD_LABELS[selectedIncident.detectionMethod || "YOLO"] || "YOLO"}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Prediction:</span>{" "}
                    {selectedIncident.predictionDetails || selectedIncident.description}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Coordinates:</span>{" "}
                    {selectedIncident.location
                      ? `${selectedIncident.location.lat.toFixed(5)}, ${selectedIncident.location.lng.toFixed(5)}`
                      : "N/A"}
                  </p>
                </div>
              </Card>

              <Card className="p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Response tracking</p>
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                  <p>
                    <span className="text-muted-foreground">Assigned:</span> {formatDateTime(selectedIncident.assignedAt)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Accepted:</span> {formatDateTime(selectedIncident.acceptedAt)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Resolved:</span> {formatDateTime(selectedIncident.resolvedAt)}
                  </p>
                </div>
              </Card>

              <Card className="space-y-3 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Response actions</p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={selectedIncident.status === "resolved" || busyActionKey === `${selectedIncident.id}:accept`}
                    onClick={() => {
                      void executeAction({ action: "accept" });
                    }}
                  >
                    <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Accept Ownership
                  </Button>

                  <Button
                    variant="outline"
                    disabled={selectedIncident.status === "resolved" || busyActionKey === `${selectedIncident.id}:start_progress`}
                    onClick={() => {
                      void executeAction({ action: "start_progress" });
                    }}
                  >
                    <Clock3 className="mr-1.5 h-3.5 w-3.5" /> In Progress
                  </Button>

                  <Button
                    variant="outline"
                    disabled={selectedIncident.status === "resolved" || busyActionKey === `${selectedIncident.id}:mark_valid`}
                    onClick={() => {
                      void executeAction({ action: "mark_valid" });
                    }}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Mark Valid Incident
                  </Button>

                  <Button
                    variant="outline"
                    className="border-warning/50 text-warning"
                    disabled={selectedIncident.status === "resolved" || busyActionKey === `${selectedIncident.id}:mark_false_alert`}
                    onClick={() => {
                      void executeAction({ action: "mark_false_alert" });
                    }}
                  >
                    <ShieldAlert className="mr-1.5 h-3.5 w-3.5" /> Mark False Alert
                  </Button>

                  <Button
                    className="bg-success text-success-foreground hover:bg-success/90"
                    disabled={selectedIncident.status === "resolved" || busyActionKey === `${selectedIncident.id}:resolve`}
                    onClick={() => {
                      void executeAction({ action: "resolve" });
                    }}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Resolve
                  </Button>
                </div>

                <div className="space-y-2">
                  <Textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder="Add operational notes, decisions, or field observations"
                  />
                  <Button
                    variant="outline"
                    disabled={busyActionKey === `${selectedIncident.id}:add_note`}
                    onClick={() => {
                      void executeAction({ action: "add_note", note: noteDraft });
                    }}
                  >
                    Add Note
                  </Button>
                </div>
              </Card>

              <Card className="p-4">
                <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Recent notes</p>
                {selectedIncident.notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notes added yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {selectedIncident.notes.slice(-6).reverse().map((note, index) => (
                      <p key={`${index}-${note.slice(0, 24)}`} className="rounded-md bg-muted/30 px-2 py-1 text-sm">
                        {note}
                      </p>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isSyncing ? <Clock3 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
        {isSyncing ? "Syncing incident queue..." : "Incident queue synced"}
      </div>

      <div className="sr-only" aria-live="polite">
        {socketConnected ? "Realtime connected" : "Realtime disconnected"}
      </div>
    </div>
  );
}
