/**
 * CaptchaProposalsPanel
 *
 * Two top-level views:
 *   "rules"     → field_mappings (live approved rules) – editable, deletable
 *   "proposals" → field_mapping_proposals (all statuses) – approve/reject/edit/delete
 */
import React, { useState, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import { MapPin, Pencil, Trash2, CheckCircle2, XCircle, AlertCircle, Save, X, ShieldCheck, Inbox } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useDebounce } from "../hooks/useDebounce";
import { EmptyState } from "./EmptyState";

const PROPOSAL_TABS = ["all", "pending", "approved", "rejected"];
const STATUS_COLORS = {
  pending:  "bg-amber-500/20 text-amber-400 border-amber-500/20",
  approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
  rejected: "bg-rose-500/20 text-rose-400 border-rose-500/20",
};

export function CaptchaProposalsPanel({
  mappings,
  handleRemoveMapping,
  handleQuickEditMapping,
  captchaProposals,
  models,
  handleApproveCaptchaProposal,
  handleRejectCaptchaProposal,
  handleBulkApproveCaptchaProposals,
  handleBulkRejectCaptchaProposals,
  handleEditCaptchaProposal,
  handleDeleteCaptchaProposal,
}) {
  const { isDark, t_textHeading, t_textMuted, t_borderLight, t_rowHover, glassPanel, glassButton, glassInput, badgeSuccess, smallGlassInput, tabButton, iconBtn, viewSwitcherBtn } = useThemeContext();
  const [view,   setView]   = useState(captchaProposals?.some(p => p.status === "pending") ? "proposals" : "rules");
  const [ptab,   setPtab]   = useState("pending"); // proposal status tab
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);    // { id, draft, type: "rule"|"proposal" }
  const [rowModel, setRowModel] = useState({});
  const [bulkModel, setBulkModel] = useState("");
  const [selected, setSelected] = useState({});
  const searchRef = useRef(null);

  useKeyboardShortcuts({
    onSearch: () => { searchRef.current?.focus(); },
    onEscape: () => { if (editing) setEditing(null); },
  });

  const activeModels = useMemo(() => (models || []).filter(m => m.status === "active"), [models]);
  const allMappings   = mappings || [];
  const proposals     = captchaProposals || [];
  const pendingCount  = proposals.filter(p => p.status === "pending").length;
  const debouncedSearch = useDebounce(search, 250);

  // ── filtered lists ───────────────────────────────────────
  const filteredRules = useMemo(() => {
    if (!debouncedSearch.trim()) return allMappings;
    const q = debouncedSearch.toLowerCase();
    return allMappings.filter(m =>
      (m.domain || "").toLowerCase().includes(q) ||
      (m.field_name || "").toLowerCase().includes(q) ||
      (m.source_selector || "").toLowerCase().includes(q) ||
      (m.task_type || "").toLowerCase().includes(q)
    );
  }, [allMappings, debouncedSearch]);

  const filteredProposals = useMemo(() => {
    let list = ptab === "all" ? proposals : proposals.filter(p => p.status === ptab);
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(p =>
        (p.domain || "").toLowerCase().includes(q) ||
        (p.proposed_field_name || "").toLowerCase().includes(q) ||
        (p.source_selector || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [proposals, ptab, debouncedSearch]);

  // ── selection ────────────────────────────────────────────
  const selCount  = Object.values(selected).filter(Boolean).length;
  const toggleSel = id => setSelected(p => ({ ...p, [id]: !p[id] }));
  const selectAll = list => { const n = {}; list.forEach(p => { n[p.id] = true; }); setSelected(n); };
  const clearSel  = () => setSelected({});

  // ── inline edit helpers ──────────────────────────────────
  const startEditRule = (r) => setEditing({
    id: r.id, type: "rule",
    draft: { domain: r.domain || "", field_name: r.field_name || "", task_type: r.task_type || "", source_selector: r.source_selector || "", target_selector: r.target_selector || "" }
  });
  const startEditProposal = (p) => setEditing({
    id: p.id, type: "proposal",
    draft: { domain: p.domain || "", proposed_field_name: p.proposed_field_name || "", task_type: p.task_type || "", source_selector: p.source_selector || "", target_selector: p.target_selector || "" }
  });
  const saveEdit = async () => {
    if (!editing) return;
    let ok;
    if (editing.type === "rule")
      ok = await handleQuickEditMapping(editing.id, editing.draft);
    else
      ok = await handleEditCaptchaProposal(editing.id, editing.draft);
    if (ok) setEditing(null);
  };

  // ── approve / bulk ───────────────────────────────────────
  const approveRow = (p) => {
    const mid = rowModel[p.id] || (activeModels.length === 1 ? String(activeModels[0].id) : "");
    if (!mid) { alert("Pick a model for this row before approving."); return; }
    handleApproveCaptchaProposal(p.id, Number(mid));
  };
  const bulkApprove = () => {
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (!ids.length) return;
    if (!bulkModel) { alert("Pick a model for bulk-approve."); return; }
    handleBulkApproveCaptchaProposals(ids, Number(bulkModel));
    clearSel();
  };

  // ── class helpers ────────────────────────────────────────
  const inp = smallGlassInput;

  return (
    <div className={`rounded-2xl overflow-hidden ${glassPanel}`}>
      {/* Header */}
      <div className={`p-4 border-b flex flex-wrap items-center gap-3 ${t_borderLight}`}>
        <div className="p-2 bg-cyan-500/20 text-cyan-400 rounded-lg"><MapPin size={18}/></div>
        <div className="flex-1 min-w-0">
          <h2 className={`text-base font-semibold ${t_textHeading}`}>
            Captcha Routes
            {pendingCount > 0 && <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">{pendingCount} pending proposals</span>}
          </h2>
          <p className={`text-[11px] ${t_textMuted}`}>
            Active rules: {allMappings.length} &nbsp;·&nbsp; Total proposals: {proposals.length}
          </p>
        </div>
        <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search domain / selector…"
          className={`${inp} w-44`} />
      </div>

      {/* View switcher */}
      <div className={`flex border-b ${t_borderLight} bg-transparent`}>
        <button className={viewSwitcherBtn(view === "rules")} onClick={() => { setView("rules"); clearSel(); setEditing(null); }}>
          <ShieldCheck size={14}/> Active Rules ({allMappings.length})
        </button>
        <button className={viewSwitcherBtn(view === "proposals")} onClick={() => { setView("proposals"); clearSel(); setEditing(null); }}>
          <MapPin size={14}/> Proposals ({proposals.length})
          {pendingCount > 0 && <span className="ml-1 px-1 text-[9px] bg-amber-500/20 text-amber-400 rounded">{pendingCount}</span>}
        </button>
      </div>

      {/* ── VIEW: ACTIVE RULES ───────────────────────────── */}
      {view === "rules" && (
        <div className="overflow-auto max-h-[65vh]">
          <table className="w-full text-xs min-w-[820px]">
            <thead>
              <tr className={`border-b sticky top-0 z-10 ${t_borderLight} ${isDark ? "bg-[#020617]/90" : "bg-white/90"} backdrop-blur`}>
                {["Domain", "Field / Task", "Source Selector", "Target Selector", "Model", "Actions"].map(h => (
                  <th key={h} className={`p-3 text-left font-semibold ${t_textMuted}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRules.map(r => {
                const isEdit = editing?.type === "rule" && editing?.id === r.id;
                const d = isEdit ? editing.draft : r;
                const modelName = (models || []).find(m => Number(m.id) === Number(r.ai_model_id))?.ai_model_name || `#${r.ai_model_id}`;
                return (
                  <tr key={r.id} className={`border-b ${t_borderLight} ${t_rowHover} ${isEdit ? (isDark ? "bg-indigo-500/5" : "bg-indigo-50/40") : ""}`}>
                    <td className="p-3 min-w-[130px]">
                      {isEdit ? <input value={d.domain} onChange={e => setEditing(v => ({ ...v, draft: { ...v.draft, domain: e.target.value }}))} className={`${inp} w-full`}/> : (
                        <span className={`font-mono font-medium ${t_textHeading}`}>{r.domain}</span>
                      )}
                    </td>
                    <td className="p-3">
                      {isEdit ? (
                        <div className="flex flex-col gap-1">
                          <input value={d.field_name} onChange={e => setEditing(v => ({ ...v, draft: { ...v.draft, field_name: e.target.value }}))} className={`${inp} w-full`} placeholder="field_name"/>
                          <input value={d.task_type}  onChange={e => setEditing(v => ({ ...v, draft: { ...v.draft, task_type: e.target.value }}))}  className={`${inp} w-24`}  placeholder="task_type"/>
                        </div>
                      ) : (
                        <>
                          <div className={t_textHeading}>{r.field_name}</div>
                          <span className="px-1 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">{r.task_type}</span>
                        </>
                      )}
                    </td>
                    <td className="p-3 max-w-[180px]">
                      {isEdit ? <input value={d.source_selector} onChange={e => setEditing(v => ({ ...v, draft: { ...v.draft, source_selector: e.target.value }}))} className={`${inp} w-full`}/> : (
                        <span className={`${t_textMuted} font-mono text-[10px] break-all line-clamp-2`}>{r.source_selector || "—"}</span>
                      )}
                    </td>
                    <td className="p-3 max-w-[180px]">
                      {isEdit ? <input value={d.target_selector} onChange={e => setEditing(v => ({ ...v, draft: { ...v.draft, target_selector: e.target.value }}))} className={`${inp} w-full`}/> : (
                        <span className={`${t_textMuted} font-mono text-[10px] break-all line-clamp-2`}>{r.target_selector || "—"}</span>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className={`text-[10px] ${t_textMuted}`}>{modelName}</span>
                    </td>
                    <td className="p-3">
                      {isEdit ? (
                        <div className="flex gap-1">
                          <button onClick={saveEdit} className={iconBtn('success')}><Save size={13}/></button>
                          <button onClick={() => setEditing(null)} className={iconBtn('ghost')}><X size={13}/></button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button onClick={() => startEditRule(r)} title="Edit" className={iconBtn('edit')}><Pencil size={13}/></button>
                          <button onClick={() => handleRemoveMapping(r.id)} title="Delete" className="p-1.5 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 cursor-pointer"><Trash2 size={13}/></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredRules.length === 0 && (
                <EmptyState icon={Inbox} title="No active rules" description="Approve proposals to create rules." />
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── VIEW: PROPOSALS ──────────────────────────────── */}
      {view === "proposals" && (
        <>
          {/* Status tabs */}
          <div className={`px-4 pt-3 pb-0 flex items-center gap-2 border-b ${t_borderLight}`}>
            {PROPOSAL_TABS.map(t => (
              <button key={t} className={tabButton(ptab === t)} onClick={() => { setPtab(t); clearSel(); }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
                <span className="ml-1 opacity-60">({t === "all" ? proposals.length : proposals.filter(p => p.status === t).length})</span>
              </button>
            ))}
          </div>

          {/* Bulk bar */}
          {selCount > 0 && (
            <div className={`px-4 py-2 flex items-center gap-2 flex-wrap ${isDark ? "bg-cyan-500/5" : "bg-cyan-50/50"} border-b ${t_borderLight}`}>
              <span className={`text-xs ${t_textMuted}`}>{selCount} selected</span>
              <select value={bulkModel} onChange={e => setBulkModel(e.target.value)} className={`${inp} flex-1 min-w-[140px]`}>
                <option value="">— model for bulk approve —</option>
                {activeModels.map(m => <option key={m.id} value={m.id}>{m.ai_model_name} [{m.task_type}]</option>)}
              </select>
              <button onClick={bulkApprove} className={`${badgeSuccess} flex items-center gap-1 px-2 py-1 cursor-pointer text-[10px]`}><CheckCircle2 size={12}/> Approve</button>
              <button onClick={() => { handleBulkRejectCaptchaProposals(Object.keys(selected).filter(k => selected[k])); clearSel(); }}
                className="px-2 py-1 rounded text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 cursor-pointer flex items-center gap-1">
                <XCircle size={12}/> Reject
              </button>
              <button onClick={clearSel} className={`text-[10px] ${t_textMuted} cursor-pointer`}>✕ clear</button>
            </div>
          )}

          {activeModels.length === 0 && (
            <div className="mx-4 mt-3 flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
              <AlertCircle size={14}/> No active models — activate a model before approving.
            </div>
          )}

          <div className="overflow-auto max-h-[55vh]">
            <table className="w-full text-xs min-w-[900px]">
              <thead>
                <tr className={`border-b sticky top-0 z-10 ${t_borderLight} ${isDark ? "bg-[#020617]/90" : "bg-white/90"} backdrop-blur`}>
                  <th className="p-3 w-8">
                    <input type="checkbox" checked={selCount === filteredProposals.length && filteredProposals.length > 0}
                      onChange={e => e.target.checked ? selectAll(filteredProposals) : clearSel()} className="rounded cursor-pointer"/>
                  </th>
                  {["Domain / Field", "Type", "Source Selector", "Target Selector", "Status", "Actions"].map(h => (
                    <th key={h} className={`p-3 text-left font-semibold ${t_textMuted}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredProposals.map(p => {
                  const isEdit = editing?.type === "proposal" && editing?.id === p.id;
                  const d = isEdit ? editing.draft : p;
                  return (
                    <tr key={p.id} className={`border-b ${t_borderLight} ${t_rowHover} ${isEdit ? (isDark ? "bg-indigo-500/5" : "bg-indigo-50/50") : ""}`}>
                      <td className="p-3">
                        <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggleSel(p.id)} className="rounded cursor-pointer"/>
                      </td>
                      <td className="p-3 min-w-[160px]">
                        {isEdit ? (
                          <div className="flex flex-col gap-1">
                            <input value={d.domain} onChange={e => setEditing(v => ({ ...v, draft: { ...v.draft, domain: e.target.value }}))} className={`${inp} w-full`} placeholder="domain"/>
                            <input value={d.proposed_field_name} onChange={e => setEditing(v => ({ ...v, draft: { ...v.draft, proposed_field_name: e.target.value }}))} className={`${inp} w-full`} placeholder="field name"/>
                          </div>
                        ) : (
                          <>
                            <div className={`font-mono font-medium ${t_textHeading} truncate max-w-[140px]`}>{p.domain}</div>
                            <div className={`${t_textMuted} truncate max-w-[140px]`}>{p.proposed_field_name || "—"}</div>
                            <div className={`text-[10px] ${t_textMuted}`}>#{p.id}</div>
                          </>
                        )}
                      </td>
                      <td className="p-3">
                        {isEdit ? (
                          <input value={d.task_type} onChange={e => setEditing(v => ({ ...v, draft: { ...v.draft, task_type: e.target.value }}))} className={`${inp} w-20`}/>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">{p.task_type}</span>
                        )}
                      </td>
                      <td className="p-3 max-w-[180px]">
                        {isEdit ? <input value={d.source_selector} onChange={e => setEditing(v => ({ ...v, draft: { ...v.draft, source_selector: e.target.value }}))} className={`${inp} w-full`}/> : (
                          <span className={`${t_textMuted} font-mono text-[10px] break-all line-clamp-2`}>{p.source_selector || "—"}</span>
                        )}
                      </td>
                      <td className="p-3 max-w-[180px]">
                        {isEdit ? <input value={d.target_selector} onChange={e => setEditing(v => ({ ...v, draft: { ...v.draft, target_selector: e.target.value }}))} className={`${inp} w-full`}/> : (
                          <span className={`${t_textMuted} font-mono text-[10px] break-all line-clamp-2`}>{p.target_selector || "—"}</span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] border ${STATUS_COLORS[p.status] || ""}`}>{p.status}</span>
                        <div className={`text-[10px] mt-0.5 ${t_textMuted}`}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : ""}</div>
                      </td>
                      <td className="p-3">
                        {isEdit ? (
                          <div className="flex gap-1">
                            <button onClick={saveEdit} className={iconBtn('success')}><Save size={13}/></button>
                            <button onClick={() => setEditing(null)} className={iconBtn('ghost')}><X size={13}/></button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {p.status === "pending" && (
                              <div className="flex items-center gap-1">
                                <select value={rowModel[p.id] || (activeModels.length === 1 ? String(activeModels[0].id) : "")}
                                  onChange={e => setRowModel(r => ({ ...r, [p.id]: e.target.value }))}
                                  className={`${inp} flex-1 min-w-[90px]`} disabled={!activeModels.length}>
                                  {activeModels.length !== 1 && <option value="">model</option>}
                                  {activeModels.map(m => <option key={m.id} value={m.id}>{m.ai_model_name}</option>)}
                                </select>
                                <button onClick={() => approveRow(p)} title="Approve" className={iconBtn('success')}><CheckCircle2 size={13}/></button>
                                <button onClick={() => handleRejectCaptchaProposal(p.id)} title="Reject" className={iconBtn('danger')}><XCircle size={13}/></button>
                              </div>
                            )}
                            <div className="flex gap-1">
                              <button onClick={() => startEditProposal(p)} title="Edit" className={iconBtn('edit')}><Pencil size={13}/></button>
                              <button onClick={() => handleDeleteCaptchaProposal(p.id)} title="Delete" className="p-1.5 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 cursor-pointer"><Trash2 size={13}/></button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredProposals.length === 0 && (
                  <EmptyState icon={Inbox} title="No proposals found" description="Try adjusting your search or status filter." />
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

CaptchaProposalsPanel.propTypes = {
  mappings: PropTypes.array,
  handleRemoveMapping: PropTypes.func.isRequired,
  handleQuickEditMapping: PropTypes.func.isRequired,
  captchaProposals: PropTypes.array,
  models: PropTypes.array,
  handleApproveCaptchaProposal: PropTypes.func.isRequired,
  handleRejectCaptchaProposal: PropTypes.func.isRequired,
  handleBulkApproveCaptchaProposals: PropTypes.func.isRequired,
  handleBulkRejectCaptchaProposals: PropTypes.func.isRequired,
  handleEditCaptchaProposal: PropTypes.func.isRequired,
  handleDeleteCaptchaProposal: PropTypes.func.isRequired,
};
