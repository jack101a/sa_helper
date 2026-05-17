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
  const [backupSettings, setBackupSettings] = useState({
    encryptionKey: "",
    retentionCount: "7",
    telegramChannelId: "",
    gdriveEnabled: false,
    gdriveFolderId: "",
    gdriveClientId: "",
    gdriveClientSecret: "",
  });
  const [backupBusy, setBackupBusy] = useState("");

  useEffect(() => {
    refreshBackupHealth();
    Promise.all([
      apiGet("/admin/api/settings/backup.encryption_key").catch(() => ({ value: "" })),
      apiGet("/admin/api/settings/backup.retention_count").catch(() => ({ value: "7" })),
      apiGet("/admin/api/settings/backup.telegram_channel_id").catch(() => ({ value: "" })),
      apiGet("/admin/api/settings/backup.gdrive.enabled").catch(() => ({ value: "false" })),
      apiGet("/admin/api/settings/backup.gdrive.folder_id").catch(() => ({ value: "" })),
      apiGet("/admin/api/settings/backup.gdrive.client_id").catch(() => ({ value: "" })),
      apiGet("/admin/api/settings/backup.gdrive.client_secret").catch(() => ({ value: "" })),
    ]).then(([encryption, retention, channel, enabled, folder, clientId, clientSecret]) => {
      setBackupSettings({
        encryptionKey: encryption.value || "",
        retentionCount: retention.value || "7",
        telegramChannelId: channel.value || "",
        gdriveEnabled: String(enabled.value || "").toLowerCase() === "true",
        gdriveFolderId: folder.value || "",
        gdriveClientId: clientId.value || "",
        gdriveClientSecret: clientSecret.value || "",
      });
    });
  }, []);

  const refreshBackupHealth = async () => {
    try {
      const data = await apiGet("/admin/api/system/backup-health");
      setBackupHealth(data);
    } catch (_) {}
  };

  const updateBackupSetting = (key, value) => {
    setBackupSettings(prev => ({ ...prev, [key]: value }));
  };

  const latestBackup = backupHealth?.last_backup || null;
  const backupSetupHint = (() => {
    if (!backupHealth) return "";
    if (!backupHealth.telegram_token_set) return "Set Telegram bot token in Telegram Bot settings.";
    if (!backupHealth.telegram_channel_set) return "Set Telegram backup channel ID.";
    if (!backupHealth.telegram_local_api) return "Using hosted Bot API; large files will be sent in parts.";
    if (!backupHealth.gdrive_client_configured) return "Set Google Drive OAuth client env to enable sign-in.";
    if (!backupHealth.gdrive_connected) return "Sign in with Google to connect Drive uploads.";
    return "";
  })();

  const saveBackupSettings = async () => {
    setBackupBusy("settings");
    try {
      await apiPostJson("/admin/api/settings/bulk", {
        settings: {
          "backup.encryption_key": backupSettings.encryptionKey,
          "backup.retention_count": backupSettings.retentionCount,
          "backup.telegram_channel_id": backupSettings.telegramChannelId,
          "backup.gdrive.enabled": backupSettings.gdriveEnabled ? "true" : "false",
          "backup.gdrive.folder_id": backupSettings.gdriveFolderId,
        }
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
      const result = await apiPostJson("/admin/api/system/backup", {});
      await refreshBackupHealth();
      showToast(result.status === "completed" ? "Backup package created" : result.error || "Backup failed", result.status === "completed" ? "success" : "error");
    } catch (e) {
      showToast(e.message || "Backup failed", "error");
    } finally {
      setBackupBusy("");
    }
  };

  const validateBackupPackage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupBusy("validate");
    try {
      const fd = new FormData();
      fd.append("backup_file", file);
      const result = await apiPostForm("/admin/api/system/backups/validate", fd);
      showToast(result.ok ? "Backup package validated" : result.error || "Validation failed", result.ok ? "success" : "error");
    } catch (err) {
      showToast(err.message || "Validation failed", "error");
    } finally {
      e.target.value = "";
      setBackupBusy("");
    }
  };

  const importSystemBundle = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupBusy("import-bundle");
    try {
      const fd = new FormData();
      fd.append("bundle_file", file);
      const result = await apiPostForm("/admin/api/system/import-bundle", fd);
      showToast(result.status === "completed" ? `Bundle imported (${result.file_count || 0} files)` : result.error || "Bundle import failed", result.status === "completed" ? "success" : "error");
    } catch (err) {
      showToast(err.message || "Bundle import failed", "error");
    } finally {
      e.target.value = "";
      setBackupBusy("");
    }
  };

  const restoreBackupPackage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("Restore this backup package now? This overwrites server data and files.")) {
      e.target.value = "";
      return;
    }
    setBackupBusy("restore");
    try {
      const fd = new FormData();
      fd.append("backup_file", file);
      const result = await apiPostForm("/admin/api/system/backups/restore-package", fd);
      await refreshBackupHealth();
      showToast(result.status === "completed" ? "Backup package restored" : result.error || "Restore failed", result.status === "completed" ? "success" : "error");
    } catch (err) {
      showToast(err.message || "Restore failed", "error");
    } finally {
      e.target.value = "";
      setBackupBusy("");
    }
  };

  const uploadLatestToTelegram = async () => {
    if (!latestBackup) return showToast("Create a backup first", "error");
    setBackupBusy("telegram");
    try {
      const result = await apiPostJson(`/admin/api/system/backups/${latestBackup.id}/telegram`, {});
      showToast(result.ok ? "Latest backup sent to Telegram" : (result.error || "Telegram upload failed"), result.ok ? "success" : "error");
    } catch (e) {
      showToast(e.message || "Telegram upload failed", "error");
    } finally {
      setBackupBusy("");
    }
  };

  const testTelegramBackupDestination = async () => {
    setBackupBusy("telegram-test");
    try {
      const payload = {
        save: true,
      };
      if (backupSettings.telegramChannelId.trim()) {
        payload.chat_id = backupSettings.telegramChannelId.trim();
      }
      const result = await apiPostJson("/admin/api/system/backups/telegram/test", payload);
      showToast(result.ok ? "Telegram destination test sent" : (result.error || "Telegram destination test failed"), result.ok ? "success" : "error");
      await refreshBackupHealth();
    } catch (e) {
      showToast(e.data?.hint || e.data?.error || e.message || "Telegram destination test failed", "error");
    } finally {
      setBackupBusy("");
    }
  };

  const uploadLatestToDrive = async () => {
    if (!latestBackup) return showToast("Create a backup first", "error");
    setBackupBusy("drive");
    try {
      const result = await apiPostJson(`/admin/api/system/backups/${latestBackup.id}/gdrive`, {});
      showToast(result.ok ? "Latest backup uploaded to Drive" : result.error || "Drive upload failed", result.ok ? "success" : "error");
      await refreshBackupHealth();
    } catch (e) {
      showToast(e.message || "Drive upload failed", "error");
    } finally {
      setBackupBusy("");
    }
  };

  const openDriveAuth = async () => {
    setBackupBusy("drive-auth");
    try {
      const redirectUri = `${window.location.origin}/admin/api/system/backups/gdrive/callback`;
      const result = await apiGet(`/admin/api/system/backups/gdrive/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`);
      if (!result.ok || !result.url) {
        throw new Error(result.error || "Google Drive OAuth is not configured");
      }
      window.location.href = result.url;
    } catch (e) {
      showToast(e.message || "Google Drive sign-in failed", "error");
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
            <p className={`text-sm font-medium truncate ${t_textHeading}`}>{latestBackup?.name || "None"}</p>
          </div>
          <div>
            <p className={`text-[10px] uppercase font-bold ${t_textMuted}`}>Telegram</p>
            <p className={`text-sm ${backupHealth?.telegram_token_set && backupHealth?.telegram_channel_set ? "text-emerald-400" : t_textMuted}`}>
              {backupHealth?.telegram_token_set && backupHealth?.telegram_channel_set ? "Ready" : backupHealth?.telegram_channel_set ? "Token missing" : "Not set"}
            </p>
            <p className={`text-[10px] truncate ${t_textMuted}`}>{backupHealth?.telegram_local_api ? "Local Bot API" : "Hosted Bot API"}</p>
          </div>
          <div>
            <p className={`text-[10px] uppercase font-bold ${t_textMuted}`}>Google Drive</p>
            <p className={`text-sm ${backupHealth?.gdrive_connected ? "text-emerald-400" : t_textMuted}`}>
              {backupHealth?.gdrive_connected ? "Connected" : backupHealth?.gdrive_client_configured ? "Sign in needed" : "Client missing"}
            </p>
          </div>
        </div>

        {(backupHealth?.telegram_last_error || backupHealth?.gdrive_last_error) && (
          <div className={`rounded-xl border p-3 mb-5 text-xs space-y-1 ${t_borderLight} ${t_textMuted}`}>
            {backupHealth?.telegram_last_error && <p>Telegram: {backupHealth.telegram_last_error}</p>}
            {backupHealth?.gdrive_last_error && <p>Google Drive: {backupHealth.gdrive_last_error}</p>}
          </div>
        )}

        {backupSetupHint && (
          <div className={`rounded-xl border p-3 mb-5 text-xs ${t_borderLight} ${t_textMuted}`}>
            {backupSetupHint}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="space-y-4">
            <h4 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${t_textMuted}`}>
              <KeyRound size={14} /> Package Settings
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Encryption Key</label>
                <input
                  type="password"
                  className={glassInput}
                  value={backupSettings.encryptionKey}
                  onChange={(e) => updateBackupSetting("encryptionKey", e.target.value)}
                  placeholder="Required for encrypted .upbak"
                />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Retention Count</label>
                <input
                  type="number"
                  min="1"
                  className={glassInput}
                  value={backupSettings.retentionCount}
                  onChange={(e) => updateBackupSetting("retentionCount", e.target.value)}
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
            </div>
            <button type="button" onClick={saveBackupSettings} disabled={backupBusy === "settings"} className={solidButton}>
              {backupBusy === "settings" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Backup Settings
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button type="button" onClick={createPackageBackup} disabled={backupBusy === "create"} className={glassButton}>
                {backupBusy === "create" ? <Loader2 size={14} className="animate-spin" /> : <DatabaseBackup size={14} />}
                Create Package
              </button>
              <button type="button" onClick={uploadLatestToTelegram} disabled={!latestBackup || backupBusy === "telegram"} className={`${glassButton} ${!latestBackup ? "opacity-40" : ""}`}>
                {backupBusy === "telegram" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send Latest
              </button>
              <button type="button" onClick={testTelegramBackupDestination} disabled={backupBusy === "telegram-test"} className={glassButton}>
                {backupBusy === "telegram-test" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Test Destination
              </button>
              <label className={`cursor-pointer ${glassButton}`}>
                {backupBusy === "validate" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Validate Package
                <input type="file" accept=".upbak,.zip" className="hidden" onChange={validateBackupPackage} />
              </label>
              <label className={`cursor-pointer ${glassButton}`}>
                {backupBusy === "import-bundle" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Import Bundle
                <input type="file" accept=".zip,.upbak" className="hidden" onChange={importSystemBundle} />
              </label>
              <label className={`cursor-pointer ${glassButton}`}>
                {backupBusy === "restore" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Full Restore
                <input type="file" accept=".upbak,.zip" className="hidden" onChange={restoreBackupPackage} />
              </label>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${t_textMuted}`}>
              <Cloud size={14} /> Google Drive
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={`flex items-center gap-2 text-xs ${t_textMuted}`}>
                <input
                  type="checkbox"
                  checked={backupSettings.gdriveEnabled}
                  onChange={(e) => updateBackupSetting("gdriveEnabled", e.target.checked)}
                />
                Enable Drive uploads
              </label>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Drive Folder ID</label>
                <input
                  className={glassInput}
                  value={backupSettings.gdriveFolderId}
                  onChange={(e) => updateBackupSetting("gdriveFolderId", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button type="button" onClick={openDriveAuth} disabled={backupBusy === "drive-auth"} className={glassButton}>
                {backupBusy === "drive-auth" ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                Sign in with Google
              </button>
              <button type="button" onClick={uploadLatestToDrive} disabled={!latestBackup || backupBusy === "drive"} className={`${glassButton} ${!latestBackup ? "opacity-40" : ""}`}>
                {backupBusy === "drive" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Upload Latest
              </button>
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
