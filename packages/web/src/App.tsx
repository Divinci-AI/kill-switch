import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { SignedIn, SignedOut, RedirectToSignIn, UserButton, useAuth, useUser } from "@clerk/clerk-react";
import { useEffect, useState } from "react";
import { setTokenGetter, api } from "./api/client";
import { DashboardPage } from "./pages/Dashboard/DashboardPage";
import { CloudAccountsList } from "./pages/CloudAccounts/CloudAccountsList";
import { ConnectCloudflare } from "./pages/CloudAccounts/ConnectCloudflare";
import { ConnectGCP } from "./pages/CloudAccounts/ConnectGCP";
import { ConnectAWS } from "./pages/CloudAccounts/ConnectAWS";
import { ConnectProvider } from "./pages/CloudAccounts/ConnectProvider";
import { AlertsHistory } from "./pages/Alerts/AlertsHistory";
import { BillingPage } from "./pages/Billing/BillingPage";
import { OnboardingPage } from "./pages/Onboarding/OnboardingPage";
import { SettingsPage } from "./pages/Settings/SettingsPage";
import { AcceptInvitePage } from "./pages/Team/AcceptInvitePage";

function AuthenticatedApp() {
  const { getToken, isLoaded } = useAuth();
  const { user } = useUser();
  const location = useLocation();
  const [accountReady, setAccountReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    if (isLoaded) {
      setTokenGetter(() => getToken());
    }
  }, [isLoaded, getToken]);

  // Fetch account status after auth to check onboarding
  useEffect(() => {
    if (isLoaded && user) {
      api.getMe()
        .then(account => {
          setNeedsOnboarding(!account.onboardingCompleted);
          setAccountReady(true);
        })
        .catch(() => {
          setNeedsOnboarding(true);
          setAccountReady(true);
        });
    }
  }, [isLoaded, user]);

  if (!isLoaded || !accountReady) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0c1229", color: "#fff" }}>
        <p>Loading...</p>
      </div>
    );
  }

  // Show onboarding wizard for new users (full-screen, no nav)
  if (needsOnboarding && location.pathname !== "/billing" && !location.pathname.startsWith("/invite")) {
    return (
      <div style={{ minHeight: "100vh", background: "#0c1229", color: "#c4c5ca" }}>
        <OnboardingPage onComplete={() => setNeedsOnboarding(false)} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0c1229", color: "#c4c5ca" }}>
      {/* Nav */}
      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 24px", height: "56px", background: "rgba(51,51,51,0.55)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "20px" }}>&#9889;</span>
          <Link to="/" style={{ fontFamily: "Outfit, sans-serif", fontWeight: "600", fontSize: "18px", color: "#fff", textDecoration: "none" }}>Kill Switch</Link>
        </div>
        <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
          <Link to="/" style={{ color: "#c4c5ca", textDecoration: "none", fontSize: "14px" }}>Dashboard</Link>
          <Link to="/accounts" style={{ color: "#c4c5ca", textDecoration: "none", fontSize: "14px" }}>Accounts</Link>
          <Link to="/alerts" style={{ color: "#c4c5ca", textDecoration: "none", fontSize: "14px" }}>Alerts</Link>
          <Link to="/billing" style={{ color: "#c4c5ca", textDecoration: "none", fontSize: "14px" }}>Billing</Link>
          <Link to="/settings" style={{ color: "#c4c5ca", textDecoration: "none", fontSize: "14px" }}>Settings</Link>
          <UserButton afterSignOutUrl="/" />
        </div>
      </nav>

      {/* Content */}
      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 24px" }}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/accounts" element={<CloudAccountsList />} />
          <Route path="/accounts/connect" element={<ConnectProvider />} />
          <Route path="/accounts/connect/cloudflare" element={<ConnectCloudflare />} />
          <Route path="/accounts/connect/gcp" element={<ConnectGCP />} />
          <Route path="/accounts/connect/aws" element={<ConnectAWS />} />
          <Route path="/alerts" element={<AlertsHistory />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/invite" element={<AcceptInvitePage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SignedIn>
        <AuthenticatedApp />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </BrowserRouter>
  );
}
