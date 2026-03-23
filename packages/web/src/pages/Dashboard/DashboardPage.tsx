import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";

interface CloudAccount {
  id: string;
  provider: string;
  name: string;
  status: string;
  lastCheckAt?: number;
  lastCheckStatus?: string;
  lastViolations?: string[];
}

export function DashboardPage() {
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.listCloudAccounts()
      .then(data => setAccounts(data.accounts || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const runManualCheck = async () => {
    setChecking(true);
    try {
      await api.runCheck();
      const data = await api.listCloudAccounts();
      setAccounts(data.accounts || []);
    } catch (e) {
      console.error(e);
    }
    setChecking(false);
  };

  const statusColor = (status?: string) => {
    if (status === "violation") return "#ff6b6b";
    if (status === "error") return "#ffa07a";
    if (status === "ok") return "#5ce2e7";
    return "#6b7280";
  };

  const providerIcon = (p: string) => p === "cloudflare" ? "&#9729;" : p === "gcp" ? "&#9729;" : "&#9729;";
  const timeAgo = (ts?: number) => {
    if (!ts) return "Never";
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.round(mins / 60)}h ago`;
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
        <div>
          <h1 style={{ fontFamily: "Outfit, sans-serif", fontSize: "28px", fontWeight: "700", color: "#fff", margin: 0 }}>Dashboard</h1>
          <p style={{ color: "#6b7280", marginTop: "4px" }}>Monitoring {accounts.length} cloud account{accounts.length !== 1 ? "s" : ""}</p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button onClick={runManualCheck} disabled={checking} style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", padding: "8px 20px", borderRadius: "8px", cursor: "pointer", fontSize: "14px" }}>
            {checking ? "Checking..." : "Run Check"}
          </button>
          <Link to="/accounts/connect/cloudflare" style={{ background: "#c25800", color: "#fff", padding: "8px 20px", borderRadius: "8px", textDecoration: "none", fontSize: "14px", fontWeight: "600", display: "flex", alignItems: "center" }}>
            + Connect Account
          </Link>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 20px", background: "rgba(255,255,255,0.03)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p style={{ fontSize: "48px", marginBottom: "16px" }}>&#128737;&#65039;</p>
          <h2 style={{ fontFamily: "Outfit, sans-serif", color: "#fff", marginBottom: "8px" }}>No cloud accounts connected</h2>
          <p style={{ color: "#6b7280", marginBottom: "24px" }}>Connect your Cloudflare or GCP account to start monitoring.</p>
          <Link to="/accounts/connect/cloudflare" style={{ background: "#c25800", color: "#fff", padding: "12px 32px", borderRadius: "8px", textDecoration: "none", fontWeight: "600" }}>
            Connect Cloudflare
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
          {accounts.map(account => (
            <div key={account.id} style={{ padding: "24px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", borderLeft: `3px solid ${statusColor(account.lastCheckStatus)}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h3 style={{ fontFamily: "Outfit, sans-serif", fontSize: "17px", color: "#fff", margin: 0 }}>{account.name}</h3>
                <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "4px", background: `${statusColor(account.lastCheckStatus)}22`, color: statusColor(account.lastCheckStatus), fontWeight: "600", textTransform: "uppercase" }}>
                  {account.lastCheckStatus || "pending"}
                </span>
              </div>
              <div style={{ display: "flex", gap: "16px", fontSize: "13px", color: "#6b7280" }}>
                <span>{account.provider === "cloudflare" ? "Cloudflare" : "GCP"}</span>
                <span>Checked: {timeAgo(account.lastCheckAt)}</span>
              </div>
              {account.lastViolations && account.lastViolations.length > 0 && (
                <div style={{ marginTop: "12px", padding: "8px 12px", background: "rgba(255,107,107,0.08)", borderRadius: "6px", fontSize: "12px", color: "#ff6b6b" }}>
                  {account.lastViolations.map((v, i) => <div key={i}>{v}</div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
