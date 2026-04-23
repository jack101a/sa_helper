import React, { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Key, ShieldCheck, Database, FileX2,
  Settings, LogOut, CheckCircle2, AlertCircle, Trash2,
  Plus, Upload, Download, BrainCircuit, Activity, XCircle, Sun, Moon, Loader2
} from "lucide-react";

export function App() {
  // --- STATE ---
  const [toast, setToast] = useState({ message: "", type: "" });
  const [loading, setLoading] = useState(true);
  const [isDark, setIsDark] = useState(true); // Dynamic Theme State
  const [createdKeyModal, setCreatedKeyModal] = useState({ open: false, keyId: null, keyValue: "" });
  const [rememberedKeys, setRememberedKeys] = useState({});
  const [editingModelId, setEditingModelId] = useState(null);
  const [editingModelDraft, setEditingModelDraft] = useState(null);
  const [editingMappingId, setEditingMappingId] = useState(null);
  const [editingMappingDraft, setEditingMappingDraft] = useState(null);
  const [assigningDomainDraft, setAssigningDomainDraft] = useState(null);

  const [stats, setStats] = useState({
    total_requests: 0,
    successful_requests: 0,
    failed_requests: 0,
    avg_processing_ms: 0
  });

  const [apiKeys, setApiKeys] = useState([]);
  const [access, setAccess] = useState({ global_access: false, allowed_domains: [] });
  const [models, setModels] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [failedPayloads, setFailedPayloads] = useState([]);
  const [selectedPayloads, setSelectedPayloads] = useState({});
  const [datasetsDir, setDatasetsDir] = useState("C:\\tata-captcha\\datasets\\failed");
  const [proposals, setProposals] = useState([]);
  const [settingsKeyId, setSettingsKeyId] = useState("");
  const [settingsAllDomains, setSettingsAllDomains] = useState(true);
  const [settingsDomainsCsv, setSettingsDomainsCsv] = useState("");
  const [settingsKeyRpm, setSettingsKeyRpm] = useState(60);
  const [settingsKeyBurst, setSettingsKeyBurst] = useState(10);
  const [settingsDomainSelections, setSettingsDomainSelections] = useState([]);
  const [settingsCustomDomain, setSettingsCustomDomain] = useState("");
  const [activePage, setActivePage] = useState("dashboard");
  const [cloudBackupConfigured, setCloudBackupConfigured] = useState(false);
  const [createKeyAllDomains, setCreateKeyAllDomains] = useState(true);
  const [createKeyDomainSelections, setCreateKeyDomainSelections] = useState([]);
  const roundedLatency = Math.max(0, Math.round(Number(stats.avg_processing_ms || 0)));
  const latencyValue = roundedLatency > 9999 ? "9999+" : String(roundedLatency);
  const keyMemoryStorageKey = "tata_admin_created_keys";
  const themeStorageKey = "tata_admin_theme";
  const mappingsByDomain = useMemo(() => {
    const grouped = {};
    for (const mapping of mappings) {
      const domain = String(mapping.domain || "-").trim() || "-";
      if (!grouped[domain]) grouped[domain] = [];
      grouped[domain].push(mapping);
    }
    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]));
  }, [mappings]);

  const allPayloadSelected = failedPayloads.length > 0 && failedPayloads.every((p) => selectedPayloads[p.name]);
  const selectedKeyObj = apiKeys.find((k) => String(k.id) === String(settingsKeyId)) || null;

  // --- PREMIUM GLASSMORPHISM THEME UTILS ---
  const t_bg = isDark ? "bg-[#020617] text-slate-200" : "bg-[#f1f5f9] text-slate-800";
  
  const glassPanel = isDark 
    ? "bg-white/[0.02] backdrop-blur-2xl border border-white/[0.05] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]" 
    : "bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.07)]";
  
  const glassNav = isDark
    ? "bg-[#020617]/40 backdrop-blur-3xl border-b border-white/[0.05]"
    : "bg-white/40 backdrop-blur-3xl border-b border-white/60 shadow-sm";

  const t_textHeading = isDark ? "text-white" : "text-slate-900";
  const t_textMuted = isDark ? "text-slate-400" : "text-slate-500";
  const t_rowHover = isDark ? "hover:bg-white/[0.03]" : "hover:bg-white/50";
  const t_borderLight = isDark ? "border-white/[0.05]" : "border-black/[0.05]";

  const glassInput = `w-full rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:outline-none transition-all backdrop-blur-md ${
    isDark ? "bg-black/20 border border-white/10 text-white placeholder-slate-500 focus:bg-black/40 shadow-inner" 
           : "bg-white/50 border border-white/60 text-slate-900 placeholder-slate-400 focus:bg-white/80 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
  }`;

  const solidButton = `bg-indigo-500 hover:bg-indigo-400 text-white transition-all rounded-xl px-5 py-2.5 font-medium text-sm flex items-center justify-center gap-2 ${
    isDark ? "shadow-[0_0_20px_rgba(99,102,241,0.4)] hover:shadow-[0_0_30px_rgba(99,102,241,0.6)]" 
           : "shadow-lg shadow-indigo-500/30"
  }`;
  
  const glassButton = `rounded-xl px-4 py-2 text-sm font-medium transition-all backdrop-blur-md flex items-center justify-center gap-2 ${
    isDark ? "bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-300 hover:text-white" 
           : "bg-white/60 hover:bg-white border border-white/80 text-slate-700 hover:text-indigo-600 shadow-sm"
  }`;

  const dangerButton = `border rounded-lg px-3 py-1.5 text-xs font-medium transition-all backdrop-blur-md ${
    isDark ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/20" 
           : "bg-rose-100/50 hover:bg-rose-100 text-rose-600 border-rose-200"
  }`;

  const badgeSuccess = `px-2.5 py-1 rounded-md text-[10px] uppercase tracking-wider font-semibold border backdrop-blur-md ${
    isDark ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
           : "bg-emerald-100/50 text-emerald-700 border-emerald-200"
  }`;

  const badgeWarning = `px-2.5 py-1 rounded-md text-[10px] uppercase tracking-wider font-semibold border backdrop-blur-md ${
    isDark ? "bg-amber-500/10 text-amber-400 border-amber-500/20" 
           : "bg-amber-100/50 text-amber-700 border-amber-200"
  }`;

  // --- API HANDLERS ---
  const showToast = (message, type = "ok") => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: "", type: "" }), 3000);
  };

  const navClass = (name) => `text-sm font-medium transition-colors flex items-center gap-2 ${activePage === name ? t_textHeading : `${t_textMuted} hover:text-indigo-500`}`;

  const fetchBootstrap = async () => {
    const response = await fetch("/admin/api/bootstrap", {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Failed bootstrap (${response.status})`);
    
    const data = await response.json();
    setStats(data.usage || {});
    setApiKeys(data.api_keys || []);
    setAccess({
      global_access: !!data.global_access,
      allowed_domains: data.allowed_domains || []
    });
    setModels(data.model_registry || []);
    setMappings(data.field_mappings || []);
    setProposals(data.field_mapping_proposals || []);
    setFailedPayloads(data.datasets_files || []);
    setCloudBackupConfigured(Boolean(data.cloud_backup_configured));
    if(data.datasets_dir) setDatasetsDir(data.datasets_dir);
  };

  const postForm = async (url, payload) => {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, value);
      }
    });
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      credentials: "include"
    });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response;
  };

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(themeStorageKey);
      if (savedTheme === "light") {
        setIsDark(false);
      } else if (savedTheme === "dark") {
        setIsDark(true);
      }
    } catch (_error) {
      // ignore storage read errors
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(keyMemoryStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setRememberedKeys(parsed);
        }
      }
    } catch (_error) {
      // ignore malformed local cache
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(keyMemoryStorageKey, JSON.stringify(rememberedKeys));
    } catch (_error) {
      // ignore storage write errors
    }
  }, [rememberedKeys]);

  useEffect(() => {
    try {
      window.localStorage.setItem(themeStorageKey, isDark ? "dark" : "light");
    } catch (_error) {
      // ignore storage write errors
    }
  }, [isDark]);

  useEffect(() => {
    const run = async () => {
      try {
        await fetchBootstrap();
      } catch (error) {
        // Show silent error in dev environment since endpoints might not exist locally
        console.warn("Bootstrap fetch failed - likely dev environment without endpoints.");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  useEffect(() => {
    if (!apiKeys.length) return;
    const active = apiKeys.find((k) => k.enabled) || apiKeys[0];
    if (!active) return;
    if (!settingsKeyId || !apiKeys.some((k) => String(k.id) === String(settingsKeyId))) {
      setSettingsKeyId(String(active.id));
      const allowAll = active.all_domains !== undefined ? Boolean(active.all_domains) : true;
      setSettingsAllDomains(allowAll);
      setSettingsDomainsCsv((active.allowed_domains || []).join(", "));
      setSettingsDomainSelections(active.allowed_domains || []);
      setSettingsKeyRpm(Number(active.rate_limit?.requests_per_minute || 60));
      setSettingsKeyBurst(Number(active.rate_limit?.burst || 10));
    }
  }, [apiKeys, settingsKeyId]);

  const handleCreateKey = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    try {
      const response = await postForm("/admin/api/keys/create", {
        key_name: formData.get("key_name"),
        expiry_days: Number(formData.get("expiry_days") || 30),
        all_domains: createKeyAllDomains ? "on" : "",
        allowed_domains_csv: createKeyAllDomains ? "" : createKeyDomainSelections.join(","),
        requests_per_minute: Number(formData.get("requests_per_minute") || 0),
        burst: Number(formData.get("burst") || 0)
      });
      const payload = await response.json();
      await fetchBootstrap();
      if (payload.key_id && payload.api_key) {
        setRememberedKeys((prev) => ({ ...prev, [String(payload.key_id)]: payload.api_key }));
      }
      setCreatedKeyModal({
        open: true,
        keyId: payload.key_id ?? null,
        keyValue: payload.api_key || ""
      });
      e.target.reset();
      setCreateKeyAllDomains(true);
      setCreateKeyDomainSelections([]);
      showToast("API key created.");
    } catch { showToast("Failed to create key", "error"); }
  };

  const handleCopyKey = async (keyValue) => {
    if (!keyValue) {
      showToast("No key available to copy", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(keyValue);
      showToast("API key copied.");
    } catch (_error) {
      showToast("Clipboard copy failed", "error");
    }
  };

  const handleViewStoredKey = (keyId) => {
    const value = rememberedKeys[String(keyId)];
    if (!value) {
      showToast("This key cannot be shown. Only keys created from this dashboard browser can be viewed.", "error");
      return;
    }
    setCreatedKeyModal({ open: true, keyId, keyValue: value });
  };

  const handleRevokeKey = async (id) => {
    if (!window.confirm("Revoke this API Key? Client access will be cut immediately.")) return;
    try {
      await postForm("/admin/keys/revoke", { key_id: id });
      await fetchBootstrap();
      showToast(`Key #${id} revoked.`, "error");
    } catch { showToast("Failed to revoke key", "error"); }
  };

  const handleDeleteRevokedKey = async (id) => {
    if (!window.confirm("Delete this revoked key entry? This cannot be undone.")) return;
    try {
      await postForm("/admin/keys/delete", { key_id: id });
      setRememberedKeys((prev) => {
        const next = { ...prev };
        delete next[String(id)];
        return next;
      });
      await fetchBootstrap();
      showToast(`Key #${id} deleted.`, "error");
    } catch {
      showToast("Only revoked keys can be deleted", "error");
    }
  };

  const handleSettingsKeyChange = (nextId) => {
    setSettingsKeyId(String(nextId));
    const key = apiKeys.find((k) => String(k.id) === String(nextId));
    if (!key) return;
    const allowAll = key.all_domains !== undefined ? Boolean(key.all_domains) : true;
    setSettingsAllDomains(allowAll);
    setSettingsDomainsCsv((key.allowed_domains || []).join(", "));
    setSettingsDomainSelections(key.allowed_domains || []);
    setSettingsKeyRpm(Number(key.rate_limit?.requests_per_minute || 60));
    setSettingsKeyBurst(Number(key.rate_limit?.burst || 10));
  };

  const handleSaveKeyAccessSettings = async (e) => {
    e.preventDefault();
    if (!settingsKeyId) return;
    try {
      await postForm("/admin/keys/access/update", {
        key_id: Number(settingsKeyId),
        all_domains: settingsAllDomains ? "on" : "",
        allowed_domains_csv: settingsAllDomains ? "" : settingsDomainSelections.join(",")
      });
      await fetchBootstrap();
      showToast("Key domain access updated.");
    } catch {
      showToast("Failed to update key access", "error");
    }
  };

  const handleSaveKeyRateLimitSettings = async (e) => {
    e.preventDefault();
    if (!settingsKeyId) return;
    try {
      await postForm("/admin/keys/rate-limit/update", {
        key_id: Number(settingsKeyId),
        requests_per_minute: Number(settingsKeyRpm),
        burst: Number(settingsKeyBurst)
      });
      await fetchBootstrap();
      showToast("Key rate limit updated.");
    } catch {
      showToast("Failed to update key rate limit", "error");
    }
  };

  const handleCreateBackupNow = async () => {
    try {
      await postForm("/admin/backups/create", {});
      showToast("Backup created.");
    } catch {
      showToast("Failed to create backup", "error");
    }
  };

  const handleCloudBackupPush = async () => {
    try {
      await postForm("/admin/backups/cloud/push", {});
      showToast("Cloud backup pushed.");
    } catch {
      showToast("Cloud backup push failed", "error");
    }
  };

  const handleCloudBackupPull = async () => {
    if (!window.confirm("Restore from cloud backup now?")) return;
    try {
      await postForm("/admin/backups/cloud/pull", {});
      await fetchBootstrap();
      showToast("Cloud backup restored.");
    } catch {
      showToast("Cloud backup restore failed", "error");
    }
  };

  const toggleCreateKeyDomain = (domain) => {
    setCreateKeyDomainSelections((prev) => (
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    ));
  };

  const toggleSettingsDomainSelection = (domain) => {
    setSettingsDomainSelections((prev) => (
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    ));
  };

  const handleAddSettingsCustomDomain = () => {
    const token = String(settingsCustomDomain || "").trim().toLowerCase();
    if (!token) return;
    if (!settingsDomainSelections.includes(token)) {
      setSettingsDomainSelections((prev) => [...prev, token]);
    }
    setSettingsCustomDomain("");
  };

  const handleRestoreLatestBackup = async () => {
    if (!window.confirm("Restore latest backup? This will overwrite current settings.")) return;
    try {
      await postForm("/admin/backups/restore-latest", {});
      await fetchBootstrap();
      showToast("Latest backup restored.");
    } catch {
      showToast("Failed to restore backup", "error");
    }
  };

  const handleAddDomain = async (e) => {
    e.preventDefault();
    const domain = new FormData(e.target).get("new_domain");
    if (domain) {
      try {
        await postForm("/admin/access", {
          global_access: access.global_access ? "on" : null,
          new_domain: domain
        });
        await fetchBootstrap();
        e.target.reset();
        showToast(`Domain ${domain} added.`);
      } catch { showToast("Failed to add domain", "error"); }
    }
  };

  const handleRemoveDomain = async (domain) => {
    if (!window.confirm(`Remove ${domain} from whitelist?`)) return;
    try {
      await postForm("/admin/access/remove", { domain });
      await fetchBootstrap();
      showToast(`Domain ${domain} removed.`, "error");
    } catch { showToast("Failed to remove domain", "error"); }
  };

  const handleRegisterModel = async (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const modelFile = fd.get("model_file");
    if (!modelFile || typeof modelFile === "string" || !modelFile.name) {
      showToast("Please choose an ONNX model file first", "error");
      return;
    }
    if (!modelFile.name.toLowerCase().endsWith(".onnx")) {
      showToast("Only .onnx model files are supported", "error");
      return;
    }
    const upload = new FormData();
    upload.append("ai_model_name", fd.get("ai_model_name"));
    upload.append("version", fd.get("version"));
    upload.append("task_type", fd.get("task_type"));
    upload.append("runtime", fd.get("runtime"));
    // Snapshot file into a Blob first to avoid mobile file-handle mutation errors (ERR_UPLOAD_FILE_CHANGED).
    let uploadBlob = modelFile;
    try {
      const fileBuffer = await modelFile.arrayBuffer();
      uploadBlob = new Blob([fileBuffer], {
        type: modelFile.type || "application/octet-stream"
      });
    } catch (_error) {
      showToast("Could not read selected file. Please reselect the file and retry.", "error");
      return;
    }
    upload.append("ai_model_file", uploadBlob, modelFile.name);
    try {
      const response = await fetch("/admin/models/upload", {
        method: "POST",
        body: upload,
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Admin-API": "1"
        }
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Upload endpoint returned non-JSON response. Please re-login and retry.");
      }
      const payload = await response.json();
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message || `Upload failed (${response.status})`);
      }
      await fetchBootstrap();
      formEl.reset();
      showToast(payload.message || "New model registered.");
    } catch (error) {
      showToast(error.message || "Failed to register model", "error");
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/admin/logout", { method: "POST", credentials: "include" });
    } finally {
      window.location.assign("/admin/login");
    }
  };

  const handleExportMasterSetup = () => {
    window.location.assign("/admin/export/master-setup.json");
  };

  const handleImportMasterSetup = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const setupFile = fd.get("setup_file");
    if (!(setupFile instanceof File) || !setupFile.name) {
      showToast("Please select a setup JSON file first", "error");
      return;
    }
    const payload = new FormData();
    payload.append("setup_file", setupFile);
    try {
      const response = await fetch("/admin/import/master-setup", {
        method: "POST",
        body: payload,
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Admin-API": "1"
        }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        throw new Error(body.message || `Import failed (${response.status})`);
      }
      await fetchBootstrap();
      e.target.reset();
      showToast(body.message || "Master setup imported.");
    } catch (error) {
      showToast(error.message || "Import failed", "error");
    }
  };

  const handleChangeModelState = async (id, state) => {
    try {
      await postForm("/admin/models/promote", { ai_model_id: id, lifecycle_state: state });
      await fetchBootstrap();
      showToast(`Model #${id} -> ${state}.`);
    } catch { showToast("Failed to change model state", "error"); }
  };

  const handleDeleteModel = async (id) => {
    if (!window.confirm("Delete this AI model? Dependencies may break.")) return;
    try {
      await postForm("/admin/models/remove", { ai_model_id: id });
      await fetchBootstrap();
      showToast(`Model #${id} removed.`, "error");
    } catch { showToast("Failed to remove model", "error"); }
  };

  const beginEditModel = (model) => {
    setEditingModelId(model.id);
    setEditingModelDraft({
      ai_model_name: model.ai_model_name || "",
      version: model.version || "v1",
      task_type: model.task_type || "image",
      lifecycle_state: model.lifecycle_state || "candidate",
      notes: model.notes || ""
    });
  };

  const cancelEditModel = () => {
    setEditingModelId(null);
    setEditingModelDraft(null);
  };

  const handleSaveModelEdit = async (e, modelId) => {
    e.preventDefault();
    if (!editingModelDraft) return;
    try {
      await postForm("/admin/models/update", {
        ai_model_id: modelId,
        ai_model_name: (editingModelDraft.ai_model_name || "").trim(),
        version: (editingModelDraft.version || "v1").trim() || "v1",
        task_type: editingModelDraft.task_type || "image",
        lifecycle_state: editingModelDraft.lifecycle_state || "candidate",
        notes: editingModelDraft.notes || ""
      });
      await fetchBootstrap();
      showToast(`Model #${modelId} updated.`);
      cancelEditModel();
    } catch {
      showToast("Failed to update model", "error");
    }
  };

  const handleSaveMapping = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await postForm("/admin/mappings/set", {
        domain: fd.get("domain"),
        source_data_type: fd.get("source_data_type"),
        source_selector: fd.get("source_selector"),
        target_selector: fd.get("target_selector"),
        target_data_type: "text_input",
        ai_model_id: Number(fd.get("ai_model_id"))
      });
      await fetchBootstrap();
      e.target.reset();
      showToast("Field mapping created.");
    } catch { showToast("Failed to create mapping", "error"); }
  };

  const beginEditMapping = (mapping) => {
    setEditingMappingId(mapping.id);
    setEditingMappingDraft({
      domain: mapping.domain || "",
      source_data_type: mapping.source_data_type || "image",
      source_selector: mapping.source_selector || "",
      target_data_type: mapping.target_data_type || "text_input",
      target_selector: mapping.target_selector || "",
      ai_model_id: Number(mapping.ai_model_id)
    });
  };

  const cancelEditMapping = () => {
    setEditingMappingId(null);
    setEditingMappingDraft(null);
  };

  const handleSaveMappingEdit = async (e, mappingId) => {
    e.preventDefault();
    if (!editingMappingDraft) return;
    try {
      await postForm("/admin/mappings/update", {
        mapping_id: mappingId,
        domain: (editingMappingDraft.domain || "").trim(),
        source_data_type: editingMappingDraft.source_data_type || "image",
        source_selector: (editingMappingDraft.source_selector || "").trim(),
        target_data_type: editingMappingDraft.target_data_type || "text_input",
        target_selector: (editingMappingDraft.target_selector || "").trim(),
        ai_model_id: Number(editingMappingDraft.ai_model_id)
      });
      await fetchBootstrap();
      showToast("Mapping updated.");
      cancelEditMapping();
    } catch {
      showToast("Failed to update mapping", "error");
    }
  };

  const beginAssignDomainModel = (domain, domainMappings) => {
    const firstMappedModel = domainMappings.find((m) => Number(m.ai_model_id));
    setAssigningDomainDraft({
      domain,
      ai_model_id: firstMappedModel ? Number(firstMappedModel.ai_model_id) : ""
    });
  };

  const cancelAssignDomainModel = () => {
    setAssigningDomainDraft(null);
  };

  const handleSaveDomainModelAssign = async (e) => {
    e.preventDefault();
    if (!assigningDomainDraft) return;
    try {
      await postForm("/admin/mappings/domain/assign-model", {
        domain: assigningDomainDraft.domain,
        ai_model_id: Number(assigningDomainDraft.ai_model_id)
      });
      await fetchBootstrap();
      showToast("Domain model assignment updated.");
      cancelAssignDomainModel();
    } catch {
      showToast("Failed to assign model to domain", "error");
    }
  };

  const handleRemoveMapping = async (id) => {
    if (!window.confirm("Delete this routing map?")) return;
    try {
      await postForm("/admin/mappings/remove", { mapping_id: id });
      await fetchBootstrap();
      showToast("Mapping removed.", "error");
    } catch { showToast("Failed to remove mapping", "error"); }
  };

  const handleTestMapping = async (mappingId, domain) => {
    try {
      await postForm("/admin/mappings/test", { mapping_id: mappingId });
      showToast(`Test triggered for ${domain}`);
    } catch { showToast("Failed to test mapping", "error"); }
  };

  const handleToggleGlobalAccess = async (checked) => {
    try {
      await postForm("/admin/access", {
        global_access: checked ? "on" : null,
        new_domain: ""
      });
      await fetchBootstrap();
      showToast(`Global access ${checked ? "enabled" : "disabled"}`);
    } catch { showToast("Failed to update access", "error"); }
  };

  const handleLabelPayload = async (filename, domain, aiGuess, e) => {
    e.preventDefault();
    const text = new FormData(e.target).get("corrected_text");
    try {
      await postForm("/admin/datasets/label", {
        filename, domain, ai_guess: aiGuess, corrected_text: text
      });
      await fetchBootstrap();
      showToast(`Labeled as "${text}".`);
    } catch { showToast("Failed to label payload", "error"); }
  };

  const handleIgnorePayload = async (filename) => {
    if (!window.confirm("Discard payload? It won't be added to datasets.")) return;
    try {
      await postForm("/admin/datasets/ignore", { filename });
      await fetchBootstrap();
      showToast("Payload ignored.");
    } catch { showToast("Failed to ignore payload", "error"); }
  };

  const togglePayload = (name) => {
    setSelectedPayloads((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const toggleAllPayloads = () => {
    if (allPayloadSelected) {
      setSelectedPayloads({});
      return;
    }
    const next = {};
    failedPayloads.forEach((p) => { next[p.name] = true; });
    setSelectedPayloads(next);
  };

  const handleBulkIgnorePayloads = async () => {
    const selected = failedPayloads.filter((p) => selectedPayloads[p.name]);
    if (!selected.length) {
      showToast("Select payloads first", "error");
      return;
    }
    try {
      for (const item of selected) {
        await postForm("/admin/datasets/ignore", { filename: item.name });
      }
      setSelectedPayloads({});
      await fetchBootstrap();
      showToast(`Ignored ${selected.length} payload(s).`);
    } catch {
      showToast("Bulk ignore failed", "error");
    }
  };

  const handleBulkSavePayloads = async () => {
    const selected = failedPayloads.filter((p) => selectedPayloads[p.name]);
    if (!selected.length) {
      showToast("Select payloads first", "error");
      return;
    }
    try {
      for (const item of selected) {
        await postForm("/admin/datasets/label", {
          filename: item.name,
          domain: item.domain,
          ai_guess: item.ocr_guess,
          corrected_text: item.corrected_text || item.ocr_guess
        });
      }
      setSelectedPayloads({});
      await fetchBootstrap();
      showToast(`Saved ${selected.length} payload(s).`);
    } catch {
      showToast("Bulk save failed", "error");
    }
  };

  const handleApproveProposal = async (proposal, e) => {
    e.preventDefault();
    const modelId = parseInt(new FormData(e.target).get("ai_model_id"), 10);
    if (!Number.isFinite(modelId)) { showToast("Select a model first", "error"); return; }
    try {
      await postForm("/admin/mappings/proposals/approve", { proposal_id: proposal.id, ai_model_id: modelId });
      await fetchBootstrap();
      showToast("Proposal approved.");
    } catch { showToast("Failed to approve proposal", "error"); }
  };

  const handleRejectProposal = async (id) => {
    if (!window.confirm("Discard proposal?")) return;
    try {
      await postForm("/admin/mappings/proposals/reject", { proposal_id: id });
      await fetchBootstrap();
      showToast("Proposal ignored.");
    } catch { showToast("Failed to reject proposal", "error"); }
  };

  // --- RENDER ---
  return (
    <div className={`min-h-screen font-sans selection:bg-indigo-500/30 relative overflow-x-hidden transition-colors duration-500 ${t_bg}`}>
      
      {/* VIBRANT AMBIENT BACKGROUND BLOBS */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className={`absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full mix-blend-multiply filter blur-[100px] opacity-60 animate-blob ${isDark ? 'bg-indigo-900 mix-blend-screen' : 'bg-indigo-200'}`} />
        <div className={`absolute top-[0%] right-[-10%] w-[40vw] h-[40vw] rounded-full mix-blend-multiply filter blur-[100px] opacity-60 animate-blob animation-delay-2000 ${isDark ? 'bg-purple-900 mix-blend-screen' : 'bg-purple-200'}`} />
        <div className={`absolute bottom-[-10%] left-[10%] w-[60vw] h-[60vw] rounded-full mix-blend-multiply filter blur-[100px] opacity-60 animate-blob animation-delay-4000 ${isDark ? 'bg-cyan-900 mix-blend-screen' : 'bg-cyan-200'}`} />
      </div>

      {/* STICKY GLASS NAVIGATION BAR */}
      <nav className={`sticky top-0 z-50 transition-colors duration-500 ${glassNav}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <BrainCircuit size={18} className="text-white" />
              </div>
              <span className={`text-xl font-bold tracking-tight ${t_textHeading}`}>
                tata<span className="text-indigo-500">captcha</span>
              </span>
            </div>
            
            <div className="hidden md:flex items-center gap-6">
              <button type="button" onClick={() => setActivePage("dashboard")} className={navClass("dashboard")}><LayoutDashboard size={16}/> Dashboard</button>
              <button type="button" onClick={() => setActivePage("models")} className={navClass("models")}><Database size={16}/> Models</button>
              <button type="button" onClick={() => setActivePage("settings")} className={navClass("settings")}><Settings size={16}/> Settings</button>
            </div>

            <div className="md:hidden">
              <select
                value={activePage}
                onChange={(e) => setActivePage(e.target.value)}
                className={`text-xs rounded-lg px-2 py-1 border ${isDark ? "bg-black/30 border-white/10 text-slate-200" : "bg-white/80 border-slate-200 text-slate-700"}`}
              >
                <option value="dashboard">Dashboard</option>
                <option value="models">Models</option>
                <option value="settings">Settings</option>
              </select>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <button onClick={() => setIsDark(!isDark)} className={`p-2 rounded-lg transition-colors backdrop-blur-md ${isDark ? 'hover:bg-white/10 text-amber-400' : 'hover:bg-black/5 text-slate-700'}`} title="Toggle Theme">
                {isDark ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              <button onClick={handleLogout} className={`p-2 rounded-lg hover:text-rose-500 transition-colors ${t_textMuted}`} title="Logout"><LogOut size={20} /></button>
            </div>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT AREA */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 relative z-10 space-y-8">
        
        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 z-40 flex items-center justify-center">
            <div className={`${glassPanel} p-8 rounded-3xl flex flex-col items-center gap-4 animate-pulse`}>
              <Loader2 className="animate-spin text-indigo-500" size={32} />
              <p className={`text-sm font-medium ${t_textMuted}`}>Connecting to Tata Dashboard API...</p>
            </div>
          </div>
        )}

        {/* TOAST ALERTS */}
        {toast.message && (
          <div className="fixed bottom-6 right-6 z-50 animate-bounce">
            <div className={`backdrop-blur-2xl border rounded-2xl px-5 py-3 shadow-2xl flex items-center gap-3
              ${toast.type === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-500' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'}
              ${isDark ? '' : 'bg-white/80'}`}>
              {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
              <span className="text-sm font-medium drop-shadow-sm">{toast.message}</span>
            </div>
          </div>
        )}

        {createdKeyModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className={`${glassPanel} w-full max-w-xl rounded-2xl p-5`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-lg font-semibold ${t_textHeading}`}>API Key</h3>
                <button
                  type="button"
                  onClick={() => setCreatedKeyModal({ open: false, keyId: null, keyValue: "" })}
                  className={`text-sm ${t_textMuted} hover:text-rose-500`}
                >
                  Close
                </button>
              </div>
              <p className={`text-xs mb-3 ${t_textMuted}`}>
                Key ID: {createdKeyModal.keyId ?? "-"} | Save this key securely.
              </p>
              <div className={`rounded-xl px-3 py-3 border font-mono text-xs break-all ${isDark ? "bg-black/30 border-white/10 text-emerald-300" : "bg-white/80 border-white text-emerald-700"}`}>
                {createdKeyModal.keyValue || "(no key value)"}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => handleCopyKey(createdKeyModal.keyValue)} className={glassButton}>
                  Copy Key
                </button>
                <button
                  type="button"
                  onClick={() => setCreatedKeyModal({ open: false, keyId: null, keyValue: "" })}
                  className={solidButton}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {activePage === "settings" && (
        <>
        {/* IMPORT/EXPORT HERO PANEL */}
        <div id="settings-section" className={`rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors duration-500 ${glassPanel}`}>
          <div>
            <h2 className={`text-lg font-semibold tracking-wide ${t_textHeading}`}>System Configuration</h2>
            <p className={`text-[12px] mt-1 ${t_textMuted}`}>Backup or restore your master setup (Keys, Models, Mappings).</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <button onClick={handleExportMasterSetup} className={glassButton}>
              <Download size={16} className={isDark ? "text-indigo-400" : "text-indigo-600"}/> 
              Export Config
            </button>
            <div className="h-px sm:h-auto sm:w-px bg-white/10 sm:mx-2 hidden sm:block"></div>
            <form onSubmit={handleImportMasterSetup} className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto items-stretch sm:items-center">
              <input type="file" name="setup_file" accept=".json,application/json" required className={`min-w-0 flex-1 sm:w-48 text-xs file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-500/10 file:text-indigo-500 hover:file:bg-indigo-500/20 file:transition-colors ${t_textMuted}`} />
              <button type="submit" className={`w-full sm:w-auto ${glassButton}`}>
                <Upload size={16} className={isDark ? "text-cyan-400" : "text-cyan-600"}/>
                Import
              </button>
            </form>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`rounded-2xl p-5 transition-colors duration-500 ${glassPanel}`}>
            <h3 className={`text-base font-semibold ${t_textHeading}`}>Key Domain Access</h3>
            <p className={`text-xs mt-1 mb-4 ${t_textMuted}`}>Set domain scope per API key.</p>
            <form onSubmit={handleSaveKeyAccessSettings} className="space-y-3">
              <h4 className={`text-xs uppercase tracking-wider ${t_textMuted}`}>Key Domain Access</h4>
              <label className={`text-xs ${t_textMuted}`}>API Key</label>
              <select className={glassInput} value={settingsKeyId} onChange={(e) => handleSettingsKeyChange(e.target.value)}>
                <option value="" disabled>Select API key</option>
                {apiKeys.map((k) => <option key={k.id} value={k.id}>{k.name} (#{k.id})</option>)}
              </select>
              <label className={`flex items-center gap-2 text-xs ${t_textMuted}`}>
                <input type="checkbox" checked={settingsAllDomains} onChange={(e) => setSettingsAllDomains(e.target.checked)} />
                Allow all domains
              </label>
              <div className={`max-h-28 overflow-auto rounded-xl border p-2 ${t_borderLight} ${settingsAllDomains ? "opacity-50 pointer-events-none" : ""}`}>
                {access.allowed_domains.map((domain) => (
                  <label key={domain} className={`flex items-center gap-2 text-xs ${t_textMuted}`}>
                    <input type="checkbox" checked={settingsDomainSelections.includes(domain)} onChange={() => toggleSettingsDomainSelection(domain)} />
                    {domain}
                  </label>
                ))}
              </div>
              <div className={`flex gap-2 ${settingsAllDomains ? "opacity-50 pointer-events-none" : ""}`}>
                <input className={glassInput} value={settingsCustomDomain} onChange={(e) => setSettingsCustomDomain(e.target.value)} placeholder="Add custom domain" />
                <button type="button" onClick={handleAddSettingsCustomDomain} className={glassButton}>Add</button>
              </div>
              <button type="submit" className={glassButton}>Save Access</button>
            </form>
          </div>

          <div className={`rounded-2xl p-5 transition-colors duration-500 ${glassPanel}`}>
            <h3 className={`text-base font-semibold ${t_textHeading}`}>Key Rate Limit</h3>
            <p className={`text-xs mt-1 mb-4 ${t_textMuted}`}>Per-key throughput controls (like system policy).</p>
            <form onSubmit={handleSaveKeyRateLimitSettings} className="space-y-3">
              <h4 className={`text-xs uppercase tracking-wider ${t_textMuted}`}>Key Rate Limit</h4>
              <label className={`text-xs ${t_textMuted}`}>API Key</label>
              <select className={glassInput} value={settingsKeyId} onChange={(e) => handleSettingsKeyChange(e.target.value)}>
                <option value="" disabled>Select API key</option>
                {apiKeys.map((k) => <option key={k.id} value={k.id}>{k.name} (#{k.id})</option>)}
              </select>
              <div>
                <label className={`text-xs ${t_textMuted}`}>RPM (requests per minute)</label>
                <input type="number" min="1" className={glassInput} value={settingsKeyRpm} onChange={(e) => setSettingsKeyRpm(Number(e.target.value))} placeholder="Requests/minute" />
              </div>
              <div>
                <label className={`text-xs ${t_textMuted}`}>Burst (extra requests in same minute)</label>
                <input type="number" min="0" className={glassInput} value={settingsKeyBurst} onChange={(e) => setSettingsKeyBurst(Number(e.target.value))} placeholder="Burst" />
              </div>
              <button type="submit" className={glassButton}>Save Limit</button>
            </form>
          </div>
        </div>

        <div className={`rounded-2xl p-5 transition-colors duration-500 ${glassPanel}`}>
          <h3 className={`text-base font-semibold ${t_textHeading}`}>Backups</h3>
          <p className={`text-xs mt-1 mb-4 ${t_textMuted}`}>Local, cloud, and downloadable recovery options.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-3">
              <h4 className={`text-xs uppercase tracking-wider ${t_textMuted}`}>Backups</h4>
              <button type="button" onClick={handleCreateBackupNow} className={glassButton}>Create Backup Now</button>
              <button type="button" onClick={handleRestoreLatestBackup} className={glassButton}>Restore Latest Backup</button>
              <button type="button" onClick={handleExportMasterSetup} className={glassButton}>Download Backup (.json)</button>
              <button type="button" disabled={!cloudBackupConfigured} onClick={handleCloudBackupPush} className={`${glassButton} ${!cloudBackupConfigured ? "opacity-50 cursor-not-allowed" : ""}`}>Push Cloud Backup</button>
              <button type="button" disabled={!cloudBackupConfigured} onClick={handleCloudBackupPull} className={`${glassButton} ${!cloudBackupConfigured ? "opacity-50 cursor-not-allowed" : ""}`}>Restore Cloud Backup</button>
              {!cloudBackupConfigured && <div className={`text-xs ${t_textMuted}`}>Cloud backup is not configured on server.</div>}
            </div>
          </div>
        </div>

        <div className={`rounded-2xl p-5 transition-colors duration-500 ${glassPanel}`}>
          <h3 className={`text-base font-semibold ${t_textHeading}`}>API Key Access & Limits Overview</h3>
          <p className={`text-xs mt-1 mb-4 ${t_textMuted}`}>Scrollable summary of each key, domain scope, rate limit, and bound device.</p>
          <div className="overflow-auto max-h-80 custom-scrollbar">
            <table className="w-full text-sm text-left min-w-[780px]">
              <thead>
                <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                  <th className="pb-3 font-medium">Key</th>
                  <th className="pb-3 font-medium">Domain Access</th>
                  <th className="pb-3 font-medium">Rate Limit</th>
                  <th className="pb-3 font-medium">Device Lock</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${t_borderLight}`}>
                {apiKeys.map((k) => (
                  <tr key={`settings-key-${k.id}`} className={t_rowHover}>
                    <td className="py-3">
                      <div className={`${t_textHeading}`}>{k.name}</div>
                      <div className={`text-[11px] font-mono ${t_textMuted}`}>#{k.id}</div>
                    </td>
                    <td className="py-3 text-xs">
                      {k.all_domains ? (
                        <span className={badgeSuccess}>All domains</span>
                      ) : (
                        <div className={`max-w-[300px] font-mono ${t_textMuted}`}>
                          {(k.allowed_domains || []).join(", ") || "No domains selected"}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-xs">
                      <span className={`${t_textHeading}`}>
                        {(k.rate_limit?.requests_per_minute || 60)} rpm
                      </span>
                      <span className={`ml-2 ${t_textMuted}`}>
                        burst {(k.rate_limit?.burst || 10)}
                      </span>
                    </td>
                    <td className="py-3 text-xs">
                      {k.device_binding?.device_id ? (
                        <span className="font-mono text-emerald-500">{k.device_binding.device_id}</span>
                      ) : (
                        <span className={t_textMuted}>Not bound yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}

        {activePage === "dashboard" && (
        <>
        {/* STATS GRID */}
        <div id="dashboard-section" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Requests', value: stats.total_requests.toLocaleString(), icon: <Activity size={24}/>, color: 'text-indigo-500' },
            { label: 'Success', value: stats.successful_requests.toLocaleString(), icon: <CheckCircle2 size={24}/>, color: 'text-emerald-500' },
            { label: 'Failed', value: stats.failed_requests.toLocaleString(), icon: <AlertCircle size={24}/>, color: 'text-rose-500' },
            { label: 'Avg Latency', value: `${latencyValue}ms`, icon: <Activity size={24}/>, color: 'text-cyan-500' }
          ].map((stat, i) => (
            <div key={i} className={`rounded-2xl transition-colors duration-500 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group ${glassPanel} ${t_rowHover}`}>
              <div>
                <p className={`text-sm font-medium mb-1 drop-shadow-sm ${t_textMuted}`}>{stat.label}</p>
                <p className={`text-2xl sm:text-3xl font-bold tracking-tight drop-shadow-md ${t_textHeading}`}>{stat.value}</p>
              </div>
              <div className={`p-3 rounded-xl border group-hover:scale-110 transition-transform ${isDark ? 'bg-white/[0.05] border-white/5' : 'bg-white border-white/60 shadow-sm'} ${stat.color}`}>
                {stat.icon}
              </div>
            </div>
          ))}
        </div>

        {/* ROW 1: API KEYS & ACCESS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* API Keys Container */}
          <div className={`rounded-2xl flex flex-col transition-colors duration-500 overflow-hidden ${glassPanel}`}>
            <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
              <div className="p-2 bg-indigo-500/20 text-indigo-500 rounded-lg backdrop-blur-md"><Key size={20}/></div>
              <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>API Credentials</h2>
            </div>
            
            <div className="p-5 flex-1 flex flex-col">
              <div className="overflow-auto max-h-72 mb-6 flex-1 pr-2 custom-scrollbar">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead>
                    <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                      <th className="pb-3 font-medium px-2">Name</th>
                      <th className="pb-3 font-medium px-2">Status</th>
                      <th className="pb-3 font-medium px-2 hidden sm:table-cell">Expires</th>
                      <th className="pb-3 text-right font-medium px-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${t_borderLight}`}>
                    {apiKeys.map(key => (
                      <tr key={key.id} className="group">
                        <td className="py-3 px-2">
                          <div className={`font-medium ${t_textHeading}`}>{key.name}</div>
                          <div className={`text-[10px] font-mono ${t_textMuted}`}>ID: {key.id}</div>
                        </td>
                        <td className="py-3 px-2">
                          {key.enabled ? <span className={badgeSuccess}>Active</span> : <span className={badgeWarning}>Revoked</span>}
                        </td>
                        <td className={`py-3 px-2 text-xs hidden sm:table-cell ${t_textMuted}`}>{key.expires_at_display}</td>
                        <td className="py-3 px-2 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button onClick={() => handleViewStoredKey(key.id)} className={glassButton}>View</button>
                            {key.enabled ? (
                              <button onClick={() => handleRevokeKey(key.id)} className={`${dangerButton} sm:opacity-0 group-hover:opacity-100`}>Revoke</button>
                            ) : (
                              <>
                                <span className={`text-xs ${t_textMuted}`}>{key.revoked_at_display}</span>
                                <button onClick={() => handleDeleteRevokedKey(key.id)} className={dangerButton}>Delete</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <form onSubmit={handleCreateKey} className="flex flex-col sm:flex-row gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                  <div>
                    <label className={`text-xs ${t_textMuted}`}>Key Name</label>
                    <input type="text" name="key_name" required placeholder="New key name..." className={glassInput} />
                  </div>
                  <div>
                    <label className={`text-xs ${t_textMuted}`}>Expiry (days)</label>
                    <input type="number" name="expiry_days" defaultValue="30" min="1" className={glassInput} title="Expiry days" />
                  </div>
                  <label className={`flex items-center gap-2 text-xs ${t_textMuted}`}>
                    <input type="checkbox" checked={createKeyAllDomains} onChange={(e) => setCreateKeyAllDomains(e.target.checked)} /> All domains access
                  </label>
                  <div className={`max-h-24 overflow-auto rounded-xl border p-2 ${t_borderLight} ${createKeyAllDomains ? "opacity-50 pointer-events-none" : ""}`}>
                    {access.allowed_domains.length === 0 && (
                      <div className={`text-xs ${t_textMuted}`}>No allowed domains configured yet.</div>
                    )}
                    {access.allowed_domains.map((domain) => (
                      <label key={domain} className={`flex items-center gap-2 text-xs ${t_textMuted}`}>
                        <input type="checkbox" checked={createKeyDomainSelections.includes(domain)} onChange={() => toggleCreateKeyDomain(domain)} />
                        {domain}
                      </label>
                    ))}
                  </div>
                  <div>
                    <label className={`text-xs ${t_textMuted}`}>Rate Limit RPM (requests/min)</label>
                    <input type="number" name="requests_per_minute" defaultValue="60" min="1" className={glassInput} title="Per-key RPM" />
                  </div>
                  <div>
                    <label className={`text-xs ${t_textMuted}`}>Burst (extra requests/min)</label>
                    <input type="number" name="burst" defaultValue="10" min="0" className={glassInput} title="Per-key burst" />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full sm:w-auto self-end rounded-lg px-3 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-400 text-white transition-colors"
                >
                  <span className="inline-flex items-center gap-1"><Plus size={14}/> Create</span>
                </button>
              </form>
            </div>
          </div>

          {/* Access Control Container */}
          <div className={`rounded-2xl flex flex-col transition-colors duration-500 overflow-hidden ${glassPanel}`}>
            <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
              <div className="p-2 bg-purple-500/20 text-purple-500 rounded-lg backdrop-blur-md"><ShieldCheck size={20}/></div>
              <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Access Control</h2>
            </div>
            
            <div className="p-5 flex-1 space-y-6">
              <label className={`flex items-start sm:items-center gap-3 cursor-pointer p-4 rounded-xl border transition-colors backdrop-blur-md ${isDark ? 'bg-white/[0.03] border-white/10 hover:bg-white/[0.08]' : 'bg-white/50 border-white/80 hover:bg-white/80'}`}>
                <input 
                  type="checkbox" 
                  checked={access.global_access}
                  onChange={(e) => handleToggleGlobalAccess(e.target.checked)}
                  className={`mt-1 sm:mt-0 w-5 h-5 rounded text-indigo-500 focus:ring-indigo-500 ${isDark ? 'border-gray-600 bg-gray-700/50' : 'border-slate-300 bg-white/50'}`} 
                />
                <div>
                  <div className={`text-sm font-medium ${t_textHeading}`}>Enable Global Access</div>
                  <div className={`text-xs ${t_textMuted}`}>Skip all domain-based restrictions</div>
                </div>
              </label>

              <div>
                <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 drop-shadow-sm ${t_textMuted}`}>Allowed Domains Whitelist</h4>
                <div className="flex flex-wrap gap-2 mb-4 max-h-32 overflow-auto pr-1 custom-scrollbar">
                  {access.allowed_domains.map(domain => (
                    <div key={domain} className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg text-sm transition-colors backdrop-blur-md ${isDark ? 'bg-white/[0.05] border-white/10 hover:bg-white/[0.1]' : 'bg-white/60 border-white/80 hover:bg-white shadow-sm'}`}>
                      <span className={`font-mono text-xs ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>{domain}</span>
                      <button onClick={() => handleRemoveDomain(domain)} className="text-gray-400 hover:text-rose-500 transition-colors"><XCircle size={14}/></button>
                    </div>
                  ))}
                </div>
                
                <form onSubmit={handleAddDomain} className="flex flex-col sm:flex-row gap-3">
                  <input type="text" name="new_domain" placeholder="Add domain (e.g. site.gov.in)" className={glassInput} />
                  <button type="submit" className={`w-full sm:w-auto ${glassButton}`}>Add</button>
                </form>
              </div>
            </div>
          </div>

        </div>
        </>
        )}

        {/* ROW 2: MODELS & MAPPINGS */}
        {activePage === "models" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Model Registry Container */}
          <div id="models-section" className={`rounded-2xl transition-colors duration-500 overflow-hidden ${glassPanel}`}>
            <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
              <div className="p-2 bg-blue-500/20 text-blue-500 rounded-lg backdrop-blur-md"><BrainCircuit size={20}/></div>
              <div>
                <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Model Registry</h2>
                <p className={`text-[11px] ${t_textMuted}`}>Manage ONNX weights & task types</p>
              </div>
            </div>
            <div className="p-5">
              <div className="overflow-x-auto max-h-64 mb-6 pr-2 custom-scrollbar">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead>
                    <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                      <th className="pb-3 font-medium pr-4">Model Data</th>
                      <th className="pb-3 font-medium px-4">Status</th>
                      <th className="pb-3 text-right font-medium pl-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${t_borderLight}`}>
                    {models.map(model => (
                      <React.Fragment key={model.id}>
                        <tr>
                          <td className="py-3 pr-4">
                            <div className="font-medium text-indigo-500 drop-shadow-sm">{model.ai_model_name} <span className={`text-xs ${t_textMuted}`}>{model.version}</span></div>
                            <div className={`text-xs mt-0.5 ${t_textMuted}`}>ID: #{model.id} • {model.task_type}</div>
                          </td>
                          <td className="py-3 px-4">
                            <span className={model.lifecycle_state === 'production' ? badgeSuccess : badgeWarning}>
                              {model.lifecycle_state}
                            </span>
                          </td>
                          <td className="py-3 pl-4 text-right space-x-2">
                            <button onClick={() => handleChangeModelState(model.id, 'production')} className={`text-[11px] px-2 py-1 rounded transition-colors backdrop-blur-md border ${isDark ? 'bg-white/[0.05] border-white/10 hover:bg-white/[0.1] text-gray-300' : 'bg-white/60 border-white/80 hover:bg-white text-slate-700 shadow-sm'}`}>Promote</button>
                            <button
                              onClick={() => beginEditModel(model)}
                              className={`text-[11px] px-2 py-1 rounded transition-colors backdrop-blur-md border ${isDark ? 'bg-white/[0.05] border-white/10 hover:bg-white/[0.1] text-gray-300' : 'bg-white/60 border-white/80 hover:bg-white text-slate-700 shadow-sm'}`}
                            >
                              Edit
                            </button>
                            <button onClick={() => handleDeleteModel(model.id)} className="text-[11px] text-rose-500 hover:text-rose-600 bg-rose-500/10 px-2 py-1 rounded transition-colors backdrop-blur-md border border-rose-500/20">Del</button>
                          </td>
                        </tr>
                        {editingModelId === model.id && editingModelDraft && (
                          <tr>
                            <td colSpan={3} className={`py-3 px-3 border-t ${t_borderLight}`}>
                              <form onSubmit={(e) => handleSaveModelEdit(e, model.id)} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <input className={glassInput} value={editingModelDraft.ai_model_name} onChange={(e) => setEditingModelDraft((prev) => ({ ...prev, ai_model_name: e.target.value }))} placeholder="Model Name" required />
                                <input className={glassInput} value={editingModelDraft.version} onChange={(e) => setEditingModelDraft((prev) => ({ ...prev, version: e.target.value }))} placeholder="Version" required />
                                <select className={glassInput} value={editingModelDraft.task_type} onChange={(e) => setEditingModelDraft((prev) => ({ ...prev, task_type: e.target.value }))}>
                                  <option value="image">image</option>
                                  <option value="audio">audio</option>
                                  <option value="text">text</option>
                                </select>
                                <select className={glassInput} value={editingModelDraft.lifecycle_state} onChange={(e) => setEditingModelDraft((prev) => ({ ...prev, lifecycle_state: e.target.value }))}>
                                  <option value="candidate">candidate</option>
                                  <option value="staging">staging</option>
                                  <option value="production">production</option>
                                  <option value="rolled_back">rolled_back</option>
                                </select>
                                <input className={`sm:col-span-2 ${glassInput}`} value={editingModelDraft.notes} onChange={(e) => setEditingModelDraft((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes" />
                                <div className="sm:col-span-2 flex justify-end gap-2">
                                  <button type="button" onClick={cancelEditModel} className={glassButton}>Cancel</button>
                                  <button type="submit" className={solidButton}>Save</button>
                                </div>
                              </form>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <form
                onSubmit={handleRegisterModel}
                action="/admin/models/upload"
                method="post"
                encType="multipart/form-data"
                className="space-y-3"
              >
                <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 drop-shadow-sm ${t_textMuted}`}>Register New Model</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="text" name="ai_model_name" required placeholder="Model Name" className={glassInput} />
                  <input type="text" name="version" defaultValue="v1" placeholder="Version" className={glassInput} />
                  <select name="task_type" className={glassInput}>
                    <option value="image">Task: Image</option>
                    <option value="audio">Task: Audio</option>
                    <option value="text">Task: Text</option>
                  </select>
                  <select name="runtime" className={glassInput}><option value="onnx">onnx</option></select>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center mt-3 pt-3 border-t border-white/5">
                  <input type="file" name="model_file" accept=".onnx" className={`flex-1 text-xs file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-500/10 file:text-indigo-500 hover:file:bg-indigo-500/20 w-full ${t_textMuted}`} />
                  <button type="submit" className={`w-full sm:w-auto ${solidButton}`}>Upload</button>
                </div>
              </form>
            </div>
          </div>

          {/* Domain Field Mapping Container */}
          <div className={`rounded-2xl transition-colors duration-500 overflow-hidden ${glassPanel}`}>
            <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
              <div className="p-2 bg-cyan-500/20 text-cyan-500 rounded-lg backdrop-blur-md"><Database size={20}/></div>
              <div>
                <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Domain Mapping</h2>
                <p className={`text-[11px] ${t_textMuted}`}>Map domains to AI models & selectors</p>
              </div>
            </div>
            <div className="p-5">
              <div className="overflow-x-auto max-h-64 mb-6 pr-2 custom-scrollbar">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead>
                    <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                      <th className="pb-3 font-medium pr-4">Routing Logic</th>
                      <th className="pb-3 font-medium px-4">Selectors (Src -&gt; Tgt)</th>
                      <th className="pb-3 text-right font-medium pl-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${t_borderLight}`}>
                    {mappingsByDomain.map(([domain, domainMappings]) => (
                      <React.Fragment key={domain}>
                        <tr className={isDark ? "bg-white/[0.03]" : "bg-black/[0.03]"}>
                          <td colSpan={3} className="py-2 px-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className={`font-mono text-xs ${t_textHeading}`}>{domain}</div>
                              <div className={`text-[10px] ${t_textMuted}`}>{domainMappings.length} route(s)</div>
                              {assigningDomainDraft?.domain === domain ? (
                                  <form onSubmit={handleSaveDomainModelAssign} className="flex flex-wrap items-center gap-2">
                                    <select
                                      className="h-7 px-2 rounded-md text-xs bg-black/20 border border-white/10"
                                      value={String(assigningDomainDraft.ai_model_id)}
                                      onChange={(e) => setAssigningDomainDraft((prev) => ({ ...prev, ai_model_id: Number(e.target.value) }))}
                                      required
                                    >
                                      <option value="" disabled>Select model</option>
                                      {models.map((m) => (
                                        <option key={m.id} value={m.id}>{m.ai_model_name} ({m.task_type})</option>
                                      ))}
                                    </select>
                                    <button type="button" onClick={cancelAssignDomainModel} className="text-[11px] px-2 py-1 rounded border border-white/10">Cancel</button>
                                    <button type="submit" className="text-[11px] px-2 py-1 rounded border border-indigo-500/50 text-indigo-400">Apply</button>
                                  </form>
                                ) : (
                                  <button onClick={() => beginAssignDomainModel(domain, domainMappings)} className="text-[11px] px-2 py-1 rounded border border-white/10">Assign Model</button>
                                )}
                            </div>
                          </td>
                        </tr>
                        {domainMappings.map((mapping) => (
                          <React.Fragment key={mapping.id}>
                            <tr className={t_rowHover}>
                              <td className="py-3 pr-4">
                                {mapping.ai_model_name ? (
                                  <div className="text-[10px] text-indigo-500 mt-1">use: {mapping.ai_model_name}</div>
                                ) : (
                                  <div className="text-[10px] text-rose-500 mt-1">model missing (reassign required)</div>
                                )}
                                <div className={`text-[10px] ${t_textMuted}`}>type: {mapping.source_data_type || "image"}</div>
                              </td>
                              <td className="py-3 px-4 font-mono text-xs">
                                <div className={isDark ? 'text-gray-300' : 'text-slate-700'}>S: {mapping.source_selector}</div>
                                <div className={t_textMuted}>T: {mapping.target_selector || "-"}</div>
                              </td>
                              <td className="py-3 pl-4 text-right space-x-2">
                                <button
                                  onClick={() => handleTestMapping(mapping.id, mapping.domain)}
                                  disabled={!mapping.ai_model_name}
                                  className={`text-[11px] px-2 py-1 rounded transition-colors backdrop-blur-md border ${isDark ? 'bg-white/[0.05] border-white/10 hover:bg-white/[0.1] text-gray-300' : 'bg-white/60 border-white/80 hover:bg-white text-slate-700 shadow-sm'} disabled:opacity-40 disabled:cursor-not-allowed`}
                                >
                                  Test
                                </button>
                                <button
                                  onClick={() => beginEditMapping(mapping)}
                                  className={`text-[11px] px-2 py-1 rounded transition-colors backdrop-blur-md border ${isDark ? 'bg-white/[0.05] border-white/10 hover:bg-white/[0.1] text-gray-300' : 'bg-white/60 border-white/80 hover:bg-white text-slate-700 shadow-sm'}`}
                                >
                                  Edit
                                </button>
                                <button onClick={() => handleRemoveMapping(mapping.id)} className="text-[11px] text-rose-500 hover:text-rose-600 bg-rose-500/10 px-2 py-1 rounded transition-colors backdrop-blur-md border border-rose-500/20">Del</button>
                              </td>
                            </tr>
                            {editingMappingId === mapping.id && editingMappingDraft && (
                              <tr>
                                <td colSpan={3} className={`py-3 px-3 border-t ${t_borderLight}`}>
                                  <form onSubmit={(e) => handleSaveMappingEdit(e, mapping.id)} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <input className={glassInput} value={editingMappingDraft.domain} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, domain: e.target.value }))} placeholder="Domain" required />
                                    <select className={glassInput} value={editingMappingDraft.source_data_type} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, source_data_type: e.target.value }))}>
                                      <option value="image">image</option>
                                      <option value="audio">audio</option>
                                      <option value="text">text</option>
                                    </select>
                                    <input className={glassInput} value={editingMappingDraft.source_selector} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, source_selector: e.target.value }))} placeholder="Source selector" required />
                                    <input className={glassInput} value={editingMappingDraft.target_selector} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, target_selector: e.target.value }))} placeholder="Target selector" required />
                                    <select className={glassInput} value={editingMappingDraft.target_data_type} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, target_data_type: e.target.value }))}>
                                      <option value="text_input">text_input</option>
                                      <option value="text">text</option>
                                    </select>
                                    <select className={glassInput} value={String(editingMappingDraft.ai_model_id || "")} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, ai_model_id: Number(e.target.value) }))} required>
                                      <option value="" disabled>Select model</option>
                                      {models.map((m) => <option key={m.id} value={m.id}>{m.ai_model_name} ({m.version})</option>)}
                                    </select>
                                    <div className="sm:col-span-2 flex justify-end gap-2">
                                      <button type="button" onClick={cancelEditMapping} className={glassButton}>Cancel</button>
                                      <button type="submit" className={solidButton}>Save</button>
                                    </div>
                                  </form>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <form onSubmit={handleSaveMapping} className="space-y-3">
                <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 drop-shadow-sm ${t_textMuted}`}>Create Routing Map</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="text" name="domain" required placeholder="Domain (e.g. site.com)" className={glassInput} />
                  <select name="ai_model_id" required className={glassInput} defaultValue="">
                    <option value="" disabled>Assign Model...</option>
                    {models.map(m => <option key={m.id} value={m.id}>{m.ai_model_name}</option>)}
                  </select>
                  <input type="text" name="source_selector" required placeholder="Source Selector (#img)" className={glassInput} />
                  <input type="text" name="target_selector" required placeholder="Target Selector (#txt)" className={glassInput} />
                </div>
                <input type="hidden" name="source_data_type" value="image" />
                <button type="submit" className={`w-full mt-2 ${solidButton}`}>Deploy Route Mapping</button>
              </form>
            </div>
          </div>

        </div>
        )}

        {/* FAILED PAYLOADS QUEUE */}
        {activePage === "dashboard" && (
        <div className={`rounded-2xl transition-colors duration-500 overflow-hidden ${glassPanel}`}>
          <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
            <div className="p-2 bg-amber-500/20 text-amber-500 rounded-lg backdrop-blur-md"><FileX2 size={20}/></div>
            <div>
              <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Payload Correction Queue</h2>
              <p className={`text-[11px] ${t_textMuted}`}>Manual review of failed predictions. Source: <span className="font-mono text-amber-500/70">{datasetsDir}</span></p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={handleBulkSavePayloads} className={glassButton}>Save Selected</button>
              <button type="button" onClick={handleBulkIgnorePayloads} className={glassButton}>Ignore Selected</button>
            </div>
          </div>
          
          <div className="p-5 overflow-auto max-h-[30rem] custom-scrollbar">
            <table className="w-full text-sm text-left min-w-[700px]">
              <thead>
                <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                  <th className="pb-3 font-medium">
                    <input type="checkbox" checked={allPayloadSelected} onChange={toggleAllPayloads} />
                  </th>
                  <th className="pb-3 font-medium">Target Context</th>
                  <th className="pb-3 font-medium">Captured Payload</th>
                  <th className="pb-3 font-medium">AI Guess</th>
                  <th className="pb-3 font-medium">Human Correction</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${t_borderLight}`}>
                {failedPayloads.map(item => (
                  <tr key={item.id || item.name} className={`group ${t_rowHover}`}>
                    <td className="py-4 pr-3">
                      <input type="checkbox" checked={!!selectedPayloads[item.name]} onChange={() => togglePayload(item.name)} />
                    </td>
                    <td className="py-4 pr-4">
                      <div className={`font-mono text-xs drop-shadow-sm ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>{item.domain}</div>
                      <div className={`text-[10px] mt-1 ${t_textMuted}`}>{item.updated_at}</div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className={`relative inline-block rounded-lg overflow-hidden border shadow-md backdrop-blur-sm ${isDark ? 'border-white/10 bg-black/50' : 'border-white/60 bg-white/50'}`}>
                        <img src={item.preview_url} alt="failed captcha" className="h-[45px] w-[200px] object-cover mix-blend-multiply dark:mix-blend-screen" />
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <span className={`px-3 py-1 border rounded-md font-mono tracking-widest backdrop-blur-md shadow-sm ${isDark ? 'bg-black/30 border-white/5 text-rose-400' : 'bg-white/60 border-white/80 text-rose-600'}`}>{item.ocr_guess}</span>
                    </td>
                    <td className="py-4">
                      <form onSubmit={(e) => handleLabelPayload(item.name, item.domain, item.ocr_guess, e)} className="flex items-center gap-2">
                        <input type="text" name="corrected_text" defaultValue={item.corrected_text || item.ocr_guess} required className={`${glassInput} w-32 tracking-widest font-mono text-emerald-500`} />
                        <button type="submit" className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors border backdrop-blur-md shadow-sm ${isDark ? 'bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 border-emerald-500/30' : 'bg-white/80 hover:bg-white text-emerald-600 border-white'}`}>Fix & Save</button>
                        <button type="button" onClick={() => handleIgnorePayload(item.name)} className={`p-2 transition-colors ${t_textMuted} hover:text-rose-500`}><Trash2 size={16}/></button>
                      </form>
                    </td>
                  </tr>
                ))}
                {failedPayloads.length === 0 && (
                  <tr><td colSpan="5" className={`py-8 text-center ${t_textMuted}`}>Queue is clear. Great job!</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* EXTENSION PROPOSALS QUEUE */}
        {activePage === "dashboard" && (
        <div className={`rounded-2xl transition-colors duration-500 overflow-hidden ${glassPanel}`}>
          <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
            <div className="p-2 bg-violet-500/20 text-violet-500 rounded-lg backdrop-blur-md">
              <Database size={20} />
            </div>
            <div>
              <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Extension Proposals</h2>
              <p className={`text-[11px] ${t_textMuted}`}>Approve or reject pending field proposals</p>
            </div>
          </div>
          <div className="p-5 overflow-auto max-h-[24rem] custom-scrollbar">
            <table className="w-full text-sm text-left min-w-[700px]">
              <thead>
                <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                  <th className="pb-3 font-medium">Domain</th>
                  <th className="pb-3 font-medium">Task</th>
                  <th className="pb-3 font-medium">Source</th>
                  <th className="pb-3 font-medium">Target</th>
                  <th className="pb-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${t_borderLight}`}>
                {proposals.map((p) => (
                  <tr key={p.id} className={t_rowHover}>
                    <td className={`py-3 font-mono text-xs ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>{p.domain}</td>
                    <td className="py-3 text-xs text-amber-500">{p.task_type}</td>
                    <td className={`py-3 font-mono text-xs ${t_textMuted}`}>{p.source_selector}</td>
                    <td className={`py-3 font-mono text-xs ${t_textMuted}`}>{p.target_selector}</td>
                    <td className="py-3 text-right">
                      <form onSubmit={(e) => handleApproveProposal(p, e)} className="inline-flex flex-wrap items-center justify-end gap-2">
                        <select name="ai_model_id" defaultValue="" className={`${glassInput} py-1.5 w-auto text-xs min-w-[120px]`}>
                          <option value="" disabled>Select Model</option>
                          {models.filter((m) => m.task_type === p.task_type).map((m) => (
                            <option key={m.id} value={m.id}>{m.ai_model_name}</option>
                          ))}
                        </select>
                        <button type="submit" className={`text-[11px] px-2.5 py-1.5 rounded-lg border backdrop-blur-md transition-colors ${isDark ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-400 hover:bg-emerald-500/30' : 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100'}`}>Approve</button>
                        <button type="button" onClick={() => handleRejectProposal(p.id)} className={`text-[11px] px-2.5 py-1.5 rounded-lg border backdrop-blur-md transition-colors ${isDark ? 'bg-rose-500/20 border-rose-400/30 text-rose-400 hover:bg-rose-500/30' : 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100'}`}>Reject</button>
                      </form>
                    </td>
                  </tr>
                ))}
                {proposals.length === 0 && (
                  <tr><td colSpan="5" className={`py-6 text-center ${t_textMuted}`}>No pending proposals.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

      </main>

      {/* BLOB ANIMATIONS & SCROLLBARS */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob { animation: blob 15s infinite alternate; }
        .animation-delay-2000 { animation-delay: 2s; }
        .animation-delay-4000 { animation-delay: 4s; }
        
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.3); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(156, 163, 175, 0.5); }
      `}} />
    </div>
  );
}

export default App;



