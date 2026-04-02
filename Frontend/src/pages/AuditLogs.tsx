import { useMemo, useState } from "react";
import { ClipboardList, Clock3, CheckCircle2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDuration,
  getIncidentDecision,
  getResponseTimeMs,
  getStoredDecisionThreshold,
} from "@/lib/decisionRules";
import { useIncidentStore } from "@/store/incidents";

const toWorkflowLabel = (status: string) => {
  if (status === "active") {
    return "pending";
  }

  if (status === "assigned" || status === "in_progress") {
    return "assigned";
  }

  return "resolved";
};

export default function AuditLogsPage() {
  const incidents = useIncidentStore((state) => state.incidents);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  const threshold = getStoredDecisionThreshold();

  const rows = useMemo(() => {
    return incidents
      .map((incident) => {
        const decision = getIncidentDecision(incident, threshold);
        const responseMs = getResponseTimeMs(incident);

        return {
          incident,
          decision,
          responseMs,
          workflow: toWorkflowLabel(incident.status),
          handler: incident.assignedTo || "Unassigned",
        };
      })
      .sort((left, right) => new Date(right.incident.timestamp).getTime() - new Date(left.incident.timestamp).getTime());
  }, [incidents, threshold]);

  const selected = rows.find((row) => row.incident.id === selectedIncidentId) || null;

  const resolvedRows = rows.filter((row) => row.incident.status === "resolved");
  const avgResponseMs =
    resolvedRows.length === 0
      ? 0
      : resolvedRows.reduce((accumulator, row) => accumulator + row.responseMs, 0) / resolvedRows.length;

  const timeline = useMemo(() => {
    if (!selected) {
      return [];
    }

    const { incident, decision } = selected;

    const events = [
      {
        at: incident.timestamp,
        title: "Incident detected",
        details: `${incident.type} | ${incident.severity} severity in ${incident.zone}`,
      },
      {
        at: incident.timestamp,
        title: "Decision computed",
        details: decision.reason,
      },
    ];

    if (decision.override) {
      events.push({
        at: decision.override.at,
        title: "Decision overridden",
        details: `${decision.override.mode} by ${decision.override.actor}`,
      });
    }

    if (incident.assignedTo) {
      events.push({
        at: incident.updatedAt || incident.timestamp,
        title: "Responder assigned",
        details: incident.assignedTo,
      });
    }

    if (incident.resolvedAt) {
      events.push({
        at: incident.resolvedAt,
        title: "Final action",
        details: `Incident marked resolved by ${incident.assignedTo || "system"}`,
      });
    }

    return events.sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
  }, [selected]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold tracking-tight">Logs and Audit Trail</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Accountability ledger for detection time, response latency, final action, and ownership.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Total logs</p>
            <ClipboardList className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 font-heading text-3xl font-bold">{rows.length}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Resolved incidents</p>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </div>
          <p className="mt-2 font-heading text-3xl font-bold">{resolvedRows.length}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Average response</p>
            <Clock3 className="h-4 w-4 text-warning" />
          </div>
          <p className="mt-2 font-heading text-3xl font-bold">{formatDuration(avgResponseMs)}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Handled by responders</p>
            <UserRound className="h-4 w-4 text-accent" />
          </div>
          <p className="mt-2 font-heading text-3xl font-bold">
            {rows.filter((row) => row.handler !== "Unassigned").length}
          </p>
        </Card>
      </div>

      <Card className="p-5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Incident</TableHead>
              <TableHead>Detected at</TableHead>
              <TableHead>Response time</TableHead>
              <TableHead>Final action</TableHead>
              <TableHead>Handled by</TableHead>
              <TableHead>Decision path</TableHead>
              <TableHead className="text-right">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.incident.id}>
                <TableCell className="font-medium">{row.incident.id}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(row.incident.timestamp).toLocaleString()}
                </TableCell>
                <TableCell>{formatDuration(row.responseMs)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {row.workflow}
                  </Badge>
                </TableCell>
                <TableCell>{row.handler}</TableCell>
                <TableCell className="max-w-[300px] text-sm text-muted-foreground">{row.decision.reason}</TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => setSelectedIncidentId(row.incident.id)}>
                    View log
                  </Button>
                </TableCell>
              </TableRow>
            ))}

            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No incidents available yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => (!open ? setSelectedIncidentId(null) : undefined)}>
        <DialogContent className="max-w-2xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading text-lg">Audit timeline: {selected.incident.id}</DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                {timeline.map((event, index) => (
                  <div key={`${event.title}-${index}`} className="rounded-md border border-border/70 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{event.title}</p>
                      <p className="text-xs text-muted-foreground">{new Date(event.at).toLocaleString()}</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{event.details}</p>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
