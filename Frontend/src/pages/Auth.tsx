import { FormEvent, useCallback, useEffect, useState } from "react";
import { Clock3, Loader2, ShieldCheck, UserCheck, UserRoundCog, XCircle } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  getGoogleAuthConfig,
  loginWithGoogle,
  type GoogleAuthResult,
  type GoogleProfile,
} from "@/lib/authApi";
import { useAuthStore, type AuthUser, type ResponderType } from "@/store/auth";

type AuthView = "login" | "onboarding" | "pending";
type OnboardingRole = "operator" | "responder";

const RESPONDER_TYPE_OPTIONS: Array<{ value: ResponderType; label: string }> = [
  { value: "medical", label: "Medical Responder" },
  { value: "fire", label: "Fire Responder" },
  { value: "crowd", label: "Crowd Control Responder" },
  { value: "inactivity", label: "Inactivity Monitor Responder" },
];

const toProfileFromUser = (user: AuthUser): GoogleProfile => ({
  googleId: user.googleId,
  email: user.email,
  name: user.name,
  avatar: user.avatar,
});

export default function AuthPage() {
  const { toast } = useToast();
  const setSession = useAuthStore((s) => s.setSession);

  const [clientId, setClientId] = useState("");
  const [view, setView] = useState<AuthView>("login");
  const [cachedCredential, setCachedCredential] = useState("");
  const [profile, setProfile] = useState<GoogleProfile | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedRole, setSelectedRole] = useState<OnboardingRole>("operator");
  const [selectedResponderType, setSelectedResponderType] = useState<ResponderType>("medical");
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadGoogleConfig = async () => {
      try {
        const config = await getGoogleAuthConfig();
        if (!cancelled) {
          setClientId(config.clientId);
        }
      } catch (error) {
        if (!cancelled) {
          toast({
            title: "Google login unavailable",
            description: error instanceof Error ? error.message : "Unexpected error",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoadingConfig(false);
        }
      }
    };

    void loadGoogleConfig();

    return () => {
      cancelled = true;
    };
  }, [toast]);

  const handleAuthResult = useCallback(
    (result: GoogleAuthResult, credential: string) => {
      if (result.authState === "approved") {
        if (result.token && result.user) {
          setSession({ token: result.token, user: result.user });
          return;
        }

        toast({
          title: "Authentication failed",
          description: "Missing session payload from server.",
          variant: "destructive",
        });
        return;
      }

      if (result.authState === "onboarding_required") {
        setCachedCredential(credential);
        setProfile(result.profile || null);
        setStatusMessage(result.message || "Choose your role to complete onboarding.");
        setView("onboarding");
        return;
      }

      if (result.authState === "pending_approval" || result.authState === "rejected") {
        setProfile(result.user ? toProfileFromUser(result.user) : result.profile || null);
        setStatusMessage(
          result.message ||
            (result.authState === "pending_approval"
              ? "Waiting for admin approval"
              : "Access has been rejected by admin"),
        );
        setView("pending");
        return;
      }

      toast({
        title: "Unexpected authentication response",
        description: "Please retry login.",
        variant: "destructive",
      });
    },
    [setSession, toast],
  );

  const handleCredential = useCallback(
    async (credential: string) => {
      try {
        setIsSubmitting(true);
        const result = await loginWithGoogle({ credential });
        handleAuthResult(result, credential);
      } catch (error) {
        toast({
          title: "Login failed",
          description: error instanceof Error ? error.message : "Unexpected error",
          variant: "destructive",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [handleAuthResult, toast],
  );

  const submitOnboarding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!cachedCredential) {
      toast({
        title: "Session expired",
        description: "Please sign in again with Google.",
        variant: "destructive",
      });
      setView("login");
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await loginWithGoogle({
        credential: cachedCredential,
        role: selectedRole,
        responderType: selectedRole === "responder" ? selectedResponderType : undefined,
      });
      handleAuthResult(result, cachedCredential);
    } catch (error) {
      toast({
        title: "Onboarding failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,hsl(var(--primary)/0.22),transparent_34%),radial-gradient(circle_at_90%_85%,hsl(var(--accent)/0.2),transparent_35%),linear-gradient(160deg,hsl(var(--background)),hsl(var(--sidebar-background)))]" />

      <Card className="relative w-full max-w-xl border-border/70 bg-card/95 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 flex items-center gap-3">
          <img src="/eventlogo.png" alt="Sentinel AI Monitor" className="h-14 w-14 rounded-lg border border-border/50" />
          <div>
            <p className="font-heading text-lg font-semibold tracking-tight">Sentinel AI Monitor</p>
            <p className="text-sm text-muted-foreground">Google OAuth + Role-based access control</p>
          </div>
        </div>

        {view === "login" ? (
          <div className="space-y-5">
            <div>
              <h1 className="font-heading text-2xl font-bold tracking-tight">Secure Sign In</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Continue with your Google account to access the monitoring console.
              </p>
            </div>

            {isLoadingConfig ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Initializing Google login...
              </div>
            ) : clientId ? (
              <GoogleSignInButton
                clientId={clientId}
                disabled={isSubmitting}
                onCredential={(credential) => {
                  void handleCredential(credential);
                }}
                onError={(message) => {
                  toast({
                    title: "Google sign-in error",
                    description: message,
                    variant: "destructive",
                  });
                }}
              />
            ) : (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                GOOGLE_CLIENT_ID is not configured on backend.
              </div>
            )}
          </div>
        ) : null}

        {view === "onboarding" ? (
          <form className="space-y-5" onSubmit={submitOnboarding}>
            <div>
              <h1 className="font-heading text-2xl font-bold tracking-tight">Complete Registration</h1>
              <p className="mt-1 text-sm text-muted-foreground">{statusMessage || "Select your role to continue."}</p>
            </div>

            {profile ? (
              <div className="flex items-center gap-3 rounded-md border border-border/70 bg-muted/30 p-3">
                {profile.avatar ? (
                  <img src={profile.avatar} alt={profile.name} className="h-10 w-10 rounded-full border border-border" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
                    <UserCheck className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium">{profile.name}</p>
                  <p className="text-xs text-muted-foreground">{profile.email}</p>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as OnboardingRole)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operator">Operator</SelectItem>
                  <SelectItem value="responder">Responder</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedRole === "responder" ? (
              <div className="space-y-2">
                <Label>Responder Specialization</Label>
                <Select
                  value={selectedResponderType}
                  onValueChange={(value) => setSelectedResponderType(value as ResponderType)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select specialization" />
                  </SelectTrigger>
                  <SelectContent>
                    {RESPONDER_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setView("login")} disabled={isSubmitting}>
                Back
              </Button>
              <Button type="submit" className="flex-1 gap-2" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCog className="h-4 w-4" />}
                Submit for Approval
              </Button>
            </div>
          </form>
        ) : null}

        {view === "pending" ? (
          <div className="space-y-5">
            <div>
              <h1 className="font-heading text-2xl font-bold tracking-tight">Approval Pending</h1>
              <p className="mt-1 text-sm text-muted-foreground">Your account is registered but not approved yet.</p>
            </div>

            <div className="rounded-md border border-warning/50 bg-warning/10 p-3">
              <div className="flex items-start gap-2 text-warning">
                <Clock3 className="mt-0.5 h-4 w-4" />
                <p className="text-sm">{statusMessage || "Waiting for admin approval"}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-primary/40 text-primary">
                <ShieldCheck className="mr-1 h-3 w-3" /> Access Control Enabled
              </Badge>
              <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
                {profile?.email || "No account selected"}
              </Badge>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setView("login");
                setStatusMessage("");
              }}
            >
              {statusMessage.toLowerCase().includes("rejected") ? (
                <>
                  <XCircle className="mr-2 h-4 w-4" /> Try Another Account
                </>
              ) : (
                "Back to Sign In"
              )}
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
