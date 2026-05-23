/**
 * AutofillProposalsPanel
 * Table-style rule management with mobile horizontal scrolling.
 */
import React, { useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Inbox,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useDebounce } from "../hooks/useDebounce";
import { EmptyState } from "./EmptyState";

const STATUS_TABS = ["all", "pending", "approved", "rejected"];
const STATUS_COLORS = {
  pending: "bg-amber-500/20 text-amber-400 border-amber-500/20",
  approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
  rejected: "bg-rose-500/20 text-rose-400 border-rose-500/20",
};

const EXAMPLE_IMPORT = `{
  "rules": [
    {
      "name": "Applicant mobile number",
      "status": "approved",
      "site": { "match_mode": "domainPath", "pattern": "sarathi.parivahan.gov.in/sarathiservice" },
      "profile_scope": "default",
      "priority": 100,
      "steps": [
        {
          "order": 1,
          "action": "text",
          "value": "{{mobile}}",
          "selector": {
            "strategy": "css",
            "id": "mobileNo",
            "name": "mobileNo",
            "css": "#mobileNo"
          }
        }
      ]
    }
  ]
}`;

function parseRule(ruleJson) {
  if (!ruleJson) return null;
  try { return typeof ruleJson === "string" ? JSON.parse(ruleJson) : ruleJson; } catch { return null; }
}

function ruleName(rule, row) {
  return rule?.name || rule?.local_rule_id || row.approved_rule_id || `Rule #${row.id}`;
}

function ruleSite(rule) {
  const site = rule?.site || {};
  if (!site.pattern) return "Any configured page";
  return `${site.pattern}${site.match_mode ? ` (${site.match_mode})` : ""}`;
}

function firstStep(rule) {
  return Array.isArray(rule?.steps) && rule.steps.length ? rule.steps[0] : {};
}

function selectorPairs(rule, expanded) {
  const steps = Array.isArray(rule?.steps) ? rule.steps : [];
  const selectedSteps = expanded ? steps : steps.slice(0, 1);
  return selectedSteps.flatMap((step, index) => {
    const selector = step?.selector || {};
    return Object.entries(selector)
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
      .map(([key, value]) => ({
        key: `${index}-${key}`,
        label: key,
        value: String(value),
      }));
  });
}

function valuePreview(value) {
  if (value === undefined || value === null || value === "") return "-";
  const text = String(value);
  return text.length > 54 ? `${text.slice(0, 54)}...` : text;
}

function buildManualRule(form) {
  const selector = {
    strategy: form.selectorStrategy,
    id: form.selectorId.trim(),
    name: form.selectorName.trim(),
    css: form.selectorCss.trim(),
  };
  if (form.selectorXpath.trim()) selector.xpath = form.selectorXpath.trim();
  return {
    local_rule_id: `admin_${Date.now()}`,
    name: form.name.trim(),
    status: form.status,
    site: { match_mode: form.matchMode, pattern: form.pattern.trim() },
    profile_scope: form.profileScope.trim() || "default",
    frame_path: "any",
    priority: Number(form.priority) || 100,
    steps: [{
      order: 1,
      action: form.action,
      value: form.action === "click" ? "" : form.value,
      selector,
    }],
    meta: { created_from: "admin_ui", created_at: new Date().toISOString() },
  };
}

const defaultManualForm = {
  name: "",
  pattern: "",
  matchMode: "domainPath",
  profileScope: "default",
  priority: 100,
  action: "text",
  value: "",
  selectorStrategy: "css",
  selectorId: "",
  selectorName: "",
  selectorCss: "",
  selectorXpath: "",
  status: "approved",
};

export function AutofillProposalsPanel({
  autofillProposals,
  handleApproveAutofillProposal,
  handleRejectAutofillProposal,
  handleBulkApproveAutofillProposals,
  handleBulkRejectAutofillProposals,
  handleEditAutofillProposal,
  handleDeleteAutofillProposal,
  handleImportAutofillRules,
}) {
  const {
    isDark,
    t_textHeading,
    t_textMuted,
    t_borderLight,
    t_rowHover,
    glassPanel,
    badgeSuccess,
    smallGlassInput,
    tabButton,
    iconBtn,
  } = useThemeContext();
  const [tab, setTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState({});
  const [expanded, setExpanded] = useState({});
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [manualForm, setManualForm] = useState(defaultManualForm);
  const [importText, setImportText] = useState(EXAMPLE_IMPORT);
  const searchRef = useRef(null);

  useKeyboardShortcuts({
    onSearch: () => { searchRef.current?.focus(); },
    onEscape: () => {
      if (editing) setEditing(null);
      else if (showAdd) setShowAdd(false);
      else if (showImport) setShowImport(false);
    },
  });

  const proposals = autofillProposals || [];
  const pendingCount = proposals.filter(p => p.status === "pending").length;
  const debouncedSearch = useDebounce(search, 250);

  const filtered = useMemo(() => {
    let list = tab === "all" ? proposals : proposals.filter(p => p.status === tab);
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p => {
      const rule = parseRule(p.rule_json);
      return [
        p.id,
        p.status,
        p.device_id,
        p.approved_rule_id,
        ruleName(rule, p),
        ruleSite(rule),
        p.rule_json,
      ].join(" ").toLowerCase().includes(q);
    });
  }, [proposals, tab, debouncedSearch]);

  const selCount = Object.values(selected).filter(Boolean).length;
  const selectedIds = Object.keys(selected).filter(k => selected[k]);
  const toggleSel = id => setSelected(p => ({ ...p, [id]: !p[id] }));
  const selectAll = () => {
    const next = {};
    filtered.forEach(p => { next[p.id] = true; });
    setSelected(next);
  };
  const clearSel = () => setSelected({});
  const toggleExpand = id => setExpanded(p => ({ ...p, [id]: !p[id] }));
  const startEdit = (p) => setEditing({ id: p.id, ruleStr: p.rule_json || "{}" });
  const updateManual = (key, value) => setManualForm(prev => ({ ...prev, [key]: value }));

  const submitManual = async (event) => {
    event.preventDefault();
    if (!manualForm.name.trim() || !manualForm.pattern.trim()) return;
    const hasSelector = manualForm.selectorId.trim() || manualForm.selectorName.trim() || manualForm.selectorCss.trim() || manualForm.selectorXpath.trim();
    if (!hasSelector) return;
    const ok = await handleImportAutofillRules([buildManualRule(manualForm)]);
    if (ok) {
      setManualForm(defaultManualForm);
      setShowAdd(false);
    }
  };

  const submitImport = async () => {
    let parsed;
    try { parsed = JSON.parse(importText); } catch { alert("Invalid JSON format."); return; }
    const rules = Array.isArray(parsed) ? parsed : Array.isArray(parsed.rules) ? parsed.rules : [parsed];
    if (!rules.length) return;
    const ok = await handleImportAutofillRules(rules);
    if (ok) setShowImport(false);
  };

  const saveEdit = async () => {
    if (!editing) return;
    try { JSON.parse(editing.ruleStr); } catch { alert("Invalid JSON."); return; }
    const ok = await handleEditAutofillProposal(editing.id, { rule_json: editing.ruleStr });
    if (ok) setEditing(null);
  };

  const setRuleStatus = async (row, active) => {
    const nextStatus = active ? "approved" : "rejected";
    const rule = parseRule(row.rule_json);
    const patch = { status: nextStatus };
    if (rule) patch.rule_json = JSON.stringify({ ...rule, status: nextStatus });
    await handleEditAutofillProposal(row.id, patch);
  };

  const inputClass = `${smallGlassInput} w-full`;
  const labelClass = `text-[11px] font-medium ${t_textMuted}`;

  return (
    <div className={`rounded-2xl overflow-hidden ${glassPanel}`}>
      <div className={`p-4 border-b flex flex-wrap items-center gap-3 ${t_borderLight}`}>
        <div className="p-2 bg-violet-500/20 text-violet-400 rounded-lg"><Zap size={18}/></div>
        <div className="flex-1 min-w-0">
          <h2 className={`text-base font-semibold ${t_textHeading}`}>
            Autofill Rules
            {pendingCount > 0 && <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">{pendingCount} pending</span>}
          </h2>
          <p className={`text-[11px] ${t_textMuted}`}>Search, edit JSON, approve, reject, import, or add fields manually</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowAdd(v => !v)} className={`${badgeSuccess} flex items-center gap-1 px-2 py-1 cursor-pointer text-[10px]`}>
            <Plus size={12}/> Add field
          </button>
          <button onClick={() => setShowImport(v => !v)} className="px-2 py-1 rounded text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 cursor-pointer flex items-center gap-1">
            <Upload size={12}/> Import JSON
          </button>
        </div>
        <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rule / website / selector"
          className={`${smallGlassInput} w-full sm:w-64`} />
      </div>

      {showAdd && (
        <form onSubmit={submitManual} className={`p-4 border-b ${t_borderLight} ${isDark ? "bg-slate-950/30" : "bg-slate-50/70"}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <label className={labelClass}>Rule name<input required value={manualForm.name} onChange={e => updateManual("name", e.target.value)} className={inputClass} placeholder="Applicant mobile number"/></label>
            <label className={labelClass}>Website / webpage<input required value={manualForm.pattern} onChange={e => updateManual("pattern", e.target.value)} className={inputClass} placeholder="example.com/path"/></label>
            <label className={labelClass}>Match mode<select value={manualForm.matchMode} onChange={e => updateManual("matchMode", e.target.value)} className={inputClass}><option value="domainPath">Domain + path contains</option><option value="domain">Exact domain</option><option value="fullUrl">Exact full URL</option></select></label>
            <label className={labelClass}>Action<select value={manualForm.action} onChange={e => updateManual("action", e.target.value)} className={inputClass}><option value="text">Text</option><option value="select">Select</option><option value="checkbox">Checkbox</option><option value="radio">Radio</option><option value="click">Click</option></select></label>
            <label className={labelClass}>Value<input value={manualForm.value} onChange={e => updateManual("value", e.target.value)} className={inputClass} placeholder="{{profile_field}} or fixed value"/></label>
            <label className={labelClass}>Selector strategy<select value={manualForm.selectorStrategy} onChange={e => updateManual("selectorStrategy", e.target.value)} className={inputClass}><option value="css">CSS</option><option value="id">ID</option><option value="name">Name</option></select></label>
            <label className={labelClass}>ID selector<input value={manualForm.selectorId} onChange={e => updateManual("selectorId", e.target.value)} className={inputClass} placeholder="mobileNo"/></label>
            <label className={labelClass}>Name selector<input value={manualForm.selectorName} onChange={e => updateManual("selectorName", e.target.value)} className={inputClass} placeholder="mobileNo"/></label>
            <label className={`${labelClass} md:col-span-2`}>CSS selector<input value={manualForm.selectorCss} onChange={e => updateManual("selectorCss", e.target.value)} className={inputClass} placeholder="#mobileNo or input[name='mobileNo']"/></label>
            <label className={`${labelClass} md:col-span-2`}>XPath note<input value={manualForm.selectorXpath} onChange={e => updateManual("selectorXpath", e.target.value)} className={inputClass} placeholder="//input[@id='mobileNo']"/></label>
            <label className={labelClass}>Initial status<select value={manualForm.status} onChange={e => updateManual("status", e.target.value)} className={inputClass}><option value="approved">Active</option><option value="rejected">Inactive</option></select></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" className={`${badgeSuccess} px-3 py-1.5 text-[11px] cursor-pointer flex items-center gap-1`}><Save size={13}/> Save field</button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded text-[11px] bg-slate-500/10 border border-slate-500/20 cursor-pointer">Cancel</button>
          </div>
        </form>
      )}

      {showImport && (
        <div className={`p-4 border-b ${t_borderLight}`}>
          <div className={`text-xs font-semibold mb-2 ${t_textHeading}`}>Import autofill JSON</div>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={12}
            className={`${smallGlassInput} w-full font-mono text-[11px] resize-y`}
          />
          <div className={`mt-1 text-[10px] ${t_textMuted}`}>Accepted format: an object with a rules array, a single rule object, or an array of rule objects.</div>
          <div className="mt-3 flex gap-2">
            <button onClick={submitImport} className={`${badgeSuccess} px-3 py-1.5 text-[11px] cursor-pointer flex items-center gap-1`}><Upload size={13}/> Import</button>
            <button onClick={() => setShowImport(false)} className="px-3 py-1.5 rounded text-[11px] bg-slate-500/10 border border-slate-500/20 cursor-pointer">Cancel</button>
          </div>
        </div>
      )}

      <div className={`px-4 pt-3 pb-0 flex items-center gap-2 border-b overflow-x-auto ${t_borderLight}`}>
        {STATUS_TABS.map(t => (
          <button key={t} className={`${tabButton(tab === t)} shrink-0`} onClick={() => { setTab(t); clearSel(); }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            <span className="ml-1 opacity-60">({t === "all" ? proposals.length : proposals.filter(p => p.status === t).length})</span>
          </button>
        ))}
      </div>

      {selCount > 0 && (
        <div className={`px-4 py-2 flex items-center gap-2 overflow-x-auto ${isDark ? "bg-violet-500/5" : "bg-violet-50/50"} border-b ${t_borderLight}`}>
          <span className={`text-xs whitespace-nowrap ${t_textMuted}`}>{selCount} selected</span>
          <button onClick={() => { handleBulkApproveAutofillProposals(selectedIds); clearSel(); }}
            className={`${badgeSuccess} flex items-center gap-1 px-2 py-1 cursor-pointer text-[10px] whitespace-nowrap`}>
            <CheckCircle2 size={12}/> Approve
          </button>
          <button onClick={() => { handleBulkRejectAutofillProposals(selectedIds); clearSel(); }}
            className="px-2 py-1 rounded text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 cursor-pointer flex items-center gap-1 whitespace-nowrap">
            <XCircle size={12}/> Reject
          </button>
          <button onClick={clearSel} className={`text-[10px] ${t_textMuted} cursor-pointer whitespace-nowrap`}>clear</button>
        </div>
      )}

      <div className="max-w-full overflow-x-auto overflow-y-auto max-h-[60vh]">
        <table className="w-full min-w-[980px] text-xs">
          <thead>
            <tr className={`border-b sticky top-0 z-10 ${t_borderLight} ${isDark ? "bg-[#020617]/95" : "bg-white/95"} backdrop-blur`}>
              <th className="p-3 w-8">
                <input type="checkbox" checked={selCount === filtered.length && filtered.length > 0}
                  onChange={e => e.target.checked ? selectAll() : clearSel()} className="rounded cursor-pointer"/>
              </th>
              {["Rule", "Website / Page", "Selectors", "Status", "Actions"].map(h => (
                <th key={h} className={`p-3 text-left font-semibold whitespace-nowrap ${t_textMuted}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const rule = parseRule(p.rule_json);
              const step = firstStep(rule);
              const pairs = selectorPairs(rule, expanded[p.id]);
              const isEdit = editing?.id === p.id;
              const isExpanded = expanded[p.id];
              const active = p.status === "approved";
              return (
                <React.Fragment key={p.id}>
                  <tr className={`border-b ${t_borderLight} ${t_rowHover} ${isEdit ? (isDark ? "bg-indigo-500/5" : "bg-indigo-50/40") : ""}`}>
                    <td className="p-3 align-top">
                      <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggleSel(p.id)} className="rounded cursor-pointer"/>
                    </td>

                    <td className="p-3 align-top min-w-[210px] max-w-[260px]">
                      <div className={`font-semibold ${t_textHeading} break-words`}>{rule ? ruleName(rule, p) : `Rule #${p.id}`}</div>
                      <div className={`mt-1 ${t_textMuted}`}>
                        <span className="font-mono">{step.action || "action"}</span>
                        <span> / </span>
                        <span className="font-mono break-all">{valuePreview(step.value)}</span>
                      </div>
                      <div className={`mt-1 text-[10px] ${t_textMuted}`}>
                        #{p.id}{p.approved_rule_id ? ` / ${p.approved_rule_id}` : ""}
                      </div>
                    </td>

                    <td className="p-3 align-top min-w-[220px] max-w-[280px]">
                      <div className={`font-mono text-[11px] break-all ${t_textMuted}`}>{rule ? ruleSite(rule) : "Invalid rule JSON"}</div>
                    </td>

                    <td className="p-3 align-top min-w-[270px] max-w-[360px]">
                      {pairs.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {pairs.slice(0, isExpanded ? undefined : 4).map(item => (
                            <span key={item.key} className={`px-1.5 py-0.5 rounded border font-mono text-[10px] break-all ${t_borderLight} ${isDark ? "bg-slate-900/70 text-slate-300" : "bg-slate-50 text-slate-700"}`}>
                              {item.label}: {item.value}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={`${t_textMuted}`}>No selector data</span>
                      )}
                      {pairs.length > 4 && (
                        <button onClick={() => toggleExpand(p.id)} className={`mt-1 flex items-center gap-0.5 ${t_textMuted} hover:text-indigo-400 cursor-pointer`}>
                          {isExpanded ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}
                          {isExpanded ? "collapse" : `+${pairs.length - 4} more selectors`}
                        </button>
                      )}
                    </td>

                    <td className="p-3 align-top whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] border ${STATUS_COLORS[p.status] || ""}`}>{p.status}</span>
                      {p.status !== "pending" && (
                        <label className={`mt-2 flex items-center gap-2 text-[11px] ${t_textMuted}`}>
                          <input type="checkbox" checked={active} onChange={e => setRuleStatus(p, e.target.checked)} className="rounded cursor-pointer"/>
                          {active ? "Active" : "Inactive"}
                        </label>
                      )}
                      <div className={`text-[10px] mt-1 ${t_textMuted}`}>{p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : p.created_at ? new Date(p.created_at).toLocaleDateString() : ""}</div>
                    </td>

                    <td className="p-3 align-top">
                      {isEdit ? (
                        <div className="flex gap-1">
                          <button onClick={saveEdit} className={iconBtn("success")}><Save size={13}/></button>
                          <button onClick={() => setEditing(null)} className={iconBtn("ghost")}><X size={13}/></button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {p.status === "pending" && (
                            <div className="flex gap-1">
                              <button onClick={() => handleApproveAutofillProposal(p.id)} title="Approve" className={iconBtn("success")}><CheckCircle2 size={13}/></button>
                              <button onClick={() => handleRejectAutofillProposal(p.id)} title="Reject" className={iconBtn("danger")}><XCircle size={13}/></button>
                            </div>
                          )}
                          <div className="flex gap-1">
                            <button onClick={() => startEdit(p)} title="Edit JSON" className={iconBtn("edit")}><Pencil size={13}/></button>
                            <button onClick={() => toggleExpand(p.id)} title="Details" className={iconBtn("ghost")}><Code2 size={13}/></button>
                            <button onClick={() => handleDeleteAutofillProposal(p.id)} title="Delete" className={iconBtn("danger")}><Trash2 size={13}/></button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                  {isEdit && (
                    <tr className={`border-b ${t_borderLight}`}>
                      <td className="p-3" />
                      <td className="p-3" colSpan={5}>
                        <textarea
                          value={editing.ruleStr}
                          onChange={e => setEditing(v => ({ ...v, ruleStr: e.target.value }))}
                          rows={7}
                          className={`${smallGlassInput} w-full font-mono text-[11px] resize-y`}
                        />
                      </td>
                    </tr>
                  )}
                  {isExpanded && !isEdit && (
                    <tr className={`border-b ${t_borderLight}`}>
                      <td className="p-3" />
                      <td className="p-3" colSpan={5}>
                        <pre className={`text-[10px] p-2 rounded-md overflow-auto max-h-64 ${isDark ? "bg-black/30 text-slate-300" : "bg-slate-50 text-slate-700"} border ${t_borderLight}`}>{p.rule_json || ""}</pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-8">
            <EmptyState icon={Inbox} title="No autofill rules found" description="Add a field, import JSON, or change the status filter." />
          </div>
        )}
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
  handleImportAutofillRules: PropTypes.func.isRequired,
};
