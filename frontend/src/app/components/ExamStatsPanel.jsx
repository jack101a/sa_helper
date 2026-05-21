import React, { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, Loader2, Save, GraduationCap, ToggleLeft, ToggleRight } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { apiGet, apiPostJson } from "../../api/client";
import { fetchTrainingStats, queryKeys } from "../../api/queries";
import { AutomationMethodsPanel } from "./AutomationMethodsPanel";

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
