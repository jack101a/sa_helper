import React, { Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { DashboardLayout } from "./layout/DashboardLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SkeletonCard } from "./components/Skeleton";

const DashboardPanel         = React.lazy(() => import("./components/DashboardPanel").then(m => ({ default: m.DashboardPanel })));
const SubscriptionsPanel      = React.lazy(() => import("./components/SubscriptionsPanel").then(m => ({ default: m.SubscriptionsPanel })));
const UserscriptsPanel       = React.lazy(() => import("./components/UserscriptsPanel").then(m => ({ default: m.UserscriptsPanel })));
const ModelsPanel            = React.lazy(() => import("./components/ModelsPanel").then(m => ({ default: m.ModelsPanel })));
const MappingsPanel          = React.lazy(() => import("./components/MappingsPanel").then(m => ({ default: m.MappingsPanel })));
const ExamStatsPanel         = React.lazy(() => import("./components/ExamStatsPanel").then(m => ({ default: m.ExamStatsPanel })));
const SettingsPanel          = React.lazy(() => import("./components/SettingsPanel").then(m => ({ default: m.SettingsPanel })));
const KeysPanel              = React.lazy(() => import("./components/KeysPanel").then(m => ({ default: m.KeysPanel })));
const AutofillProposalsPanel = React.lazy(() => import("./components/AutofillProposalsPanel").then(m => ({ default: m.AutofillProposalsPanel })));
const CaptchaProposalsPanel  = React.lazy(() => import("./components/CaptchaProposalsPanel").then(m => ({ default: m.CaptchaProposalsPanel })));

import { CheckCircle2, BarChart3, XCircle, Timer } from "lucide-react";

import { useToast }            from "./hooks/useToast";
import { useAdminData }        from "./hooks/useAdminData";
import { useAuth }             from "./hooks/useAuth";
import { useKeyHandlers }      from "./hooks/useKeyHandlers";
import { useSettingsHandlers } from "./hooks/useSettingsHandlers";
import { useModelHandlers }    from "./hooks/useModelHandlers";
import { useProposalHandlers } from "./hooks/useProposalHandlers";

import { useThemeContext } from "./context/ThemeContext";

const KEY_MEM_KEY = "tata_admin_created_keys";

function DashboardPage({
  loading, stats, glassPanel, t_rowHover, t_textMuted, t_textHeading, isDark,
  failedPayloads, selectedPayloads, allPayloadSelected, datasetsDir, modelHandlers,
  apiKeys, access, masterKeyInfo,
  createKeyAllDomains, setCreateKeyAllDomains, createKeyDomainSelections,
  keyHandlers, settingsHandlers,
}) {
  const latencyValue = (() => {
    const v = Math.max(0, Math.round(Number(stats.avg_processing_ms || 0)));
    return v > 9999 ? "9999+" : String(v);
  })();

  const statCards = [
    { label: "Total Requests", value: stats.total_requests?.toLocaleString() || "0", color: "text-indigo-500",   icon: BarChart3 },
    { label: "Success",        value: stats.successful_requests?.toLocaleString() || "0", color: "text-emerald-500", icon: CheckCircle2 },
    { label: "Failed",         value: stats.failed_requests?.toLocaleString() || "0", color: "text-rose-500",    icon: XCircle },
    { label: "Avg Latency",    value: `${latencyValue}ms`, color: "text-cyan-500",    icon: Timer },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading
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
        )})
        }
      </div>

      <DashboardPanel
        failedPayloads={failedPayloads} selectedPayloads={selectedPayloads}
        allPayloadSelected={allPayloadSelected} datasetsDir={datasetsDir}
        loading={loading}
        {...modelHandlers}
      />

      <KeysPanel
        apiKeys={apiKeys} access={access} masterKeyInfo={masterKeyInfo}
        createKeyAllDomains={createKeyAllDomains} setCreateKeyAllDomains={setCreateKeyAllDomains}
        createKeyDomainSelections={createKeyDomainSelections}
        {...keyHandlers} {...settingsHandlers}
      />
    </div>
  );
}

export function App() {
  const { toast, showToast } = useToast();
  const {
    stats, apiKeys, access, models, mappings,
    failedPayloads, datasetsDir,
    autofillProposals, captchaProposals, examStats,
    cloudBackupConfigured, loading, masterKeyInfo, userscripts,
    refresh,
  } = useAdminData(showToast);
  const { logout: handleLogout } = useAuth();
  const { t_textHeading, t_textMuted, t_rowHover, glassPanel, isDark } = useThemeContext();

  const [rememberedKeys,    setRememberedKeys]    = useState({});
  const [createdKeyModal,   setCreatedKeyModal]   = useState({ open: false, keyId: null, keyValue: "", warnings: [] });
  const [editingModelId,    setEditingModelId]    = useState(null);
  const [editingModelDraft, setEditingModelDraft] = useState(null);
  const [editingMappingId,    setEditingMappingId]    = useState(null);
  const [editingMappingDraft, setEditingMappingDraft] = useState(null);
  const [assigningDomainDraft, setAssigningDomainDraft] = useState(null);
  const [selectedPayloads,     setSelectedPayloads]     = useState({});
  const [settingsKeyId,          setSettingsKeyId]          = useState("");
  const [settingsAllDomains,     setSettingsAllDomains]     = useState(true);
  const [settingsKeyRpm,         setSettingsKeyRpm]         = useState(60);
  const [settingsKeyBurst,       setSettingsKeyBurst]       = useState(10);
  const [settingsDomainSelections, setSettingsDomainSelections] = useState([]);
  const [settingsCustomDomain,     setSettingsCustomDomain]     = useState("");
  const [createKeyAllDomains,       setCreateKeyAllDomains]       = useState(true);
  const [createKeyDomainSelections, setCreateKeyDomainSelections] = useState([]);

  const mappingsByDomain = (() => {
    const grouped = {};
    for (const m of mappings) {
      const d = String(m.domain || "-").trim() || "-";
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(m);
    }
    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const allPayloadSelected = failedPayloads.length > 0 && failedPayloads.every(p => selectedPayloads[p.name]);

  useEffect(() => {
    try { const r = localStorage.getItem(KEY_MEM_KEY); if (r) { const p = JSON.parse(r); if (p && typeof p === "object") setRememberedKeys(p); } } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(KEY_MEM_KEY, JSON.stringify(rememberedKeys)); } catch {} }, [rememberedKeys]);
  useEffect(() => {
    if (!apiKeys.length) return;
    const active = apiKeys.find(k => k.enabled) || apiKeys[0];
    if (!active) return;
    if (!settingsKeyId || !apiKeys.some(k => String(k.id) === String(settingsKeyId))) {
      setSettingsKeyId(String(active.id));
      setSettingsAllDomains(active.all_domains !== undefined ? Boolean(active.all_domains) : true);
      setSettingsDomainSelections(active.allowed_domains || []);
      setSettingsKeyRpm(Number(active.rate_limit?.requests_per_minute || 60));
      setSettingsKeyBurst(Number(active.rate_limit?.burst || 10));
    }
  }, [apiKeys, settingsKeyId]);

  const keyHandlers = useKeyHandlers({
    showToast,
    rememberedKeys, setRememberedKeys,
    setCreatedKeyModal,
    createKeyAllDomains, setCreateKeyAllDomains,
    createKeyDomainSelections, setCreateKeyDomainSelections,
  });

  const settingsHandlers = useSettingsHandlers({
    showToast, apiKeys, access,
    settingsKeyId, setSettingsKeyId,
    settingsAllDomains, setSettingsAllDomains,
    settingsDomainSelections, setSettingsDomainSelections,
    settingsKeyRpm, setSettingsKeyRpm,
    settingsKeyBurst, setSettingsKeyBurst,
    settingsCustomDomain, setSettingsCustomDomain,
  });

  const modelHandlers = useModelHandlers({
    showToast,
    setEditingModelId, setEditingModelDraft, editingModelDraft,
    setEditingMappingId, setEditingMappingDraft, editingMappingDraft,
    setAssigningDomainDraft, assigningDomainDraft,
    failedPayloads, selectedPayloads, setSelectedPayloads, allPayloadSelected,
  });

  const proposalHandlers = useProposalHandlers({ showToast });

  return (
    <ErrorBoundary>
      <DashboardLayout
        handleLogout={handleLogout}
        loading={loading} toast={toast}
        createdKeyModal={createdKeyModal} setCreatedKeyModal={setCreatedKeyModal}
        handleCopyKey={keyHandlers.handleCopyKey}
      >
        <Suspense fallback={<div className="flex items-center justify-center py-20"><div className={`animate-spin rounded-full h-8 w-8 border-2 border-t-transparent ${isDark ? "border-indigo-400" : "border-indigo-600"}`} /></div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage
            loading={loading} stats={stats}
            glassPanel={glassPanel} t_rowHover={t_rowHover}
            t_textMuted={t_textMuted} t_textHeading={t_textHeading} isDark={isDark}
            failedPayloads={failedPayloads} selectedPayloads={selectedPayloads}
            allPayloadSelected={allPayloadSelected} datasetsDir={datasetsDir}
            modelHandlers={modelHandlers}
            apiKeys={apiKeys} access={access} masterKeyInfo={masterKeyInfo}
            createKeyAllDomains={createKeyAllDomains}
            setCreateKeyAllDomains={setCreateKeyAllDomains}
            createKeyDomainSelections={createKeyDomainSelections}
            keyHandlers={keyHandlers} settingsHandlers={settingsHandlers}
          />} />
          <Route path="/subscriptions" element={<SubscriptionsPanel showToast={showToast} />} />
          <Route path="/userscripts" element={<UserscriptsPanel userscripts={userscripts} refreshUserscripts={refresh} showToast={showToast} />} />
          <Route path="/models" element={
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <ModelsPanel models={models} editingModelId={editingModelId} editingModelDraft={editingModelDraft} setEditingModelDraft={setEditingModelDraft} {...modelHandlers} />
              <MappingsPanel mappingsByDomain={mappingsByDomain} models={models} editingMappingId={editingMappingId} editingMappingDraft={editingMappingDraft} setEditingMappingDraft={setEditingMappingDraft} assigningDomainDraft={assigningDomainDraft} setAssigningDomainDraft={setAssigningDomainDraft} {...modelHandlers} />
            </div>
          } />
          <Route path="/autofill" element={<AutofillProposalsPanel autofillProposals={autofillProposals} {...proposalHandlers} />} />
          <Route path="/captcha" element={<CaptchaProposalsPanel mappings={mappings} handleRemoveMapping={modelHandlers.handleRemoveMapping} handleQuickEditMapping={modelHandlers.handleQuickEditMapping} captchaProposals={captchaProposals} models={models} {...proposalHandlers} />} />
          <Route path="/exam" element={<ExamStatsPanel examStats={examStats} showToast={showToast} />} />
          <Route path="/automation" element={<Navigate to="/exam" replace />} />
          <Route path="/settings" element={<SettingsPanel apiKeys={apiKeys} access={access} settingsKeyId={settingsKeyId} settingsAllDomains={settingsAllDomains} setSettingsAllDomains={setSettingsAllDomains} settingsDomainSelections={settingsDomainSelections} settingsKeyRpm={settingsKeyRpm} setSettingsKeyRpm={setSettingsKeyRpm} settingsKeyBurst={settingsKeyBurst} setSettingsKeyBurst={setSettingsKeyBurst} settingsCustomDomain={settingsCustomDomain} setSettingsCustomDomain={setSettingsCustomDomain} cloudBackupConfigured={cloudBackupConfigured} showToast={showToast} {...settingsHandlers} />} />
        </Routes>
        </Suspense>
      </DashboardLayout>
    </ErrorBoundary>
  );
}

export default App;
