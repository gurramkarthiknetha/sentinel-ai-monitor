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
import { useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import {
  Monitor,
  AlertTriangle,
  Map,
  BarChart3,
  Shield,
  User,
  LogOut,
} from "lucide-react";

const navItems = [
  { title: "Overview", url: "/", icon: BarChart3, roles: ['admin', 'operator', 'responder'] },
  { title: "Monitoring", url: "/monitoring", icon: Monitor, roles: ['admin', 'operator'] },
  { title: "Incidents", url: "/incidents", icon: AlertTriangle, roles: ['admin', 'operator', 'responder'] },
  { title: "Zone Map", url: "/map", icon: Map, roles: ['admin', 'operator'] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  const filteredItems = navItems.filter((item) =>
    user ? item.roles.includes(user.role) : false
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-heading text-primary tracking-wider">
            {!collapsed && "AI EVENT MONITOR"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredItems.map((item) => (
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
              <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
