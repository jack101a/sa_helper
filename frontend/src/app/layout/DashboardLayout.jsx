import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { useThemeContext } from "../context/ThemeContext";

export function DashboardLayout({
  children,
  handleLogout,
  loading, toast,
  createdKeyModal, setCreatedKeyModal,
  handleCopyKey,
}) {
  const { isDark, t_bg, t_textHeading, t_textMuted, glassPanel, glassButton, solidButton } = useThemeContext();

  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setCheatSheetOpen(true);
      }
      if (e.key === "Escape" && cheatSheetOpen) {
        setCheatSheetOpen(false);
      }
      if (e.key === "Escape" && createdKeyModal.open) {
        setCreatedKeyModal({ open: false, keyId: null, keyValue: "", warnings: [] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createdKeyModal.open, setCreatedKeyModal, cheatSheetOpen]);

  return (
    <div className={`min-h-screen font-sans selection:bg-indigo-500/30 relative overflow-x-hidden transition-colors duration-500 ${t_bg}`}>

      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className={`absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full filter blur-[100px] opacity-60 animate-blob ${isDark ? "bg-indigo-900 mix-blend-screen" : "bg-indigo-200 mix-blend-multiply"}`} />
        <div className={`absolute top-[0%] right-[-10%] w-[40vw] h-[40vw] rounded-full filter blur-[100px] opacity-60 animate-blob animation-delay-2000 ${isDark ? "bg-purple-900 mix-blend-screen" : "bg-purple-200 mix-blend-multiply"}`} />
        <div className={`absolute bottom-[-10%] left-[10%] w-[60vw] h-[60vw] rounded-full filter blur-[100px] opacity-60 animate-blob animation-delay-4000 ${isDark ? "bg-cyan-900 mix-blend-screen" : "bg-cyan-200 mix-blend-multiply"}`} />
      </div>

      <Sidebar handleLogout={handleLogout} />

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 relative z-10 space-y-8">

        {loading && (
          <div className="fixed top-20 right-6 z-40 flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30 backdrop-blur-md">
            <Loader2 className="animate-spin text-indigo-400" size={16} />
            <span className={`text-xs font-medium ${t_textMuted}`}>Syncing data...</span>
          </div>
        )}

        {toast.message && (
          <div role="alert" aria-live="polite" className="fixed bottom-6 right-6 z-50" style={{ animation: "slideInBottom 0.3s ease-out, fadeOut 0.3s ease-in 2.7s forwards" }}>
            <div className={`backdrop-blur-2xl border rounded-2xl px-5 py-3 shadow-2xl flex items-center gap-3
              ${toast.type === "error" ? "bg-rose-500/10 border-rose-500/30 text-rose-500" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"}
              ${isDark ? "" : "bg-white/80"}`}>
              {toast.type === "error" ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
              <span className="text-sm font-medium drop-shadow-sm">{toast.message}</span>
            </div>
          </div>
        )}

        {createdKeyModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className={`${glassPanel} w-full max-w-xl rounded-2xl p-5`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-lg font-semibold ${t_textHeading}`}>API Key</h3>
                <button onClick={() => setCreatedKeyModal({ open: false, keyId: null, keyValue: "", warnings: [] })} className={`text-sm ${t_textMuted} hover:text-rose-500`}>Close</button>
              </div>
              <p className={`text-xs mb-3 ${t_textMuted}`}>Key ID: {createdKeyModal.keyId ?? "\u2013"} | Save this key securely \u2014 it won't be shown again.</p>
              <div className={`rounded-xl px-3 py-3 border font-mono text-xs break-all ${isDark ? "bg-black/30 border-white/10 text-emerald-300" : "bg-white/80 border-white text-emerald-700"}`}>
                {createdKeyModal.keyValue || "(no key value)"}
              </div>
              {createdKeyModal.warnings?.length > 0 && (
                <div className={`mt-3 rounded-xl px-3 py-2 border text-xs ${isDark ? "bg-amber-500/10 border-amber-500/30 text-amber-200" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
                  {createdKeyModal.warnings.map((warning, index) => (
                    <div key={`${warning}-${index}`}>{warning}</div>
                  ))}
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => handleCopyKey(createdKeyModal.keyValue)} className={glassButton}>Copy Key</button>
                <button onClick={() => setCreatedKeyModal({ open: false, keyId: null, keyValue: "", warnings: [] })} className={solidButton}>Done</button>
              </div>
            </div>
          </div>
        )}

        {cheatSheetOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCheatSheetOpen(false)}>
            <div className={`${glassPanel} w-full max-w-sm rounded-2xl p-5`} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-lg font-semibold ${t_textHeading}`}>Keyboard Shortcuts</h3>
                <button onClick={() => setCheatSheetOpen(false)} className={`p-1 rounded ${t_textMuted} hover:text-rose-500`}><X size={18}/></button>
              </div>
              <div className="space-y-2 text-sm">
                {[
                  ["/", "Focus search input"],
                  ["Esc", "Close modals / cancel editing"],
                  ["Shift+/", "Show this cheat sheet"],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-3">
                    <kbd className="px-2 py-0.5 text-xs font-mono rounded bg-white/10 border border-white/10 text-indigo-400">{key}</kbd>
                    <span className={t_textMuted}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {children}
      </main>

    </div>
  );
}

DashboardLayout.propTypes = {
  children: PropTypes.node.isRequired,
  handleLogout: PropTypes.func.isRequired,
  loading: PropTypes.bool.isRequired,
  toast: PropTypes.shape({
    message: PropTypes.string,
    type: PropTypes.string,
  }).isRequired,
  createdKeyModal: PropTypes.shape({
    open: PropTypes.bool,
    keyId: PropTypes.any,
    keyValue: PropTypes.string,
    warnings: PropTypes.array,
  }).isRequired,
  setCreatedKeyModal: PropTypes.func.isRequired,
  handleCopyKey: PropTypes.func.isRequired,
};
