# Task P9 — Frontend State Management & Extension Build

> **Tasks**: T32, T33, T34  
> **Priority**: P9 (last — cosmetic/DX improvement)  
> **Depends on**: T11-T15 (plan entitlements must exist in backend)  
> **Estimated changes**: ~200 lines new, ~80 lines modified

---

## Files to Read First

1. `frontend/src/app/App.jsx` — entire file (221 lines) — the state monster
2. `frontend/src/app/hooks/useAdminData.js` — data fetching layer (75 lines)
3. `frontend/src/app/context/ThemeContext.jsx` — existing context pattern (668 bytes)
4. `frontend/src/app/components/PlansPanel.jsx` — existing plan editor
5. `frontend/src/app/components/SubscriptionsPanel.jsx` — subscription list
6. `frontend/src/api/queries.js` — API query functions
7. `frontend/package.json` — dependencies (check for @tanstack/react-query)

---

## Current Problem

`App.jsx` has **16 useState calls** (lines 102-117) that get passed down as props through 5+ levels. This is the classic "prop drilling" problem. The app already has `ThemeContext` and `@tanstack/react-query` — we should use these existing patterns to reduce App.jsx complexity.

---

## T32: Create AdminDataContext (Extract State from App.jsx)

### Goal

Move the 16 useState calls and 4 handler hooks from App.jsx into a context provider, reducing App.jsx to pure routing.

### Step 32.1: Create the context

**Create NEW file**: `frontend/src/app/context/AdminDataContext.jsx`

```jsx
import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useToast } from '../hooks/useToast';
import { useAdminData } from '../hooks/useAdminData';
import { useAuth } from '../hooks/useAuth';
import { useKeyHandlers } from '../hooks/useKeyHandlers';
import { useSettingsHandlers } from '../hooks/useSettingsHandlers';
import { useModelHandlers } from '../hooks/useModelHandlers';
import { useProposalHandlers } from '../hooks/useProposalHandlers';

const AdminDataContext = createContext(null);

const KEY_MEM_KEY = 'tata_admin_created_keys';

export function AdminDataProvider({ children }) {
  const { toast, showToast } = useToast();
  const {
    stats, apiKeys, access, models, mappings,
    failedPayloads, datasetsDir,
    autofillProposals, captchaProposals, examStats,
    cloudBackupConfigured, loading, masterKeyInfo, userscripts,
    refresh,
  } = useAdminData(showToast);
  const { logout: handleLogout } = useAuth();

  // ── UI State ──
  const [rememberedKeys,    setRememberedKeys]    = useState({});
  const [createdKeyModal,   setCreatedKeyModal]   = useState({ open: false, keyId: null, keyValue: '', warnings: [] });
  const [editingModelId,    setEditingModelId]    = useState(null);
  const [editingModelDraft, setEditingModelDraft] = useState(null);
  const [editingMappingId,    setEditingMappingId]    = useState(null);
  const [editingMappingDraft, setEditingMappingDraft] = useState(null);
  const [assigningDomainDraft, setAssigningDomainDraft] = useState(null);
  const [selectedPayloads,     setSelectedPayloads]     = useState({});
  const [settingsKeyId,          setSettingsKeyId]          = useState('');
  const [settingsAllDomains,     setSettingsAllDomains]     = useState(true);
  const [settingsKeyRpm,         setSettingsKeyRpm]         = useState(60);
  const [settingsKeyBurst,       setSettingsKeyBurst]       = useState(10);
  const [settingsDomainSelections, setSettingsDomainSelections] = useState([]);
  const [settingsCustomDomain,     setSettingsCustomDomain]     = useState('');
  const [createKeyAllDomains,       setCreateKeyAllDomains]       = useState(true);
  const [createKeyDomainSelections, setCreateKeyDomainSelections] = useState([]);

  // ── Derived state ──
  const mappingsByDomain = useMemo(() => {
    const grouped = {};
    for (const m of mappings) {
      const d = String(m.domain || '-').trim() || '-';
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(m);
    }
    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]));
  }, [mappings]);

  const allPayloadSelected = failedPayloads.length > 0 && failedPayloads.every(p => selectedPayloads[p.name]);

  // ── Effects (keep identical to App.jsx lines 131-146) ──
  useEffect(() => {
    try { const r = localStorage.getItem(KEY_MEM_KEY); if (r) { const p = JSON.parse(r); if (p && typeof p === 'object') setRememberedKeys(p); } } catch {}
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

  // ── Handlers ──
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

  const value = {
    // Data
    stats, apiKeys, access, models, mappings, mappingsByDomain,
    failedPayloads, datasetsDir, allPayloadSelected,
    autofillProposals, captchaProposals, examStats,
    cloudBackupConfigured, loading, masterKeyInfo, userscripts,
    refresh,
    // Auth
    handleLogout,
    // UI state
    toast, showToast,
    rememberedKeys, setRememberedKeys,
    createdKeyModal, setCreatedKeyModal,
    editingModelId, editingModelDraft, setEditingModelDraft,
    editingMappingId, editingMappingDraft, setEditingMappingDraft,
    assigningDomainDraft, setAssigningDomainDraft,
    selectedPayloads, setSelectedPayloads,
    settingsKeyId, settingsAllDomains, setSettingsAllDomains,
    settingsDomainSelections, settingsKeyRpm, setSettingsKeyRpm,
    settingsKeyBurst, setSettingsKeyBurst,
    settingsCustomDomain, setSettingsCustomDomain,
    createKeyAllDomains, setCreateKeyAllDomains,
    createKeyDomainSelections,
    // Handlers
    keyHandlers, settingsHandlers, modelHandlers, proposalHandlers,
  };

  return (
    <AdminDataContext.Provider value={value}>
      {children}
    </AdminDataContext.Provider>
  );
}

export function useAdminDataContext() {
  const ctx = useContext(AdminDataContext);
  if (!ctx) throw new Error('useAdminDataContext must be used within AdminDataProvider');
  return ctx;
}
```

### Step 32.2: Simplify App.jsx

**File**: `frontend/src/app/App.jsx`

Replace the entire file with a thin routing shell:

```jsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { DashboardLayout } from './layout/DashboardLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AdminDataProvider, useAdminDataContext } from './context/AdminDataContext';
import { useThemeContext } from './context/ThemeContext';

// Lazy-loaded panels (keep existing pattern)
const DashboardPanel         = React.lazy(() => import('./components/DashboardPanel').then(m => ({ default: m.DashboardPanel })));
const SubscriptionsPanel      = React.lazy(() => import('./components/SubscriptionsPanel').then(m => ({ default: m.SubscriptionsPanel })));
const UserscriptsPanel       = React.lazy(() => import('./components/UserscriptsPanel').then(m => ({ default: m.UserscriptsPanel })));
const ModelsPanel            = React.lazy(() => import('./components/ModelsPanel').then(m => ({ default: m.ModelsPanel })));
const MappingsPanel          = React.lazy(() => import('./components/MappingsPanel').then(m => ({ default: m.MappingsPanel })));
const ExamStatsPanel         = React.lazy(() => import('./components/ExamStatsPanel').then(m => ({ default: m.ExamStatsPanel })));
const SettingsPanel          = React.lazy(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const KeysPanel              = React.lazy(() => import('./components/KeysPanel').then(m => ({ default: m.KeysPanel })));
const AutofillProposalsPanel = React.lazy(() => import('./components/AutofillProposalsPanel').then(m => ({ default: m.AutofillProposalsPanel })));
const CaptchaProposalsPanel  = React.lazy(() => import('./components/CaptchaProposalsPanel').then(m => ({ default: m.CaptchaProposalsPanel })));

import { CheckCircle2, BarChart3, XCircle, Timer } from 'lucide-react';
import { SkeletonCard } from './components/Skeleton';

function DashboardPage() {
  const ctx = useAdminDataContext();
  const { t_textHeading, t_textMuted, t_rowHover, glassPanel, isDark } = useThemeContext();

  const latencyValue = (() => {
    const v = Math.max(0, Math.round(Number(ctx.stats.avg_processing_ms || 0)));
    return v > 9999 ? '9999+' : String(v);
  })();

  const statCards = [
    { label: 'Total Requests', value: ctx.stats.total_requests?.toLocaleString() || '0', color: 'text-indigo-500',   icon: BarChart3 },
    { label: 'Success',        value: ctx.stats.successful_requests?.toLocaleString() || '0', color: 'text-emerald-500', icon: CheckCircle2 },
    { label: 'Failed',         value: ctx.stats.failed_requests?.toLocaleString() || '0', color: 'text-rose-500',    icon: XCircle },
    { label: 'Avg Latency',    value: `${latencyValue}ms`, color: 'text-cyan-500',    icon: Timer },
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
            <div className={`p-3 rounded-xl border group-hover:scale-110 transition-transform ${isDark ? 'bg-white/[0.05] border-white/5' : 'bg-white border-white/60 shadow-sm'} ${s.color}`}>
              <Icon size={24} />
            </div>
          </div>
        )})}
      </div>

      <DashboardPanel
        failedPayloads={ctx.failedPayloads} selectedPayloads={ctx.selectedPayloads}
        allPayloadSelected={ctx.allPayloadSelected} datasetsDir={ctx.datasetsDir}
        loading={ctx.loading}
        {...ctx.modelHandlers}
      />

      <KeysPanel
        apiKeys={ctx.apiKeys} access={ctx.access} masterKeyInfo={ctx.masterKeyInfo}
        createKeyAllDomains={ctx.createKeyAllDomains} setCreateKeyAllDomains={ctx.setCreateKeyAllDomains}
        createKeyDomainSelections={ctx.createKeyDomainSelections}
        {...ctx.keyHandlers} {...ctx.settingsHandlers}
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
      loading={ctx.loading} toast={ctx.toast}
      createdKeyModal={ctx.createdKeyModal} setCreatedKeyModal={ctx.setCreatedKeyModal}
      handleCopyKey={ctx.keyHandlers.handleCopyKey}
    >
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className={`animate-spin rounded-full h-8 w-8 border-2 border-t-transparent ${isDark ? 'border-indigo-400' : 'border-indigo-600'}`} /></div>}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPanel showToast={ctx.showToast} />} />
        <Route path="/userscripts" element={<UserscriptsPanel userscripts={ctx.userscripts} refreshUserscripts={ctx.refresh} showToast={ctx.showToast} />} />
        <Route path="/models" element={
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <ModelsPanel models={ctx.models} editingModelId={ctx.editingModelId} editingModelDraft={ctx.editingModelDraft} setEditingModelDraft={ctx.setEditingModelDraft} {...ctx.modelHandlers} />
            <MappingsPanel mappingsByDomain={ctx.mappingsByDomain} models={ctx.models} editingMappingId={ctx.editingMappingId} editingMappingDraft={ctx.editingMappingDraft} setEditingMappingDraft={ctx.setEditingMappingDraft} assigningDomainDraft={ctx.assigningDomainDraft} setAssigningDomainDraft={ctx.setAssigningDomainDraft} {...ctx.modelHandlers} />
          </div>
        } />
        <Route path="/autofill" element={<AutofillProposalsPanel autofillProposals={ctx.autofillProposals} {...ctx.proposalHandlers} />} />
        <Route path="/captcha" element={<CaptchaProposalsPanel mappings={ctx.mappings} handleRemoveMapping={ctx.modelHandlers.handleRemoveMapping} handleQuickEditMapping={ctx.modelHandlers.handleQuickEditMapping} captchaProposals={ctx.captchaProposals} models={ctx.models} {...ctx.proposalHandlers} />} />
        <Route path="/exam" element={<ExamStatsPanel examStats={ctx.examStats} showToast={ctx.showToast} />} />
        <Route path="/automation" element={<Navigate to="/exam" replace />} />
        <Route path="/settings" element={<SettingsPanel apiKeys={ctx.apiKeys} access={ctx.access} settingsKeyId={ctx.settingsKeyId} settingsAllDomains={ctx.settingsAllDomains} setSettingsAllDomains={ctx.setSettingsAllDomains} settingsDomainSelections={ctx.settingsDomainSelections} settingsKeyRpm={ctx.settingsKeyRpm} setSettingsKeyRpm={ctx.setSettingsKeyRpm} settingsKeyBurst={ctx.settingsKeyBurst} setSettingsKeyBurst={ctx.setSettingsKeyBurst} settingsCustomDomain={ctx.settingsCustomDomain} setSettingsCustomDomain={ctx.setSettingsCustomDomain} cloudBackupConfigured={ctx.cloudBackupConfigured} showToast={ctx.showToast} {...ctx.settingsHandlers} />} />
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
```

> **CRITICAL**: This is a full rewrite of App.jsx. Every route and prop MUST match the original exactly. Compare line-by-line before committing.

---

## T33: Add Plan Entitlement Fields to PlansPanel

### Goal

Add `max_devices`, `allowed_services`, and `rate_limit_rpm` fields to the admin plan editor.

**File**: `frontend/src/app/components/PlansPanel.jsx`

**Read the file first.** Find the form fields (likely inside a `<form>` or a create/edit modal).

**Add these fields** after the existing fields (price, duration, monthly_limit):

```jsx
{/* Max Devices */}
<div>
  <label className={`block text-sm font-medium mb-1 ${t_textMuted}`}>Max Devices</label>
  <input
    type="number"
    min="1"
    max="10"
    value={draft.max_devices || 1}
    onChange={e => setDraft(d => ({ ...d, max_devices: parseInt(e.target.value) || 1 }))}
    className={inputClass}
    id="plan-max-devices"
  />
</div>

{/* Rate Limit (RPM) */}
<div>
  <label className={`block text-sm font-medium mb-1 ${t_textMuted}`}>Rate Limit (req/min)</label>
  <input
    type="number"
    min="1"
    max="1000"
    value={draft.rate_limit_rpm || 60}
    onChange={e => setDraft(d => ({ ...d, rate_limit_rpm: parseInt(e.target.value) || 60 }))}
    className={inputClass}
    id="plan-rate-limit"
  />
</div>

{/* Allowed Services */}
<div>
  <label className={`block text-sm font-medium mb-1 ${t_textMuted}`}>Allowed Services</label>
  <div className="flex flex-wrap gap-3">
    {['captcha', 'solver', 'autofill', 'exam'].map(svc => (
      <label key={svc} className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={!!(draft.allowed_services || {})[svc]}
          onChange={e => setDraft(d => ({
            ...d,
            allowed_services: { ...(d.allowed_services || {}), [svc]: e.target.checked },
          }))}
          id={`plan-service-${svc}`}
        />
        <span className="capitalize">{svc}</span>
      </label>
    ))}
  </div>
</div>
```

> **IMPORTANT**: Read PlansPanel.jsx to understand:
> 1. The variable names for draft state (might be `draft`, `formData`, `newPlan`, etc.)
> 2. The CSS class names used for inputs (`inputClass`, etc.)
> 3. The theme context usage pattern
> 4. Match all conventions exactly.

---

## T34: Add Training Stats to ExamStatsPanel

### Goal

Show the MCQ training pipeline stats in the exam panel.

**File**: `frontend/src/app/components/ExamStatsPanel.jsx`

**Read the file first.** Then add a section that fetches and displays training stats.

### Step 34.1: Add training stats fetch

**File**: `frontend/src/api/queries.js`

**Add this query function:**

```js
export const fetchTrainingStats = async () => {
  const res = await fetch('/admin/api/exam/training-stats', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch training stats');
  return res.json();
};

// Add to queryKeys object:
export const queryKeys = {
  // ... existing keys ...
  trainingStats: ['trainingStats'],
};
```

### Step 34.2: Display training stats

**File**: `frontend/src/app/components/ExamStatsPanel.jsx`

**Add inside the component**, after the existing stats display:

```jsx
// At the top of the component, add useQuery:
import { useQuery } from '@tanstack/react-query';
import { fetchTrainingStats, queryKeys } from '../../api/queries';

// Inside the component function:
const training = useQuery({
  queryKey: queryKeys.trainingStats,
  queryFn: fetchTrainingStats,
  staleTime: 60_000,
});

// In the JSX, add a section:
{training.data && (
  <div className={`rounded-2xl p-5 ${glassPanel}`}>
    <h3 className={`text-lg font-semibold mb-3 ${t_textHeading}`}>
      📚 Training Pipeline
    </h3>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div>
        <p className={`text-sm ${t_textMuted}`}>Main Bank</p>
        <p className={`text-xl font-bold ${t_textHeading}`}>{training.data.main_bank_count}</p>
      </div>
      <div>
        <p className={`text-sm ${t_textMuted}`}>Learned Total</p>
        <p className={`text-xl font-bold ${t_textHeading}`}>{training.data.learned_total}</p>
      </div>
      <div>
        <p className={`text-sm ${t_textMuted}`}>Verified</p>
        <p className={`text-xl font-bold text-emerald-500`}>{training.data.learned_verified}</p>
      </div>
      <div>
        <p className={`text-sm ${t_textMuted}`}>In-Memory Index</p>
        <p className={`text-xl font-bold ${t_textHeading}`}>{training.data.inmemory_hash_count}</p>
      </div>
    </div>
    <button
      onClick={async () => {
        try {
          const res = await fetch('/admin/api/exam/merge', { method: 'POST', credentials: 'include' });
          const data = await res.json();
          showToast(data.merged > 0
            ? `✅ Merged ${data.merged} questions (total: ${data.total_bank})`
            : 'No new questions to merge');
          training.refetch();
        } catch (e) {
          showToast('Merge failed: ' + e.message, 'error');
        }
      }}
      className="mt-3 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition-colors"
      id="force-merge-btn"
    >
      🔄 Force Merge Now
    </button>
  </div>
)}
```

> **IMPORTANT**: Read ExamStatsPanel.jsx to understand:
> 1. How `glassPanel`, `t_textHeading`, `t_textMuted` are accessed (props vs context)
> 2. How `showToast` is accessed
> 3. Match the existing visual style exactly

---

## Verification

```bash
# 1. Frontend builds without errors
cd frontend && npm run build

# 2. No console errors on dashboard load (check in browser)
cd frontend && npm run dev
# Open http://localhost:5173/admin/dashboard in browser
# Check console for errors
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `frontend/src/app/context/AdminDataContext.jsx` | [NEW] ~130 lines — central state provider |
| `frontend/src/app/App.jsx` | REWRITE — ~100 lines thin routing shell |
| `frontend/src/app/components/PlansPanel.jsx` | +~40 lines — entitlement fields |
| `frontend/src/app/components/ExamStatsPanel.jsx` | +~50 lines — training stats + merge button |
| `frontend/src/api/queries.js` | +~8 lines — training stats query |
