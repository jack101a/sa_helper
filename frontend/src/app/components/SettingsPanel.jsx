import React, { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Download, Upload, Save, Bell, Globe, Shield, Loader2, Inbox, Send, CreditCard, Image, RotateCcw, Database, Users, RefreshCw, CloudUpload } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { apiGet, apiPostJson } from "../../api/client";
import { EmptyState } from "./EmptyState";

export function SettingsPanel({
  apiKeys,
  access,
  settingsKeyId,
  settingsAllDomains,
  setSettingsAllDomains,
  settingsDomainSelections,
  toggleSettingsDomainSelection,
  settingsKeyRpm,
  setSettingsKeyRpm,
  settingsKeyBurst,
  setSettingsKeyBurst,
  settingsCustomDomain,
  setSettingsCustomDomain,
  handleSettingsKeyChange,
  handleSaveKeyAccessSettings,
  handleAddSettingsCustomDomain,
  handleSaveKeyRateLimitSettings,
  handleSaveKeyEntitlementsSettings,
  handleCreateBackupNow,
  handleRestoreLatestBackup,
  handleExportMasterSetup,
  handleImportMasterSetup,
  refreshData,
  showToast
}) {
  const { isDark, t_textHeading, t_textMuted, t_borderLight, t_rowHover, glassPanel, glassButton, glassInput, badgeSuccess, solidButton } = useThemeContext();
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const selectedKey = apiKeys.find(k => String(k.id) === String(settingsKeyId));
  const selectedServices = selectedKey?.services || {};
  const [backupList, setBackupList] = useState({ system: [], users: [], full: [] });
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupWorking, setBackupWorking] = useState("");
  const [selectedSystemBackup, setSelectedSystemBackup] = useState("");
  const [selectedUserBackup, setSelectedUserBackup] = useState("");
  const [backupRemoteConfig, setBackupRemoteConfig] = useState({
    telegram_chat_id: "",
    telegram_token_set: false,
    telegram_last_error: "",
    rclone_remote: "",
    rclone_path: "sa-helper-backups",
    rclone_binary: "",
    rclone_config_path: "",
    rclone_config_exists: false,
    rclone_config: "",
    rclone_remotes: [],
    rclone_remotes_error: "",
    rclone_last_error: "",
  });
  const [backupConfigLoading, setBackupConfigLoading] = useState(false);
  const [backupConfigSaving, setBackupConfigSaving] = useState(false);
  const [backupTestWorking, setBackupTestWorking] = useState("");

  const updateBackupRemoteConfig = (key, value) => {
    setBackupRemoteConfig(prev => ({ ...prev, [key]: value }));
  };

  const formatBackupSize = (bytes) => {
    const value = Number(bytes || 0);
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  };

  const formatBackupDate = (value) => {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  };

  const refreshBackups = async () => {
    setBackupLoading(true);
    try {
      const data = await apiGet("/admin/api/backups/list");
      const next = {
        system: data.system || [],
        users: data.users || [],
        full: data.full || [],
      };
      setBackupList(next);
      setSelectedSystemBackup(current => current || next.system[0]?.name || "");
      setSelectedUserBackup(current => current || next.users[0]?.name || "");
    } catch (e) {
      showToast("Failed to load backups: " + e.message, "error");
    } finally {
      setBackupLoading(false);
    }
  };

  const createSplitBackup = async (type) => {
    setBackupWorking(type);
    try {
      await apiPostJson(`/admin/api/backups/${type}`, {});
      await refreshBackups();
      showToast(type === "system" ? "System backup created." : "User backup created.");
    } catch (e) {
      showToast("Backup failed: " + e.message, "error");
    } finally {
      setBackupWorking("");
    }
  };

  const restoreSplitBackup = async (type) => {
    const filename = type === "system" ? selectedSystemBackup : selectedUserBackup;
    if (!filename) return showToast("Select a backup first.", "error");
    if (!confirm(`Restore ${type} backup ${filename}? This overwrites matching local data.`)) return;
    setBackupWorking(`restore-${type}`);
    try {
      const data = await apiPostJson("/admin/api/backups/restore", { type, filename });
      refreshData?.();
      const reloaded = data.exam_reload ? ` Exam reloaded: ${data.exam_reload.questions || 0} questions, ${data.exam_reload.sign_hashes || 0} hashes.` : "";
      showToast(type === "system" ? "System backup restored." : "User backup restored.");
      if (reloaded) showToast(reloaded.trim());
    } catch (e) {
      showToast("Restore failed: " + e.message, "error");
    } finally {
      setBackupWorking("");
    }
  };

  const syncBackups = async (target) => {
    setBackupWorking(target);
    try {
      const data = await apiPostJson(`/admin/api/backups/${target}`, {});
      const failed = (data.results || []).filter(r => r.success === false || r.ok === false);
      if (failed.length) {
        const message = failed.map(r => r.error || r.message || r.category).filter(Boolean).join("; ");
        showToast(`${target} completed with ${failed.length} failure(s).${message ? ` ${message}` : ""}`, "error");
      } else {
        showToast(target === "rclone-sync" ? "Latest backups sent to rclone." : "Latest backups sent to Telegram.");
      }
    } catch (e) {
      showToast("Sync failed: " + e.message, "error");
    } finally {
      setBackupWorking("");
    }
  };

  const loadBackupRemoteConfig = async () => {
    setBackupConfigLoading(true);
    try {
      const data = await apiGet("/admin/api/backups/remote-config");
      setBackupRemoteConfig(prev => ({ ...prev, ...data }));
    } catch (e) {
      showToast("Failed to load backup connection settings: " + e.message, "error");
    } finally {
      setBackupConfigLoading(false);
    }
  };

  const saveBackupRemoteConfig = async () => {
    setBackupConfigSaving(true);
    try {
      const data = await apiPostJson("/admin/api/backups/remote-config", {
        telegram_chat_id: backupRemoteConfig.telegram_chat_id,
        rclone_remote: backupRemoteConfig.rclone_remote,
        rclone_path: backupRemoteConfig.rclone_path,
        rclone_config: backupRemoteConfig.rclone_config,
      });
      setBackupRemoteConfig(prev => ({ ...prev, ...data }));
      showToast("Backup connection settings saved.");
    } catch (e) {
      showToast("Failed to save backup settings: " + e.message, "error");
    } finally {
      setBackupConfigSaving(false);
    }
  };

  const testBackupTelegram = async () => {
    setBackupTestWorking("telegram");
    try {
      const saved = await apiPostJson("/admin/api/backups/remote-config", {
        telegram_chat_id: backupRemoteConfig.telegram_chat_id,
        rclone_remote: backupRemoteConfig.rclone_remote,
        rclone_path: backupRemoteConfig.rclone_path,
        rclone_config: backupRemoteConfig.rclone_config,
      });
      setBackupRemoteConfig(prev => ({ ...prev, ...saved }));
      const data = await apiPostJson("/admin/api/backups/test-telegram", {
        telegram_chat_id: saved.telegram_chat_id || backupRemoteConfig.telegram_chat_id,
      });
      if (data.ok) {
        showToast("Telegram backup chat test sent.");
      } else {
        showToast("Telegram backup test failed: " + (data.error || data.hint || "unknown error"), "error");
      }
      await loadBackupRemoteConfig();
    } catch (e) {
      showToast("Telegram backup test failed: " + e.message, "error");
    } finally {
      setBackupTestWorking("");
    }
  };

  const testBackupRclone = async () => {
    setBackupTestWorking("rclone");
    try {
      const data = await apiPostJson("/admin/api/backups/test-rclone", {
        rclone_remote: backupRemoteConfig.rclone_remote,
        rclone_path: backupRemoteConfig.rclone_path,
      });
      if (data.ok) {
        showToast(`Rclone remote reachable: ${data.remote}`);
      } else {
        showToast("Rclone test failed: " + (data.error || "unknown error"), "error");
      }
      await loadBackupRemoteConfig();
    } catch (e) {
      showToast("Rclone test failed: " + e.message, "error");
    } finally {
      setBackupTestWorking("");
    }
  };

  useEffect(() => {
    apiGet("/admin/api/settings/telegram.bot_token")
      .then(d => setTelegramToken(d.value || ""))
      .catch(() => {});
    apiGet("/admin/api/settings/telegram.bot_enabled")
      .then(d => setTelegramEnabled(String(d.value || "").toLowerCase() === "true"))
      .catch(() => {});
    refreshTelegramStatus();
    refreshBackups();
    loadBackupRemoteConfig();
  }, []);

  const refreshTelegramStatus = async () => {
    try {
      const data = await apiGet("/admin/api/telegram/status");
      setTelegramStatus(data);
    } catch (_) {}
  };

  const saveTelegramToken = async () => {
    setTelegramSaving(true);
    try {
      await apiPostJson("/admin/api/settings/bulk", {
        settings: {
          "telegram.bot_token": telegramToken,
          "telegram.bot_enabled": telegramEnabled ? "true" : "false",
        }
      });
      await refreshTelegramStatus();
      showToast("Telegram bot settings saved");
    } catch (e) {
      showToast("Failed to save: " + e.message);
    }
    setTelegramSaving(false);
  };

  const testTelegramBot = async () => {
    setTelegramTesting(true);
    try {
      const data = await apiPostJson("/admin/api/telegram/test", {});
      showToast(`Telegram bot connected: @${data.username || data.id}`);
      await refreshTelegramStatus();
    } catch (e) {
      showToast("Telegram test failed: " + e.message);
    }
    setTelegramTesting(false);
  };

  const [restarting, setRestarting] = useState(false);
  const handleRestart = async () => {
    if (!confirm("Restart the server? This will briefly interrupt service.")) return;
    setRestarting(true);
    try {
      await apiPostJson("/admin/api/system/restart", {});
      showToast("Server restarting...");
    } catch (e) {
      showToast("Restart failed: " + e.message);
      setRestarting(false);
    }
  };

  // Payment settings (UPI ID + QR)
  const [upiId, setUpiId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [notePrefix, setNotePrefix] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState("INR");
  const [qrUrl, setQrUrl] = useState("");
  const [qrUploading, setQrUploading] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);

  useEffect(() => {
    apiGet("/admin/api/settings/payment.upi_id")
      .then(d => setUpiId(d.value || ""))
      .catch(() => {});
    apiGet("/admin/api/settings/payment.payee_name")
      .then(d => setPayeeName(d.value || "ta-ta Extension"))
      .catch(() => {});
    apiGet("/admin/api/settings/payment.note_prefix")
      .then(d => setNotePrefix(d.value || "Reg"))
      .catch(() => {});
    apiGet("/admin/api/settings/payment.currency")
      .then(d => setPaymentCurrency(d.value || "INR"))
      .catch(() => {});
    apiGet("/admin/api/settings/payment.qr_image_url")
      .then(d => setQrUrl(d.value || ""))
      .catch(() => {});
  }, []);

  const handleQrUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setQrUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch("/admin/api/settings/upload-qr", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = await resp.json();
      if (data.ok) {
        setQrUrl(data.url);
        showToast("QR image uploaded");
      } else {
        showToast("Upload failed: " + (data.detail || "unknown"));
      }
    } catch (err) {
      showToast("Upload failed: " + err.message);
    }
    setQrUploading(false);
  };

  const savePaymentSettings = async () => {
    setPaymentSaving(true);
    try {
      await apiPostJson("/admin/api/settings/bulk", {
        settings: {
          "payment.upi_id": upiId,
          "payment.payee_name": payeeName,
          "payment.note_prefix": notePrefix,
          "payment.currency": paymentCurrency,
          "payment.qr_image_url": qrUrl,
        }
      });
      showToast("Payment settings saved");
    } catch (e) {
      showToast("Failed to save: " + e.message);
    }
    setPaymentSaving(false);
  };
  const [globalSettings, setGlobalSettings] = useState({});
  const [loadingGlobal, setLoadingGlobal] = useState(true);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const initialGlobalSettings = useRef(null);

  useEffect(() => {
    const isDirty = initialGlobalSettings.current !== null && JSON.stringify(globalSettings) !== JSON.stringify(initialGlobalSettings.current);
    if (!isDirty) return;
    const onBefore = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [globalSettings]);

  useEffect(() => {
    fetchGlobalSettings();
  }, []);

  const fetchGlobalSettings = async () => {
    try {
      const data = await apiGet("/admin/api/settings");
      const map = {};
      data.settings.forEach(s => {
        map[s.key] = s.value;
      });
      setGlobalSettings(map);
      initialGlobalSettings.current = JSON.parse(JSON.stringify(map));
    } catch (e) {
      console.error("Failed to fetch global settings", e);
    } finally {
      setLoadingGlobal(false);
    }
  };

  const handleSaveGlobal = async (e) => {
    e.preventDefault();
    setSavingGlobal(true);
    try {
      await apiPostJson("/admin/api/settings/bulk", { settings: globalSettings });
      showToast("System settings updated.");
    } catch (e) {
      showToast("Error saving settings", "error");
    } finally {
      setSavingGlobal(false);
    }
  };

  const updateGlobal = (key, value) => {
    setGlobalSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      {/* GLOBAL SYSTEM SETTINGS SECTION */}
      <div className={`rounded-2xl p-6 ${glassPanel}`}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-500 rounded-lg backdrop-blur-md">
              <Globe size={20}/>
            </div>
            <div>
              <h2 className={`text-lg font-semibold ${t_textHeading}`}>Global System Settings</h2>
              <p className={`text-xs ${t_textMuted}`}>Configure platform-wide behavior and identity.</p>
            </div>
          </div>
          <button 
            onClick={handleSaveGlobal} 
            disabled={savingGlobal || loadingGlobal}
            className={solidButton}
          >
            {savingGlobal ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {savingGlobal ? "Saving..." : "Save System Config"}
          </button>
        </div>

        {loadingGlobal ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin text-indigo-500" /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h4 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${t_textMuted}`}>
                <Shield size={14} /> Identity & Branding
              </h4>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Platform Name</label>
                <input 
                  className={glassInput} 
                  value={globalSettings["platform.name"] || ""} 
                  onChange={(e) => updateGlobal("platform.name", e.target.value)}
                  placeholder="Unified Platform" 
                />
              </div>
            </div>

            <div className="space-y-4">
              <h4 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${t_textMuted}`}>
                <Bell size={14} /> Admin WhatsApp Alerts
              </h4>
              <div className="space-y-3">
                <label className={`flex items-center gap-2 text-xs ${t_textMuted}`}>
                  <input 
                    type="checkbox" 
                    checked={globalSettings["alerts.whatsapp_enabled"] === "true"} 
                    onChange={(e) => updateGlobal("alerts.whatsapp_enabled", e.target.checked ? "true" : "false")} 
                  />
                  Enable WhatsApp Alerts (New Key, Critical Errors)
                </label>
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>CallMeBot Phone (+91...)</label>
                  <input 
                    className={glassInput} 
                    value={globalSettings["alerts.callmebot_phone"] || ""} 
                    onChange={(e) => updateGlobal("alerts.callmebot_phone", e.target.value)}
                    placeholder="+919876543210" 
                  />
                </div>
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>CallMeBot API Key</label>
                  <input 
                    type="password"
                    className={glassInput} 
                    value={globalSettings["alerts.callmebot_apikey"] || ""} 
                    onChange={(e) => updateGlobal("alerts.callmebot_apikey", e.target.value)}
                    placeholder="xxxxxx" 
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* IMPORT/EXPORT HERO PANEL */}
      <div id="settings-section" className={`rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors duration-500 ${glassPanel}`}>
        <div>
          <h2 className={`text-base font-semibold tracking-wide ${t_textHeading}`}>Master Configuration</h2>
          <p className={`text-[12px] mt-1 ${t_textMuted}`}>Export or import the entire database setup (JSON).</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <button onClick={handleExportMasterSetup} className={glassButton}>
            <Download size={16} className={isDark ? "text-indigo-400" : "text-indigo-600"}/> 
            Export
          </button>
          <form onSubmit={handleImportMasterSetup} className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto items-stretch sm:items-center">
            <input type="file" name="setup_file" accept=".json,application/json" required className={`min-w-0 flex-1 sm:w-48 text-xs file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-500/10 file:text-indigo-500 hover:file:bg-indigo-500/20 file:transition-colors ${t_textMuted}`} />
            <button type="submit" className={`w-full sm:w-auto ${glassButton}`}>
              <Upload size={16} className={isDark ? "text-cyan-400" : "text-cyan-600"}/>
              Import
            </button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Key Domain Access */}
        <div className={`rounded-2xl p-6 transition-colors duration-500 ${glassPanel}`}>
          <h3 className={`text-base font-semibold mb-4 ${t_textHeading}`}>Key Domain Access</h3>
          <form onSubmit={handleSaveKeyAccessSettings} className="space-y-4">
            <div>
              <label className={`text-xs block mb-1 ${t_textMuted}`}>Select API Key</label>
              <select className={glassInput} value={settingsKeyId} onChange={(e) => handleSettingsKeyChange(e.target.value)}>
                <option value="" disabled>Select API key</option>
                {apiKeys.map((k) => <option key={k.id} value={k.id}>{k.name} (#{k.id})</option>)}
              </select>
            </div>
            <label className={`flex items-center gap-2 text-xs ${t_textMuted} font-medium`}>
              <input type="checkbox" checked={settingsAllDomains} onChange={(e) => setSettingsAllDomains(e.target.checked)} />
              Allow access to all domains
            </label>
            <div className={`max-h-32 overflow-auto rounded-xl border p-3 ${t_borderLight} ${settingsAllDomains ? "opacity-50 pointer-events-none" : ""}`}>
              {access.allowed_domains.map((domain) => (
                <label key={domain} className={`flex items-center gap-2 text-xs py-1 ${t_textMuted} hover:text-white transition-colors cursor-pointer`}>
                  <input type="checkbox" checked={settingsDomainSelections.includes(domain)} onChange={() => toggleSettingsDomainSelection(domain)} />
                  {domain}
                </label>
              ))}
              {access.allowed_domains.length === 0 && <p className="text-[10px] text-center italic py-2 opacity-50">No domains in system whitelist.</p>}
            </div>
            <div className={`flex gap-2 ${settingsAllDomains ? "opacity-50 pointer-events-none" : ""}`}>
              <input className={glassInput} value={settingsCustomDomain} onChange={(e) => setSettingsCustomDomain(e.target.value)} placeholder="Add custom domain" />
              <button type="button" onClick={handleAddSettingsCustomDomain} className={glassButton}>Add</button>
            </div>
            <button type="submit" className={glassButton}>Update Domain Access</button>
          </form>
        </div>

        {/* Key Rate Limit */}
        <div className={`rounded-2xl p-6 transition-colors duration-500 ${glassPanel}`}>
          <h3 className={`text-base font-semibold mb-4 ${t_textHeading}`}>Key Rate Limit</h3>
          <form onSubmit={handleSaveKeyRateLimitSettings} className="space-y-4">
            <div>
              <label className={`text-xs block mb-1 ${t_textMuted}`}>Select API Key</label>
              <select className={glassInput} value={settingsKeyId} onChange={(e) => handleSettingsKeyChange(e.target.value)}>
                <option value="" disabled>Select API key</option>
                {apiKeys.map((k) => <option key={k.id} value={k.id}>{k.name} (#{k.id})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>RPM Limit</label>
                <input type="number" min="1" className={glassInput} value={settingsKeyRpm} onChange={(e) => setSettingsKeyRpm(Number(e.target.value))} placeholder="60" />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Burst Allowance</label>
                <input type="number" min="0" className={glassInput} value={settingsKeyBurst} onChange={(e) => setSettingsKeyBurst(Number(e.target.value))} placeholder="10" />
              </div>
            </div>
            <button type="submit" className={glassButton}>Update Rate Limit</button>
          </form>
        </div>
      </div>

      <div className={`rounded-2xl p-6 transition-colors duration-500 ${glassPanel}`}>
        <h3 className={`text-base font-semibold mb-4 ${t_textHeading}`}>Key User Info And Services</h3>
        <form key={`ent-${settingsKeyId}`} onSubmit={handleSaveKeyEntitlementsSettings} className="space-y-4">
          <div>
            <label className={`text-xs block mb-1 ${t_textMuted}`}>Select API Key</label>
            <select className={glassInput} value={settingsKeyId} onChange={(e) => handleSettingsKeyChange(e.target.value)}>
              <option value="" disabled>Select API key</option>
              {apiKeys.map((k) => <option key={k.id} value={k.id}>{k.name} (#{k.id})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={`text-xs block mb-1 ${t_textMuted}`}>Plan</label>
              <input name="plan_name" className={glassInput} defaultValue={selectedKey?.plan_name || "Standard"} />
            </div>
            <div>
              <label className={`text-xs block mb-1 ${t_textMuted}`}>Mobile</label>
              <input name="mobile" className={glassInput} defaultValue={selectedKey?.mobile || ""} />
            </div>
            <div>
              <label className={`text-xs block mb-1 ${t_textMuted}`}>Telegram ID</label>
              <input name="telegram_id" className={glassInput} defaultValue={selectedKey?.telegram_id || ""} />
            </div>
          </div>
          <div className={`grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-xl border p-3 ${t_borderLight}`}>
            {["autofill", "captcha", "stall", "solver", "custom"].map((svc) => (
              <label key={svc} className={`flex items-center gap-2 text-xs capitalize ${t_textMuted}`}>
                <input type="checkbox" name={`service_${svc}`} defaultChecked={selectedServices[svc] !== false && (svc !== "custom" || selectedServices[svc] === true)} />
                {svc}
              </label>
            ))}
          </div>
          <button type="submit" className={glassButton}>Update User Services</button>
        </form>
      </div>

      {/* Backups Section */}
      <div className={`rounded-2xl p-6 transition-colors duration-500 ${glassPanel}`}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className={`text-base font-semibold ${t_textHeading}`}>Data Resilience</h3>
          <button type="button" onClick={refreshBackups} disabled={backupLoading} className={glassButton}>
            {backupLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`rounded-xl border p-4 ${t_borderLight}`}>
            <div className="flex items-center gap-2 mb-3">
              <Database size={16} className="text-cyan-400" />
              <h4 className={`text-sm font-semibold ${t_textHeading}`}>System Backup</h4>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button type="button" onClick={() => createSplitBackup("system")} disabled={!!backupWorking} className={glassButton}>
                {backupWorking === "system" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Create System
              </button>
              <select className={glassInput} value={selectedSystemBackup} onChange={(e) => setSelectedSystemBackup(e.target.value)}>
                <option value="">No system backups</option>
                {backupList.system.map((item) => (
                  <option key={item.name} value={item.name}>{item.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => restoreSplitBackup("system")} disabled={!selectedSystemBackup || !!backupWorking} className={glassButton}>
                {backupWorking === "restore-system" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Restore
              </button>
            </div>
            {backupList.system[0] && (
              <p className={`text-[11px] mt-2 ${t_textMuted}`}>
                Latest: {formatBackupSize(backupList.system[0].size)} · {formatBackupDate(backupList.system[0].created)}
              </p>
            )}
          </div>

          <div className={`rounded-xl border p-4 ${t_borderLight}`}>
            <div className="flex items-center gap-2 mb-3">
              <Users size={16} className="text-emerald-400" />
              <h4 className={`text-sm font-semibold ${t_textHeading}`}>User Backup</h4>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button type="button" onClick={() => createSplitBackup("users")} disabled={!!backupWorking} className={glassButton}>
                {backupWorking === "users" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Create Users
              </button>
              <select className={glassInput} value={selectedUserBackup} onChange={(e) => setSelectedUserBackup(e.target.value)}>
                <option value="">No user backups</option>
                {backupList.users.map((item) => (
                  <option key={item.name} value={item.name}>{item.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => restoreSplitBackup("users")} disabled={!selectedUserBackup || !!backupWorking} className={glassButton}>
                {backupWorking === "restore-users" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Restore
              </button>
            </div>
            {backupList.users[0] && (
              <p className={`text-[11px] mt-2 ${t_textMuted}`}>
                Latest: {formatBackupSize(backupList.users[0].size)} · {formatBackupDate(backupList.users[0].created)}
              </p>
            )}
          </div>
        </div>

        <div className={`mt-4 rounded-xl border p-4 ${t_borderLight}`}>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
            <div>
              <h4 className={`text-sm font-semibold ${t_textHeading}`}>Remote Backup Connections</h4>
              <p className={`text-[11px] mt-1 ${t_textMuted}`}>
                Manage the Telegram backup destination and the rclone remote used by manual and scheduled backups.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={loadBackupRemoteConfig} disabled={backupConfigLoading} className={glassButton}>
                {backupConfigLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Reload
              </button>
              <button type="button" onClick={saveBackupRemoteConfig} disabled={backupConfigSaving || backupConfigLoading} className={solidButton}>
                {backupConfigSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {backupConfigSaving ? "Saving..." : "Save Backup Config"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Send size={16} className="text-blue-400" />
                <h5 className={`text-xs font-bold uppercase tracking-widest ${t_textMuted}`}>Telegram Backup</h5>
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Backup Chat ID</label>
                <input
                  className={glassInput}
                  value={backupRemoteConfig.telegram_chat_id || ""}
                  onChange={(e) => updateBackupRemoteConfig("telegram_chat_id", e.target.value)}
                  placeholder="-1001234567890"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={testBackupTelegram} disabled={backupTestWorking === "telegram" || !backupRemoteConfig.telegram_chat_id} className={glassButton}>
                  {backupTestWorking === "telegram" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Test Chat
                </button>
                <span className={`text-[11px] ${t_textMuted}`}>
                  Bot token: {backupRemoteConfig.telegram_token_set ? "set" : "missing"}
                </span>
              </div>
              {backupRemoteConfig.telegram_last_error && (
                <p className="text-[11px] text-red-400 break-words">
                  Last Telegram error: {backupRemoteConfig.telegram_last_error}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CloudUpload size={16} className="text-cyan-400" />
                <h5 className={`text-xs font-bold uppercase tracking-widest ${t_textMuted}`}>Rclone Backup</h5>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>Remote Name</label>
                  <input
                    className={glassInput}
                    value={backupRemoteConfig.rclone_remote || ""}
                    onChange={(e) => updateBackupRemoteConfig("rclone_remote", e.target.value)}
                    placeholder="gdrive"
                  />
                </div>
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>Remote Folder</label>
                  <input
                    className={glassInput}
                    value={backupRemoteConfig.rclone_path || ""}
                    onChange={(e) => updateBackupRemoteConfig("rclone_path", e.target.value)}
                    placeholder="sa-helper-backups"
                  />
                </div>
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>rclone.conf</label>
                <textarea
                  className={`${glassInput} min-h-40 font-mono text-[11px] leading-relaxed`}
                  value={backupRemoteConfig.rclone_config || ""}
                  onChange={(e) => updateBackupRemoteConfig("rclone_config", e.target.value)}
                  spellCheck={false}
                  placeholder={"[gdrive]\ntype = drive\nscope = drive.file\n..."}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={testBackupRclone} disabled={backupTestWorking === "rclone" || !backupRemoteConfig.rclone_remote} className={glassButton}>
                  {backupTestWorking === "rclone" ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
                  Test Remote
                </button>
                <span className={`text-[11px] break-all ${t_textMuted}`}>
                  Binary: {backupRemoteConfig.rclone_binary || "missing"} · Config: {backupRemoteConfig.rclone_config_exists ? backupRemoteConfig.rclone_config_path : "not saved"}
                </span>
              </div>
              {(backupRemoteConfig.rclone_remotes || []).length > 0 && (
                <p className={`text-[11px] ${t_textMuted}`}>
                  Remotes: {(backupRemoteConfig.rclone_remotes || []).join(", ")}
                </p>
              )}
              {(backupRemoteConfig.rclone_last_error || backupRemoteConfig.rclone_remotes_error) && (
                <p className="text-[11px] text-red-400 break-words">
                  Last rclone error: {backupRemoteConfig.rclone_last_error || backupRemoteConfig.rclone_remotes_error}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <button type="button" onClick={() => syncBackups("rclone-sync")} disabled={!!backupWorking} className={glassButton}>
            {backupWorking === "rclone-sync" ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
            Rclone Sync
          </button>
          <button type="button" onClick={() => syncBackups("telegram-sync")} disabled={!!backupWorking} className={glassButton}>
            {backupWorking === "telegram-sync" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Telegram Upload
          </button>
        </div>
      </div>

      {/* Overview Table */}
      <div className={`rounded-2xl p-6 transition-colors duration-500 ${glassPanel}`}>
        <h3 className={`text-base font-semibold mb-4 ${t_textHeading}`}>API Credentials Audit</h3>
        <div className="overflow-auto max-h-80 custom-scrollbar">
          <table className="w-full text-sm text-left min-w-[780px]">
            <thead>
              <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                <th className="pb-3 font-medium">Key Identity</th>
                <th className="pb-3 font-medium">Domain Scope</th>
                <th className="pb-3 font-medium">Rate Limit</th>
                <th className="pb-3 font-medium">Services</th>
                <th className="pb-3 font-medium text-right">Device Lock</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${t_borderLight}`}>
              {apiKeys.map((k) => (
                <tr key={`settings-key-${k.id}`} className={t_rowHover}>
                  <td className="py-4">
                    <div className={`font-semibold ${t_textHeading}`}>{k.name}</div>
                    <div className={`text-[10px] font-mono opacity-60 ${t_textMuted}`}>#{k.id}</div>
                  </td>
                  <td className="py-4 text-xs">
                    {k.all_domains ? (
                      <span className={badgeSuccess}>GLOBAL</span>
                    ) : (
                      <div className={`max-w-[280px] font-mono text-[10px] break-all leading-relaxed ${t_textMuted}`}>
                        {(k.allowed_domains || []).join(", ") || "No specific domains"}
                      </div>
                    )}
                  </td>
                  <td className="py-4 text-xs">
                    <div className={t_textHeading}>{(k.rate_limit?.requests_per_minute || 60)} RPM</div>
                    <div className={`text-[10px] ${t_textMuted}`}>Burst: {(k.rate_limit?.burst || 10)}</div>
                  </td>
                  <td className="py-4 text-xs">
                    <div className={`max-w-[260px] ${t_textMuted}`}>
                      {Object.entries(k.services || {}).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "No services"}
                    </div>
                    <div className={`text-[10px] ${t_textMuted}`}>{k.plan_name || "Standard"} {k.mobile ? `- ${k.mobile}` : ""}</div>
                  </td>
                  <td className="py-4 text-xs text-right">
                    {k.device_binding?.device_id ? (
                      <span className="font-mono text-emerald-500/80 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">{k.device_binding.device_id.slice(0,12)}...</span>
                    ) : (
                      <span className={`opacity-40 italic ${t_textMuted}`}>Unbound</span>
                    )}
                  </td>
                </tr>
              ))}
              {apiKeys.length === 0 && <EmptyState icon={Inbox} title="No API keys registered" />}
            </tbody>
          </table>
        </div>
      </div>

      {/* Telegram Bot Settings */}
      <div className={`rounded-2xl p-6 transition-colors duration-500 ${glassPanel}`}>
        <div className="flex items-center gap-3 mb-4">
          <Send size={18} className="text-blue-400" />
          <h3 className={`text-base font-semibold ${t_textHeading}`}>Telegram Bot</h3>
        </div>
        <p className={`text-xs mb-4 ${t_textMuted}`}>
          Set this to enable Telegram registration. Users can register, select plans, and submit payments via bot.
          Run with: <code className="px-1 py-0.5 rounded bg-white/5 text-xs">TELEGRAM_BOT_TOKEN=xxx python -m app.services.telegram_bot</code>
        </p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className={`text-xs block mb-1 ${t_textMuted}`}>Bot Token (from @BotFather)</label>
            <input 
              type="password"
              className={glassInput} 
              value={telegramToken} 
              onChange={(e) => setTelegramToken(e.target.value)}
              placeholder="123456:ABC-DEF1234ghikl..." 
            />
          </div>
          <button onClick={saveTelegramToken} disabled={telegramSaving} className={solidButton}>
            {telegramSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {telegramSaving ? "Saving..." : "Save"}
          </button>
        </div>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <label className={`flex items-center gap-2 text-xs ${t_textMuted}`}>
            <input
              type="checkbox"
              checked={telegramEnabled}
              onChange={(e) => setTelegramEnabled(e.target.checked)}
            />
            Enable Telegram registration
          </label>
          <button onClick={testTelegramBot} disabled={telegramTesting || !telegramToken} className={glassButton}>
            {telegramTesting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {telegramTesting ? "Testing..." : "Test Bot"}
          </button>
        </div>
        {telegramStatus && (
          <p className={`text-[11px] mt-2 ${t_textMuted}`}>
            Status: {telegramStatus.enabled ? "enabled" : "disabled"} · Token: {telegramStatus.token_set ? "set" : "missing"} · Package: {telegramStatus.package_available ? telegramStatus.package_version || "available" : "missing"}
          </p>
        )}
        <p className={`text-[11px] mt-2 ${t_textMuted}`}>
          Also configurable via <code className="px-1 py-0.5 rounded bg-white/5 text-xs">TELEGRAM_BOT_TOKEN</code> in <code className="px-1 py-0.5 rounded bg-white/5 text-xs">sa_helper/config/.env</code>
        </p>
        <div className="mt-4 pt-3 border-t border-white/[0.05]">
          <button
            onClick={handleRestart}
            disabled={restarting}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              isDark ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25' : 'bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200'
            }`}
          >
            {restarting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {restarting ? "Restarting..." : "Restart Server"}
          </button>
          <p className={`text-[11px] mt-1.5 ${t_textMuted}`}>
            Restart after changing bot token or payment settings.
          </p>
        </div>
      </div>

      {/* Payment Settings (UPI + QR) */}
      <div className={`rounded-2xl p-6 transition-colors duration-500 ${glassPanel}`}>
        <div className="flex items-center gap-3 mb-4">
          <CreditCard size={18} className="text-emerald-400" />
          <h3 className={`text-base font-semibold ${t_textHeading}`}>Payment Settings</h3>
        </div>
        <p className={`text-xs mb-4 ${t_textMuted}`}>
          Configure UPI ID and QR code shown to users during Telegram bot registration.
        </p>
        <div className="space-y-3">
          <div>
            <label className={`text-xs block mb-1 ${t_textMuted}`}>UPI ID</label>
            <input 
              className={glassInput} 
              value={upiId} 
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="yourname@upi" 
            />
          </div>
          <div>
            <label className={`text-xs block mb-1 ${t_textMuted}`}>Payee Name</label>
            <input 
              className={glassInput} 
              value={payeeName} 
              onChange={(e) => setPayeeName(e.target.value)}
              placeholder="ta-ta Extension" 
            />
          </div>
          <div>
            <label className={`text-xs block mb-1 ${t_textMuted}`}>Payment Note Prefix</label>
            <input 
              className={glassInput} 
              value={notePrefix} 
              onChange={(e) => setNotePrefix(e.target.value)}
              placeholder="Reg" 
            />
          </div>
          <div>
            <label className={`text-xs block mb-1 ${t_textMuted}`}>Currency</label>
            <input 
              className={glassInput} 
              value={paymentCurrency} 
              onChange={(e) => setPaymentCurrency(e.target.value)}
              placeholder="INR" 
              maxLength={3}
            />
          </div>
          <div>
            <label className={`text-xs block mb-1 ${t_textMuted}`}>QR Code Image</label>
            <div className="flex gap-2 items-center">
              <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm cursor-pointer transition-all ${isDark ? 'bg-white/10 hover:bg-white/15' : 'bg-gray-100 hover:bg-gray-200'} ${t_textHeading}`}>
                {qrUploading ? <Loader2 size={14} className="animate-spin" /> : <Image size={14} />}
                {qrUploading ? "Uploading..." : "Upload QR"}
                <input type="file" accept="image/*" onChange={handleQrUpload} className="hidden" />
              </label>
              {qrUrl && (
                <span className={`text-xs truncate max-w-[200px] ${t_textMuted}`}>
                  {qrUrl.startsWith("/admin/") ? "Uploaded ✓" : qrUrl}
                </span>
              )}
            </div>
          </div>
          <button onClick={savePaymentSettings} disabled={paymentSaving} className={solidButton}>
            {paymentSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {paymentSaving ? "Saving..." : "Save Payment Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

SettingsPanel.propTypes = {
  apiKeys: PropTypes.array.isRequired,
  access: PropTypes.object.isRequired,
  settingsKeyId: PropTypes.string,
  settingsAllDomains: PropTypes.bool.isRequired,
  setSettingsAllDomains: PropTypes.func.isRequired,
  settingsDomainSelections: PropTypes.array.isRequired,
  toggleSettingsDomainSelection: PropTypes.func.isRequired,
  settingsKeyRpm: PropTypes.number.isRequired,
  setSettingsKeyRpm: PropTypes.func.isRequired,
  settingsKeyBurst: PropTypes.number.isRequired,
  setSettingsKeyBurst: PropTypes.func.isRequired,
  settingsCustomDomain: PropTypes.string.isRequired,
  setSettingsCustomDomain: PropTypes.func.isRequired,
  handleSettingsKeyChange: PropTypes.func.isRequired,
  handleSaveKeyAccessSettings: PropTypes.func.isRequired,
  handleAddSettingsCustomDomain: PropTypes.func.isRequired,
  handleSaveKeyRateLimitSettings: PropTypes.func.isRequired,
  handleSaveKeyEntitlementsSettings: PropTypes.func.isRequired,
  handleCreateBackupNow: PropTypes.func.isRequired,
  handleRestoreLatestBackup: PropTypes.func.isRequired,
  handleExportMasterSetup: PropTypes.func.isRequired,
  handleImportMasterSetup: PropTypes.func.isRequired,
  refreshData: PropTypes.func,
  showToast: PropTypes.func.isRequired,
};
