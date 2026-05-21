/**
 * AutofillProposalsPanel
 * UX: status tabs + search + inline rule_json edit + delete + approve/reject
 */
import React, { useState, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import { Zap, Pencil, Trash2, CheckCircle2, XCircle, Save, X, ChevronDown, ChevronRight, Inbox } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useDebounce } from "../hooks/useDebounce";
import { EmptyState } from "./EmptyState";

const STATUS_TABS = ["all", "pending", "approved", "rejected"];
const STATUS_COLORS = {
  pending:  "bg-amber-500/20 text-amber-400 border-amber-500/20",
  approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
  rejected: "bg-rose-500/20 text-rose-400 border-rose-500/20",
};

/** Try to parse rule_json and return a display-friendly object */
function parseRule(rule_json) {
  if (!rule_json) return null;
  try { return JSON.parse(rule_json); } catch { return null; }
}

/** Pretty key labels for known rule fields */
const RULE_LABELS = {
  domain: "Domain", selector: "Selector", field_name: "Field",
  value: "Value", action: "Action", tag: "Tag",
};

export function AutofillProposalsPanel({
  autofillProposals,
  handleApproveAutofillProposal, handleRejectAutofillProposal,
  handleBulkApproveAutofillProposals, handleBulkRejectAutofillProposals,
  handleEditAutofillProposal, handleDeleteAutofillProposal,
}) {
  const { isDark, t_textHeading, t_textMuted, t_borderLight, t_rowHover, glassPanel, glassButton, badgeSuccess, smallGlassInput, tabButton, iconBtn } = useThemeContext();
  const [tab,       setTab]       = useState("pending");
  const [search,    setSearch]    = useState("");
  const [selected,  setSelected]  = useState({});
  const [expanded,  setExpanded]  = useState({});   // row JSON expand
  const [editing,   setEditing]   = useState(null); // { id, ruleStr }
  const searchRef = useRef(null);

  useKeyboardShortcuts({
    onSearch: () => { searchRef.current?.focus(); },
    onEscape: () => { if (editing) setEditing(null); },
  });

  const proposals = autofillProposals || [];
  const pendingCount = proposals.filter(p => p.status === "pending").length;

  const debouncedSearch = useDebounce(search, 250);

  const filtered = useMemo(() => {
    let list = tab === "all" ? proposals : proposals.filter(p => p.status === tab);
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      list = list.filter(p =>
        (p.rule_json || "").toLowerCase().includes(q) ||
        (p.device_id || "").toLowerCase().includes(q) ||
        String(p.id).includes(q)
      );
    }
    return list;
  }, [proposals, tab, debouncedSearch]);

  const selCount = Object.values(selected).filter(Boolean).length;
  const toggleSel = id => setSelected(p => ({ ...p, [id]: !p[id] }));
  const selectAll = () => { const n = {}; filtered.forEach(p => { n[p.id] = true; }); setSelected(n); };
  const clearSel  = () => setSelected({});

  const toggleExpand = id => setExpanded(p => ({ ...p, [id]: !p[id] }));
  const startEdit = (p) => setEditing({ id: p.id, ruleStr: p.rule_json || "{}" });

  const saveEdit = async () => {
    if (!editing) return;
    // Validate JSON first
    try { JSON.parse(editing.ruleStr); } catch { alert("Invalid JSON — please fix before saving."); return; }
    const ok = await handleEditAutofillProposal(editing.id, { rule_json: editing.ruleStr });
    if (ok) setEditing(null);
  };

  const inp = smallGlassInput;

  return (
    <div className={`rounded-2xl overflow-hidden ${glassPanel}`}>
      {/* Header */}
      <div className={`p-4 border-b flex flex-wrap items-center gap-3 ${t_borderLight}`}>
        <div className="p-2 bg-violet-500/20 text-violet-400 rounded-lg"><Zap size={18}/></div>
        <div className="flex-1 min-w-0">
          <h2 className={`text-base font-semibold ${t_textHeading}`}>
            Autofill Rule Proposals
            {pendingCount > 0 && <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">{pendingCount} pending</span>}
          </h2>
          <p className={`text-[11px] ${t_textMuted}`}>All statuses — search, edit rule JSON, delete, approve or reject</p>
        </div>
        <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rule / device…"
          className={`${smallGlassInput} w-44`} />
      </div>

      {/* Tabs */}
      <div className={`px-4 pt-3 pb-0 flex items-center gap-2 border-b ${t_borderLight}`}>
        {STATUS_TABS.map(t => (
          <button key={t} className={tabButton(tab === t)} onClick={() => { setTab(t); clearSel(); }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            <span className="ml-1 opacity-60">({t === "all" ? proposals.length : proposals.filter(p => p.status === t).length})</span>
          </button>
        ))}
      </div>

      {/* Bulk bar */}
      {selCount > 0 && (
        <div className={`px-4 py-2 flex items-center gap-2 ${isDark ? "bg-violet-500/5" : "bg-violet-50/50"} border-b ${t_borderLight}`}>
          <span className={`text-xs ${t_textMuted}`}>{selCount} selected</span>
          <button onClick={() => { handleBulkApproveAutofillProposals(Object.keys(selected).filter(k => selected[k])); clearSel(); }}
            className={`${badgeSuccess} flex items-center gap-1 px-2 py-1 cursor-pointer text-[10px]`}>
            <CheckCircle2 size={12}/> Approve
          </button>
          <button onClick={() => { handleBulkRejectAutofillProposals(Object.keys(selected).filter(k => selected[k])); clearSel(); }}
            className="px-2 py-1 rounded text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 cursor-pointer flex items-center gap-1">
            <XCircle size={12}/> Reject
          </button>
          <button onClick={clearSel} className={`text-[10px] ${t_textMuted} cursor-pointer`}>✕ clear</button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto max-h-[60vh]">
        <table className="w-full text-xs min-w-[700px]">
          <thead>
            <tr className={`border-b sticky top-0 z-10 ${t_borderLight} ${isDark ? "bg-[#020617]/80" : "bg-white/80"} backdrop-blur`}>
              <th className="p-3 w-8">
                <input type="checkbox" checked={selCount === filtered.length && filtered.length > 0}
                  onChange={e => e.target.checked ? selectAll() : clearSel()} className="rounded cursor-pointer"/>
              </th>
              {["ID / Device", "Rule Preview", "Status / Date", "Actions"].map(h => (
                <th key={h} className={`p-3 text-left font-semibold ${t_textMuted}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const rule = parseRule(p.rule_json);
              const isEdit = editing?.id === p.id;
              const isExpanded = expanded[p.id];
              return (
                <React.Fragment key={p.id}>
                  <tr className={`border-b ${t_borderLight} ${t_rowHover} ${isEdit ? (isDark ? "bg-indigo-500/5" : "bg-indigo-50/40") : ""}`}>
                    <td className="p-3">
                      <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggleSel(p.id)} className="rounded cursor-pointer"/>
                    </td>

                    {/* ID / Device */}
                    <td className="p-3 min-w-[120px]">
                      <div className={`font-mono font-semibold ${t_textHeading}`}>#{p.id}</div>
                      {p.device_id && <div className={`${t_textMuted} font-mono text-[10px] truncate max-w-[110px]`} title={p.device_id}>{p.device_id}</div>}
                      {p.approved_rule_id && <div className="text-[10px] text-emerald-400 font-mono truncate max-w-[110px]" title={p.approved_rule_id}>{p.approved_rule_id}</div>}
                    </td>

                    {/* Rule preview */}
                    <td className="p-3 max-w-[340px]">
                      {isEdit ? (
                        <textarea
                          value={editing.ruleStr}
                          onChange={e => setEditing(v => ({ ...v, ruleStr: e.target.value }))}
                          rows={5}
                          className={`${inp} w-full font-mono resize-y`}
                        />
                      ) : rule ? (
                        <div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            {Object.entries(rule).slice(0, isExpanded ? undefined : 3).map(([k, v]) => (
                              <span key={k} className={t_textMuted}>
                                <span className="font-semibold text-indigo-400">{RULE_LABELS[k] || k}:</span>{" "}
                                <span className="font-mono">{String(v).slice(0, 60)}{String(v).length > 60 ? "…" : ""}</span>
                              </span>
                            ))}
                          </div>
                          {Object.keys(rule).length > 3 && (
                            <button onClick={() => toggleExpand(p.id)} className={`mt-0.5 flex items-center gap-0.5 ${t_textMuted} hover:text-indigo-400 cursor-pointer`}>
                              {isExpanded ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}
                              {isExpanded ? "collapse" : `+${Object.keys(rule).length - 3} more fields`}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className={`font-mono break-all line-clamp-3 ${t_textMuted}`}>{p.rule_json}</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="p-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] border ${STATUS_COLORS[p.status] || ""}`}>{p.status}</span>
                      <div className={`text-[10px] mt-0.5 ${t_textMuted}`}>{p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : p.created_at ? new Date(p.created_at).toLocaleDateString() : ""}</div>
                    </td>

                    {/* Actions */}
                    <td className="p-3">
                      {isEdit ? (
                        <div className="flex gap-1">
                          <button onClick={saveEdit} className={iconBtn('success')}><Save size={13}/></button>
                          <button onClick={() => setEditing(null)} className={iconBtn('ghost')}><X size={13}/></button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {p.status === "pending" && (
                            <div className="flex gap-1">
                              <button onClick={() => handleApproveAutofillProposal(p.id)} title="Approve" className={iconBtn('success')}><CheckCircle2 size={13}/></button>
                              <button onClick={() => handleRejectAutofillProposal(p.id)} title="Reject" className={iconBtn('danger')}><XCircle size={13}/></button>
                            </div>
                          )}
                          <div className="flex gap-1">
                            <button onClick={() => startEdit(p)} title="Edit JSON" className={iconBtn('edit')}><Pencil size={13}/></button>
                            <button onClick={() => handleDeleteAutofillProposal(p.id)} title="Delete" className={iconBtn('danger')}><Trash2 size={13}/></button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && (
              <EmptyState icon={Inbox} title="No proposals found" description="Try adjusting your search or status filter." />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

AutofillProposalsPanel.propTypes = {
  autofillProposals: PropTypes.array,
  handleApproveAutofillProposal: PropTypes.func.isRequired,
  handleRejectAutofillProposal: PropTypes.func.isRequired,
  handleBulkApproveAutofillProposals: PropTypes.func.isRequired,
  handleBulkRejectAutofillProposals: PropTypes.func.isRequired,
  handleEditAutofillProposal: PropTypes.func.isRequired,
  handleDeleteAutofillProposal: PropTypes.func.isRequired,
};
