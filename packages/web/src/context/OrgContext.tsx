import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api, setActiveOrgId } from "../api/client";

export interface Org {
  id: string;
  name: string;
  slug: string;
  type: "personal" | "organization";
  tier: string;
  role: string;
}

interface OrgContextValue {
  activeOrg: Org | null;
  orgs: Org[];
  teamRole: string | null;
  switchOrg: (orgId: string) => Promise<void>;
  refreshOrgs: () => Promise<void>;
  loading: boolean;
}

const OrgContext = createContext<OrgContextValue>({
  activeOrg: null,
  orgs: [],
  teamRole: null,
  switchOrg: async () => {},
  refreshOrgs: async () => {},
  loading: true,
});

export function useOrg() {
  return useContext(OrgContext);
}

interface OrgProviderProps {
  children: React.ReactNode;
  /** Initial account data from /accounts/me to avoid a duplicate fetch */
  initialAccount?: any;
}

export function OrgProvider({ children, initialAccount }: OrgProviderProps) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrgIdState, setActiveOrgIdState] = useState<string | null>(null);
  const [teamRole, setTeamRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyAccountData = useCallback((me: any) => {
    const orgList: Org[] = me.orgs || [];
    setOrgs(orgList);
    const currentOrgId = me.activeOrgId || orgList[0]?.id || null;
    setActiveOrgIdState(currentOrgId);
    setActiveOrgId(currentOrgId);
    setTeamRole(me.teamRole || null);
  }, []);

  const refreshOrgs = useCallback(async () => {
    try {
      const me = await api.getMe();
      applyAccountData(me);
    } catch (err) {
      console.error("[OrgContext] Failed to refresh orgs:", err);
    } finally {
      setLoading(false);
    }
  }, [applyAccountData]);

  // Initialize from parent data or fetch fresh
  useEffect(() => {
    if (initialAccount?.orgs) {
      applyAccountData(initialAccount);
      setLoading(false);
    } else {
      refreshOrgs();
    }
  }, [initialAccount, applyAccountData, refreshOrgs]);

  const switchOrg = useCallback(async (orgId: string) => {
    await api.switchOrg(orgId);
    setActiveOrgIdState(orgId);
    setActiveOrgId(orgId);
    await refreshOrgs();
  }, [refreshOrgs]);

  const activeOrg = orgs.find(o => o.id === activeOrgIdState) || null;

  return (
    <OrgContext.Provider value={{ activeOrg, orgs, teamRole, switchOrg, refreshOrgs, loading }}>
      {children}
    </OrgContext.Provider>
  );
}
