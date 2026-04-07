import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { FireEscalationRealtime } from "@/components/FireEscalationRealtime";
import { Bell } from "lucide-react";
import { useIncidentStore } from "@/store/incidents";
import { getIncidents } from "@/lib/incidentsApi";
import { Badge } from "@/components/ui/badge";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const setIncidents = useIncidentStore((s) => s.setIncidents);
  const activeCount = useIncidentStore((s) =>
    s.incidents.filter((i) => ["active", "pending_confirmation", "escalated"].includes(i.status)).length
  );

  useEffect(() => {
    let cancelled = false;

    const loadIncidents = async () => {
      try {
        const incidents = await getIncidents();
        if (!cancelled) {
          setIncidents(incidents);
        }
      } catch (error) {
        console.error("Failed to fetch incidents:", error);
      }
    };

    void loadIncidents();

    return () => {
      cancelled = true;
    };
  }, [setIncidents]);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {location.pathname === "/monitoring" ? null : <FireEscalationRealtime />}
          <header className="h-14 flex items-center justify-between border-b border-border px-4 bg-card/50 backdrop-blur-sm sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-heading text-muted-foreground tracking-wider">SYSTEM ONLINE</span>
            </div>
            <div className="flex items-center gap-4">
              {activeCount > 0 && (
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-warning" />
                  <Badge variant="outline" className="border-warning text-warning text-xs">
                    {activeCount} active
                  </Badge>
                </div>
              )}
              <span className="text-xs text-muted-foreground font-mono">
                {new Date().toLocaleTimeString()}
              </span>
            </div>
          </header>
          <main className="flex-1 p-6 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
