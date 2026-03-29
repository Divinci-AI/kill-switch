import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useOrg } from "../context/OrgContext";
import { api } from "../api/client";

const KNOWN_ERRORS: Record<string, string> = {
  "Creating organizations requires the Team or Enterprise plan": "Upgrade to Team plan to create organizations.",
  "Organization name must be at least 2 characters": "Name must be at least 2 characters.",
  "This slug is already taken": "That name is already in use. Try a different one.",
  "Generated slug already exists. Please try again.": "Please try again with a different name.",
};

function sanitizeError(message?: string): string {
  if (!message) return "Failed to create organization";
  // Return known error if matched, otherwise truncate to safe length
  return KNOWN_ERRORS[message] || message.substring(0, 100);
}

export function OrgSwitcher() {
  const { activeOrg, orgs, switchOrg, refreshOrgs } = useOrg();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [error, setError] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const canCreateOrg = orgs.some(
    o => o.type === "personal" && (o.tier === "team" || o.tier === "enterprise") && o.role === "owner"
  );

  // Only show switcher if user has multiple orgs or can create one
  if (orgs.length <= 1 && !canCreateOrg) return null;

  async function handleSwitch(orgId: string) {
    setOpen(false);
    await switchOrg(orgId);
    navigate("/");
  }

  async function handleCreate() {
    if (!newOrgName.trim()) return;
    setError("");
    try {
      const org = await api.createOrg(newOrgName.trim());
      await refreshOrgs();
      await switchOrg(org.id);
      setCreating(false);
      setNewOrgName("");
      navigate("/");
    } catch (err: any) {
      setError(sanitizeError(err.message));
    }
  }

  const typeBadge = (type: string) => (
    <span style={{
      fontSize: "10px",
      padding: "1px 6px",
      borderRadius: "3px",
      background: type === "organization" ? "rgba(92, 226, 231, 0.15)" : "rgba(255,255,255,0.08)",
      color: type === "organization" ? "#5ce2e7" : "#999",
      marginLeft: "8px",
    }}>
      {type === "organization" ? "Org" : "Personal"}
    </span>
  );

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "6px",
          padding: "4px 12px",
          color: "#fff",
          fontSize: "13px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          maxWidth: "200px",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {activeOrg?.name || "Select org"}
        </span>
        <span style={{ fontSize: "10px", opacity: 0.6 }}>{open ? "\u25B2" : "\u25BC"}</span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          marginTop: "4px",
          background: "#1a1f3a",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "8px",
          padding: "4px 0",
          minWidth: "240px",
          zIndex: 1000,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}>
          {orgs.map(org => (
            <button
              key={org.id}
              onClick={() => handleSwitch(org.id)}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                padding: "8px 12px",
                background: org.id === activeOrg?.id ? "rgba(92, 226, 231, 0.08)" : "transparent",
                border: "none",
                color: "#c4c5ca",
                fontSize: "13px",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {org.name}
              </span>
              {typeBadge(org.type)}
              {org.id === activeOrg?.id && (
                <span style={{ marginLeft: "8px", color: "#5ce2e7", fontSize: "12px" }}>&#10003;</span>
              )}
            </button>
          ))}

          {canCreateOrg && !creating && (
            <>
              <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />
              <button
                onClick={() => setCreating(true)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "8px 12px",
                  background: "transparent",
                  border: "none",
                  color: "#5ce2e7",
                  fontSize: "13px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                + Create Organization
              </button>
            </>
          )}

          {creating && (
            <div style={{ padding: "8px 12px" }}>
              <input
                type="text"
                placeholder="Organization name"
                value={newOrgName}
                onChange={e => setNewOrgName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                autoFocus
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "4px",
                  color: "#fff",
                  fontSize: "13px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {error && <div style={{ color: "#ff6b6b", fontSize: "11px", marginTop: "4px" }}>{error}</div>}
              <button
                onClick={handleCreate}
                style={{
                  marginTop: "6px",
                  padding: "4px 12px",
                  background: "#5ce2e7",
                  color: "#0c1229",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "12px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Create
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
