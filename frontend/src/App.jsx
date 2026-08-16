import React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useApp } from "./store.jsx";
import { Layout } from "./Layout.jsx";
import { Login } from "./pages/Login.jsx";
import { Dashboard } from "./pages/Dashboard.jsx";
import { WhatsAppPage } from "./pages/WhatsApp.jsx";
import { GroupsPage } from "./pages/Groups.jsx";
import { InboxPage } from "./pages/Inbox.jsx";
import { CampaignsPage } from "./pages/Campaigns.jsx";
import { WizardPage } from "./pages/Wizard.jsx";
import { CampaignDetail } from "./pages/CampaignDetail.jsx";
import { TemplatesPage } from "./pages/Templates.jsx";
import { AutoReplyPage } from "./pages/AutoReply.jsx";
import { AiPage } from "./pages/Ai.jsx";
import { SchedulerPage } from "./pages/Scheduler.jsx";
import { ReportsPage } from "./pages/Reports.jsx";
import { SettingsPage } from "./pages/Settings.jsx";

function Guard({ children }) {
  const { user } = useApp();
  const loc = useLocation();
  if (user === undefined) return <div className="main">در حال بارگذاری...</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return children;
}

export default function App() {
  const { user } = useApp();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <Guard>
            <Layout />
          </Guard>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="whatsapp" element={<WhatsAppPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="campaigns/new" element={<WizardPage />} />
        <Route path="campaigns/:id" element={<CampaignDetail />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="auto-reply" element={<AutoReplyPage />} />
        <Route path="ai" element={<AiPage />} />
        <Route path="scheduler" element={<SchedulerPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
