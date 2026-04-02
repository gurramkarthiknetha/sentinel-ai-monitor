import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardLayout } from "@/components/DashboardLayout";
import { getCurrentUser } from "@/lib/authApi";
import { useAuthStore, type UserRole } from "@/store/auth";
import AdminUsers from "@/pages/AdminUsers";
import AuditLogs from "@/pages/AuditLogs";
import Auth from "@/pages/Auth";
import DecisionOversight from "@/pages/DecisionOversight";
import Overview from "@/pages/Overview";
import Monitoring from "@/pages/Monitoring";
import Incidents from "@/pages/Incidents";
import ZoneMap from "@/pages/ZoneMap";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const AppLoadingScreen = () => (
  <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
    Verifying session...
  </div>
);

const ProtectedLayout = () => (
  <DashboardLayout>
    <Outlet />
  </DashboardLayout>
);

const RequireAuth = () => {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

const RequireRole = ({ allowedRoles }: { allowedRoles: UserRole[] }) => {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

const AppRoutes = () => {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const setUser = useAuthStore((state) => state.setUser);
  const setBootstrapping = useAuthStore((state) => state.setBootstrapping);
  const clearSession = useAuthStore((state) => state.clearSession);

  useEffect(() => {
    let cancelled = false;

    const hydrateCurrentUser = async () => {
      if (!token) {
        if (!cancelled) {
          setUser(null);
          setBootstrapping(false);
        }
        return;
      }

      if (!cancelled) {
        setBootstrapping(true);
      }

      try {
        const currentUser = await getCurrentUser();
        if (!cancelled) {
          setUser(currentUser);
        }
      } catch {
        if (!cancelled) {
          clearSession();
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    };

    void hydrateCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [clearSession, setBootstrapping, setUser, token]);

  if (isBootstrapping) {
    return <AppLoadingScreen />;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Auth />} />

      <Route element={<RequireAuth />}>
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/incidents" element={<Incidents />} />

          <Route element={<RequireRole allowedRoles={["operator"]} />}>
            <Route path="/monitoring" element={<Monitoring />} />
          </Route>

          <Route element={<RequireRole allowedRoles={["admin", "operator"]} />}>
            <Route path="/map" element={<ZoneMap />} />
          </Route>

          <Route element={<RequireRole allowedRoles={["admin"]} />}>
            <Route path="/admin/oversight" element={<DecisionOversight />} />
            <Route path="/admin/logs" element={<AuditLogs />} />
            <Route path="/admin/users" element={<AdminUsers />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
