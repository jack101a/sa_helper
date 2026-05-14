import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { CheckCircle2, Edit2, Plus, RefreshCw, Server, Trash2, X, Zap } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { apiDelete, apiGet, apiPostJson, apiPutJson } from "../../api/client";
import { EmptyState } from "./EmptyState";

const DEFAULT_WAIT_MS = 5000;

function isTruthySetting(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function parseScriptSteps(payloadJson) {
  try {
    const parsed = JSON.parse(payloadJson || "{}");
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    if (steps.length) {
      return steps.map((step, index) => ({
        code: step.code || "",
        wait_after_ms: index < steps.length - 1 ? Number(step.wait_after_ms || DEFAULT_WAIT_MS) : 0,
      }));
    }
  } catch (err) {
    console.warn("Failed to parse automation method payload", err);
  }
  return [{ code: "", wait_after_ms: 0 }];
}

function countPayloadSteps(payloadJson) {
  try {
    const parsed = JSON.parse(payloadJson || "{}");
    return Array.isArray(parsed.steps) ? parsed.steps.length : 0;
  } catch {
    return 0;
  }
}

function compileScriptSteps(scriptSteps) {
  const cleaned = scriptSteps.map((step) => ({
    code: String(step.code || "").trim(),
    wait_after_ms: Math.max(0, Number(step.wait_after_ms || 0)),
  }));

  if (cleaned.some((step) => !step.code)) {
    throw new Error("Every script box must contain code.");
  }

  return JSON.stringify({
    version: 1,
    steps: cleaned.map((step, index) => ({
      id: `script-${index + 1}`,
      label: `Script ${index + 1}`,
      code: step.code,
      wait_after_ms: index < cleaned.length - 1 ? (step.wait_after_ms || DEFAULT_WAIT_MS) : 0,
    })),
  });
}

export function AutomationMethodsPanel({ showToast }) {
  const {
    isDark,
    t_textHeading,
    t_textMuted,
    t_borderLight,
    t_rowHover,
    glassPanel,
    glassButton,
    glassInput,
    solidButton,
  } = useThemeContext();

  const [methods, setMethods] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [useServerMethod, setUseServerMethod] = useState(false);
  const [isSavingSetting, setIsSavingSetting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState(null);
  const [formData, setFormData] = useState({ name: "", description: "" });
  const [scriptSteps, setScriptSteps] = useState([{ code: "", wait_after_ms: 0 }]);

  const fetchMethods = async () => {
    setIsLoading(true);
    try {
      const data = await apiGet("/admin/api/automation-methods");
      setMethods(data.methods || []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDynamicSetting = async () => {
    try {
      const data = await apiGet("/admin/api/settings/automation.dynamic_methods_enabled");
      setUseServerMethod(isTruthySetting(data.value));
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  useEffect(() => {
    fetchMethods();
    fetchDynamicSetting();
  }, []);

  useKeyboardShortcuts({
    onEscape: () => { if (isModalOpen) setIsModalOpen(false); },
  });

  const activeMethod = methods.find((method) => method.active && method.enabled);

  const setScriptSource = async (enabled) => {
    const previous = useServerMethod;
    setUseServerMethod(enabled);
    setIsSavingSetting(true);
    try {
      await apiPostJson("/admin/api/settings/bulk", {
        settings: { "automation.dynamic_methods_enabled": enabled ? "true" : "false" },
      });
      showToast(enabled ? "Start Stall will use the active saved method" : "Start Stall will use built-in fallback scripts", "success");
    } catch (err) {
      setUseServerMethod(previous);
      showToast(err.message, "error");
    } finally {
      setIsSavingSetting(false);
    }
  };

  const openModal = (method = null) => {
    if (method) {
      setEditingMethod(method);
      setFormData({ name: method.name || "", description: method.description || "" });
      setScriptSteps(parseScriptSteps(method.payload_json));
    } else {
      setEditingMethod(null);
      setFormData({ name: "", description: "" });
      setScriptSteps([{ code: "", wait_after_ms: 0 }]);
    }
    setIsModalOpen(true);
  };

  const updateScriptStep = (index, patch) => {
    setScriptSteps((prev) => prev.map((step, i) => i === index ? { ...step, ...patch } : step));
  };

  const addScriptStep = () => {
    setScriptSteps((prev) => {
      const current = prev.map((step, index) => (
        index === prev.length - 1 && !Number(step.wait_after_ms)
          ? { ...step, wait_after_ms: DEFAULT_WAIT_MS }
          : step
      ));
      return [...current, { code: "", wait_after_ms: 0 }];
    });
  };

  const removeScriptStep = (index) => {
    setScriptSteps((prev) => {
      const next = prev.filter((_, i) => i !== index);
      const normalized = next.length ? next : [{ code: "", wait_after_ms: 0 }];
      return normalized.map((step, i) => i === normalized.length - 1 ? { ...step, wait_after_ms: 0 } : step);
    });
  };

  const handleSave = async (event) => {
    event.preventDefault();
    try {
      const payload_json = compileScriptSteps(scriptSteps);
      const requestData = { ...formData, payload_json };
      if (editingMethod) {
        await apiPutJson(`/admin/api/automation-methods/${editingMethod.id}`, requestData);
      } else {
        await apiPostJson("/admin/api/automation-methods", requestData);
      }
      showToast("Script method saved", "success");
      setIsModalOpen(false);
      fetchMethods();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleActivate = async (id) => {
    try {
      await apiPostJson(`/admin/api/automation-methods/${id}/activate`, {});
      showToast("Script method activated", "success");
      fetchMethods();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this script method?")) return;
    try {
      await apiDelete(`/admin/api/automation-methods/${id}`);
      showToast("Script method deleted", "success");
      fetchMethods();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className={`rounded-2xl transition-colors duration-500 overflow-hidden ${glassPanel}`}>
      <div className={`p-5 border-b ${t_borderLight}`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500">
              <Zap size={20} />
            </div>
            <div>
              <h2 className={`text-lg font-semibold ${t_textHeading}`}>STALL Script Methods</h2>
              <p className={`text-xs mt-1 ${t_textMuted}`}>
                Save one or more script blocks. The active method is served as one payload when Start Stall asks the backend for `stall-flow`.
              </p>
              <div className={`mt-2 text-[11px] ${t_textMuted}`}>
                Active method: <span className={activeMethod ? "text-emerald-500 font-semibold" : ""}>{activeMethod?.name || "None selected"}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className={`inline-flex rounded-xl border p-1 ${t_borderLight}`}>
              <button
                type="button"
                disabled={isSavingSetting}
                onClick={() => setScriptSource(true)}
                className={`px-3 py-2 rounded-lg text-[11px] font-bold transition-colors ${
                  useServerMethod ? "bg-emerald-500 text-white" : `${t_textMuted} hover:text-indigo-500`
                }`}
              >
                Saved Server Method
              </button>
              <button
                type="button"
                disabled={isSavingSetting}
                onClick={() => setScriptSource(false)}
                className={`px-3 py-2 rounded-lg text-[11px] font-bold transition-colors ${
                  !useServerMethod ? "bg-slate-600 text-white" : `${t_textMuted} hover:text-indigo-500`
                }`}
              >
                Built-In Fallback
              </button>
            </div>
            <button
              type="button"
              onClick={fetchMethods}
              disabled={isLoading}
              className={`${glassButton} flex items-center justify-center gap-2 text-xs font-medium disabled:opacity-50`}
            >
              <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} /> Refresh
            </button>
            <button type="button" onClick={() => openModal()} className={`${solidButton} justify-center text-xs font-bold`}>
              <Plus size={14} /> New Method
            </button>
          </div>
        </div>
      </div>

      <div className="p-5">
        {methods.length === 0 && !isLoading ? (
          <EmptyState icon={Server} title="No STALL script methods" description="Create a saved method, activate it, then choose Saved Server Method above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm text-left">
              <thead>
                <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                  <th className="pb-3 font-medium">State</th>
                  <th className="pb-3 font-medium">Method</th>
                  <th className="pb-3 font-medium">Scripts</th>
                  <th className="pb-3 font-medium">Description</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${t_borderLight}`}>
                {methods.map((method) => {
                  const scriptCount = countPayloadSteps(method.payload_json);
                  const isActive = method.active && method.enabled;
                  return (
                    <tr key={method.id} className={t_rowHover}>
                      <td className="py-4 pr-3">
                        {isActive ? (
                          <div className="flex items-center gap-2 text-emerald-500">
                            <CheckCircle2 size={16} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">Active</span>
                          </div>
                        ) : method.enabled ? (
                          <button
                            type="button"
                            onClick={() => handleActivate(method.id)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${isDark ? "bg-white/5 text-gray-300 hover:bg-white/10" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                          >
                            Make Active
                          </button>
                        ) : (
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${t_textMuted}`}>Disabled</span>
                        )}
                      </td>
                      <td className={`py-4 pr-3 font-semibold ${isActive ? "text-indigo-500" : t_textHeading}`}>{method.name}</td>
                      <td className="py-4 pr-3">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${isDark ? "bg-white/10 text-gray-300" : "bg-slate-100 text-slate-500"}`}>
                          {scriptCount} {scriptCount === 1 ? "script" : "scripts"}
                        </span>
                      </td>
                      <td className={`py-4 pr-3 text-xs ${t_textMuted}`}>{method.description || "-"}</td>
                      <td className="py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openModal(method)}
                            className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-white/10 text-gray-400 hover:text-white" : "hover:bg-slate-100 text-slate-500 hover:text-slate-800"}`}
                            title="Edit"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(method.id)}
                            className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-rose-500/20 text-gray-400 hover:text-rose-400" : "hover:bg-rose-100 text-slate-500 hover:text-rose-600"}`}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[2147483647] bg-black/60 backdrop-blur-sm p-0 sm:p-2">
          <div className={`flex h-screen w-screen flex-col rounded-none sm:rounded-xl border ${t_borderLight} ${glassPanel} shadow-2xl`}>
            <div className={`shrink-0 border-b p-4 sm:p-5 flex items-center justify-between gap-3 ${t_borderLight}`}>
              <div>
                <h3 className={`text-base sm:text-lg font-bold ${t_textHeading}`}>
                  {editingMethod ? "Edit STALL Script Method" : "New STALL Script Method"}
                </h3>
                <p className={`text-[11px] mt-1 ${t_textMuted}`}>Paste scripts separately. Add waits only between scripts.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className={`p-2 rounded-xl transition-colors ${t_textMuted} hover:text-rose-500`}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-scroll p-4 sm:p-6 space-y-5" style={{ scrollbarGutter: "stable" }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className={`text-xs font-semibold ${t_textMuted}`}>Method name</label>
                    <input
                      required
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Current STALL flow"
                      className={`${glassInput} w-full text-sm`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={`text-xs font-semibold ${t_textMuted}`}>Description</label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Optional note"
                      className={`${glassInput} w-full text-sm`}
                    />
                  </div>
                </div>

                <div className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${t_borderLight}`}>
                  <div>
                    <div className={`text-sm font-semibold ${t_textHeading}`}>Scripts</div>
                    <div className={`text-[11px] ${t_textMuted}`}>One script is enough. Add more only if the flow needs separate stages.</div>
                  </div>
                  <button type="button" onClick={addScriptStep} className={`${solidButton} justify-center text-xs`}>
                    <Plus size={14} /> Add Script
                  </button>
                </div>

                <div className="space-y-4">
                  {scriptSteps.map((step, index) => (
                    <div key={index} className={`rounded-2xl border ${t_borderLight} overflow-hidden`}>
                      <div className={`px-4 py-3 border-b flex items-center justify-between gap-3 ${t_borderLight}`}>
                        <div>
                          <div className={`text-xs font-bold uppercase tracking-wider ${t_textHeading}`}>Script {index + 1}</div>
                          {index < scriptSteps.length - 1 && (
                            <div className={`text-[11px] ${t_textMuted}`}>Runs, then waits before Script {index + 2}</div>
                          )}
                        </div>
                        {scriptSteps.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeScriptStep(index)}
                            className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-rose-500/20 text-gray-400 hover:text-rose-400" : "hover:bg-rose-100 text-slate-500 hover:text-rose-600"}`}
                            title="Remove script"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div className="p-4 space-y-3">
                        <textarea
                          required
                          value={step.code}
                          onChange={(e) => updateScriptStep(index, { code: e.target.value })}
                          className={`${glassInput} w-full font-mono text-xs min-h-[22rem] resize-y`}
                          placeholder="// Paste script code here"
                        />
                        {index < scriptSteps.length - 1 && (
                          <div className="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-3 items-end">
                            <div>
                              <label className={`text-xs block mb-1 ${t_textMuted}`}>Wait after this script</label>
                              <input
                                type="number"
                                min="0"
                                step="100"
                                className={`${glassInput} w-full text-sm`}
                                value={step.wait_after_ms || DEFAULT_WAIT_MS}
                                onChange={(e) => updateScriptStep(index, { wait_after_ms: Number(e.target.value) })}
                              />
                            </div>
                            <div className={`text-[11px] pb-2 ${t_textMuted}`}>Default is 5000 ms.</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`shrink-0 border-t p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between ${t_borderLight}`}>
                <div className={`text-[11px] ${t_textMuted}`}>
                  Saving compiles these boxes into one backend payload. The extension fetch path does not change.
                </div>
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setIsModalOpen(false)} className={`${glassButton} text-xs`}>
                    Cancel
                  </button>
                  <button type="submit" className={`${solidButton} text-xs`}>
                    {editingMethod ? "Update Method" : "Save Method"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

AutomationMethodsPanel.propTypes = {
  showToast: PropTypes.func.isRequired,
};
