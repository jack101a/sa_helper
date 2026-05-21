import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPostJson, apiPostForm } from '../../api/client';
import { queryKeys } from '../../api/queries';

export function useSettingsHandlers({
  showToast,
  apiKeys,
  settingsKeyId, setSettingsKeyId,
  settingsAllDomains, setSettingsAllDomains,
  settingsDomainSelections, setSettingsDomainSelections,
  settingsKeyRpm, setSettingsKeyRpm,
  settingsKeyBurst, setSettingsKeyBurst,
  settingsCustomDomain, setSettingsCustomDomain,
  access,
}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });

  const handleSettingsKeyChange = (nextId) => {
    setSettingsKeyId(String(nextId));
    const key = apiKeys.find(k => String(k.id) === String(nextId));
    if (!key) return;
    setSettingsAllDomains(key.all_domains !== undefined ? Boolean(key.all_domains) : true);
    setSettingsDomainSelections(key.allowed_domains || []);
    setSettingsKeyRpm(Number(key.rate_limit?.requests_per_minute || 60));
    setSettingsKeyBurst(Number(key.rate_limit?.burst || 10));
  };

  const saveKeyAccess = useMutation({
    mutationFn: () => apiPost("/admin/keys/access/update", {
      key_id: Number(settingsKeyId),
      all_domains: settingsAllDomains ? "on" : "",
      allowed_domains_csv: settingsAllDomains ? "" : settingsDomainSelections.join(","),
    }),
    onSuccess: () => { invalidate(); showToast("Key domain access updated."); },
    onError: () => showToast("Failed to update key access", "error"),
  });

  const handleSaveKeyAccessSettings = (e) => {
    e.preventDefault();
    if (!settingsKeyId) return;
    saveKeyAccess.mutate();
  };

  const saveKeyRateLimit = useMutation({
    mutationFn: () => apiPost("/admin/keys/rate-limit/update", {
      key_id: Number(settingsKeyId),
      requests_per_minute: Number(settingsKeyRpm),
      burst: Number(settingsKeyBurst),
    }),
    onSuccess: () => { invalidate(); showToast("Key rate limit updated."); },
    onError: () => showToast("Failed to update key rate limit", "error"),
  });

  const handleSaveKeyRateLimitSettings = (e) => {
    e.preventDefault();
    if (!settingsKeyId) return;
    saveKeyRateLimit.mutate();
  };

  const saveKeyEntitlements = useMutation({
    mutationFn: (payload) => apiPost("/admin/keys/entitlements/update", payload),
    onSuccess: () => { invalidate(); showToast("Key services updated."); },
    onError: () => showToast("Failed to update key services", "error"),
  });

  const handleSaveKeyEntitlementsSettings = (e) => {
    e.preventDefault();
    if (!settingsKeyId) return;
    const fd = new FormData(e.target);
    saveKeyEntitlements.mutate({
      key_id: Number(settingsKeyId),
      plan_name: fd.get("plan_name") || "Standard",
      mobile: fd.get("mobile") || "",
      telegram_id: fd.get("telegram_id") || "",
      service_autofill: fd.get("service_autofill") ? "on" : "",
      service_captcha: fd.get("service_captcha") ? "on" : "",
      service_stall: fd.get("service_stall") ? "on" : "",
      service_solver: fd.get("service_solver") ? "on" : "",
      service_custom: fd.get("service_custom") ? "on" : "",
    });
  };

  const toggleSettingsDomainSelection = (domain) => {
    setSettingsDomainSelections(prev =>
      prev.includes(domain) ? prev.filter(d => d !== domain) : [...prev, domain]
    );
  };

  const handleAddSettingsCustomDomain = () => {
    const token = String(settingsCustomDomain || "").trim().toLowerCase();
    if (!token) return;
    if (!settingsDomainSelections.includes(token)) {
      setSettingsDomainSelections(prev => [...prev, token]);
    }
    setSettingsCustomDomain("");
  };

  const toggleGlobalAccess = useMutation({
    mutationFn: (checked) => apiPost("/admin/access", { global_access: checked ? "on" : null, new_domain: "" }),
    onSuccess: (_, checked) => { invalidate(); showToast(`Global access ${checked ? "enabled" : "disabled"}`); },
    onError: () => showToast("Failed to update access", "error"),
  });

  const handleToggleGlobalAccess = async (checked) => {
    toggleGlobalAccess.mutate(checked);
  };

  const addDomain = useMutation({
    mutationFn: (domain) => apiPost("/admin/access", { global_access: access.global_access ? "on" : null, new_domain: domain }),
    onSuccess: (_, domain) => { invalidate(); showToast(`Domain ${domain} added.`); },
    onError: () => showToast("Failed to add domain", "error"),
  });

  const handleAddDomain = async (e) => {
    e.preventDefault();
    const domain = new FormData(e.target).get("new_domain");
    if (!domain) return;
    addDomain.mutate(domain, { onSuccess: () => e.target.reset() });
  };

  const removeDomain = useMutation({
    mutationFn: (domain) => apiPost("/admin/access/remove", { domain }),
    onSuccess: (_, domain) => { invalidate(); showToast(`Domain ${domain} removed.`, "error"); },
    onError: () => showToast("Failed to remove domain", "error"),
  });

  const handleRemoveDomain = async (domain) => {
    if (!window.confirm(`Remove ${domain} from whitelist?`)) return;
    removeDomain.mutate(domain);
  };

  const createBackup = useMutation({
    mutationFn: () => apiPost("/admin/backups/create", {}),
    onSuccess: () => showToast("Backup created."),
    onError: () => showToast("Failed to create backup", "error"),
  });

  const handleCreateBackupNow = () => createBackup.mutate();

  const cloudPush = useMutation({
    mutationFn: () => apiPost("/admin/backups/cloud/push", {}),
    onSuccess: () => showToast("Cloud backup pushed."),
    onError: () => showToast("Cloud backup push failed", "error"),
  });

  const handleCloudBackupPush = () => cloudPush.mutate();

  const cloudPull = useMutation({
    mutationFn: () => apiPost("/admin/backups/cloud/pull", {}),
    onSuccess: () => { invalidate(); showToast("Cloud backup restored."); },
    onError: () => showToast("Cloud backup restore failed", "error"),
  });

  const handleCloudBackupPull = async () => {
    if (!window.confirm("Restore from cloud backup now?")) return;
    cloudPull.mutate();
  };

  const restoreLatest = useMutation({
    mutationFn: () => apiPost("/admin/backups/restore-latest", {}),
    onSuccess: () => { invalidate(); showToast("Latest backup restored."); },
    onError: () => showToast("Failed to restore backup", "error"),
  });

  const handleRestoreLatestBackup = async () => {
    if (!window.confirm("Restore latest backup? This will overwrite current settings.")) return;
    restoreLatest.mutate();
  };

  const handleExportMasterSetup = () => window.location.assign("/admin/export/master-setup.json");

  const handleImportMasterSetup = async (e) => {
    e.preventDefault();
    const file = new FormData(e.target).get("setup_file");
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append("setup_file", file);
      await apiPostForm("/admin/import/master-setup", fd);
      invalidate();
      e.target.reset();
      showToast("Master setup imported.");
    } catch (error) { showToast(error.message || "Import failed", "error"); }
  };

  const handleExportAutofill = () => window.location.assign("/admin/api/autofill/export");
  
  const handleImportAutofill = async (e) => {
    e.preventDefault();
    try {
      const file = new FormData(e.target).get("rules_file");
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text);
      const body = await apiPostJson("/admin/api/autofill/import", data);
      showToast(`Imported ${body.imported} autofill rules.`);
      invalidate();
      e.target.reset();
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleExportCaptcha = () => window.location.assign("/admin/api/captcha/export");

  const handleImportCaptcha = async (e) => {
    e.preventDefault();
    try {
      const file = new FormData(e.target).get("captcha_file");
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text);
      await apiPostJson("/admin/api/captcha/import", data);
      showToast("Captcha config imported.");
      invalidate();
      e.target.reset();
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleExportFullBackup = () => window.location.assign("/admin/export/master-backup.zip");

  const handleImportFullBackup = async (e) => {
    e.preventDefault();
    try {
      const file = new FormData(e.target).get("backup_file");
      if (!file) return;
      const fd = new FormData();
      fd.append("backup_file", file);
      await apiPostForm("/admin/import/master-backup.zip", fd);
      showToast("Master ZIP imported successfully.");
      invalidate();
      e.target.reset();
    } catch (err) { showToast(err.message, "error"); }
  };

  return {
    handleSettingsKeyChange, handleSaveKeyAccessSettings, handleSaveKeyRateLimitSettings,
    handleSaveKeyEntitlementsSettings,
    toggleSettingsDomainSelection, handleAddSettingsCustomDomain,
    handleToggleGlobalAccess, handleAddDomain, handleRemoveDomain,
    handleCreateBackupNow, handleCloudBackupPush, handleCloudBackupPull,
    handleRestoreLatestBackup, handleExportMasterSetup, handleImportMasterSetup,
    handleExportAutofill, handleImportAutofill, handleExportCaptcha, handleImportCaptcha,
    handleExportFullBackup, handleImportFullBackup,
  };
}
