import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Save, ShieldAlert, UserCog, XCircle } from "lucide-react";
import { getUsers, updateUserById } from "@/lib/authApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { type ApprovalStatus, type AuthUser, type ResponderType, type UserRole } from "@/store/auth";

type UserDraft = {
  role: UserRole;
  responderType: ResponderType | "";
  approvalStatus: ApprovalStatus;
};

const responderOptions: Array<{ value: ResponderType; label: string }> = [
  { value: "medical", label: "Medical" },
  { value: "fire", label: "Fire" },
  { value: "crowd", label: "Crowd" },
  { value: "inactivity", label: "Inactivity" },
];

const toDraft = (user: AuthUser): UserDraft => ({
  role: user.role,
  responderType: user.responderType || "",
  approvalStatus: user.approvalStatus,
});

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const pendingCount = useMemo(
    () => users.filter((user) => user.approvalStatus === "pending").length,
    [users],
  );

  useEffect(() => {
    let cancelled = false;

    const loadUsers = async () => {
      try {
        setIsLoading(true);
        const allUsers = await getUsers();

        if (!cancelled) {
          setUsers(allUsers);
          setDrafts(
            allUsers.reduce<Record<string, UserDraft>>((accumulator, user) => {
              accumulator[user.id] = toDraft(user);
              return accumulator;
            }, {}),
          );
        }
      } catch (error) {
        if (!cancelled) {
          toast({
            title: "Failed to load users",
            description: error instanceof Error ? error.message : "Unexpected error",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, [toast]);

  const setDraft = (userId: string, patch: Partial<UserDraft>) => {
    setDrafts((previous) => ({
      ...previous,
      [userId]: {
        ...previous[userId],
        ...patch,
      },
    }));
  };

  const saveUser = async (user: AuthUser) => {
    const draft = drafts[user.id] || toDraft(user);

    if (draft.role === "responder" && !draft.responderType) {
      toast({
        title: "Responder specialization required",
        description: "Please select responder type before saving",
        variant: "destructive",
      });
      return;
    }

    try {
      setSavingUserId(user.id);

      const updated = await updateUserById(user.id, {
        role: draft.role,
        responderType: draft.role === "responder" ? draft.responderType || undefined : undefined,
        approvalStatus: draft.approvalStatus,
      });

      setUsers((previous) => previous.map((entry) => (entry.id === user.id ? updated : entry)));
      setDrafts((previous) => ({
        ...previous,
        [user.id]: toDraft(updated),
      }));

      toast({
        title: "User updated",
        description: `${updated.name} now has ${updated.role} access (${updated.approvalStatus})`,
      });
    } catch (error) {
      toast({
        title: "Failed to update user",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold tracking-tight">User Access Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">Approve requests and manage RBAC assignments</p>
        </div>

        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <ShieldAlert className="h-3.5 w-3.5" />
          {pendingCount} pending approval
        </div>
      </div>

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading users...</Card>
      ) : users.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No users found.</Card>
      ) : (
        <div className="grid gap-4">
          {users.map((user) => {
            const draft = drafts[user.id] || toDraft(user);
            const isSaving = savingUserId === user.id;

            return (
              <Card key={user.id} className="border-border bg-card p-4">
                <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] lg:items-end">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{user.name}</p>
                      <Badge variant="outline" className="capitalize">
                        {user.approvalStatus.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select
                      value={draft.role}
                      onValueChange={(value) => {
                        const role = value as UserRole;
                        setDraft(user.id, {
                          role,
                          responderType: role === "responder" ? draft.responderType : "",
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="operator">Operator</SelectItem>
                        <SelectItem value="responder">Responder</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Responder Type</Label>
                    <Select
                      value={draft.responderType || "none"}
                      onValueChange={(value) =>
                        setDraft(user.id, {
                          responderType: value === "none" ? "" : (value as ResponderType),
                        })
                      }
                      disabled={draft.role !== "responder"}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Responder Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {responderOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Approval</Label>
                    <Select
                      value={draft.approvalStatus}
                      onValueChange={(value) => setDraft(user.id, { approvalStatus: value as ApprovalStatus })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Approval" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Button
                      variant="outline"
                      className="gap-1"
                      disabled={isSaving}
                      onClick={() => {
                        setDraft(user.id, { approvalStatus: "approved" });
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-1"
                      disabled={isSaving}
                      onClick={() => {
                        setDraft(user.id, { approvalStatus: "rejected" });
                      }}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Reject
                    </Button>
                    <Button disabled={isSaving} className="gap-1" onClick={() => void saveUser(user)}>
                      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <UserCog className="h-3.5 w-3.5" />
                  Created {user.createdAt ? new Date(user.createdAt).toLocaleString() : "-"}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
