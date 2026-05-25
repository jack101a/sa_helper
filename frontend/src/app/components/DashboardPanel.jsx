import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { FileX2, Trash2, Download, Inbox, Save, ShieldCheck, Loader2 } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { apiGet, apiPostJson } from "../../api/client";
import { EmptyState } from "./EmptyState";
import { SkeletonTableRow } from "./Skeleton";

export function DashboardPanel({
  failedPayloads,
  selectedPayloads,
  allPayloadSelected,
  datasetsDir,
  loading,
  togglePayload,
  toggleAllPayloads,
  handleLabelPayload,
  handleIgnorePayload,
  handleBulkSavePayloads,
  handleBulkIgnorePayloads,
  showToast,
}) {
  const { isDark, t_textHeading, t_textMuted, t_borderLight, t_rowHover, glassPanel, glassButton, glassInput } = useThemeContext();
  const [copyUnlockerEnabled, setCopyUnlockerEnabled] = useState(false);
  const [copyUnlockerSites, setCopyUnlockerSites] = useState("");
  const [copyUnlockerLoading, setCopyUnlockerLoading] = useState(true);
  const [copyUnlockerSaving, setCopyUnlockerSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiGet("/admin/api/settings/extension.copy_unlocker.enabled").catch(() => ({ value: "false" })),
      apiGet("/admin/api/settings/extension.copy_unlocker.sites").catch(() => ({ value: "" })),
    ]).then(([enabled, sites]) => {
      if (!alive) return;
      setCopyUnlockerEnabled(String(enabled.value || "").toLowerCase() === "true");
      setCopyUnlockerSites(sites.value || "");
    }).finally(() => {
      if (alive) setCopyUnlockerLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const saveCopyUnlockerConfig = async () => {
    setCopyUnlockerSaving(true);
    try {
      const normalizedSites = String(copyUnlockerSites || "")
        .split(/[\n,]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .join("\n");
      await apiPostJson("/admin/api/settings/bulk", {
        settings: {
          "extension.copy_unlocker.enabled": copyUnlockerEnabled ? "true" : "false",
          "extension.copy_unlocker.sites": normalizedSites,
        }
      });
      setCopyUnlockerSites(normalizedSites);
      showToast("Copy/right-click unlocker settings saved.");
    } catch (e) {
      showToast("Failed to save unlocker settings: " + e.message, "error");
    } finally {
      setCopyUnlockerSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className={`rounded-2xl p-5 border backdrop-blur-md ${glassPanel} ${t_borderLight}`}>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-500/20 text-indigo-500 rounded-2xl shadow-inner">
              <Download size={24} />
            </div>
            <div>
              <h3 className={`text-lg font-bold ${t_textHeading}`}>Browser Extension</h3>
              <p className={`text-xs ${t_textMuted}`}>Download original admin source or protected user distribution packages.</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <span className={`text-xs font-semibold mr-2 ${t_textMuted}`}>ADMIN SOURCE:</span>
              <a href="/admin/api/extension/download?format=zip&variant=admin" className="text-xs font-bold text-indigo-500 hover:underline">ZIP</a>
              <span className="text-white/20">|</span>
              <a href="/admin/api/extension/download?format=crx&variant=admin" className="text-xs font-bold text-emerald-500 hover:underline">CRX</a>
              <span className="text-white/20">|</span>
              <a href="/admin/api/extension/download?format=xpi&variant=admin" className="text-xs font-bold text-orange-500 hover:underline">XPI</a>
            </div>
            
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <span className={`text-xs font-semibold mr-2 ${t_textMuted}`}>USER PACKAGE:</span>
              <a href="/admin/api/extension/download?format=zip&variant=user" className="text-xs font-bold text-indigo-500 hover:underline">ZIP</a>
              <span className="text-white/20">|</span>
              <a href="/admin/api/extension/download?format=crx&variant=user" className="text-xs font-bold text-emerald-500 hover:underline">CRX</a>
              <span className="text-white/20">|</span>
              <a href="/admin/api/extension/download?format=xpi&variant=user" className="text-xs font-bold text-orange-500 hover:underline">XPI</a>
            </div>
          </div>
        </div>
      </div>

      <div className={`rounded-2xl p-5 border backdrop-blur-md ${glassPanel} ${t_borderLight}`}>
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-emerald-500/20 text-emerald-500 rounded-2xl shadow-inner">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h3 className={`text-lg font-bold ${t_textHeading}`}>Copy & Right Click Unlocker</h3>
              <p className={`text-xs mt-1 ${t_textMuted}`}>
                Admin-controlled restore for right-click, text selection, copy, and normal paste on approved websites only.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={saveCopyUnlockerConfig}
            disabled={copyUnlockerLoading || copyUnlockerSaving}
            className={glassButton}
          >
            {copyUnlockerSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {copyUnlockerSaving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4">
          <label className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${t_borderLight}`}>
            <span>
              <span className={`block text-sm font-semibold ${t_textHeading}`}>Enable Feature</span>
              <span className={`block text-[11px] ${t_textMuted}`}>Only applies to listed websites.</span>
            </span>
            <input
              type="checkbox"
              checked={copyUnlockerEnabled}
              onChange={(e) => setCopyUnlockerEnabled(e.target.checked)}
              disabled={copyUnlockerLoading}
            />
          </label>
          <div>
            <label className={`text-xs block mb-1 ${t_textMuted}`}>Allowed Websites</label>
            <textarea
              className={`${glassInput} min-h-28 font-mono text-xs leading-relaxed`}
              value={copyUnlockerSites}
              onChange={(e) => setCopyUnlockerSites(e.target.value)}
              disabled={copyUnlockerLoading}
              placeholder={"example.com\n*.example.org\nhttps://example.net/articles/*"}
              spellCheck={false}
            />
            <p className={`text-[11px] mt-2 ${t_textMuted}`}>
              One domain or URL pattern per line. The extension ignores all other websites.
            </p>
          </div>
        </div>
      </div>
    
      <div className={`rounded-2xl transition-colors duration-500 overflow-hidden ${glassPanel}`}>
      <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>

        <div className="p-2 bg-amber-500/20 text-amber-500 rounded-lg backdrop-blur-md"><FileX2 size={20}/></div>
        <div>
          <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Payload Correction Queue</h2>
          <p className={`text-[11px] ${t_textMuted}`}>Manual review of failed predictions. Source: <span className="font-mono text-amber-500/70">{datasetsDir}</span></p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={handleBulkSavePayloads} className={glassButton}>Save Selected</button>
          <button type="button" onClick={handleBulkIgnorePayloads} className={glassButton}>Ignore Selected</button>
        </div>
      </div>
      
      <div className="p-5 overflow-auto max-h-[30rem] custom-scrollbar">
        <table className="w-full text-sm text-left min-w-[700px]">
          <thead>
            <tr className={`border-b sticky top-0 z-10 ${t_textMuted} ${t_borderLight} ${isDark ? "bg-[#020617]/90" : "bg-white/90"} backdrop-blur`}>
              <th className="pb-3 font-medium">
                <input type="checkbox" checked={allPayloadSelected} onChange={toggleAllPayloads} />
              </th>
              <th className="pb-3 font-medium">Target Context</th>
              <th className="pb-3 font-medium">Captured Payload</th>
              <th className="pb-3 font-medium">AI Guess</th>
              <th className="pb-3 font-medium">Human Correction</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${t_borderLight}`}>
            {failedPayloads.map(item => (
              <tr key={item.id || item.name} className={`group ${t_rowHover}`}>
                <td className="py-4 pr-3">
                  <input type="checkbox" checked={!!selectedPayloads[item.name]} onChange={() => togglePayload(item.name)} />
                </td>
                <td className="py-4 pr-4">
                  <div className={`font-mono text-xs drop-shadow-sm ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>{item.domain}</div>
                  <div className={`text-[10px] mt-1 ${t_textMuted}`}>{item.updated_at}</div>
                </td>
                <td className="py-4 pr-4">
                  <div className={`relative inline-block rounded-lg overflow-hidden border shadow-md backdrop-blur-sm ${isDark ? 'border-white/10 bg-black/50' : 'border-white/60 bg-white/50'}`}>
                    <img src={item.preview_url} alt={`Failed captcha preview for ${item.name}`} loading="lazy" width="200" height="45" className="h-[45px] w-[200px] object-cover mix-blend-multiply dark:mix-blend-screen"
                      onError={(e) => { e.target.style.display = "none"; }} />
                  </div>
                </td>
                <td className="py-4 pr-4">
                  <span className={`px-3 py-1 border rounded-md font-mono tracking-widest backdrop-blur-md shadow-sm ${isDark ? 'bg-black/30 border-white/5 text-rose-400' : 'bg-white/60 border-white/80 text-rose-600'}`}>{item.ocr_guess}</span>
                </td>
                <td className="py-4">
                  <form onSubmit={(e) => handleLabelPayload(item.name, item.domain, item.ocr_guess, e)} className="flex items-center gap-2">
                    <input type="text" name="corrected_text" defaultValue={item.corrected_text || item.ocr_guess} required className={`${glassInput} w-32 tracking-widest font-mono text-emerald-500`} />
                    <button type="submit" className={`${glassButton} px-3 py-2 text-xs`}>Fix & Save</button>
                    <button type="button" onClick={() => handleIgnorePayload(item.name)} className={`p-2 transition-colors ${t_textMuted} hover:text-rose-500`}><Trash2 size={16}/></button>
                  </form>
                </td>
              </tr>
            ))}
            {loading && Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} cols={4} />)}
            {!loading && failedPayloads.length === 0 && (
              <EmptyState icon={Inbox} title="Queue is clear" description="Great job! All payloads have been processed." />
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>
  );
}

DashboardPanel.propTypes = {
  failedPayloads: PropTypes.array.isRequired,
  selectedPayloads: PropTypes.object.isRequired,
  allPayloadSelected: PropTypes.bool.isRequired,
  datasetsDir: PropTypes.string.isRequired,
  loading: PropTypes.bool,
  togglePayload: PropTypes.func.isRequired,
  toggleAllPayloads: PropTypes.func.isRequired,
  handleLabelPayload: PropTypes.func.isRequired,
  handleIgnorePayload: PropTypes.func.isRequired,
  handleBulkSavePayloads: PropTypes.func.isRequired,
  handleBulkIgnorePayloads: PropTypes.func.isRequired,
  showToast: PropTypes.func.isRequired,
};
