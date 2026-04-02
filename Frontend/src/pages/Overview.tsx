import { useIncidentStore, type Severity, type IncidentType } from "@/store/incidents";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from "recharts";
import { AlertTriangle, Flame, Users, HeartPulse, Shield, Clock, Activity, PersonStanding } from "lucide-react";
import { motion } from "framer-motion";

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
  fire: 'hsl(0, 84%, 60%)',
  crowd: 'hsl(38, 92%, 50%)',
  medical: 'hsl(200, 80%, 50%)',
  security: 'hsl(280, 60%, 55%)',
  inactivity: 'hsl(188, 95%, 42%)',
};

export default function OverviewPage() {
  const incidents = useIncidentStore((s) => s.incidents);

  const total = incidents.length;
  const active = incidents.filter((i) => i.status === 'active').length;
  const critical = incidents.filter((i) => i.severity === 'critical').length;
  const resolved = incidents.filter((i) => i.status === 'resolved').length;

  const byType = (['fire', 'crowd', 'medical', 'security', 'inactivity'] as IncidentType[]).map((type) => ({
    name: type,
    value: incidents.filter((i) => i.type === type).length,
    color: TYPE_COLORS[type],
  }));

  const bySeverity = (['low', 'medium', 'high', 'critical'] as Severity[]).map((sev) => ({
    name: sev,
    value: incidents.filter((i) => i.severity === sev).length,
    fill: SEVERITY_COLORS[sev],
  }));

  // Mock trend data
  const trendData = Array.from({ length: 24 }, (_, i) => ({
    hour: `${i}:00`,
    incidents: Math.floor(Math.random() * 5) + 1,
    resolved: Math.floor(Math.random() * 4),
  }));

  const stats = [
    { label: 'Total Incidents', value: total, icon: Activity, color: 'text-foreground' },
    { label: 'Active', value: active, icon: AlertTriangle, color: 'text-warning' },
    { label: 'Critical', value: critical, icon: Flame, color: 'text-critical' },
    { label: 'Resolved', value: resolved, icon: Clock, color: 'text-success' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold tracking-tight">Operations Overview</h1>
        <p className="text-muted-foreground text-sm mt-1">Real-time event monitoring dashboard</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  <p className={`text-3xl font-heading font-bold mt-1 ${stat.color}`}>{stat.value}</p>
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
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(220, 18%, 10%)',
                  border: '1px solid hsl(220, 14%, 18%)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
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
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(220, 18%, 10%)',
                  border: '1px solid hsl(220, 14%, 18%)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
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
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(220, 18%, 10%)',
                border: '1px solid hsl(220, 14%, 18%)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {bySeverity.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Recent Incidents */}
      <Card className="p-5 bg-card border-border">
        <h3 className="text-sm font-heading font-semibold text-foreground mb-4 tracking-wider uppercase">
          Recent Incidents
        </h3>
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
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
