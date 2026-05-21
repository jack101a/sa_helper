import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../api/client';
import { queryKeys } from '../../api/queries';

export function useKeyHandlers({
  showToast,
  rememberedKeys, setRememberedKeys,
  setCreatedKeyModal,
  createKeyAllDomains, setCreateKeyAllDomains,
  createKeyDomainSelections, setCreateKeyDomainSelections,
}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });

  const createKey = useMutation({
    mutationFn: (payload) => apiPost("/admin/api/keys/create", payload),
    onSuccess: (payload) => {
      invalidate();
      if (payload.key_id && payload.api_key) {
        setRememberedKeys(prev => ({ ...prev, [String(payload.key_id)]: payload.api_key }));
      }
      setCreatedKeyModal({
        open: true,
        keyId: payload.key_id ?? null,
        keyValue: payload.api_key || "",
        warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      });
      setCreateKeyAllDomains(true);
      setCreateKeyDomainSelections([]);
      showToast(payload.warnings?.length ? "API key created with warnings." : "API key created.");
    },
    onError: (error) => {
      const data = error?.data;
      if (data?.api_key) {
        if (data.key_id) {
          setRememberedKeys(prev => ({ ...prev, [String(data.key_id)]: data.api_key }));
        }
        setCreatedKeyModal({
          open: true,
          keyId: data.key_id ?? null,
          keyValue: data.api_key,
          warnings: Array.isArray(data.warnings) ? data.warnings : [error.message || "Key created with server warning."],
        });
        showToast("API key created with warnings.", "error");
        invalidate();
        return;
      }
      showToast(error?.message || "Failed to create key", "error");
    },
  });

  const handleCreateKey = async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    form.reset();
    createKey.mutate({
      key_name: fd.get("key_name"),
      expiry_days: Number(fd.get("expiry_days") || 30),
      all_domains: createKeyAllDomains ? "on" : "",
      allowed_domains_csv: createKeyAllDomains ? "" : createKeyDomainSelections.join(","),
      requests_per_minute: Number(fd.get("requests_per_minute") || 0),
      burst: Number(fd.get("burst") || 0),
      key_type: fd.get("key_type") || "user",
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

  const handleCopyKey = async (keyValue) => {
    if (!keyValue) { showToast("No key available to copy", "error"); return; }
    try {
      await navigator.clipboard.writeText(keyValue);
      showToast("API key copied.");
    } catch { showToast("Clipboard copy failed", "error"); }
  };

  const handleViewStoredKey = async (keyId) => {
    const value = rememberedKeys[String(keyId)];
    if (value) {
      setCreatedKeyModal({ open: true, keyId, keyValue: value, warnings: [] });
      return;
    }
    try {
      const data = await apiGet(`/admin/api/keys/${keyId}/plain`);
      if (data?.api_key) {
        setRememberedKeys(prev => ({ ...prev, [String(keyId)]: data.api_key }));
        setCreatedKeyModal({ open: true, keyId, keyValue: data.api_key, warnings: [] });
        return;
      }
    } catch (_) {}
    showToast("Plain key is unavailable for this key (older keys may not be recoverable).", "error");
  };

  const revokeKey = useMutation({
    mutationFn: (id) => apiPost("/admin/keys/revoke", { key_id: id }),
    onSuccess: (_, id) => { invalidate(); showToast(`Key #${id} revoked.`, "error"); },
    onError: () => showToast("Failed to revoke key", "error"),
  });

  const handleRevokeKey = async (id) => {
    if (!window.confirm("Revoke this API Key? Client access will be cut immediately.")) return;
    revokeKey.mutate(id);
  };

  const deleteRevokedKey = useMutation({
    mutationFn: (id) => apiPost("/admin/keys/delete", { key_id: id }),
    onSuccess: (_, id) => {
      setRememberedKeys(prev => { const next = { ...prev }; delete next[String(id)]; return next; });
      invalidate();
      showToast(`Key #${id} deleted.`, "error");
    },
    onError: () => showToast("Only revoked keys can be deleted", "error"),
  });

  const handleDeleteRevokedKey = async (id) => {
    if (!window.confirm("Delete this revoked key entry? This cannot be undone.")) return;
    deleteRevokedKey.mutate(id);
  };

  const toggleCreateKeyDomain = (domain) => {
    setCreateKeyDomainSelections(prev =>
      prev.includes(domain) ? prev.filter(d => d !== domain) : [...prev, domain]
    );
  };

  return {
    handleCreateKey, handleCopyKey, handleViewStoredKey,
    handleRevokeKey, handleDeleteRevokedKey, toggleCreateKeyDomain,
  };
}
