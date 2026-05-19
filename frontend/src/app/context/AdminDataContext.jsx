import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { useToast } from "../hooks/useToast";
import { useAdminData } from "../hooks/useAdminData";
import { useAuth } from "../hooks/useAuth";
import { useKeyHandlers } from "../hooks/useKeyHandlers";
import { useSettingsHandlers } from "../hooks/useSettingsHandlers";
import { useModelHandlers } from "../hooks/useModelHandlers";
import { useProposalHandlers } from "../hooks/useProposalHandlers";

const AdminDataContext = createContext(null);

const KEY_MEM_KEY = "tata_admin_created_keys";

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
  const [rememberedKeys, setRememberedKeys] = useState({});
  const [createdKeyModal, setCreatedKeyModal] = useState({ open: false, keyId: null, keyValue: "", warnings: [] });
  const [editingModelId, setEditingModelId] = useState(null);
  const [editingModelDraft, setEditingModelDraft] = useState(null);
  const [editingMappingId, setEditingMappingId] = useState(null);
  const [editingMappingDraft, setEditingMappingDraft] = useState(null);
  const [assigningDomainDraft, setAssigningDomainDraft] = useState(null);
  const [selectedPayloads, setSelectedPayloads] = useState({});
  const [settingsKeyId, setSettingsKeyId] = useState("");
  const [settingsAllDomains, setSettingsAllDomains] = useState(true);
  const [settingsKeyRpm, setSettingsKeyRpm] = useState(60);
  const [settingsKeyBurst, setSettingsKeyBurst] = useState(10);
  const [settingsDomainSelections, setSettingsDomainSelections] = useState([]);
  const [settingsCustomDomain, setSettingsCustomDomain] = useState("");
  const [createKeyAllDomains, setCreateKeyAllDomains] = useState(true);
  const [createKeyDomainSelections, setCreateKeyDomainSelections] = useState([]);

  // ── Derived state ──
  const mappingsByDomain = useMemo(() => {
    const grouped = {};
    for (const m of mappings) {
      const d = String(m.domain || "-").trim() || "-";
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(m);
    }
    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]));
  }, [mappings]);

  const allPayloadSelected = failedPayloads.length > 0 && failedPayloads.every(p => selectedPayloads[p.name]);

  // ── Effects ──
  useEffect(() => {
    try {
      const r = localStorage.getItem(KEY_MEM_KEY);
      if (r) {
        const p = JSON.parse(r);
        if (p && typeof p === "object") setRememberedKeys(p);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY_MEM_KEY, JSON.stringify(rememberedKeys));
    } catch {}
  }, [rememberedKeys]);
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
  if (!ctx) throw new Error("useAdminDataContext must be used within AdminDataProvider");
  return ctx;
}

