import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import {
  ClipboardList,
  Gauge,
  AlertTriangle,
  Monitor,
  Map,
  Scale,
  ShieldCheck,
  User,
  LogOut,
} from "lucide-react";
import type { UserRole } from "@/store/auth";

interface NavItem {
  title: string;
  url: string;
  icon: typeof Gauge;
}

const NAV_ITEMS_BY_ROLE: Record<UserRole, NavItem[]> = {
  admin: [
    { title: "Overview", url: "/", icon: Gauge },
    { title: "Incidents", url: "/incidents", icon: AlertTriangle },
    { title: "Decision Oversight", url: "/admin/oversight", icon: Scale },
    { title: "Audit Logs", url: "/admin/logs", icon: ClipboardList },
    { title: "User Approvals", url: "/admin/users", icon: ShieldCheck },
    { title: "Zone Map", url: "/map", icon: Map },
  ],
  operator: [
    { title: "Overview", url: "/", icon: Gauge },
    { title: "Monitoring", url: "/monitoring", icon: Monitor },
    { title: "Incidents", url: "/incidents", icon: AlertTriangle },
    { title: "Zone Map", url: "/map", icon: Map },
  ],
  responder: [
    { title: "Responder Panel", url: "/responder", icon: AlertTriangle },
  ],
};

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);

  const handleLogout = () => {
    clearSession();
    navigate('/login', { replace: true });
  };

  const navItems = user ? NAV_ITEMS_BY_ROLE[user.role] : [];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-heading text-primary tracking-wider">
            {!collapsed && "AI EVENT MONITOR"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hover:bg-sidebar-accent/50 transition-colors"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {user && !collapsed && (
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-accent-foreground truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {user.role}
                {user.responderType ? ` · ${user.responderType}` : ""}
              </p>
            </div>
          </div>
        )}

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} className="hover:bg-sidebar-accent/40 transition-colors">
              <LogOut className="mr-2 h-4 w-4" />
              {!collapsed && <span>Sign out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
