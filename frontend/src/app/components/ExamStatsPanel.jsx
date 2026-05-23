import React, { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BrainCircuit, Loader2, Save, GraduationCap, ToggleLeft, ToggleRight } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { apiGet, apiPostJson } from "../../api/client";
import { fetchTrainingStats, queryKeys } from "../../api/queries";
import { AutomationMethodsPanel } from "./AutomationMethodsPanel";

const SOLVER_METHODS = [
  {
    id: "sign_hash_db",
    label: "Main Bank Sign Hash",
    detail: "Matches known sign/image hashes against the main question bank.",
    runtime: "Runtime currently uses this"
  },
  {
    id: "sign_hash_label",
    label: "Sign Label Option Match",
    detail: "Uses sign labels and option text when the direct bank match is missing.",
    runtime: "Runtime currently uses this"
  },
  {
    id: "learned_exact_hash",
    label: "Learned Exact Hash",
    detail: "Uses verified learned rows with the same question image hash.",
    runtime: "Depends on learning mode"
  },
  {
    id: "learned_phash",
    label: "Learned pHash",
    detail: "Uses verified learned rows with a visually similar question image.",
    runtime: "Depends on learning mode"
  },
  {
    id: "learned_text_identity",
    label: "Learned Answer Remap",
    detail: "Uses option image/text identity to handle shuffled learned options.",
    runtime: "Depends on learning mode"
  },
  {
    id: "ocr_db",
    label: "OCR DB",
    detail: "Runs OCR on question/options and searches the question bank.",
    runtime: "Runtime currently uses this"
  },
  {
    id: "llm",
    label: "LLM Fallback",
    detail: "Uses the configured LiteLLM model when local matching fails.",
    runtime: "Runtime currently uses this"
  },
  {
    id: "random_fallback",
    label: "Random Fallback",
    detail: "Extension fallback when backend returns no answer.",
    runtime: "Runtime currently uses this"
  }
];

const DEFAULT_SOLVER_METHODS = SOLVER_METHODS.map((method, index) => ({
  id: method.id,
  enabled: ["sign_hash_db", "sign_hash_label", "ocr_db", "llm"].includes(method.id),
  priority: (index + 1) * 10
}));

function normalizeSolverMethods(rawValue) {
  let parsed = [];
  try {
    parsed = JSON.parse(rawValue || "[]");
  } catch (_) {
    parsed = [];
  }
  const byId = new Map(Array.isArray(parsed) ? parsed.map(item => [item?.id, item]) : []);
  return DEFAULT_SOLVER_METHODS
    .map(defaultItem => {
      const item = byId.get(defaultItem.id) || {};
      return {
        id: defaultItem.id,
        enabled: typeof item.enabled === "boolean" ? item.enabled : defaultItem.enabled,
        priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : defaultItem.priority
      };
    })
    .sort((a, b) => a.priority - b.priority);
}

function serializeSolverMethods(methods) {
  return JSON.stringify(methods.map((method, index) => ({
    id: method.id,
    enabled: !!method.enabled,
    priority: (index + 1) * 10
  })));
}

export function ExamStatsPanel({
  examStats,
  showToast
}) {
  const { t_textHeading, t_textMuted, t_borderLight, glassPanel, glassInput, solidButton } = useThemeContext();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [learningStats, setLearningStats] = useState(null);
  const [togglingLearning, setTogglingLearning] = useState(false);
  const initialSettings = useRef(null);
  const training = useQuery({
    queryKey: queryKeys.trainingStats,
    queryFn: fetchTrainingStats,
    staleTime: 60_000,
  });

  useEffect(() => {
    const isDirty = initialSettings.current !== null && JSON.stringify(settings) !== JSON.stringify(initialSettings.current);
    if (!isDirty) return;
    const onBefore = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [settings]);

  useEffect(() => {
    fetchSettings();
    fetchLearningStats();
  }, []);

  const fetchSettings = async () => {
    try {
      const data = await apiGet("/admin/api/settings");
      const settingsMap = {};
      data.settings.forEach(s => {
        settingsMap[s.key] = s.value;
      });
      setSettings(settingsMap);
      initialSettings.current = JSON.parse(JSON.stringify(settingsMap));
    } catch (e) {
      console.error("Failed to fetch settings", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPostJson("/admin/api/settings/bulk", { settings });
      showToast("Exam settings saved successfully");
    } catch (e) {
      showToast("Error saving settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const solverMethods = normalizeSolverMethods(settings["exam.solver_methods_ui"]);

  const updateSolverMethods = (nextMethods) => {
    updateSetting("exam.solver_methods_ui", serializeSolverMethods(nextMethods));
  };

  const toggleSolverMethod = (id) => {
    updateSolverMethods(solverMethods.map(method =>
      method.id === id ? { ...method, enabled: !method.enabled } : method
    ));
  };

  const moveSolverMethod = (id, direction) => {
    const index = solverMethods.findIndex(method => method.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= solverMethods.length) return;
    const next = [...solverMethods];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    updateSolverMethods(next);
  };

  const resetSolverMethods = () => {
    updateSolverMethods(DEFAULT_SOLVER_METHODS);
  };

  const fetchLearningStats = async () => {
    try {
      const data = await apiGet("/admin/api/exam/learning/stats");
      setLearningStats(data);
    } catch (e) {
      console.error("Failed to fetch learning stats", e);
    }
  };

  const toggleLearning = async () => {
    setTogglingLearning(true);
    try {
      const newState = !learningStats?.learning_enabled;
      await apiPostJson("/admin/api/exam/learning/toggle", { enabled: newState });
      setLearningStats(prev => ({ ...prev, learning_enabled: newState }));
      showToast(`Self-learning ${newState ? "enabled" : "disabled"}`);
    } catch (e) {
      showToast("Failed to toggle learning", "error");
    } finally {
      setTogglingLearning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`rounded-2xl p-5 ${glassPanel}`}>
          <p className={`text-sm font-medium ${t_textMuted}`}>Total Exam Solves</p>
          <p className={`text-3xl font-bold ${t_textHeading}`}>{(examStats.total_exam_solves || 0).toLocaleString()}</p>
        </div>
        <div className={`rounded-2xl p-5 ${glassPanel}`}>
          <p className={`text-sm font-medium ${t_textMuted}`}>Successful Solves</p>
          <p className={`text-3xl font-bold text-emerald-500`}>{(examStats.exam_ok_count || 0).toLocaleString()}</p>
        </div>
        <div className={`rounded-2xl p-5 ${glassPanel}`}>
          <p className={`text-sm font-medium ${t_textMuted}`}>Accuracy Rate</p>
          <p className={`text-3xl font-bold text-indigo-500`}>{examStats.exam_ok_rate || 0}%</p>
        </div>
      </div>

      {/* Configuration Form */}
      <div className={`rounded-2xl p-6 ${glassPanel}`}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-500 rounded-lg backdrop-blur-md">
              <BrainCircuit size={20}/>
            </div>
            <h3 className={`text-lg font-semibold ${t_textHeading}`}>MCQ Solver Configuration</h3>
          </div>
          <button 
            onClick={handleSave} 
            disabled={saving}
            className={solidButton}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? "Saving..." : "Save Config"}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* AI / LLM Settings */}
          <div className="space-y-4">
            <h4 className={`text-xs font-bold uppercase tracking-widest ${t_textMuted}`}>AI / LLM Settings (LiteLLM)</h4>
            
            <div className="space-y-3">
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>LiteLLM Proxy Endpoint</label>
                <input 
                  className={glassInput} 
                  value={settings["exam.litellm_endpoint"] || ""} 
                  onChange={(e) => updateSetting("exam.litellm_endpoint", e.target.value)}
                  placeholder="https://litellm.example.com" 
                />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Model Name</label>
                <input 
                  className={glassInput} 
                  value={settings["exam.litellm_model"] || ""} 
                  onChange={(e) => updateSetting("exam.litellm_model", e.target.value)}
                  placeholder="gpt-4, anthropic/claude-3, etc." 
                />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>API Key</label>
                <input 
                  type="password"
                  className={glassInput} 
                  value={settings["exam.litellm_api_key"] || ""} 
                  onChange={(e) => updateSetting("exam.litellm_api_key", e.target.value)}
                  placeholder="sk-..." 
                />
              </div>
            </div>
          </div>

          {/* OCR & Resources */}
          <div className="space-y-4">
            <h4 className={`text-xs font-bold uppercase tracking-widest ${t_textMuted}`}>OCR & Local Resources</h4>
            
            <div className="space-y-3">
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Tesseract Data Path (TESSDATA_PREFIX)</label>
                <input 
                  className={glassInput} 
                  value={settings["exam.tessdata_path"] || ""} 
                  onChange={(e) => updateSetting("exam.tessdata_path", e.target.value)}
                  placeholder="/usr/share/tesseract-ocr/4.00/tessdata" 
                />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>OCR Languages</label>
                <input 
                  className={glassInput} 
                  value={settings["exam.ocr_lang"] || "eng+mar"} 
                  onChange={(e) => updateSetting("exam.ocr_lang", e.target.value)}
                  placeholder="eng+mar" 
                />
              </div>
              <div className="pt-2">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className={`text-xs block mb-1 ${t_textMuted}`}>Question Bank</label>
                    <div className={`p-3 rounded-xl border ${t_borderLight} text-xs ${t_textHeading}`}>
                      Status: Active
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className={`text-xs block mb-1 ${t_textMuted}`}>Sign Hashes</label>
                    <div className={`p-3 rounded-xl border ${t_borderLight} text-xs ${t_textHeading}`}>
                      Indexed: Yes
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <div className={`rounded-2xl p-6 ${glassPanel}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
          <div>
            <h3 className={`text-lg font-semibold ${t_textHeading}`}>MCQ/STall Solving Priority</h3>
            <p className={`text-xs mt-1 ${t_textMuted}`}>
              Dashboard-only metadata. Changing these controls does not change live solver execution yet.
            </p>
          </div>
          <button
            type="button"
            onClick={resetSolverMethods}
            className={`px-3 py-2 rounded-lg border ${t_borderLight} text-xs ${t_textHeading} hover:bg-white/5 transition-colors`}
          >
            Reset View
          </button>
        </div>

        <div className="space-y-2">
          {solverMethods.map((method, index) => {
            const meta = SOLVER_METHODS.find(item => item.id === method.id) || { label: method.id, detail: "", runtime: "" };
            return (
              <div
                key={method.id}
                className={`flex flex-col gap-3 rounded-xl border ${t_borderLight} p-3 md:flex-row md:items-center md:justify-between`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-lg border ${t_borderLight} flex items-center justify-center text-xs font-bold ${t_textHeading}`}>
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`font-semibold ${t_textHeading}`}>{meta.label}</p>
                      <span className={`px-2 py-0.5 rounded-full border ${t_borderLight} text-[10px] ${t_textMuted}`}>
                        {meta.runtime}
                      </span>
                    </div>
                    <p className={`text-xs mt-1 ${t_textMuted}`}>{meta.detail}</p>
                    <p className={`text-[10px] mt-1 ${t_textMuted}`}>Setting id: {method.id}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end md:self-auto">
                  <button
                    type="button"
                    onClick={() => moveSolverMethod(method.id, -1)}
                    disabled={index === 0}
                    className={`p-2 rounded-lg border ${t_borderLight} ${t_textHeading} disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/5 transition-colors`}
                    title="Move up"
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSolverMethod(method.id, 1)}
                    disabled={index === solverMethods.length - 1}
                    className={`p-2 rounded-lg border ${t_borderLight} ${t_textHeading} disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/5 transition-colors`}
                    title="Move down"
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSolverMethod(method.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      method.enabled
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                        : 'border-slate-500/40 bg-slate-500/10 text-slate-400'
                    }`}
                    title={method.enabled ? "Marked enabled in dashboard metadata" : "Marked disabled in dashboard metadata"}
                  >
                    {method.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    {method.enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {training.data && (
        <div className={`rounded-2xl p-5 ${glassPanel}`}>
          <h3 className={`text-lg font-semibold mb-3 ${t_textHeading}`}>Training Pipeline</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className={`text-sm ${t_textMuted}`}>Main Bank</p>
              <p className={`text-xl font-bold ${t_textHeading}`}>{training.data.main_bank_count}</p>
            </div>
            <div>
              <p className={`text-sm ${t_textMuted}`}>Learned Total</p>
              <p className={`text-xl font-bold ${t_textHeading}`}>{training.data.learned_total}</p>
            </div>
            <div>
              <p className={`text-sm ${t_textMuted}`}>Verified</p>
              <p className="text-xl font-bold text-emerald-500">{training.data.learned_verified}</p>
            </div>
            <div>
              <p className={`text-sm ${t_textMuted}`}>In-Memory Index</p>
              <p className={`text-xl font-bold ${t_textHeading}`}>{training.data.inmemory_hash_count}</p>
            </div>
          </div>
          <button
            onClick={async () => {
              try {
                const data = await apiPostJson("/admin/api/exam/merge", {});
                showToast(
                  data.merged > 0
                    ? `Merged ${data.merged} questions (total: ${data.total_bank})`
                    : "No new questions to merge"
                );
                training.refetch();
              } catch (e) {
                showToast(`Merge failed: ${e.message}`, "error");
              }
            }}
            className="mt-3 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition-colors"
            id="force-merge-btn"
          >
            Force Merge Now
          </button>
        </div>
      )}

      {/* Self-Learning Section */}
      <div className={`rounded-2xl p-6 ${glassPanel}`}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg backdrop-blur-md ${learningStats?.learning_enabled ? 'bg-emerald-500/20 text-emerald-500' : 'bg-slate-500/20 text-slate-500'}`}>
              <GraduationCap size={20}/>
            </div>
            <div>
              <h3 className={`text-lg font-semibold ${t_textHeading}`}>Hash-Based Self-Learning</h3>
              <p className={`text-xs ${t_textMuted}`}>
                Stores question image hashes and correct options; OCR text is preview only
              </p>
            </div>
          </div>
          <button
            onClick={toggleLearning}
            disabled={togglingLearning}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              learningStats?.learning_enabled
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                : 'bg-slate-500/20 text-slate-400 border border-slate-500/30 hover:bg-slate-500/30'
            }`}
          >
            {togglingLearning ? (
              <Loader2 size={16} className="animate-spin" />
            ) : learningStats?.learning_enabled ? (
              <ToggleRight size={18} />
            ) : (
              <ToggleLeft size={18} />
            )}
            {learningStats?.learning_enabled ? "Learning ON" : "Learning OFF"}
          </button>
        </div>

        {learningStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={`rounded-xl p-4 border ${t_borderLight} ${learningStats?.learning_enabled ? '' : 'opacity-50'}`}>
              <p className={`text-xs ${t_textMuted}`}>Hash Entries Learned</p>
              <p className="text-2xl font-bold text-indigo-400">
                {learningStats.learned?.total_learned || 0}
              </p>
            </div>
            <div className={`rounded-xl p-4 border ${t_borderLight} ${learningStats?.learning_enabled ? '' : 'opacity-50'}`}>
              <p className={`text-xs ${t_textMuted}`}>High Confidence</p>
              <p className="text-2xl font-bold text-emerald-400">
                {learningStats.learned?.high_confidence || 0}
              </p>
            </div>
            <div className={`rounded-xl p-4 border ${t_borderLight} ${learningStats?.learning_enabled ? '' : 'opacity-50'}`}>
              <p className={`text-xs ${t_textMuted}`}>Total Confirmations</p>
              <p className="text-2xl font-bold text-amber-400">
                {learningStats.learned?.total_confirmations || 0}
              </p>
            </div>
            <div className={`rounded-xl p-4 border ${t_borderLight} ${learningStats?.learning_enabled ? '' : 'opacity-50'}`}>
              <p className={`text-xs ${t_textMuted}`}>Attempt Accuracy</p>
              <p className="text-2xl font-bold text-cyan-400">
                {((learningStats.attempts?.accuracy || 0) * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        )}

        <div className={`mt-4 p-4 rounded-xl border ${t_borderLight} text-xs ${t_textMuted}`}>
          <p className="font-medium mb-1">How it works:</p>
          <ol className="list-decimal list-inside space-y-0.5 opacity-80">
            <li>Extension solves question on real exam</li>
            <li>Score counter confirms answer was correct</li>
            <li>Question image hash, pHash, selected option, and OCR preview are saved in SQLite</li>
            <li>Same/similar question images are answered by hash match without LLM</li>
          </ol>
        </div>
      </div>

      <AutomationMethodsPanel showToast={showToast} />
    </div>
  );
}

ExamStatsPanel.propTypes = {
  examStats: PropTypes.object.isRequired,
  showToast: PropTypes.func.isRequired,
};
