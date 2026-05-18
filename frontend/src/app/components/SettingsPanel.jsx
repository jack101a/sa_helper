import React, { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Download, Upload, Save, Bell, Globe, Shield, Loader2, Inbox, Send, CreditCard, Image, RotateCcw, DatabaseBackup, CheckCircle2, Cloud, KeyRound } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { apiGet, apiPostForm, apiPostJson } from "../../api/client";
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
  cloudBackupConfigured,
  handleSettingsKeyChange,
  handleSaveKeyAccessSettings,
  handleAddSettingsCustomDomain,
  handleSaveKeyRateLimitSettings,
  handleSaveKeyEntitlementsSettings,
  handleCreateBackupNow,
  handleRestoreLatestBackup,
  handleExportMasterSetup,
  handleImportMasterSetup,
  handleExportAutofill,
  handleImportAutofill,
  handleExportCaptcha,
  handleImportCaptcha,
  handleExportFullBackup,
  handleImportFullBackup,
  handleCloudBackupPush,
  handleCloudBackupPull,
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

  useEffect(() => {
    apiGet("/admin/api/settings/telegram.bot_token")
      .then(d => setTelegramToken(d.value || ""))
      .catch(() => {});
    apiGet("/admin/api/settings/telegram.bot_enabled")
      .then(d => setTelegramEnabled(String(d.value || "").toLowerCase() === "true"))
      .catch(() => {});
    refreshTelegramStatus();
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

  const [backupHealth, setBackupHealth] = useState(null);
  const [backupHistory, setBackupHistory] = useState([]);
  const [backupSettings, setBackupSettings] = useState({
    encryptionEnabled: true,
    encryptionMethod: "age",
    ageRecipient: "",
    gpgRecipient: "",
    telegramEnabled: true,
    telegramChannelId: "",
    telegramSendFile: true,
    telegramMaxFileMb: "45",
    rcloneEnabled: true,
    rcloneDestination: "",
    autoEnabled: false,
    scheduleType: "cron",
    cron: "0 3 * * *",
    intervalHours: "24",
    timezone: "Asia/Kolkata",
    retentionDays: "14",
    localRetentionCount: "10",
    runTelegram: true,
    runRclone: true,
  });
  const [backupBusy, setBackupBusy] = useState("");

  useEffect(() => {
    refreshBackupHealth();
    refreshBackupHistory();
  }, []);

  const refreshBackupHealth = async () => {
    try {
      const data = await apiGet("/admin/api/system/backup/config");
      setBackupHealth(data);
      setBackupSettings(prev => ({
        ...prev,
        encryptionEnabled: Boolean(data.encryption_enabled),
        encryptionMethod: data.encryption_method || "none",
        telegramEnabled: Boolean(data.telegram_enabled),
        telegramChannelId: data.telegram_chat_id || "",
        telegramSendFile: Boolean(data.telegram_send_file),
        telegramMaxFileMb: String(data.telegram_max_file_mb || 45),
        rcloneEnabled: Boolean(data.rclone_enabled),
        rcloneDestination: data.rclone_destination || "",
        autoEnabled: Boolean(data.auto_enabled),
        scheduleType: data.schedule_type || "cron",
        cron: data.cron || "0 3 * * *",
        intervalHours: String(data.interval_hours || 24),
        timezone: data.timezone || "Asia/Kolkata",
        retentionDays: String(data.retention_days || 14),
        localRetentionCount: String(data.local_retention_count || 10),
      }));
    } catch (_) {}
  };

  const refreshBackupHistory = async () => {
    try {
      const data = await apiGet("/admin/api/system/backup/history");
      setBackupHistory(Array.isArray(data.runs) ? data.runs : []);
    } catch (_) {}
  };

  const updateBackupSetting = (key, value) => {
    setBackupSettings(prev => ({ ...prev, [key]: value }));
  };

  const latestBackup = backupHistory?.[0] || null;
  const backupSetupHint = (() => {
    if (!backupHealth) return "";
    if (!backupHealth.telegram_chat_id) return "Set Telegram backup chat/channel ID.";
    if (!backupHealth.rclone_destination) return "Set rclone destination path.";
    return "";
  })();

  const saveBackupSettings = async () => {
    setBackupBusy("settings");
    try {
      await apiPostJson("/admin/api/system/backup/config", {
        settings: {
          "backup.encryption.enabled": backupSettings.encryptionEnabled ? "true" : "false",
          "backup.encryption.method": backupSettings.encryptionMethod,
          "backup.age.recipient": backupSettings.ageRecipient,
          "backup.gpg.recipient": backupSettings.gpgRecipient,
          "backup.telegram.enabled": backupSettings.telegramEnabled ? "true" : "false",
          "backup.telegram.chat_id": backupSettings.telegramChannelId,
          "backup.telegram.send_file": backupSettings.telegramSendFile ? "true" : "false",
          "backup.telegram.max_file_mb": backupSettings.telegramMaxFileMb,
          "backup.rclone.enabled": backupSettings.rcloneEnabled ? "true" : "false",
          "backup.rclone.destination": backupSettings.rcloneDestination,
          "backup.auto.enabled": backupSettings.autoEnabled ? "true" : "false",
          "backup.auto.schedule_type": backupSettings.scheduleType,
          "backup.auto.cron": backupSettings.cron,
          "backup.auto.interval_hours": backupSettings.intervalHours,
          "backup.auto.timezone": backupSettings.timezone,
          "backup.retention_days": backupSettings.retentionDays,
          "backup.local_retention_count": backupSettings.localRetentionCount,
        },
      });
      await refreshBackupHealth();
      showToast("Backup settings saved");
    } catch (e) {
      showToast(e.message || "Failed to save backup settings", "error");
    } finally {
      setBackupBusy("");
    }
  };

  const createPackageBackup = async () => {
    setBackupBusy("create");
    try {
      const result = await apiPostJson("/admin/api/system/backup/run", {
        telegram: backupSettings.runTelegram,
        rclone: backupSettings.runRclone,
        trigger_type: "manual",
      });
      await refreshBackupHealth();
      await refreshBackupHistory();
      showToast(result.status === "completed" ? "Backup package created" : result.error || "Backup failed", result.status === "completed" ? "success" : "error");
    } catch (e) {
      showToast(e.message || "Backup failed", "error");
    } finally {
      setBackupBusy("");
    }
  };

  const uploadRcloneConfig = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupBusy("rclone-conf");
    try {
      const fd = new FormData();
      fd.append("rclone_file", file);
      const result = await apiPostForm("/admin/api/system/backup/rclone-config", fd);
      showToast(result.ok ? "rclone.conf uploaded" : result.error || "rclone.conf upload failed", result.ok ? "success" : "error");
      await refreshBackupHealth();
    } catch (err) {
      showToast(err.message || "rclone.conf upload failed", "error");
    } finally {
      e.target.value = "";
      setBackupBusy("");
    }
  };

  const testRcloneMode = async (mode) => {
    setBackupBusy(`rclone-${mode}`);
    try {
      const result = await apiPostJson("/admin/api/system/backup/rclone/test", { mode, destination: backupSettings.rcloneDestination });
      showToast(result.ok ? "rclone test passed" : result.error || "rclone test failed", result.ok ? "success" : "error");
    } catch (err) {
      showToast(err.message || "rclone test failed", "error");
    } finally {
      setBackupBusy("");
    }
  };

  const testTelegramBackupDestination = async () => {
    setBackupBusy("telegram-test");
    try {
      const result = await apiPostJson("/admin/api/system/backup/telegram/test", { chat_id: backupSettings.telegramChannelId.trim() });
      showToast(result.ok ? "Telegram destination test sent" : (result.error || "Telegram destination test failed"), result.ok ? "success" : "error");
      await refreshBackupHealth();
    } catch (e) {
      showToast(e.data?.hint || e.data?.error || e.message || "Telegram destination test failed", "error");
    } finally {
      setBackupBusy("");
    }
  };

  const testTelegramBackupFile = async () => {
    setBackupBusy("telegram-file");
    try {
      const result = await apiPostJson("/admin/api/system/backup/telegram/test-file", { chat_id: backupSettings.telegramChannelId.trim() });
      showToast(result.ok ? "Telegram test file sent" : (result.error || "Telegram test file failed"), result.ok ? "success" : "error");
    } catch (e) {
      showToast(e.message || "Telegram test file failed", "error");
    } finally {
      setBackupBusy("");
    }
  };

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
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/15 text-emerald-500 rounded-lg">
              <DatabaseBackup size={20} />
            </div>
            <div>
              <h3 className={`text-base font-semibold ${t_textHeading}`}>Data Resilience</h3>
              <p className={`text-xs ${t_textMuted}`}>Portable backup packages for redeploy and restore.</p>
            </div>
          </div>
          <button type="button" onClick={refreshBackupHealth} className={glassButton}>
            <RotateCcw size={14} />
            Refresh
          </button>
        </div>

        <div className={`grid grid-cols-1 md:grid-cols-4 gap-3 rounded-xl border p-4 mb-5 ${t_borderLight}`}>
          <div>
            <p className={`text-[10px] uppercase font-bold ${t_textMuted}`}>Backups</p>
            <p className={`text-xl font-semibold ${t_textHeading}`}>{backupHealth?.total_backups ?? "-"}</p>
          </div>
          <div>
            <p className={`text-[10px] uppercase font-bold ${t_textMuted}`}>Latest</p>
            <p className={`text-sm font-medium truncate ${t_textHeading}`}>{latestBackup?.filename || "None"}</p>
          </div>
          <div>
            <p className={`text-[10px] uppercase font-bold ${t_textMuted}`}>Telegram</p>
            <p className={`text-sm ${backupHealth?.telegram_enabled && backupHealth?.telegram_chat_id ? "text-emerald-400" : t_textMuted}`}>
              {backupHealth?.telegram_enabled && backupHealth?.telegram_chat_id ? "Ready" : "Not configured"}
            </p>
            <p className={`text-[10px] truncate ${t_textMuted}`}>Hosted Bot API</p>
          </div>
          <div>
            <p className={`text-[10px] uppercase font-bold ${t_textMuted}`}>Rclone</p>
            <p className={`text-sm ${backupHealth?.rclone_enabled && backupHealth?.rclone_config_present ? "text-emerald-400" : t_textMuted}`}>
              {backupHealth?.rclone_enabled && backupHealth?.rclone_config_present ? "Ready" : "Not configured"}
            </p>
          </div>
        </div>

        {backupSetupHint && (
          <div className={`rounded-xl border p-3 mb-5 text-xs ${t_borderLight} ${t_textMuted}`}>
            {backupSetupHint}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="space-y-4">
            <h4 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${t_textMuted}`}>
              <KeyRound size={14} /> Backup Settings
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Encryption Method</label>
                <select className={glassInput} value={backupSettings.encryptionMethod} onChange={(e) => updateBackupSetting("encryptionMethod", e.target.value)}>
                  <option value="age">age</option>
                  <option value="gpg">gpg</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Telegram Max File MB</label>
                <input
                  type="number"
                  min="1"
                  className={glassInput}
                  value={backupSettings.telegramMaxFileMb}
                  onChange={(e) => updateBackupSetting("telegramMaxFileMb", e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Telegram Backup Channel ID</label>
                <input
                  className={glassInput}
                  value={backupSettings.telegramChannelId}
                  onChange={(e) => updateBackupSetting("telegramChannelId", e.target.value)}
                  placeholder="-1001234567890"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Rclone Destination</label>
                <input className={glassInput} value={backupSettings.rcloneDestination} onChange={(e) => updateBackupSetting("rcloneDestination", e.target.value)} placeholder="remote:sa-helper-backups/" />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Cron</label>
                <input className={glassInput} value={backupSettings.cron} onChange={(e) => updateBackupSetting("cron", e.target.value)} />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Interval Hours</label>
                <input type="number" min="1" className={glassInput} value={backupSettings.intervalHours} onChange={(e) => updateBackupSetting("intervalHours", e.target.value)} />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Timezone</label>
                <input className={glassInput} value={backupSettings.timezone} onChange={(e) => updateBackupSetting("timezone", e.target.value)} />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Retention Days</label>
                <input type="number" min="1" className={glassInput} value={backupSettings.retentionDays} onChange={(e) => updateBackupSetting("retentionDays", e.target.value)} />
              </div>
            </div>
            <button type="button" onClick={saveBackupSettings} disabled={backupBusy === "settings"} className={solidButton}>
              {backupBusy === "settings" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Backup Settings
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button type="button" onClick={createPackageBackup} disabled={backupBusy === "create"} className={glassButton}>
                {backupBusy === "create" ? <Loader2 size={14} className="animate-spin" /> : <DatabaseBackup size={14} />}
                Run Backup Now
              </button>
              <button type="button" onClick={testTelegramBackupDestination} disabled={backupBusy === "telegram-test"} className={glassButton}>
                {backupBusy === "telegram-test" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Telegram Test Message
              </button>
              <button type="button" onClick={testTelegramBackupFile} disabled={backupBusy === "telegram-file"} className={glassButton}>
                {backupBusy === "telegram-file" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Telegram Test File
              </button>
              <label className={`cursor-pointer ${glassButton}`}>
                {backupBusy === "rclone-conf" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Upload rclone.conf
                <input type="file" accept=".conf,text/plain" className="hidden" onChange={uploadRcloneConfig} />
              </label>
              <button type="button" onClick={() => testRcloneMode("version")} disabled={backupBusy === "rclone-version"} className={glassButton}>{backupBusy === "rclone-version" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}Rclone Version</button>
              <button type="button" onClick={() => testRcloneMode("remotes")} disabled={backupBusy === "rclone-remotes"} className={glassButton}>{backupBusy === "rclone-remotes" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}List Remotes</button>
              <button type="button" onClick={() => testRcloneMode("destination")} disabled={backupBusy === "rclone-destination"} className={glassButton}>{backupBusy === "rclone-destination" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}Test Destination</button>
              <button type="button" onClick={() => testRcloneMode("upload")} disabled={backupBusy === "rclone-upload"} className={glassButton}>{backupBusy === "rclone-upload" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}Test Upload</button>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${t_textMuted}`}>
              <Cloud size={14} /> Schedule & History
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={`flex items-center gap-2 text-xs ${t_textMuted}`}>
                <input
                  type="checkbox"
                  checked={backupSettings.autoEnabled}
                  onChange={(e) => updateBackupSetting("autoEnabled", e.target.checked)}
                />
                Enable auto backup
              </label>
              <label className={`flex items-center gap-2 text-xs ${t_textMuted}`}><input type="checkbox" checked={backupSettings.runTelegram} onChange={(e) => updateBackupSetting("runTelegram", e.target.checked)} />Run to Telegram</label>
              <label className={`flex items-center gap-2 text-xs ${t_textMuted}`}><input type="checkbox" checked={backupSettings.runRclone} onChange={(e) => updateBackupSetting("runRclone", e.target.checked)} />Run to rclone</label>
            </div>
            <div className={`rounded-xl border p-3 text-xs ${t_borderLight} ${t_textMuted}`}>
              <p>Next run: {backupHealth?.next_run_at || "n/a"}</p>
              <p>Running: {backupHealth?.running ? "yes" : "no"}</p>
              <p>{backupHealth?.telegram_note}</p>
            </div>
            <div className="overflow-auto max-h-64 border rounded-xl p-2">
              <table className="w-full text-xs">
                <thead><tr><th className="text-left">Time</th><th className="text-left">Status</th><th className="text-left">Telegram</th><th className="text-left">Rclone</th><th className="text-left">Error</th></tr></thead>
                <tbody>
                  {backupHistory.map((r) => (
                    <tr key={`run-${r.id}`}><td>{r.created || "-"}</td><td>{r.status}</td><td>{r.telegram_status || "-"}</td><td>{r.rclone_status || "-"}</td><td>{r.error_summary || "-"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
  cloudBackupConfigured: PropTypes.bool.isRequired,
  handleSettingsKeyChange: PropTypes.func.isRequired,
  handleSaveKeyAccessSettings: PropTypes.func.isRequired,
  handleAddSettingsCustomDomain: PropTypes.func.isRequired,
  handleSaveKeyRateLimitSettings: PropTypes.func.isRequired,
  handleSaveKeyEntitlementsSettings: PropTypes.func.isRequired,
  handleCreateBackupNow: PropTypes.func.isRequired,
  handleRestoreLatestBackup: PropTypes.func.isRequired,
  handleExportMasterSetup: PropTypes.func.isRequired,
  handleImportMasterSetup: PropTypes.func.isRequired,
  handleExportAutofill: PropTypes.func.isRequired,
  handleImportAutofill: PropTypes.func.isRequired,
  handleExportCaptcha: PropTypes.func.isRequired,
  handleImportCaptcha: PropTypes.func.isRequired,
  handleExportFullBackup: PropTypes.func.isRequired,
  handleImportFullBackup: PropTypes.func.isRequired,
  handleCloudBackupPush: PropTypes.func.isRequired,
  handleCloudBackupPull: PropTypes.func.isRequired,
  showToast: PropTypes.func.isRequired,
};
