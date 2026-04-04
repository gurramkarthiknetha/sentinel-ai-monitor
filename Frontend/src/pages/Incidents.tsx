import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Eye, Plus, Search, UserRound } from "lucide-react";
import { useIncidentStore, type Incident, type IncidentStatus, type IncidentType, type Severity } from "@/store/incidents";
import { createIncident, getIncidents, updateIncidentById } from "@/lib/incidentsApi";
import { getUsers } from "@/lib/authApi";
import {
  createDecisionOverrideNote,
  getIncidentDecision,
  getStoredDecisionThreshold,
  toPercent,
  type DecisionMode,
} from "@/lib/decisionRules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore, type AuthUser } from "@/store/auth";

const WORKFLOW_STATUS_LABELS: Record<IncidentStatus, "pending" | "assigned" | "resolved"> = {
  active: "pending",
  pending_confirmation: "pending",
  escalated: "assigned",
  assigned: "assigned",
  in_progress: "assigned",
  resolved: "resolved",
};

const STATUS_BADGE_CLASS: Record<"pending" | "assigned" | "resolved", string> = {
  pending: "border-warning/40 text-warning",
  assigned: "border-accent/40 text-accent",
  resolved: "border-success/40 text-success",
};

const NEXT_STATUS: Record<IncidentStatus, IncidentStatus | null> = {
  active: "assigned",
  pending_confirmation: "escalated",
  escalated: "in_progress",
  assigned: "in_progress",
  in_progress: "resolved",
  resolved: null,
};

const responderDisplayName = (user: AuthUser) => {
  const email = user.email.trim();
  return user.name.trim() ? `${user.name.trim()} <${email}>` : email;
};

const formatTypeLabel = (value: IncidentType) => value.charAt(0).toUpperCase() + value.slice(1);

export default function IncidentsPage() {
  const { toast } = useToast();
  const currentUser = useAuthStore((state) => state.user);
  const { incidents, setIncidents, updateIncident, addIncident } = useIncidentStore();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterWorkflow, setFilterWorkflow] = useState<string>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [overrideDecisionMode, setOverrideDecisionMode] = useState<DecisionMode>("manual");
  const [overrideReason, setOverrideReason] = useState("");
  const [reassignTo, setReassignTo] = useState("");
  const [isSavingOverride, setIsSavingOverride] = useState(false);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);

  const [responders, setResponders] = useState<AuthUser[]>([]);
  const [isLoadingResponders, setIsLoadingResponders] = useState(false);

  const decisionThreshold = getStoredDecisionThreshold();
  const canCreateIncidents = currentUser?.role === "admin" || currentUser?.role === "operator";
  const canUpdateIncidents = currentUser?.role === "admin" || currentUser?.role === "operator" || currentUser?.role === "responder";
  const isAdmin = currentUser?.role === "admin";

  const selectedIncident = useMemo(
    () => incidents.find((incident) => incident.id === selectedIncidentId) || null,
    [incidents, selectedIncidentId],
  );

  useEffect(() => {
    let cancelled = false;

    const refreshIncidents = async () => {
      try {
        const latest = await getIncidents();
        if (!cancelled) {
          setIncidents(latest);
        }
      } catch (error) {
        if (!cancelled) {
          toast({
            title: "Failed to refresh incidents",
            description: error instanceof Error ? error.message : "Unexpected error",
            variant: "destructive",
          });
        }
      }
    };

    void refreshIncidents();

    return () => {
      cancelled = true;
    };
  }, [setIncidents, toast]);

  useEffect(() => {
    if (!isAdmin) {
      setResponders([]);
      return;
    }

    let cancelled = false;

    const loadResponders = async () => {
      try {
        setIsLoadingResponders(true);
        const approvedUsers = await getUsers("approved");
        if (!cancelled) {
          setResponders(approvedUsers.filter((user) => user.role === "responder"));
        }
      } catch (error) {
        if (!cancelled) {
          toast({
            title: "Failed to load responders",
            description: error instanceof Error ? error.message : "Unexpected error",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoadingResponders(false);
        }
      }
    };

    void loadResponders();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, toast]);

  useEffect(() => {
    if (!selectedIncident) {
      setOverrideReason("");
      setReassignTo("");
      setOverrideDecisionMode("manual");
      return;
    }

    const currentDecision = getIncidentDecision(selectedIncident, decisionThreshold);

    setOverrideDecisionMode(currentDecision.mode);
    setOverrideReason(currentDecision.override?.reason || "");
    setReassignTo(selectedIncident.assignedTo || "");
  }, [decisionThreshold, selectedIncident]);

  const filteredIncidents = incidents.filter((incident) => {
    const workflow = WORKFLOW_STATUS_LABELS[incident.status];
    const loweredSearch = search.trim().toLowerCase();

    if (
      loweredSearch &&
      !incident.id.toLowerCase().includes(loweredSearch) &&
      !incident.description.toLowerCase().includes(loweredSearch) &&
      !incident.zone.toLowerCase().includes(loweredSearch)
    ) {
      return false;
    }

    if (filterType !== "all" && incident.type !== filterType) {
      return false;
    }

    if (filterSeverity !== "all" && incident.severity !== filterSeverity) {
      return false;
    }

    if (filterWorkflow !== "all" && workflow !== filterWorkflow) {
      return false;
    }

    return true;
  });

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);

    const payload = {
      type: formData.get("type") as IncidentType,
      severity: formData.get("severity") as Severity,
      status: "active" as IncidentStatus,
      confidence: 1,
      zone: String(formData.get("zone") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      location: {
        lat: 40.7128 + (Math.random() - 0.5) * 0.01,
        lng: -74.006 + (Math.random() - 0.5) * 0.01,
      },
      notes: [],
    };

    try {
      setIsSubmittingCreate(true);
      const createdIncident = await createIncident(payload);
      addIncident(createdIncident);
      setCreateOpen(false);
      toast({
        title: "Incident created",
        description: `${createdIncident.id} has been saved to database`,
      });
    } catch (error) {
      toast({
        title: "Failed to create incident",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const updateStatus = async (incident: Incident, nextStatus: IncidentStatus) => {
    try {
      setStatusUpdatingId(incident.id);

      const updatedIncident = await updateIncidentById(incident.id, {
        status: nextStatus,
        ...(nextStatus === "assigned" && !incident.assignedTo && currentUser
          ? { assignedTo: currentUser.name || currentUser.email }
          : {}),
        ...(nextStatus === "resolved" ? { resolvedAt: new Date().toISOString() } : {}),
      });

      updateIncident(incident.id, updatedIncident);

      toast({
        title: "Incident updated",
        description: `${incident.id} moved to ${nextStatus.replace("_", " ")}`,
      });
    } catch (error) {
      toast({
        title: "Failed to update status",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const saveAssignment = async () => {
    if (!selectedIncident || !isAdmin) {
      return;
    }

    try {
      setIsSavingAssignment(true);
      const updatedIncident = await updateIncidentById(selectedIncident.id, {
        assignedTo: reassignTo.trim() || undefined,
      });

      updateIncident(selectedIncident.id, updatedIncident);

      toast({
        title: "Responder assignment updated",
        description: `${selectedIncident.id} now assigned to ${updatedIncident.assignedTo || "Unassigned"}`,
      });
    } catch (error) {
      toast({
        title: "Failed to reassign responder",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setIsSavingAssignment(false);
    }
  };

  const saveDecisionOverride = async () => {
    if (!selectedIncident || !isAdmin) {
      return;
    }

    const reason = overrideReason.trim() || "Decision manually updated by admin";

    const overrideNote = createDecisionOverrideNote({
      mode: overrideDecisionMode,
      reason,
      actor: currentUser?.name || currentUser?.email || "admin",
      at: new Date().toISOString(),
    });

    try {
      setIsSavingOverride(true);
      const updatedIncident = await updateIncidentById(selectedIncident.id, {
        notes: [...selectedIncident.notes, overrideNote],
      });

      updateIncident(selectedIncident.id, updatedIncident);

      toast({
        title: "Decision override saved",
        description: `${selectedIncident.id} now marked as ${overrideDecisionMode}`,
      });
    } catch (error) {
      toast({
        title: "Failed to save override",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setIsSavingOverride(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold tracking-tight">Incident Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Decision and responder control center with full incident accountability.
          </p>
        </div>

        {canCreateIncidents ? (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New Incident
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-heading">Create Incident</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select name="type" defaultValue="medical">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fire">Fire</SelectItem>
                        <SelectItem value="crowd">Crowd</SelectItem>
                        <SelectItem value="medical">Medical</SelectItem>
                        <SelectItem value="inactivity">Inactivity</SelectItem>
                        <SelectItem value="security">Security</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Severity</Label>
                    <Select name="severity" defaultValue="medium">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Zone</Label>
                  <Input name="zone" placeholder="e.g. Main Stage" required />
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea name="description" placeholder="Describe the incident" required />
                </div>

                <Button className="w-full" type="submit" disabled={isSubmittingCreate}>
                  {isSubmittingCreate ? "Creating..." : "Create Incident"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="Search by ID, zone, or description"
            />
          </div>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="fire">Fire</SelectItem>
              <SelectItem value="crowd">Crowd</SelectItem>
              <SelectItem value="medical">Medical</SelectItem>
              <SelectItem value="inactivity">Inactivity</SelectItem>
              <SelectItem value="security">Security</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severity</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterWorkflow} onValueChange={setFilterWorkflow}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Workflow" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workflow</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Incident</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned responder</TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {filteredIncidents.map((incident) => {
              const decision = getIncidentDecision(incident, decisionThreshold);
              const workflow = WORKFLOW_STATUS_LABELS[incident.status];
              const nextStatus = NEXT_STATUS[incident.status];

              return (
                <TableRow key={incident.id}>
                  <TableCell className="font-medium">{incident.id}</TableCell>
                  <TableCell>{formatTypeLabel(incident.type)}</TableCell>
                  <TableCell>{toPercent(incident.confidence)}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        decision.mode === "auto"
                          ? "border-success/40 text-success"
                          : "border-warning/40 text-warning"
                      }
                    >
                      {decision.mode}
                      {decision.overridden ? " (override)" : ""}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`capitalize ${STATUS_BADGE_CLASS[workflow]}`}>
                      {workflow}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate">{incident.assignedTo || "Unassigned"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(incident.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {canUpdateIncidents && nextStatus ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={statusUpdatingId === incident.id}
                          onClick={() => void updateStatus(incident, nextStatus)}
                        >
                          {statusUpdatingId === incident.id ? "Updating..." : nextStatus.replace("_", " ")}
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      ) : null}

                      <Button size="sm" variant="outline" onClick={() => setSelectedIncidentId(incident.id)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}

            {filteredIncidents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No incidents match the selected filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={Boolean(selectedIncident)} onOpenChange={(open) => (!open ? setSelectedIncidentId(null) : undefined)}>
        <DialogContent className="max-w-3xl bg-card border-border">
          {selectedIncident ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading text-lg">Incident {selectedIncident.id}</DialogTitle>
              </DialogHeader>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="space-y-2 p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Incident details</p>
                  <p className="text-sm"><span className="text-muted-foreground">Type:</span> {formatTypeLabel(selectedIncident.type)}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Severity:</span> {selectedIncident.severity}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Confidence:</span> {toPercent(selectedIncident.confidence)}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Status:</span> {selectedIncident.status.replace("_", " ")}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Zone:</span> {selectedIncident.zone}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Responder:</span> {selectedIncident.assignedTo || "Unassigned"}</p>
                  <p className="text-sm text-muted-foreground">{new Date(selectedIncident.timestamp).toLocaleString()}</p>
                </Card>

                <Card className="space-y-2 p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Decision rationale</p>
                  {(() => {
                    const decision = getIncidentDecision(selectedIncident, decisionThreshold);
                    return (
                      <>
                        <Badge
                          variant="outline"
                          className={
                            decision.mode === "auto"
                              ? "w-fit border-success/40 text-success"
                              : "w-fit border-warning/40 text-warning"
                          }
                        >
                          {decision.mode}
                          {decision.overridden ? " (override)" : ""}
                        </Badge>
                        <p className="text-sm text-muted-foreground">{decision.reason}</p>
                      </>
                    );
                  })()}

                  <div>
                    <p className="text-sm text-muted-foreground">Description</p>
                    <p className="text-sm">{selectedIncident.description}</p>
                  </div>
                </Card>
              </div>

              {isAdmin ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="space-y-3 p-4">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Reassign responder</p>

                    <Select value={reassignTo || "none"} onValueChange={(value) => setReassignTo(value === "none" ? "" : value)}>
                      <SelectTrigger>
                        <SelectValue placeholder={isLoadingResponders ? "Loading responders..." : "Select responder"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {responders.map((responder) => {
                          const value = responderDisplayName(responder);
                          return (
                            <SelectItem key={responder.id} value={value}>
                              {value}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>

                    <Button className="w-full" disabled={isSavingAssignment} onClick={() => void saveAssignment()}>
                      {isSavingAssignment ? "Saving..." : "Save Assignment"}
                    </Button>
                  </Card>

                  <Card className="space-y-3 p-4">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Override decision</p>

                    <Select value={overrideDecisionMode} onValueChange={(value) => setOverrideDecisionMode(value as DecisionMode)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Decision mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>

                    <Textarea
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      placeholder="Why is this decision being overridden?"
                    />

                    <Button className="w-full" disabled={isSavingOverride} onClick={() => void saveDecisionOverride()}>
                      {isSavingOverride ? "Saving..." : "Save Override"}
                    </Button>
                  </Card>
                </div>
              ) : null}

              {canUpdateIncidents ? (
                <Card className="space-y-3 p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Workflow control</p>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        "active",
                        "pending_confirmation",
                        "escalated",
                        "assigned",
                        "in_progress",
                        "resolved",
                      ] as IncidentStatus[]
                    ).map((status) => (
                      <Button
                        key={status}
                        variant={selectedIncident.status === status ? "default" : "outline"}
                        size="sm"
                        disabled={statusUpdatingId === selectedIncident.id}
                        onClick={() => void updateStatus(selectedIncident, status)}
                      >
                        {status.replace("_", " ")}
                      </Button>
                    ))}
                  </div>
                </Card>
              ) : null}

              {selectedIncident.notes.length > 0 ? (
                <Card className="space-y-2 p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Notes</p>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {selectedIncident.notes.slice(-5).map((note, index) => (
                      <p key={`${note}-${index}`} className="rounded bg-muted/20 px-2 py-1">
                        {note.startsWith("[system:decision-override]") ? "System decision override recorded" : note}
                      </p>
                    ))}
                  </div>
                </Card>
              ) : null}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" />
                Decision threshold in use: {toPercent(decisionThreshold)}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
