import React, { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Tag, Loader2, Plus, Edit3, Save, Trash2, X, Upload } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { apiDelete, apiGet, apiPostForm, apiPostJson, apiPutJson } from "../../api/client";

export function PlansPanel({ showToast }) {
  const { t_textHeading, t_textMuted, t_borderLight, glassPanel, glassInput, solidButton, iconBtn, isDark } = useThemeContext();
  const defaultAllowedServices = { captcha: true, solver: true, autofill: true, exam: true };
  const defaultForm = {
    code: "",
    name: "",
    description: "",
    monthly_limit: 1000,
    duration_days: 30,
    price_amount: 0,
    max_devices: 1,
    rate_limit_rpm: 60,
    rate_limit_burst: 10,
    allowed_services: defaultAllowedServices,
  };
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [uploadingQrPlanId, setUploadingQrPlanId] = useState(null);
  const [deletePlanId, setDeletePlanId] = useState(null);
  const [deleteTargetPlanId, setDeleteTargetPlanId] = useState("");

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet("/admin/api/plans");
      setPlans(data.plans || []);
    } catch (e) {
      showToast("Failed to load plans", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPostJson("/admin/api/plans", form);
      showToast("Plan created");
      setShowCreate(false);
      setForm(defaultForm);
      fetchPlans();
    } catch (e) {
      showToast(e.message || "Failed to create plan", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (planId) => {
    setSaving(true);
    try {
      await apiPutJson(`/admin/api/plans/${planId}`, form);
      showToast("Plan updated");
      setEditingId(null);
      fetchPlans();
    } catch (e) {
      showToast(e.message || "Failed to update plan", "error");
    } finally {
      setSaving(false);
    }
  };

  const openDeleteModal = (planId) => {
    const fallbackTarget = plans.find((p) => p.is_active && p.id !== planId);
    setDeletePlanId(planId);
    setDeleteTargetPlanId(fallbackTarget ? String(fallbackTarget.id) : "");
  };

  const closeDeleteModal = () => {
    setDeletePlanId(null);
    setDeleteTargetPlanId("");
  };

  const handleDelete = async () => {
    if (!deletePlanId) return;
    setSaving(true);
    try {
      const body = {};
      if (deleteTargetPlanId) body.target_plan_id = Number(deleteTargetPlanId);
      const result = await apiDelete(`/admin/api/plans/${deletePlanId}`, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const moved = Number(result?.migrated_count || 0);
      const removedSubs = Number(result?.deleted_subscription_count || 0);
      if (moved > 0) {
        showToast(`Plan deleted. Migrated ${moved} linked subscription(s).`);
      } else if (removedSubs > 0) {
        showToast(`Plan deleted. Removed ${removedSubs} old subscription record(s).`);
      } else {
        showToast("Plan deleted");
      }
      closeDeleteModal();
      fetchPlans();
    } catch (e) {
      showToast(e.message || "Failed to deactivate plan", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleActiveToggle = async (plan, nextActive) => {
    setSaving(true);
    try {
      await apiPutJson(`/admin/api/plans/${plan.id}`, { is_active: nextActive });
      showToast(nextActive ? "Plan enabled" : "Plan disabled");
      fetchPlans();
    } catch (e) {
      showToast(e.message || "Failed to update plan status", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleQrUpload = async (planId, file) => {
    if (!file) return;
    setUploadingQrPlanId(planId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await apiPostForm(`/admin/api/settings/plans/${planId}/upload-qr`, fd);
      showToast("Plan QR uploaded");
    } catch (e) {
      showToast(e.message || "Failed to upload QR", "error");
    } finally {
      setUploadingQrPlanId(null);
    }
  };

  const openEdit = (plan) => {
    setEditingId(plan.id);
    setForm({
      code: plan.code, name: plan.name, description: plan.description || "",
      monthly_limit: plan.monthly_limit, duration_days: plan.duration_days, price_amount: plan.price_amount,
      max_devices: Number(plan.max_devices || 1),
      rate_limit_rpm: Number(plan.rate_limit_rpm || 60),
      rate_limit_burst: Number(plan.rate_limit_burst || 10),
      allowed_services: { ...defaultAllowedServices, ...(plan.allowed_services || {}) },
    });
  };

  const activeSwitchClass = (active) => [
    "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors disabled:opacity-50",
    active
      ? "bg-emerald-500/80 border-emerald-400/60"
      : isDark
        ? "bg-slate-800 border-slate-600"
        : "bg-slate-200 border-slate-300",
  ].join(" ");

  const switchKnobClass = (active) => [
    "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
    active ? "translate-x-5" : "translate-x-1",
  ].join(" ");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/20 text-emerald-500 rounded-lg backdrop-blur-md">
            <Tag size={20} />
          </div>
          <div>
            <h2 className={`text-lg font-semibold ${t_textHeading}`}>Subscription Plans</h2>
            <p className={`text-xs ${t_textMuted}`}>{plans.length} plans</p>
          </div>
        </div>
        <button onClick={() => { setShowCreate(true); setForm(defaultForm); }} className={solidButton}>
          <Plus size={16} /> Add Plan
        </button>
      </div>

      {/* Plans Grid */}
      <div className={`rounded-2xl overflow-hidden ${glassPanel}`}>
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>
        ) : plans.length === 0 ? (
          <div className="p-12 text-center"><p className={t_textMuted}>No plans created yet</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${t_borderLight}`}>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Code</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Name</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Price</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Limit/mo</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Duration</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Max Devices</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>RPM</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Burst</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Services</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>QR</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Active</th>
                  <th className={`text-right p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className={`border-b ${t_borderLight} ${isDark ? "hover:bg-white/[0.02]" : "hover:bg-black/[0.02]"}`}>
                    {editingId === p.id ? (
                      <>
                        <td className="p-2"><input className={glassInput} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></td>
                        <td className="p-2"><input className={glassInput} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></td>
                        <td className="p-2"><input className={glassInput} type="number" value={form.price_amount} onChange={(e) => setForm({ ...form, price_amount: parseInt(e.target.value) || 0 })} /></td>
                        <td className="p-2"><input className={glassInput} type="number" value={form.monthly_limit} onChange={(e) => setForm({ ...form, monthly_limit: parseInt(e.target.value) || 0 })} /></td>
                        <td className="p-2"><input className={glassInput} type="number" value={form.duration_days} onChange={(e) => setForm({ ...form, duration_days: parseInt(e.target.value) || 0 })} /></td>
                        <td className="p-2"><input className={glassInput} type="number" min="1" max="10" value={form.max_devices || 1} onChange={(e) => setForm({ ...form, max_devices: parseInt(e.target.value) || 1 })} /></td>
                        <td className="p-2"><input className={glassInput} type="number" min="1" max="1000" value={form.rate_limit_rpm || 60} onChange={(e) => setForm({ ...form, rate_limit_rpm: parseInt(e.target.value) || 60 })} /></td>
                        <td className="p-2"><input className={glassInput} type="number" min="1" max="1000" value={form.rate_limit_burst || 10} onChange={(e) => setForm({ ...form, rate_limit_burst: parseInt(e.target.value) || 10 })} /></td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2 min-w-[220px]">
                            {["captcha", "solver", "autofill", "exam"].map((svc) => (
                              <label key={svc} className={`flex items-center gap-1 text-xs ${t_textMuted}`}>
                                <input
                                  type="checkbox"
                                  checked={!!(form.allowed_services || {})[svc]}
                                  onChange={(e) => setForm({
                                    ...form,
                                    allowed_services: { ...(form.allowed_services || {}), [svc]: e.target.checked },
                                  })}
                                  id={`plan-service-edit-${p.id}-${svc}`}
                                />
                                <span className="capitalize">{svc}</span>
                              </label>
                            ))}
                          </div>
                        </td>
                        <td className="p-2">—</td>
                        <td className="p-2">—</td>
                        <td className="p-2">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleUpdate(p.id)} className={iconBtn} disabled={saving}><Save size={14} className="text-emerald-400" /></button>
                            <button onClick={() => setEditingId(null)} className={iconBtn}><X size={14} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={`p-3 font-mono text-xs font-medium ${t_textHeading}`}>{p.code}</td>
                        <td className={`p-3 ${t_textHeading}`}>{p.name}</td>
                        <td className={`p-3 font-medium text-emerald-400`}>₹{(p.price_amount / 100).toFixed(2)}</td>
                        <td className={`p-3 ${t_textHeading}`}>{p.monthly_limit?.toLocaleString()}</td>
                        <td className={`p-3 ${t_textMuted}`}>{p.duration_days} days</td>
                        <td className={`p-3 ${t_textHeading}`}>{Number(p.max_devices || 1)}</td>
                        <td className={`p-3 ${t_textHeading}`}>{Number(p.rate_limit_rpm || 60)}</td>
                        <td className={`p-3 ${t_textHeading}`}>{Number(p.rate_limit_burst || 10)}</td>
                        <td className={`p-3 ${t_textMuted}`}>
                          {Object.entries(p.allowed_services || {})
                            .filter(([, enabled]) => !!enabled)
                            .map(([name]) => name)
                            .join(", ") || "none"}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {p.has_qr ? (
                              <a
                                href={p.qr_url}
                                target="_blank"
                                rel="noreferrer"
                                className={`text-xs underline ${t_textMuted}`}
                                title="Preview plan QR"
                              >
                                Preview
                              </a>
                            ) : (
                              <span className={`text-xs ${t_textMuted}`}>No QR</span>
                            )}
                          <label className={`${iconBtn} inline-flex cursor-pointer`} title="Upload plan QR">
                            {uploadingQrPlanId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={uploadingQrPlanId === p.id}
                              onChange={(e) => handleQrUpload(p.id, e.target.files?.[0])}
                            />
                          </label>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className={`inline-flex items-center gap-2 text-xs ${t_textMuted}`}>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={!!p.is_active}
                              disabled={saving}
                              onClick={() => handleActiveToggle(p, !p.is_active)}
                              className={activeSwitchClass(!!p.is_active)}
                              title={p.is_active ? "Disable plan" : "Enable plan"}
                            >
                              <span className={switchKnobClass(!!p.is_active)} />
                            </button>
                            <span className={`px-2 py-0.5 rounded-full font-medium ${p.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"}`}>
                              {p.is_active ? "Active" : "Inactive"}
                            </span>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit(p)} className={iconBtn} title="Edit"><Edit3 size={14} /></button>
                            <button onClick={() => openDeleteModal(p.id)} className={iconBtn} title="Delete plan" disabled={saving}>
                              <Trash2 size={14} className="text-rose-400" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className={`${glassPanel} rounded-2xl p-6 w-full max-w-md border ${t_borderLight}`} onClick={(e) => e.stopPropagation()}>
            <h3 className={`text-lg font-semibold mb-4 ${t_textHeading}`}>Create Plan</h3>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>Code</label>
                  <input className={glassInput} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="basic_monthly" required />
                </div>
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>Name</label>
                  <input className={glassInput} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Basic Monthly" required />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>Price (paise)</label>
                  <input className={glassInput} type="number" value={form.price_amount} onChange={(e) => setForm({ ...form, price_amount: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>Limit/mo</label>
                  <input className={glassInput} type="number" value={form.monthly_limit} onChange={(e) => setForm({ ...form, monthly_limit: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>Days</label>
                  <input className={glassInput} type="number" value={form.duration_days} onChange={(e) => setForm({ ...form, duration_days: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>Max Devices</label>
                  <input className={glassInput} type="number" min="1" max="10" value={form.max_devices || 1} onChange={(e) => setForm({ ...form, max_devices: parseInt(e.target.value) || 1 })} id="plan-max-devices" />
                </div>
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>Rate Limit (req/min)</label>
                  <input className={glassInput} type="number" min="1" max="1000" value={form.rate_limit_rpm || 60} onChange={(e) => setForm({ ...form, rate_limit_rpm: parseInt(e.target.value) || 60 })} id="plan-rate-limit" />
                </div>
                <div>
                  <label className={`text-xs block mb-1 ${t_textMuted}`}>Burst</label>
                  <input className={glassInput} type="number" min="1" max="1000" value={form.rate_limit_burst || 10} onChange={(e) => setForm({ ...form, rate_limit_burst: parseInt(e.target.value) || 10 })} id="plan-rate-burst" />
                </div>
              </div>
              <div>
                <label className={`text-xs block mb-2 ${t_textMuted}`}>Allowed Services</label>
                <div className="flex flex-wrap gap-3">
                  {["captcha", "solver", "autofill", "exam"].map((svc) => (
                    <label key={svc} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={!!(form.allowed_services || {})[svc]}
                        onChange={(e) => setForm({
                          ...form,
                          allowed_services: { ...(form.allowed_services || {}), [svc]: e.target.checked },
                        })}
                        id={`plan-service-${svc}`}
                      />
                      <span className="capitalize">{svc}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Description</label>
                <textarea className={glassInput} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" className={solidButton} disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : "Create"}</button>
                <button type="button" onClick={() => setShowCreate(false)} className={`px-4 py-2 rounded-xl text-sm ${t_textMuted} border ${t_borderLight}`}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletePlanId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeDeleteModal}>
          <div className={`${glassPanel} rounded-2xl p-6 w-full max-w-md border ${t_borderLight}`} onClick={(e) => e.stopPropagation()}>
            <h3 className={`text-lg font-semibold mb-3 ${t_textHeading}`}>Delete Plan</h3>
            <p className={`text-sm mb-4 ${t_textMuted}`}>
              Move linked subscriptions to another active plan before deleting.
            </p>
            <div className="space-y-2">
              <label className={`text-xs block ${t_textMuted}`}>Target Plan</label>
              <select
                className={glassInput}
                value={deleteTargetPlanId}
                onChange={(e) => setDeleteTargetPlanId(e.target.value)}
              >
                <option value="">No target plan</option>
                {plans
                  .filter((p) => p.is_active && p.id !== deletePlanId)
                  .map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} ({p.code})
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex gap-2 pt-4">
              <button type="button" onClick={handleDelete} className={solidButton} disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : "Delete"}
              </button>
              <button type="button" onClick={closeDeleteModal} className={`px-4 py-2 rounded-xl text-sm ${t_textMuted} border ${t_borderLight}`}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

PlansPanel.propTypes = {
  showToast: PropTypes.func.isRequired,
};
