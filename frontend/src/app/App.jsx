import React, { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import { DashboardLayout } from "./layout/DashboardLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AdminDataProvider, useAdminDataContext } from "./context/AdminDataContext";
import { useThemeContext } from "./context/ThemeContext";
import { CheckCircle2, BarChart3, XCircle, Timer } from "lucide-react";
import { SkeletonCard } from "./components/Skeleton";

const DashboardPanel = React.lazy(() => import("./components/DashboardPanel").then(m => ({ default: m.DashboardPanel })));
const SubscriptionsPanel = React.lazy(() => import("./components/SubscriptionsPanel").then(m => ({ default: m.SubscriptionsPanel })));
const UserscriptsPanel = React.lazy(() => import("./components/UserscriptsPanel").then(m => ({ default: m.UserscriptsPanel })));
const ModelsPanel = React.lazy(() => import("./components/ModelsPanel").then(m => ({ default: m.ModelsPanel })));
const MappingsPanel = React.lazy(() => import("./components/MappingsPanel").then(m => ({ default: m.MappingsPanel })));
const ExamStatsPanel = React.lazy(() => import("./components/ExamStatsPanel").then(m => ({ default: m.ExamStatsPanel })));
const SettingsPanel = React.lazy(() => import("./components/SettingsPanel").then(m => ({ default: m.SettingsPanel })));
const KeysPanel = React.lazy(() => import("./components/KeysPanel").then(m => ({ default: m.KeysPanel })));
const AutofillProposalsPanel = React.lazy(() => import("./components/AutofillProposalsPanel").then(m => ({ default: m.AutofillProposalsPanel })));
const CaptchaProposalsPanel = React.lazy(() => import("./components/CaptchaProposalsPanel").then(m => ({ default: m.CaptchaProposalsPanel })));

function DashboardPage() {
  const ctx = useAdminDataContext();
  const { t_textHeading, t_textMuted, t_rowHover, glassPanel, isDark } = useThemeContext();

  const latencyValue = (() => {
    const v = Math.max(0, Math.round(Number(ctx.stats.avg_processing_ms || 0)));
    return v > 9999 ? "9999+" : String(v);
  })();

  const statCards = [
    { label: "Total Requests", value: ctx.stats.total_requests?.toLocaleString() || "0", color: "text-indigo-500", icon: BarChart3 },
    { label: "Success", value: ctx.stats.successful_requests?.toLocaleString() || "0", color: "text-emerald-500", icon: CheckCircle2 },
    { label: "Failed", value: ctx.stats.failed_requests?.toLocaleString() || "0", color: "text-rose-500", icon: XCircle },
    { label: "Avg Latency", value: `${latencyValue}ms`, color: "text-cyan-500", icon: Timer },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {ctx.loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className={`rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group ${glassPanel} ${t_rowHover}`}>
                  <div>
                    <p className={`text-sm font-medium mb-1 ${t_textMuted}`}>{s.label}</p>
                    <p className={`text-2xl sm:text-3xl font-bold tracking-tight ${t_textHeading}`}>{s.value}</p>
                  </div>
                  <div className={`p-3 rounded-xl border group-hover:scale-110 transition-transform ${isDark ? "bg-white/[0.05] border-white/5" : "bg-white border-white/60 shadow-sm"} ${s.color}`}>
                    <Icon size={24} />
                  </div>
                </div>
              );
            })}
      </div>

      <DashboardPanel
        failedPayloads={ctx.failedPayloads}
        selectedPayloads={ctx.selectedPayloads}
        allPayloadSelected={ctx.allPayloadSelected}
        datasetsDir={ctx.datasetsDir}
        loading={ctx.loading}
        showToast={ctx.showToast}
        {...ctx.modelHandlers}
      />

      <KeysPanel
        apiKeys={ctx.apiKeys}
        access={ctx.access}
        masterKeyInfo={ctx.masterKeyInfo}
        createKeyAllDomains={ctx.createKeyAllDomains}
        setCreateKeyAllDomains={ctx.setCreateKeyAllDomains}
        createKeyDomainSelections={ctx.createKeyDomainSelections}
        {...ctx.keyHandlers}
        {...ctx.settingsHandlers}
      />
    </div>
  );
}

function AppRoutes() {
  const ctx = useAdminDataContext();
  const { isDark } = useThemeContext();

  return (
    <DashboardLayout
      handleLogout={ctx.handleLogout}
      loading={ctx.loading}
      toast={ctx.toast}
      createdKeyModal={ctx.createdKeyModal}
      setCreatedKeyModal={ctx.setCreatedKeyModal}
      handleCopyKey={ctx.keyHandlers.handleCopyKey}
    >
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className={`animate-spin rounded-full h-8 w-8 border-2 border-t-transparent ${isDark ? "border-indigo-400" : "border-indigo-600"}`} /></div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/subscriptions" element={<SubscriptionsPanel showToast={ctx.showToast} />} />
          <Route path="/userscripts" element={<UserscriptsPanel userscripts={ctx.userscripts} refreshUserscripts={ctx.refresh} showToast={ctx.showToast} />} />
          <Route
            path="/models"
            element={
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <ModelsPanel models={ctx.models} editingModelId={ctx.editingModelId} editingModelDraft={ctx.editingModelDraft} setEditingModelDraft={ctx.setEditingModelDraft} {...ctx.modelHandlers} />
                <MappingsPanel mappingsByDomain={ctx.mappingsByDomain} models={ctx.models} editingMappingId={ctx.editingMappingId} editingMappingDraft={ctx.editingMappingDraft} setEditingMappingDraft={ctx.setEditingMappingDraft} assigningDomainDraft={ctx.assigningDomainDraft} setAssigningDomainDraft={ctx.setAssigningDomainDraft} {...ctx.modelHandlers} />
              </div>
            }
          />
          <Route path="/autofill" element={<AutofillProposalsPanel autofillProposals={ctx.autofillProposals} {...ctx.proposalHandlers} />} />
          <Route path="/captcha" element={<CaptchaProposalsPanel mappings={ctx.mappings} handleRemoveMapping={ctx.modelHandlers.handleRemoveMapping} handleQuickEditMapping={ctx.modelHandlers.handleQuickEditMapping} captchaProposals={ctx.captchaProposals} models={ctx.models} {...ctx.proposalHandlers} />} />
          <Route path="/exam" element={<ExamStatsPanel examStats={ctx.examStats} showToast={ctx.showToast} />} />
          <Route path="/automation" element={<Navigate to="/exam" replace />} />
          <Route path="/settings" element={<SettingsPanel apiKeys={ctx.apiKeys} access={ctx.access} settingsKeyId={ctx.settingsKeyId} settingsAllDomains={ctx.settingsAllDomains} setSettingsAllDomains={ctx.setSettingsAllDomains} settingsDomainSelections={ctx.settingsDomainSelections} settingsKeyRpm={ctx.settingsKeyRpm} setSettingsKeyRpm={ctx.setSettingsKeyRpm} settingsKeyBurst={ctx.settingsKeyBurst} setSettingsKeyBurst={ctx.setSettingsKeyBurst} settingsCustomDomain={ctx.settingsCustomDomain} setSettingsCustomDomain={ctx.setSettingsCustomDomain} cloudBackupConfigured={ctx.cloudBackupConfigured} refreshData={ctx.refresh} showToast={ctx.showToast} {...ctx.settingsHandlers} />} />
        </Routes>
      </Suspense>
    </DashboardLayout>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AdminDataProvider>
        <AppRoutes />
      </AdminDataProvider>
    </ErrorBoundary>
  );
}

export default App;
