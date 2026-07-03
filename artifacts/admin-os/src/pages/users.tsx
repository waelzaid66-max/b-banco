import { useState } from "react";
import {
  useGetAdminUsers,
  useGetMe,
  useSetUserBan,
  useSetUserRole,
  useSetUserVerified,
  getGetAdminUsersQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, Ban, ShieldCheck, BadgeCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/context/LanguageContext";
import { hasPermission, STAFF_ROLES, type StaffRole } from "@/lib/permissions";

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-[#E8002D]/15 text-[#E8002D] border-[#E8002D]/30",
  admin: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  moderator: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  support: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  user: "bg-muted text-muted-foreground border-border",
};

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLang();

  const { data: meResp } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const myId = meResp?.data?.id;
  const myStaffRole = meResp?.data?.staff_role;
  const canManageRoles = hasPermission(myStaffRole, "manage_roles");
  const canVerify = hasPermission(myStaffRole, "verify_users");
  const canBan = hasPermission(myStaffRole, "ban_users");

  const { data: usersResp, isLoading } = useGetAdminUsers({ search: search || undefined });
  const users = usersResp?.data ?? [];

  const toggleBan = useSetUserBan();
  const setRole = useSetUserRole();
  const setVerified = useSetUserVerified();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetAdminUsersQueryKey() });

  const handleToggleBan = (id: string, currentlyBanned: boolean) => {
    toggleBan.mutate(
      { id, data: { banned: !currentlyBanned } },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: currentlyBanned
              ? t("usersPage.toastUnbanned")
              : t("usersPage.toastBanned"),
          });
        },
        onError: () =>
          toast({ title: t("usersPage.toastActionFailed"), variant: "destructive" }),
      },
    );
  };

  const handleChangeRole = (id: string, role: StaffRole) => {
    setRole.mutate(
      { id, data: { role } },
      {
        onSuccess: () => {
          refresh();
          toast({ title: t("usersPage.toastRoleUpdated"), description: t(`roles.${role}`) });
        },
        onError: () =>
          toast({
            title: t("usersPage.toastRoleFailed"),
            description: t("usersPage.toastRoleFailedDesc"),
            variant: "destructive",
          }),
      },
    );
  };

  const handleToggleVerified = (id: string, currentlyVerified: boolean) => {
    setVerified.mutate(
      { id, data: { verified: !currentlyVerified } },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: currentlyVerified
              ? t("usersPage.toastUnverified")
              : t("usersPage.toastVerified"),
          });
        },
        onError: () =>
          toast({ title: t("usersPage.toastActionFailed"), variant: "destructive" }),
      },
    );
  };

  const showActions = canVerify || canBan;
  const colCount = 5 + (canManageRoles ? 1 : 0) + (showActions ? 1 : 0);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("usersPage.title")}</h1>
          <p className="text-muted-foreground mt-2">{t("usersPage.subtitle")}</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute start-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("usersPage.searchPh")}
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("usersPage.colUser")}</TableHead>
              <TableHead>{t("usersPage.colAccountNo")}</TableHead>
              <TableHead>{t("usersPage.colRole")}</TableHead>
              {canManageRoles && <TableHead>{t("usersPage.colStaffRole")}</TableHead>}
              <TableHead>{t("usersPage.colStatus")}</TableHead>
              <TableHead>{t("usersPage.colListings")}</TableHead>
              {showActions && <TableHead className="text-end">{t("usersPage.colActions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={colCount} className="h-24 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                </TableCell>
              </TableRow>
            ) : !users.length ? (
              <TableRow>
                <TableCell colSpan={colCount} className="h-24 text-center text-muted-foreground">
                  {t("usersPage.empty")}
                </TableCell>
              </TableRow>
            ) : (
              users.map((user: NonNullable<typeof users>[number]) => {
                const isSelf = !!myId && user.id === myId;
                const staffRole = (user.staff_role ?? "user") as StaffRole;
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.email || user.phone}</div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {user.account_number || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{user.role}</Badge>
                    </TableCell>
                    {canManageRoles && (
                      <TableCell>
                        <Select
                          value={staffRole}
                          onValueChange={(v) => handleChangeRole(user.id!, v as StaffRole)}
                          disabled={isSelf || setRole.isPending}
                        >
                          <SelectTrigger className="w-[140px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STAFF_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {t(`roles.${r}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isSelf && (
                          <div className="text-[10px] text-muted-foreground mt-1">{t("usersPage.you")}</div>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {staffRole !== "user" && (
                          <Badge variant="outline" className={`capitalize ${ROLE_BADGE[staffRole]}`}>
                            {t(`roles.${staffRole}`)}
                          </Badge>
                        )}
                        {user.is_shadow_banned ? (
                          <Badge variant="destructive">{t("usersPage.shadowBanned")}</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20">{t("usersPage.activeStatus")}</Badge>
                        )}
                        {user.is_verified && (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                            <BadgeCheck className="w-3 h-3 me-1" /> {t("usersPage.verified")}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{user.listing_count}</TableCell>
                    {showActions && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canVerify && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleToggleVerified(user.id!, !!user.is_verified)}
                              disabled={setVerified.isPending}
                            >
                              <ShieldCheck className="w-4 h-4 me-2" />
                              {user.is_verified ? t("usersPage.unverify") : t("usersPage.verify")}
                            </Button>
                          )}
                          {canBan && (
                            <Button
                              variant={user.is_shadow_banned ? "outline" : "destructive"}
                              size="sm"
                              onClick={() => handleToggleBan(user.id!, !!user.is_shadow_banned)}
                              disabled={toggleBan.isPending}
                            >
                              {user.is_shadow_banned ? (
                                <><ShieldCheck className="w-4 h-4 me-2" /> {t("usersPage.unban")}</>
                              ) : (
                                <><Ban className="w-4 h-4 me-2" /> {t("usersPage.ban")}</>
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
