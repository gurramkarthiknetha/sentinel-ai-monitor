import { useMemo } from "react";
import { useIncidentStore, type Severity, type IncidentType } from "@/store/incidents";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Flame,
  HeartPulse,
  PersonStanding,
  Shield,
  TimerReset,
  UserCog,
  Users,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  formatDuration,
  getIncidentDecision,
  getResponseTimeMs,
  getStoredDecisionThreshold,
} from "@/lib/decisionRules";

const SEVERITY_COLORS: Record<Severity, string> = {
  low: 'hsl(142, 71%, 45%)',
  medium: 'hsl(38, 92%, 50%)',
  high: 'hsl(25, 95%, 53%)',
  critical: 'hsl(0, 84%, 60%)',
};

const TYPE_ICONS: Record<IncidentType, React.ElementType> = {
  fire: Flame,
  crowd: Users,
  medical: HeartPulse,
  security: Shield,
  inactivity: PersonStanding,
};

const TYPE_COLORS: Record<IncidentType, string> = {
  fire: "hsl(0, 84%, 60%)",
  crowd: "hsl(38, 92%, 50%)",
  medical: "hsl(200, 80%, 50%)",
  security: "hsl(280, 60%, 55%)",
  inactivity: "hsl(188, 95%, 42%)",
};

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "hsl(220, 18%, 10%)",
  border: "1px solid hsl(220, 14%, 18%)",
  borderRadius: "8px",
  fontSize: "12px",
};

const buildTrendData = (timestamps: Array<{ timestamp: string; resolvedAt?: string }>) => {
  const now = new Date();
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() - 23);

  const startMs = start.getTime();
  const hourMs = 60 * 60 * 1000;

  const buckets = Array.from({ length: 24 }, (_, index) => {
    const bucketStart = new Date(startMs + index * hourMs);
    return {
      hour: bucketStart.toLocaleTimeString([], { hour: "2-digit" }),
      incidents: 0,
      resolved: 0,
      bucketStartMs: bucketStart.getTime(),
    };
  });

  for (const entry of timestamps) {
    const timestampMs = new Date(entry.timestamp).getTime();
    const incidentIndex = Math.floor((timestampMs - startMs) / hourMs);

    if (incidentIndex >= 0 && incidentIndex < buckets.length) {
      buckets[incidentIndex].incidents += 1;
    }

    if (entry.resolvedAt) {
      const resolvedMs = new Date(entry.resolvedAt).getTime();
      const resolvedIndex = Math.floor((resolvedMs - startMs) / hourMs);

      if (resolvedIndex >= 0 && resolvedIndex < buckets.length) {
        buckets[resolvedIndex].resolved += 1;
      }
    }
  }

  return buckets.map(({ hour, incidents, resolved }) => ({ hour, incidents, resolved }));
};

export default function OverviewPage() {
  const incidents = useIncidentStore((s) => s.incidents);
  const threshold = getStoredDecisionThreshold();

  const total = incidents.length;
  const active = incidents.filter((incident) => incident.status !== "resolved").length;
  const critical = incidents.filter((incident) => incident.severity === "critical").length;
  const resolved = incidents.filter((incident) => incident.status === "resolved").length;

  const trendData = useMemo(
    () => buildTrendData(incidents.map((incident) => ({ timestamp: incident.timestamp, resolvedAt: incident.resolvedAt }))),
    [incidents],
  );

  const byType = (["fire", "crowd", "medical", "inactivity", "security"] as IncidentType[]).map((type) => ({
    name: type,
    value: incidents.filter((incident) => incident.type === type).length,
    color: TYPE_COLORS[type],
  }));

  const bySeverity = (["low", "medium", "high", "critical"] as Severity[]).map((sev) => ({
    name: sev,
    value: incidents.filter((incident) => incident.severity === sev).length,
    fill: SEVERITY_COLORS[sev],
  }));

  const decisionSummary = incidents.reduce(
    (accumulator, incident) => {
      const decision = getIncidentDecision(incident, threshold);
      if (decision.mode === "auto") {
        accumulator.auto += 1;
      } else {
        accumulator.manual += 1;
      }

      return accumulator;
    },
    { auto: 0, manual: 0 },
  );

  const avgResponseMs = useMemo(() => {
    const resolvedIncidents = incidents.filter((incident) => incident.status === "resolved");
    if (resolvedIncidents.length === 0) {
      return 0;
    }

    const totalResponseMs = resolvedIncidents.reduce(
      (accumulator, incident) => accumulator + getResponseTimeMs(incident),
      0,
    );

    return totalResponseMs / resolvedIncidents.length;
  }, [incidents]);

  const stats = [
    {
      label: "Total Incidents",
      value: String(total),
      helper: "All tracked signals",
      icon: AlertTriangle,
      color: "text-foreground",
    },
    {
      label: "Active Incidents",
      value: String(active),
      helper: "Pending + assigned workflow",
      icon: AlertTriangle,
      color: "text-warning",
    },
    {
      label: "Critical Incidents",
      value: String(critical),
      helper: "Highest severity alerts",
      icon: Flame,
      color: "text-critical",
    },
    {
      label: "Resolved Incidents",
      value: String(resolved),
      helper: "Closed investigations",
      icon: CheckCircle2,
      color: "text-success",
    },
    {
      label: "Auto vs Manual",
      value: `${decisionSummary.auto}:${decisionSummary.manual}`,
      helper: `Threshold ${Math.round(threshold * 100)}%`,
      icon: Bot,
      color: "text-primary",
    },
    {
      label: "Avg Response Time",
      value: formatDuration(avgResponseMs),
      helper: "Based on resolved incidents",
      icon: TimerReset,
      color: "text-accent",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold tracking-tight">Admin Operations Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Oversight of incident flow, automated decisioning, and response performance.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="p-4 bg-card border-border hover:border-primary/30 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{stat.label}</p>
                  <p className={`mt-1 text-3xl font-heading font-bold ${stat.color}`}>{stat.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{stat.helper}</p>
                </div>
                <stat.icon className={`h-8 w-8 ${stat.color} opacity-50`} />
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-5 bg-card border-border col-span-2">
          <h3 className="text-sm font-heading font-semibold text-foreground mb-4 tracking-wider uppercase">
            Incident Trend (24h)
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis dataKey="hour" stroke="hsl(215, 12%, 50%)" fontSize={10} tickLine={false} />
              <YAxis stroke="hsl(215, 12%, 50%)" fontSize={10} tickLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="incidents" stroke="hsl(0, 84%, 60%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="resolved" stroke="hsl(160, 84%, 39%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-5 bg-card border-border">
          <h3 className="text-sm font-heading font-semibold text-foreground mb-4 tracking-wider uppercase">
            By Type
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byType} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={4}>
                {byType.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {byType.map((t) => (
              <div key={t.name} className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                <span className="text-xs text-muted-foreground capitalize">{t.name}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5 bg-card border-border">
        <h3 className="text-sm font-heading font-semibold text-foreground mb-4 tracking-wider uppercase">
          Severity Distribution
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={bySeverity}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
            <XAxis dataKey="name" stroke="hsl(215, 12%, 50%)" fontSize={11} tickLine={false} />
            <YAxis stroke="hsl(215, 12%, 50%)" fontSize={11} tickLine={false} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {bySeverity.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card className="p-5 bg-card border-border">
        <h3 className="text-sm font-heading font-semibold text-foreground mb-4 tracking-wider uppercase">Recent Incidents</h3>
        <div className="space-y-2">
          {incidents.slice(0, 5).map((inc) => {
            const Icon = TYPE_ICONS[inc.type];
            return (
              <div key={inc.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <Icon className="h-4 w-4" style={{ color: TYPE_COLORS[inc.type] }} />
                <span className="text-xs font-mono text-muted-foreground">{inc.id}</span>
                <span className="text-sm flex-1 truncate">{inc.description}</span>
                <Badge
                  variant="outline"
                  className="text-xs capitalize"
                  style={{ borderColor: SEVERITY_COLORS[inc.severity], color: SEVERITY_COLORS[inc.severity] }}
                >
                  {inc.severity}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize text-muted-foreground">
                  {inc.status.replace('_', ' ')}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    getIncidentDecision(inc, threshold).mode === "auto"
                      ? "border-success/40 text-success"
                      : "border-warning/40 text-warning"
                  }
                >
                  {getIncidentDecision(inc, threshold).mode}
                </Badge>
              </div>
            );
          })}

          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No incidents available yet.</p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
