import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Bell } from "lucide-react";
import { useIncidentStore } from "@/store/incidents";
import { Badge } from "@/components/ui/badge";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const activeCount = useIncidentStore((s) =>
    s.incidents.filter((i) => i.status === "active").length
  );

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
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
