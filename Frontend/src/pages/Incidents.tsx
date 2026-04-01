import { useState } from "react";
import { useIncidentStore, type Incident, type IncidentType, type Severity, type IncidentStatus } from "@/store/incidents";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Flame, Users, HeartPulse, Shield, Plus, Search, Clock, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const TYPE_ICONS: Record<IncidentType, React.ElementType> = {
  fire: Flame, crowd: Users, medical: HeartPulse, security: Shield,
};

const SEVERITY_COLORS: Record<Severity, string> = {
  low: 'text-success border-success',
  medium: 'text-warning border-warning',
  high: 'text-orange-400 border-orange-400',
  critical: 'text-critical border-critical',
};

const STATUS_COLORS: Record<IncidentStatus, string> = {
  active: 'bg-critical/20 text-critical',
  assigned: 'bg-warning/20 text-warning',
  in_progress: 'bg-accent/20 text-accent',
  resolved: 'bg-success/20 text-success',
};

const NEXT_STATUS: Record<IncidentStatus, IncidentStatus | null> = {
  active: 'assigned',
  assigned: 'in_progress',
  in_progress: 'resolved',
  resolved: null,
};

export default function IncidentsPage() {
  const { incidents, updateIncident, addIncident } = useIncidentStore();
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = incidents.filter((inc) => {
    if (search && !inc.id.toLowerCase().includes(search.toLowerCase()) && !inc.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType !== "all" && inc.type !== filterType) return false;
    if (filterSeverity !== "all" && inc.severity !== filterSeverity) return false;
    if (filterStatus !== "all" && inc.status !== filterStatus) return false;
    return true;
  });

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const newIncident: Incident = {
      id: `INC-${String(incidents.length + 1).padStart(4, '0')}`,
      type: data.get('type') as IncidentType,
      severity: data.get('severity') as Severity,
      status: 'active',
      confidence: 1.0,
      timestamp: new Date().toISOString(),
      zone: data.get('zone') as string,
      location: { lat: 40.7128 + (Math.random() - 0.5) * 0.01, lng: -74.006 + (Math.random() - 0.5) * 0.01 },
      description: data.get('description') as string,
      notes: [],
    };
    addIncident(newIncident);
    setCreateOpen(false);
  };

  const advanceStatus = (inc: Incident) => {
    const next = NEXT_STATUS[inc.status];
    if (next) {
      updateIncident(inc.id, {
        status: next,
        ...(next === 'assigned' ? { assignedTo: 'Current User' } : {}),
        ...(next === 'resolved' ? { resolvedAt: new Date().toISOString() } : {}),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold tracking-tight">Incidents</h1>
          <p className="text-muted-foreground text-sm mt-1">{filtered.length} incidents found</p>
        </div>
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
                  <Select name="type" defaultValue="security">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fire">Fire</SelectItem>
                      <SelectItem value="crowd">Crowd</SelectItem>
                      <SelectItem value="medical">Medical</SelectItem>
                      <SelectItem value="security">Security</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Severity</Label>
                  <Select name="severity" defaultValue="medium">
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                <Textarea name="description" placeholder="Describe the incident..." required />
              </div>
              <Button type="submit" className="w-full">Create Incident</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search incidents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="fire">Fire</SelectItem>
            <SelectItem value="crowd">Crowd</SelectItem>
            <SelectItem value="medical">Medical</SelectItem>
            <SelectItem value="security">Security</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Incident List */}
      <div className="space-y-2">
        <AnimatePresence>
          {filtered.map((inc) => {
            const Icon = TYPE_ICONS[inc.type];
            return (
              <motion.div
                key={inc.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                layout
              >
                <Card
                  className={`p-4 bg-card border-border hover:border-primary/30 transition-all cursor-pointer ${
                    inc.severity === 'critical' && inc.status === 'active' ? 'animate-pulse-glow' : ''
                  }`}
                  onClick={() => setSelectedIncident(inc)}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-muted/50">
                      <Icon className="h-5 w-5" style={{ color: SEVERITY_COLORS[inc.severity].includes('critical') ? 'hsl(0, 84%, 60%)' : undefined }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">{inc.id}</span>
                        <Badge variant="outline" className={`text-[10px] capitalize ${SEVERITY_COLORS[inc.severity]}`}>
                          {inc.severity}
                        </Badge>
                        <Badge className={`text-[10px] capitalize ${STATUS_COLORS[inc.status]}`}>
                          {inc.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <p className="text-sm truncate">{inc.description}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{inc.zone}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(inc.timestamp).toLocaleString()}
                        </span>
                        <span>•</span>
                        <span>{(inc.confidence * 100).toFixed(0)}% confidence</span>
                      </div>
                    </div>
                    {NEXT_STATUS[inc.status] && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          advanceStatus(inc);
                        }}
                      >
                        {NEXT_STATUS[inc.status]!.replace('_', ' ')} <ArrowRight className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedIncident} onOpenChange={() => setSelectedIncident(null)}>
        <DialogContent className="bg-card border-border max-w-lg">
          {selectedIncident && (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading flex items-center gap-2">
                  {selectedIncident.id}
                  <Badge className={`capitalize ${STATUS_COLORS[selectedIncident.status]}`}>
                    {selectedIncident.status.replace('_', ' ')}
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Type:</span> <span className="capitalize ml-1">{selectedIncident.type}</span></div>
                  <div><span className="text-muted-foreground">Severity:</span> <span className="capitalize ml-1">{selectedIncident.severity}</span></div>
                  <div><span className="text-muted-foreground">Zone:</span> <span className="ml-1">{selectedIncident.zone}</span></div>
                  <div><span className="text-muted-foreground">Confidence:</span> <span className="ml-1">{(selectedIncident.confidence * 100).toFixed(1)}%</span></div>
                  <div className="col-span-2"><span className="text-muted-foreground">Time:</span> <span className="ml-1">{new Date(selectedIncident.timestamp).toLocaleString()}</span></div>
                  {selectedIncident.assignedTo && (
                    <div className="col-span-2"><span className="text-muted-foreground">Assigned:</span> <span className="ml-1">{selectedIncident.assignedTo}</span></div>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Description</p>
                  <p className="text-sm">{selectedIncident.description}</p>
                </div>
                {selectedIncident.notes.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Notes</p>
                    {selectedIncident.notes.map((note, i) => (
                      <p key={i} className="text-sm text-muted-foreground">• {note}</p>
                    ))}
                  </div>
                )}
                {NEXT_STATUS[selectedIncident.status] && (
                  <Button
                    className="w-full gap-2"
                    onClick={() => {
                      advanceStatus(selectedIncident);
                      setSelectedIncident(null);
                    }}
                  >
                    Move to {NEXT_STATUS[selectedIncident.status]!.replace('_', ' ')} <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
