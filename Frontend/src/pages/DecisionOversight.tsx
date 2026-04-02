import { useMemo, useState } from "react";
import { SlidersHorizontal, Bot, UserCog, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  getIncidentDecision,
  getStoredDecisionThreshold,
  persistDecisionThreshold,
  toPercent,
} from "@/lib/decisionRules";
import { useIncidentStore } from "@/store/incidents";

export default function DecisionOversightPage() {
  const { toast } = useToast();
  const incidents = useIncidentStore((state) => state.incidents);

  const [savedThreshold, setSavedThreshold] = useState(() => getStoredDecisionThreshold());
  const [draftThreshold, setDraftThreshold] = useState(() => getStoredDecisionThreshold());

  const decisionRows = useMemo(() => {
    return incidents
      .map((incident) => ({
        incident,
        decision: getIncidentDecision(incident, savedThreshold),
      }))
      .sort((left, right) => new Date(right.incident.timestamp).getTime() - new Date(left.incident.timestamp).getTime());
  }, [incidents, savedThreshold]);

  const autoCount = decisionRows.filter((entry) => entry.decision.mode === "auto").length;
  const manualCount = decisionRows.length - autoCount;
  const overriddenCount = decisionRows.filter((entry) => entry.decision.overridden).length;

  const applyThreshold = () => {
    const normalized = persistDecisionThreshold(draftThreshold);
    setSavedThreshold(normalized);
    setDraftThreshold(normalized);

    toast({
      title: "Decision threshold updated",
      description: `Auto-handling threshold is now ${toPercent(normalized)}`,
    });
  };

  const resetThreshold = () => {
    const baseline = getStoredDecisionThreshold();
    setDraftThreshold(baseline);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold tracking-tight">Decision Oversight</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Explain and control how confidence drives auto vs manual handling.
          </p>
        </div>

        <Badge variant="outline" className="border-primary/40 text-primary">
          Current threshold: {toPercent(savedThreshold)}
        </Badge>
      </div>

      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wider">Confidence threshold control</h2>
        </div>

        <div className="space-y-3">
          <Slider
            min={0.1}
            max={0.99}
            step={0.01}
            value={[draftThreshold]}
            onValueChange={(values) => {
              const next = values[0];
              if (typeof next === "number") {
                setDraftThreshold(next);
              }
            }}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="number"
              min={0.1}
              max={0.99}
              step={0.01}
              className="w-32"
              value={draftThreshold.toFixed(2)}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed)) {
                  setDraftThreshold(parsed);
                }
              }}
            />
            <Button onClick={applyThreshold}>Apply threshold</Button>
            <Button variant="outline" className="gap-1" onClick={resetThreshold}>
              <RefreshCcw className="h-3.5 w-3.5" /> Reset draft
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Incidents with confidence above threshold default to auto-handling, while lower confidence incidents are
            routed for manual triage.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Auto handled</p>
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 font-heading text-3xl font-bold">{autoCount}</p>
          <p className="text-xs text-muted-foreground">{decisionRows.length ? Math.round((autoCount / decisionRows.length) * 100) : 0}%</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Manual reviewed</p>
            <UserCog className="h-4 w-4 text-warning" />
          </div>
          <p className="mt-2 font-heading text-3xl font-bold">{manualCount}</p>
          <p className="text-xs text-muted-foreground">
            {decisionRows.length ? Math.round((manualCount / decisionRows.length) * 100) : 0}%
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Decision overrides</p>
            <SlidersHorizontal className="h-4 w-4 text-accent" />
          </div>
          <p className="mt-2 font-heading text-3xl font-bold">{overriddenCount}</p>
          <p className="text-xs text-muted-foreground">Manual admin interventions recorded</p>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider">Decision explanation feed</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Incident</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Why</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {decisionRows.slice(0, 20).map(({ incident, decision }) => (
              <TableRow key={incident.id}>
                <TableCell className="font-medium">{incident.id}</TableCell>
                <TableCell>{toPercent(incident.confidence)}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      decision.mode === "auto"
                        ? "border-success/50 text-success"
                        : "border-warning/50 text-warning"
                    }
                  >
                    {decision.mode}
                    {decision.overridden ? " (override)" : ""}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[420px] text-sm text-muted-foreground">{decision.reason}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(incident.timestamp).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}

            {decisionRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No incidents available yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
