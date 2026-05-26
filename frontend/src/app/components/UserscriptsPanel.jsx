import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Plus, Edit2, Trash2, RefreshCw, X, Code } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { apiPostJson, apiPutJson, apiPatchJson, apiDelete, apiGet } from "../../api/client";
import { EmptyState } from "./EmptyState";

export function UserscriptsPanel({
  userscripts,
  refreshUserscripts,
  showToast
}) {
  const { isDark, t_textHeading, t_textMuted, t_borderLight, t_rowHover, glassPanel, glassButton, glassInput, solidButton } = useThemeContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingScript, setEditingScript] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    enabled: true,
    accessScope: "global",
    plans: [],
    apiKeyIds: "",
    services: [],
    tags: [],
    runtimeRole: "",
    runtimeRoles: [],
    stallRunMode: ""
  });
  const [availablePlans, setAvailablePlans] = useState([]);
  const [togglingId, setTogglingId] = useState("");

  const Switch = ({ checked, onChange, disabled = false, label }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        checked
          ? "bg-emerald-500/80 border-emerald-400/70"
          : isDark ? "bg-white/10 border-white/10" : "bg-slate-200 border-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );

  useEffect(() => {
    if (!isModalOpen) return;
    const onBefore = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [isModalOpen]);

  useKeyboardShortcuts({
    onEscape: () => { if (isModalOpen) setIsModalOpen(false); },
  });

  useEffect(() => {
    apiGet("/admin/api/plans")
      .then(data => setAvailablePlans(Array.isArray(data.plans) ? data.plans : []))
      .catch(() => setAvailablePlans([]));
  }, []);

  const parseMeta = (code) => {
    const meta = { name: "", version: "0.0.0", matches: [], runAt: "document-idle", tags: [] };
    const blockMatch = code.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
    if (!blockMatch) return meta;
    
    const lines = blockMatch[1].split("\n");
    lines.forEach(line => {
      const match = line.match(/\s*\/\/\s*@([\w-]+)\s+(.*)/);
      if (!match) return;
      const key = match[1].toLowerCase();
      const val = match[2].trim();
      if (key === "name") meta.name = val;
      else if (key === "version") meta.version = val;
      else if (key === "run-at") meta.runAt = val;
      else if (key === "match" || key === "include") meta.matches.push(val);
      else if (key === "tag") meta.tags.push(...val.split(/[,;\s]+/).map(item => item.trim()).filter(Boolean));
    });
    return meta;
  };

  const detectedMeta = React.useMemo(() => parseMeta(formData.code), [formData.code]);

  const openModal = (script = null) => {
    if (script) {
      setEditingScript(script);
      setFormData({
        name: script.name || "",
        code: script.code || "",
        enabled: script.enabled !== false,
        accessScope: script.accessScope || "global",
        plans: Array.isArray(script.plans) ? script.plans : [],
        apiKeyIds: Array.isArray(script.apiKeyIds) ? script.apiKeyIds.join(", ") : "",
        services: Array.isArray(script.services) ? script.services : [],
        tags: Array.isArray(script.tags) ? script.tags : [],
        runtimeRole: script.runtimeRole || "",
        runtimeRoles: Array.isArray(script.runtimeRoles) ? script.runtimeRoles : [],
        stallRunMode: script.stallRunMode || ""
      });
    } else {
      setEditingScript(null);
      setFormData({ name: "", code: "", enabled: true, accessScope: "global", plans: [], apiKeyIds: "", services: [], tags: [], runtimeRole: "", runtimeRoles: [], stallRunMode: "" });
    }
    setIsModalOpen(true);
  };

  const togglePlanSelection = (planName) => {
    setFormData(prev => {
      const current = Array.isArray(prev.plans) ? prev.plans : [];
      const exists = current.includes(planName);
      return {
        ...prev,
        plans: exists ? current.filter(item => item !== planName) : [...current, planName],
      };
    });
  };

  const activePlans = React.useMemo(
    () => availablePlans.filter(plan => plan.is_active !== false),
    [availablePlans],
  );

  const selectedPlanNames = React.useMemo(
    () => Array.isArray(formData.plans) ? formData.plans : [],
    [formData.plans],
  );

  const legacySelectedPlans = React.useMemo(() => {
    const known = new Set(activePlans.map(plan => plan.name).filter(Boolean));
    return selectedPlanNames.filter(name => !known.has(name));
  }, [activePlans, selectedPlanNames]);

  const serviceOptions = React.useMemo(() => {
    const names = new Set(["captcha", "solver", "autofill", "exam"]);
    activePlans.forEach(plan => {
      Object.entries(plan.allowed_services || {}).forEach(([name, enabled]) => {
        if (enabled !== false && name) names.add(name);
      });
    });
    return Array.from(names).sort();
  }, [activePlans]);

  const selectedServiceNames = React.useMemo(
    () => Array.isArray(formData.services) ? formData.services : [],
    [formData.services],
  );

  const legacySelectedServices = React.useMemo(() => {
    const known = new Set(serviceOptions);
    return selectedServiceNames.filter(name => !known.has(name));
  }, [serviceOptions, selectedServiceNames]);

  const toggleServiceSelection = (serviceName) => {
    setFormData(prev => {
      const current = Array.isArray(prev.services) ? prev.services : [];
      const exists = current.includes(serviceName);
      return {
        ...prev,
        services: exists ? current.filter(item => item !== serviceName) : [...current, serviceName],
      };
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (formData.accessScope === "plan" && selectedPlanNames.length === 0) {
        showToast("Select at least one plan for plan access.", "error");
        return;
      }
      if (formData.accessScope === "service" && selectedServiceNames.length === 0) {
        showToast("Select at least one service for service access.", "error");
        return;
      }
      const apiKeyIds = String(formData.apiKeyIds || "").split(/[,;\n]+/).map(item => Number(item.trim())).filter(Number.isFinite);
      if (formData.accessScope === "custom" && selectedPlanNames.length === 0 && selectedServiceNames.length === 0 && apiKeyIds.length === 0) {
        showToast("Select at least one plan, service, or API key for custom access.", "error");
        return;
      }
      const payload = {
        ...formData,
        plans: ["plan", "custom"].includes(formData.accessScope) ? selectedPlanNames : [],
        services: ["service", "custom"].includes(formData.accessScope) ? selectedServiceNames : [],
        apiKeyIds,
      };
      if (editingScript) {
        await apiPutJson(`/admin/api/userscripts/${editingScript.id}`, payload);
      } else {
        await apiPostJson(`/admin/api/userscripts`, payload);
      }
      showToast("Userscript saved successfully", "success");
      setIsModalOpen(false);
      await refreshUserscripts();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleDelete = async (uid) => {
    if (!confirm("Are you sure you want to delete this userscript?")) return;
    try {
      await apiDelete(`/admin/api/userscripts/${uid}`);
      showToast("Userscript deleted", "success");
      await refreshUserscripts();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleToggleEnabled = async (script) => {
    const nextEnabled = script.enabled === false;
    setTogglingId(script.id);
    try {
      await apiPatchJson(`/admin/api/userscripts/${script.id}/enabled`, { enabled: nextEnabled });
      showToast(`Userscript ${nextEnabled ? "enabled" : "disabled"}`, "success");
      await refreshUserscripts();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setTogglingId("");
    }
  };

  return (
    <div className="space-y-6">
      <div className={`rounded-2xl transition-colors duration-500 overflow-hidden ${glassPanel}`}>
        <div className={`p-5 border-b flex items-center justify-between ${t_borderLight}`}>
          <div className="flex items-center gap-3">
            <div>
              <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Userscript Management</h2>
              <p className={`text-[11px] ${t_textMuted}`}>Create, edit, and manage server-controlled scripts delivered to extensions.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              type="button" 
              onClick={refreshUserscripts} 
              className={`${glassButton} flex items-center gap-2 text-xs font-medium hover:text-indigo-500 transition-colors`}
            >
              <RefreshCw size={14} /> Refresh
            </button>
            <button 
              type="button" 
              onClick={() => openModal()} 
              className={`${solidButton} text-xs font-bold`}
            >
              <Plus size={14} /> Add Script
            </button>
          </div>
        </div>
        <div className="p-5 overflow-auto max-h-[40rem] custom-scrollbar">
          <table className="w-full text-sm text-left min-w-[1000px]">
            <thead>
              <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                <th className="pb-3 font-medium">Name</th>
                <th className="pb-3 font-medium">Version</th>
                <th className="pb-3 font-medium">RunAt</th>
                <th className="pb-3 font-medium">Access</th>
                <th className="pb-3 font-medium">Matches</th>
                <th className="pb-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${t_borderLight}`}>
              {(userscripts || []).map((script) => (
                <tr key={script.id} className={`group ${t_rowHover}`}>
                  <td className="py-4 pr-3 font-semibold">{script.name || script.id}</td>
                  <td className="py-4 pr-3">
                    <div>{script.version || "0.0.0"}</div>
                    {script.enabled === false && <span className="mt-1 inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Disabled</span>}
                  </td>
                  <td className="py-4 pr-3">{script.runAt || "document-idle"}</td>
                  <td className="py-4 pr-3">
                    <div className="flex flex-col gap-1">
                      <span className={`w-fit px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"}`}>
                        {(script.accessScope || "global") === "global" ? "Global - all users" : script.accessScope === "service" ? "Service entitlement" : script.accessScope === "custom" ? "Custom access" : script.accessScope}
                      </span>
                      {(script.accessScope === "plan" || script.accessScope === "custom") && <span className={`text-[10px] ${t_textMuted}`}>{(script.plans || []).join(", ") || "No plans"}</span>}
                      {(script.accessScope === "service" || script.accessScope === "custom") && <span className={`text-[10px] ${t_textMuted}`}>{(script.services || []).join(", ") || "No services"}</span>}
                      {(script.accessScope === "key" || script.accessScope === "custom") && <span className={`text-[10px] ${t_textMuted}`}>{(script.apiKeyIds || []).join(", ") || "No keys"}</span>}
                      {script.runtimeRole && <span className={`text-[10px] ${t_textMuted}`}>{script.runtimeRole}{script.stallRunMode ? ` / ${script.stallRunMode}` : ""}</span>}
                      {Array.isArray(script.tags) && script.tags.length > 0 && (
                        <span className={`text-[10px] ${t_textMuted}`}>{script.tags.join(", ")}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 pr-3">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {(script.matches || []).slice(0, 2).map((m, i) => (
                        <span key={i} className={`px-2 py-0.5 rounded-md text-[10px] font-mono ${isDark ? "bg-white/10 text-gray-400" : "bg-slate-100 text-slate-500"}`}>
                          {m}
                        </span>
                      ))}
                      {script.matches?.length > 2 && <span className={`text-[10px] ${t_textMuted}`}>+{script.matches.length - 2} more</span>}
                    </div>
                  </td>
                  <td className="py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <div className={`inline-flex items-center gap-2 px-2 py-1 rounded-lg text-[10px] ${script.enabled === false ? (isDark ? "bg-white/5 text-gray-400" : "bg-slate-100 text-slate-500") : (isDark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-50 text-emerald-700")}`}>
                        <Switch
                          checked={script.enabled !== false}
                          onChange={() => handleToggleEnabled(script)}
                          disabled={togglingId === script.id}
                          label={`${script.enabled === false ? "Enable" : "Disable"} ${script.name || script.id}`}
                        />
                        {script.enabled === false ? "Disabled" : "Enabled"}
                      </div>
                      <button 
                        onClick={() => openModal(script)} 
                        className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-white/10 text-gray-400 hover:text-white" : "hover:bg-slate-100 text-slate-500 hover:text-slate-800"}`}
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button 
                        onClick={() => handleDelete(script.id)} 
                        className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-rose-500/20 text-gray-400 hover:text-rose-400" : "hover:bg-rose-100 text-slate-500 hover:text-rose-600"}`}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(!userscripts || userscripts.length === 0) && (
                <EmptyState icon={Code} title="No userscripts found" description="Add your first script to get started." />
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3">
          <div className={`w-full max-w-6xl h-[92vh] rounded-3xl overflow-hidden ${glassPanel} border ${t_borderLight} shadow-2xl flex flex-col`}>
            <div className={`p-5 border-b flex items-center justify-between ${t_borderLight}`}>
              <h3 className={`text-lg font-bold ${t_textHeading}`}>
                {editingScript ? "Edit Userscript" : "Add New Userscript"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className={`p-2 rounded-xl transition-colors ${t_textMuted} hover:text-rose-500`}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6 space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_14rem] gap-4">
                  <div className="space-y-1">
                    <label className={`text-xs font-semibold ${t_textMuted}`}>Display Name (Optional override)</label>
                    <input 
                      type="text" value={formData.name} 
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      placeholder={detectedMeta.name || "Script Name"}
                      className={`${glassInput} w-full text-sm`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={`text-xs font-semibold ${t_textMuted}`}>Access</label>
                    <select
                      value={formData.accessScope}
                      onChange={e => {
                        const nextScope = e.target.value;
                        setFormData({
                          ...formData,
                          accessScope: nextScope,
                          plans: ["plan", "custom"].includes(nextScope) ? formData.plans : [],
                          services: ["service", "custom"].includes(nextScope) ? formData.services : [],
                        });
                      }}
                      className={`${glassInput} w-full text-sm`}
                    >
                      <option value="global">Global - all users</option>
                      <option value="plan">Plan</option>
                      <option value="service">Service entitlement</option>
                      <option value="key">API key IDs</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                </div>

                <label className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${t_borderLight}`}>
                  <span>
                    <span className={`block text-sm font-semibold ${t_textHeading}`}>Enable Userscript</span>
                    <span className={`block text-[11px] ${t_textMuted}`}>Disabled scripts stay saved but are not delivered to normal user extensions.</span>
                  </span>
                  <Switch
                    checked={formData.enabled !== false}
                    onChange={() => setFormData({ ...formData, enabled: formData.enabled === false })}
                    label="Enable userscript"
                  />
                </label>

                {(formData.accessScope === "plan" || formData.accessScope === "custom") && (
                  <div className="space-y-1">
                    <label className={`text-xs font-semibold ${t_textMuted}`}>Plans</label>
                    <div className={`rounded-xl border p-3 ${t_borderLight}`}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {activePlans.map(plan => (
                          <label key={plan.id || plan.name} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors ${isDark ? "hover:bg-white/5" : "hover:bg-slate-50"} ${t_textMuted}`}>
                            <input
                              type="checkbox"
                              checked={selectedPlanNames.includes(plan.name)}
                              onChange={() => togglePlanSelection(plan.name)}
                              className="mt-0.5"
                            />
                            <span className="min-w-0">
                              <span className={`block font-medium truncate ${t_textHeading}`}>{plan.name}</span>
                              <span className="block font-mono text-[10px] truncate">{plan.code}</span>
                            </span>
                          </label>
                        ))}
                        {legacySelectedPlans.map(planName => (
                          <label key={planName} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs cursor-pointer ${isDark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-700"}`}>
                            <input
                              type="checkbox"
                              checked
                              onChange={() => togglePlanSelection(planName)}
                            />
                            <span className="truncate">{planName}</span>
                          </label>
                        ))}
                      </div>
                      {activePlans.length === 0 && legacySelectedPlans.length === 0 && (
                        <p className={`text-xs italic ${t_textMuted}`}>No active plans found.</p>
                      )}
                    </div>
                  </div>
                )}

                {(formData.accessScope === "key" || formData.accessScope === "custom") && (
                  <div className="space-y-1">
                    <label className={`text-xs font-semibold ${t_textMuted}`}>API Key IDs</label>
                    <input
                      type="text"
                      value={formData.apiKeyIds}
                      onChange={e => setFormData({...formData, apiKeyIds: e.target.value})}
                      placeholder="12, 34, 56"
                      className={`${glassInput} w-full text-sm`}
                    />
                  </div>
                )}

                {(formData.accessScope === "service" || formData.accessScope === "custom") && (
                  <div className="space-y-1">
                    <label className={`text-xs font-semibold ${t_textMuted}`}>Services</label>
                    <div className={`rounded-xl border p-3 ${t_borderLight}`}>
                      <div className="flex flex-wrap gap-2">
                        {serviceOptions.map(serviceName => (
                          <button
                            key={serviceName}
                            type="button"
                            onClick={() => toggleServiceSelection(serviceName)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                              selectedServiceNames.includes(serviceName)
                                ? "bg-emerald-500/15 border-emerald-400/50 text-emerald-400"
                                : isDark ? "border-white/10 text-gray-400 hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                            }`}
                          >
                            {serviceName}
                          </button>
                        ))}
                        {legacySelectedServices.map(serviceName => (
                          <button
                            key={serviceName}
                            type="button"
                            onClick={() => toggleServiceSelection(serviceName)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${isDark ? "bg-amber-500/10 border-amber-400/30 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-700"}`}
                          >
                            {serviceName}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className={`text-[11px] ${t_textMuted}`}>Delivered only when the user's plan or key has one of these services enabled.</p>
                  </div>
                )}

                <div className="space-y-1">
                  <label className={`text-xs font-semibold ${t_textMuted}`}>Runtime Tags</label>
                  <input
                    type="text"
                    value={(formData.tags || []).join(", ")}
                    onChange={e => setFormData({
                      ...formData,
                      tags: e.target.value.split(/[,;\n\s]+/).map(item => item.trim()).filter(Boolean),
                    })}
                    placeholder="stall"
                    className={`${glassInput} w-full text-sm`}
                  />
                  <p className={`text-[11px] ${t_textMuted}`}>Use stall for scripts that should run only when STALL mode creates its isolated workspace.</p>
                </div>

                <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${t_textMuted}`}>Detected Metadata</span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className={`text-[10px] ${t_textMuted}`}>Name</p>
                    <p className={`text-xs font-medium truncate ${t_textHeading}`}>{detectedMeta.name || "Not found"}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] ${t_textMuted}`}>Version</p>
                    <p className={`text-xs font-medium ${t_textHeading}`}>{detectedMeta.version}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] ${t_textMuted}`}>Run At</p>
                    <p className={`text-xs font-medium ${t_textHeading}`}>{detectedMeta.runAt}</p>
                  </div>
                </div>
                <div>
                  <p className={`text-[10px] ${t_textMuted}`}>Matches</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detectedMeta.matches.length > 0 ? (
                      detectedMeta.matches.map((m, i) => (
                        <span key={i} className={`px-2 py-0.5 rounded-md text-[10px] font-mono ${isDark ? "bg-white/10 text-gray-400" : "bg-slate-100 text-slate-500"}`}>
                          {m}
                        </span>
                      ))
                    ) : (
                      <span className={`text-xs italic ${t_textMuted}`}>No matches found in headers</span>
                    )}
                  </div>
                </div>
                </div>

                <div className="space-y-1">
                  <label className={`text-xs font-semibold ${t_textMuted}`}>Script Code</label>
                  <textarea 
                    required value={formData.code} 
                    onChange={e => setFormData({...formData, code: e.target.value})}
                    className={`${glassInput} w-full font-mono text-xs min-h-[28rem]`}
                    placeholder={"// ==UserScript==\n// @name ...\n// ==/UserScript==\n\nconsole.log('hello');"}
                  />
                </div>
              </div>
              <div className={`flex justify-end gap-3 p-5 border-t ${t_borderLight}`}>
                <button 
                  type="button" onClick={() => setIsModalOpen(false)} 
                  className={`${glassButton} text-xs`}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className={`${solidButton} text-xs`}
                >
                  {editingScript ? "Update Script" : "Create Script"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

UserscriptsPanel.propTypes = {
  userscripts: PropTypes.array,
  refreshUserscripts: PropTypes.func.isRequired,
  showToast: PropTypes.func.isRequired,
};
