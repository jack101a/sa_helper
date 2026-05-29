/**
 * AutofillProposalsPanel
 * Table-style rule management with mobile horizontal scrolling.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { apiGet } from "../../api/client";
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
const ACTIONS = ["text", "select", "checkbox", "radio", "click"];
const MATCH_MODES = [
  ["domainPath", "Domain + path"],
  ["domain", "Domain"],
  ["path", "Path"],
  ["fullUrl", "Full URL"],
];
const ACCESS_SCOPES = [
  ["global", "All allowed users"],
  ["plan", "Plans"],
  ["service", "Services"],
  ["key", "API keys"],
  ["custom", "Custom"],
];
const PROFILE_SCOPE_MODES = [
  ["default", "Default"],
  ["plan", "Plan profiles"],
  ["user", "User/API key profiles"],
  ["custom", "Custom profiles"],
];

const EXAMPLE_IMPORT = `{
  "rules": [
    {
      "name": "Applicant mobile number",
      "status": "approved",
      "enabled": true,
      "rule_type": "instant",
      "site": { "match_mode": "domainPath", "pattern": "sarathi.parivahan.gov.in/sarathiservice" },
      "profile_scope": "default",
      "access_scope": "plan",
      "plans": ["STANDARD", "MAX"],
      "services": ["autofill"],
      "api_key_ids": [],
      "priority": 100,
      "execution": { "delay_ms": 100, "run_once": true, "wait_timeout_ms": 2500, "stop_on_error": false },
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
  const name = String(rule?.name || "").trim();
  if (name && !/^Autofill\s+[\w.-]+$/i.test(name)) return name;
  return smartRuleTitle(rule, row);
}

function ruleSite(rule) {
  const site = rule?.site || {};
  if (!site.pattern) return "Any configured page";
  return `${site.pattern}${site.match_mode ? ` (${site.match_mode})` : ""}`;
}

function firstStep(rule) {
  return Array.isArray(rule?.steps) && rule.steps.length ? rule.steps[0] : {};
}

function pageLabel(rule) {
  const site = rule?.site || {};
  const source = site.path || site.pattern || site.domain || "";
  const last = String(source).split(/[/?#]/).filter(Boolean).pop() || site.domain || "page";
  return last
    .replace(/\.(do|html?|xhtml|php|aspx?)$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, ch => ch.toUpperCase())
    .trim();
}

function selectorName(step) {
  const selector = step?.selector || {};
  const element = step?.element || {};
  return step?.label
    || step?.field_key
    || selector.label
    || selector.id
    || selector.name
    || element.visible_text
    || element.placeholder
    || selector.css
    || step?.action
    || "field";
}

function smartRuleTitle(rule, row) {
  const steps = Array.isArray(rule?.steps) ? rule.steps : [];
  const page = pageLabel(rule);
  if (!steps.length) return rule?.local_rule_id || row.approved_rule_id || `Rule #${row.id}`;
  const actions = steps.map(step => String(step.action || "").toLowerCase());
  const primary = selectorName(steps[0]).replace(/^#/, "").replace(/\s+/g, " ").slice(0, 44);
  if (steps.length === 1) {
    return actions[0] === "click" ? `Click ${primary} on ${page}` : `Fill ${primary} on ${page}`;
  }
  if (actions.every(action => action === "click")) return `Click flow on ${page} (${steps.length} steps)`;
  return `${rule?.rule_type === "flow" ? "Flow" : "Autofill"} ${page} (${steps.length} fields)`;
}

function rulePurpose(rule) {
  const steps = Array.isArray(rule?.steps) ? rule.steps : [];
  if (!steps.length) return "No steps configured";
  return steps.slice(0, 3).map(step => {
    const name = selectorName(step).replace(/^#/, "").slice(0, 34);
    const value = step.action === "click" ? "" : `: ${valuePreview(step.value)}`;
    return `${step.action || "step"} ${name}${value}`;
  }).join(" -> ") + (steps.length > 3 ? ` -> +${steps.length - 3} more` : "");
}

function accessSummary(rule) {
  const scope = rule?.access_scope || "global";
  if (scope === "plan") return (rule?.plans || []).length ? `Plans: ${(rule.plans || []).join(", ")}` : "Plan scoped, no plans";
  if (scope === "service") return (rule?.services || []).length ? `Services: ${(rule.services || []).join(", ")}` : "Service scoped";
  if (scope === "key") return (rule?.api_key_ids || []).length ? `Keys: ${(rule.api_key_ids || []).join(", ")}` : "Key scoped, no keys";
  if (scope === "custom") return "Custom scope";
  return "All allowed users";
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

function splitList(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  return String(value || "").split(/[,;\n]+/).map(v => v.trim()).filter(Boolean);
}

function splitNumberList(value) {
  return splitList(value).map(v => Number(v)).filter(Number.isFinite);
}

function joinList(value) {
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string" && value.trim() === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }));
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function defaultStep(index = 0) {
  return {
    order: index + 1,
    field_key: "",
    label: "",
    action: "text",
    value: "",
    required: true,
    delay_ms: "",
    timeout_ms: "",
    strategy: "css",
    primary: "css",
    id: "",
    name: "",
    css: "",
    xpath: "",
    confidence: "",
    tag: "",
    type: "",
    placeholder: "",
    aria_label: "",
  };
}

function normalizeStep(step, index = 0) {
  const selector = step?.selector || {};
  const element = step?.element || {};
  const runtime = step?.runtime || {};
  return {
    ...defaultStep(index),
    originalStep: step && typeof step === "object" ? step : {},
    order: numberOr(step?.order, index + 1),
    field_key: step?.field_key || step?.field || "",
    label: step?.label || selector.label || element.label || "",
    action: step?.action || "text",
    value: step?.value ?? "",
    required: step?.required !== false,
    delay_ms: step?.delay_ms ?? "",
    timeout_ms: step?.timeout_ms ?? "",
    strategy: selector.strategy || "css",
    primary: selector.primary || selector.strategy || "css",
    id: selector.id || selector.element_id || element.id || "",
    name: selector.name || element.name || "",
    css: selector.css || "",
    xpath: selector.xpath || "",
    confidence: selector.confidence ?? "",
    tag: element.tag || runtime.tag || "",
    type: element.type || runtime.type || "",
    placeholder: element.placeholder || runtime.placeholder || "",
    aria_label: element.aria_label || element.ariaLabel || runtime.aria_label || "",
  };
}

function profileScopeToDraft(profileScope) {
  if (!profileScope || typeof profileScope === "string") {
    return {
      profileScopeMode: profileScope && profileScope !== "default" ? "custom" : "default",
      profileScopePlans: [],
      profileScopeUsers: "",
      profileScopeIds: profileScope && profileScope !== "default" ? String(profileScope) : "",
    };
  }
  return {
    profileScopeMode: profileScope.mode || profileScope.scope || "custom",
    profileScopePlans: splitList(profileScope.plans || profileScope.plan_names),
    profileScopeUsers: joinList(profileScope.users || profileScope.user_ids || profileScope.api_key_ids),
    profileScopeIds: joinList(profileScope.profile_ids || profileScope.profiles || profileScope.ids),
  };
}

function ruleToForm(row) {
  const rule = parseRule(row.rule_json) || {};
  const site = rule.site || {};
  const execution = rule.execution || {};
  return {
    originalRule: rule,
    name: rule.name || rule.local_rule_id || `Rule #${row.id}`,
    status: rule.status || row.status || "pending",
    enabled: rule.enabled !== false,
    ruleType: rule.rule_type || execution.mode || "instant",
    matchMode: site.match_mode || "domainPath",
    pattern: site.pattern || "",
    domain: site.domain || "",
    path: site.path || "",
    accessScope: rule.access_scope || rule.accessScope || "global",
    plans: splitList(rule.plans || rule.plan_names || rule.allowed_plans),
    services: splitList(rule.services || rule.service || ["autofill"]),
    apiKeyIds: joinList(rule.api_key_ids || rule.apiKeyIds || rule.allowed_api_key_ids),
    priority: rule.priority ?? 100,
    delayMs: execution.delay_ms ?? (rule.rule_type === "flow" ? 150 : 100),
    waitTimeoutMs: execution.wait_timeout_ms ?? (rule.rule_type === "flow" ? 5000 : 2500),
    stopOnError: execution.stop_on_error ?? rule.rule_type === "flow",
    steps: Array.isArray(rule.steps) && rule.steps.length ? rule.steps.map(normalizeStep) : [defaultStep(0)],
    ...profileScopeToDraft(rule.profile_scope),
  };
}

function stepToRule(step, index) {
  const original = step.originalStep || {};
  const originalSelector = original.selector || {};
  const originalElement = original.element || {};
  const originalRuntime = original.runtime || {};
  return compactObject({
    ...original,
    order: numberOr(step.order, index + 1),
    field_key: step.field_key,
    label: step.label,
    action: step.action || "text",
    value: step.action === "click" ? "" : step.value,
    selector: compactObject({
      ...originalSelector,
      strategy: step.strategy || "css",
      primary: step.primary || step.strategy || "css",
      id: step.id,
      name: step.name,
      css: step.css,
      xpath: step.xpath,
      element_id: step.id,
      label: step.label,
      confidence: step.confidence === "" ? undefined : Number(step.confidence),
    }),
    element: compactObject({
      ...originalElement,
      id: step.id,
      name: step.name,
      tag: step.tag,
      type: step.type,
      placeholder: step.placeholder,
      aria_label: step.aria_label,
    }),
    runtime: compactObject({ ...originalRuntime, tag: step.tag, type: step.type, placeholder: step.placeholder }),
    delay_ms: step.delay_ms === "" ? undefined : numberOr(step.delay_ms, 0),
    timeout_ms: step.timeout_ms === "" ? undefined : numberOr(step.timeout_ms, 0),
    required: step.required !== false,
  });
}

function formToRule(form) {
  const original = form.originalRule || {};
  const accessScope = form.accessScope || "global";
  const profileScope = form.profileScopeMode === "default"
    ? "default"
    : compactObject({
        mode: form.profileScopeMode,
        plans: ["plan", "custom"].includes(form.profileScopeMode) ? form.profileScopePlans : [],
        users: ["user", "custom"].includes(form.profileScopeMode) ? splitList(form.profileScopeUsers) : [],
        profile_ids: form.profileScopeMode === "custom" ? splitList(form.profileScopeIds) : [],
      });
  const pattern = form.pattern.trim() || [form.domain, form.path].filter(Boolean).join("") || original.site?.pattern || "*";
  return {
    ...original,
    local_rule_id: original.local_rule_id || `admin_${Date.now()}`,
    name: form.name.trim() || "Autofill rule",
    status: form.status,
    enabled: form.enabled !== false,
    rule_type: form.ruleType || "instant",
    site: compactObject({ ...(original.site || {}), match_mode: form.matchMode, pattern, domain: form.domain, path: form.path }),
    profile_scope: profileScope,
    frame_path: original.frame_path || "any",
    priority: numberOr(form.priority, 100),
    access_scope: accessScope,
    plans: ["plan", "custom"].includes(accessScope) ? form.plans : [],
    services: ["service", "custom"].includes(accessScope) ? form.services : accessScope === "global" ? ["autofill"] : [],
    api_key_ids: ["key", "custom"].includes(accessScope) ? splitNumberList(form.apiKeyIds) : [],
    execution: {
      ...(original.execution || {}),
      mode: form.ruleType || "instant",
      delay_ms: numberOr(form.delayMs, form.ruleType === "flow" ? 150 : 100),
      run_once: true,
      wait_timeout_ms: numberOr(form.waitTimeoutMs, form.ruleType === "flow" ? 5000 : 2500),
      stop_on_error: Boolean(form.stopOnError),
    },
    steps: form.steps.map(stepToRule),
    meta: { ...(original.meta || {}), updated_from: "admin_ui", updated_at: new Date().toISOString() },
  };
}

function toggleArrayValue(list, value) {
  const current = Array.isArray(list) ? list : [];
  return current.includes(value) ? current.filter(item => item !== value) : [...current, value];
}

function buildManualRule(form) {
  const profileScope = form.profileScopeMode === "default"
    ? "default"
    : compactObject({
        mode: form.profileScopeMode,
        plans: ["plan", "custom"].includes(form.profileScopeMode) ? splitList(form.profileScopePlans) : [],
        users: ["user", "custom"].includes(form.profileScopeMode) ? splitList(form.profileScopeUsers) : [],
        profile_ids: form.profileScopeMode === "custom" ? splitList(form.profileScopeIds) : [],
      });
  const selector = compactObject({
    strategy: form.selectorStrategy,
    primary: form.selectorPrimary || form.selectorStrategy,
    id: form.selectorId.trim(),
    name: form.selectorName.trim(),
    css: form.selectorCss.trim(),
    xpath: form.selectorXpath.trim(),
    element_id: form.selectorId.trim(),
    label: form.label?.trim(),
    confidence: form.selectorConfidence === "" ? undefined : Number(form.selectorConfidence),
  });
  const pattern = form.pattern.trim() || [form.domain?.trim(), form.path?.trim()].filter(Boolean).join("") || "*";
  return {
    local_rule_id: `admin_${Date.now()}`,
    name: form.name.trim(),
    status: form.status,
    enabled: true,
    rule_type: form.ruleType,
    site: compactObject({ match_mode: form.matchMode, pattern, domain: form.domain?.trim(), path: form.path?.trim() }),
    profile_scope: profileScope,
    frame_path: "any",
    priority: Number(form.priority) || 100,
    access_scope: form.accessScope,
    plans: ["plan", "custom"].includes(form.accessScope) ? splitList(form.plans) : [],
    services: ["service", "custom", "global"].includes(form.accessScope) ? splitList(form.services) : [],
    api_key_ids: ["key", "custom"].includes(form.accessScope) ? splitNumberList(form.apiKeyIds) : [],
    execution: {
      delay_ms: Number(form.delayMs) || (form.ruleType === "flow" ? 150 : 100),
      run_once: true,
      wait_timeout_ms: Number(form.waitTimeoutMs) || (form.ruleType === "flow" ? 5000 : 2500),
      stop_on_error: form.ruleType === "flow",
    },
    steps: [{
      order: 1,
      field_key: form.fieldKey?.trim(),
      label: form.label?.trim(),
      action: form.action,
      value: form.action === "click" ? "" : form.value,
      selector,
      element: compactObject({ id: form.selectorId.trim(), name: form.selectorName.trim() }),
      delay_ms: Number(form.delayMs) || (form.ruleType === "flow" ? 150 : 100),
      timeout_ms: Number(form.waitTimeoutMs) || (form.ruleType === "flow" ? 5000 : 2500),
      required: true,
    }],
    meta: { created_from: "admin_ui", created_at: new Date().toISOString() },
  };
}

const defaultManualForm = {
  name: "",
  fieldKey: "",
  label: "",
  domain: "",
  path: "",
  pattern: "",
  matchMode: "domainPath",
  profileScopeMode: "default",
  profileScopePlans: "",
  profileScopeUsers: "",
  profileScopeIds: "",
  priority: 100,
  ruleType: "instant",
  action: "text",
  value: "",
  accessScope: "global",
  plans: "",
  services: "autofill",
  apiKeyIds: "",
  delayMs: 100,
  waitTimeoutMs: 2500,
  selectorStrategy: "css",
  selectorPrimary: "css",
  selectorId: "",
  selectorName: "",
  selectorCss: "",
  selectorXpath: "",
  selectorConfidence: "",
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
  const [availablePlans, setAvailablePlans] = useState([]);
  const searchRef = useRef(null);

  useEffect(() => {
    apiGet("/admin/api/plans")
      .then(data => setAvailablePlans(Array.isArray(data.plans) ? data.plans : []))
      .catch(() => setAvailablePlans([]));
  }, []);

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
  const activePlans = useMemo(() => availablePlans.filter(plan => plan.is_active !== false), [availablePlans]);
  const serviceOptions = useMemo(() => {
    const names = new Set(["autofill", "captcha", "solver", "exam"]);
    activePlans.forEach(plan => {
      Object.entries(plan.allowed_services || {}).forEach(([name, enabled]) => {
        if (enabled !== false && name) names.add(name);
      });
    });
    return Array.from(names).sort();
  }, [activePlans]);

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
  const startEdit = (p) => setEditing({ id: p.id, draft: ruleToForm(p), rawMode: false, rawText: p.rule_json || "{}" });
  const updateManual = (key, value) => setManualForm(prev => ({ ...prev, [key]: value }));
  const updateDraft = (key, value) => setEditing(prev => ({ ...prev, draft: { ...prev.draft, [key]: value } }));
  const updateDraftArray = (key, value) => setEditing(prev => ({
    ...prev,
    draft: { ...prev.draft, [key]: toggleArrayValue(prev.draft[key], value) },
  }));
  const updateStep = (index, key, value) => setEditing(prev => ({
    ...prev,
    draft: {
      ...prev.draft,
      steps: prev.draft.steps.map((step, i) => i === index ? { ...step, [key]: value } : step),
    },
  }));
  const addStep = () => setEditing(prev => ({
    ...prev,
    draft: { ...prev.draft, steps: [...prev.draft.steps, defaultStep(prev.draft.steps.length)] },
  }));
  const removeStep = (index) => setEditing(prev => ({
    ...prev,
    draft: {
      ...prev.draft,
      steps: prev.draft.steps.filter((_, i) => i !== index).map((step, i) => ({ ...step, order: i + 1 })),
    },
  }));

  const submitManual = async (event) => {
    event.preventDefault();
    if (!manualForm.name.trim()) return;
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
    let rule;
    if (editing.rawMode) {
      try { rule = JSON.parse(editing.rawText); } catch { alert("Invalid JSON."); return; }
    } else {
      if (!editing.draft.name.trim()) { alert("Rule name is required."); return; }
      if (!editing.draft.steps.length) { alert("Add at least one step."); return; }
      const invalidStep = editing.draft.steps.find(step => !step.css && !step.xpath && !step.id && !step.name);
      if (invalidStep) { alert("Each step needs CSS, XPath, ID, or Name selector."); return; }
      rule = formToRule(editing.draft);
    }
    const ok = await handleEditAutofillProposal(editing.id, {
      rule_json: JSON.stringify(rule),
      status: rule.status || editing.draft?.status,
    });
    if (ok) setEditing(null);
  };

  const setRuleStatus = async (row, active) => {
    const nextStatus = active ? "approved" : "rejected";
    const rule = parseRule(row.rule_json);
    const patch = { status: nextStatus };
    if (rule) patch.rule_json = JSON.stringify({ ...rule, status: nextStatus, enabled: active });
    await handleEditAutofillProposal(row.id, patch);
  };

  const patchRuleJson = async (row, updates) => {
    const rule = parseRule(row.rule_json);
    if (!rule) return;
    await handleEditAutofillProposal(row.id, { rule_json: JSON.stringify({ ...rule, ...updates }) });
  };
  const patchRuleAccess = async (row, updates) => {
    const rule = parseRule(row.rule_json);
    if (!rule) return;
    await handleEditAutofillProposal(row.id, {
      rule_json: JSON.stringify({
        ...rule,
        ...updates,
        meta: { ...(rule.meta || {}), access_updated_at: new Date().toISOString(), access_updated_from: "admin_quick_edit" },
      }),
    });
  };

  const inputClass = `${smallGlassInput} w-full`;
  const labelClass = `text-[11px] font-medium ${t_textMuted}`;
  const chipClass = (selectedChip) => `px-2 py-1 rounded-full border text-[10px] cursor-pointer transition ${selectedChip ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : `${t_borderLight} ${t_textMuted}`}`;

  return (
    <div className={`rounded-2xl overflow-hidden ${glassPanel}`}>
      <div className={`p-4 border-b flex flex-wrap items-center gap-3 ${t_borderLight}`}>
        <div className="p-2 bg-violet-500/20 text-violet-400 rounded-lg"><Zap size={18}/></div>
        <div className="flex-1 min-w-0">
          <h2 className={`text-base font-semibold ${t_textHeading}`}>
            Autofill Rules
            {pendingCount > 0 && <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">{pendingCount} pending</span>}
          </h2>
          <p className={`text-[11px] ${t_textMuted}`}>Edit fields, selectors, flow steps, access scope, and profile sync without touching raw JSON</p>
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
            <label className={labelClass}>Field key<input value={manualForm.fieldKey} onChange={e => updateManual("fieldKey", e.target.value)} className={inputClass} placeholder="mobile"/></label>
            <label className={labelClass}>Field label<input value={manualForm.label} onChange={e => updateManual("label", e.target.value)} className={inputClass} placeholder="Mobile number"/></label>
            <label className={labelClass}>Domain<input value={manualForm.domain} onChange={e => updateManual("domain", e.target.value)} className={inputClass} placeholder="sarathi.parivahan.gov.in"/></label>
            <label className={labelClass}>Path<input value={manualForm.path} onChange={e => updateManual("path", e.target.value)} className={inputClass} placeholder="/sarathiservice"/></label>
            <label className={labelClass}>Website pattern<input value={manualForm.pattern} onChange={e => updateManual("pattern", e.target.value)} className={inputClass} placeholder="example.com/path"/></label>
            <label className={labelClass}>Match mode<select value={manualForm.matchMode} onChange={e => updateManual("matchMode", e.target.value)} className={inputClass}>{MATCH_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={labelClass}>Rule type<select value={manualForm.ruleType} onChange={e => updateManual("ruleType", e.target.value)} className={inputClass}><option value="instant">Instant fill</option><option value="flow">Flow / ordered steps</option></select></label>
            <label className={labelClass}>Action<select value={manualForm.action} onChange={e => updateManual("action", e.target.value)} className={inputClass}><option value="text">Text</option><option value="select">Select</option><option value="checkbox">Checkbox</option><option value="radio">Radio</option><option value="click">Click</option></select></label>
            <label className={labelClass}>Value<input value={manualForm.value} onChange={e => updateManual("value", e.target.value)} className={inputClass} placeholder="{{profile_field}} or fixed value"/></label>
            <label className={labelClass}>Access<select value={manualForm.accessScope} onChange={e => updateManual("accessScope", e.target.value)} className={inputClass}><option value="global">Global</option><option value="plan">Plan</option><option value="service">Service</option><option value="key">API key IDs</option><option value="custom">Custom</option></select></label>
            <label className={labelClass}>Plans<input value={manualForm.plans} onChange={e => updateManual("plans", e.target.value)} className={inputClass} placeholder="STANDARD, MAX"/></label>
            <label className={labelClass}>Services<input value={manualForm.services} onChange={e => updateManual("services", e.target.value)} className={inputClass} placeholder="autofill"/></label>
            <label className={labelClass}>API key IDs<input value={manualForm.apiKeyIds} onChange={e => updateManual("apiKeyIds", e.target.value)} className={inputClass} placeholder="12, 15"/></label>
            <label className={labelClass}>Delay ms<input type="number" min="0" value={manualForm.delayMs} onChange={e => updateManual("delayMs", e.target.value)} className={inputClass}/></label>
            <label className={labelClass}>Wait timeout ms<input type="number" min="250" value={manualForm.waitTimeoutMs} onChange={e => updateManual("waitTimeoutMs", e.target.value)} className={inputClass}/></label>
            <label className={labelClass}>Selector strategy<select value={manualForm.selectorStrategy} onChange={e => updateManual("selectorStrategy", e.target.value)} className={inputClass}><option value="css">CSS</option><option value="id">ID</option><option value="name">Name</option><option value="xpath">XPath</option></select></label>
            <label className={labelClass}>Primary selector<select value={manualForm.selectorPrimary} onChange={e => updateManual("selectorPrimary", e.target.value)} className={inputClass}><option value="css">CSS</option><option value="id">ID</option><option value="name">Name</option><option value="xpath">XPath</option></select></label>
            <label className={labelClass}>ID selector<input value={manualForm.selectorId} onChange={e => updateManual("selectorId", e.target.value)} className={inputClass} placeholder="mobileNo"/></label>
            <label className={labelClass}>Name selector<input value={manualForm.selectorName} onChange={e => updateManual("selectorName", e.target.value)} className={inputClass} placeholder="mobileNo"/></label>
            <label className={`${labelClass} md:col-span-2`}>CSS selector<input value={manualForm.selectorCss} onChange={e => updateManual("selectorCss", e.target.value)} className={inputClass} placeholder="#mobileNo or input[name='mobileNo']"/></label>
            <label className={`${labelClass} md:col-span-2`}>XPath<input value={manualForm.selectorXpath} onChange={e => updateManual("selectorXpath", e.target.value)} className={inputClass} placeholder="//input[@id='mobileNo']"/></label>
            <label className={labelClass}>Confidence<input type="number" min="0" max="100" step="1" value={manualForm.selectorConfidence} onChange={e => updateManual("selectorConfidence", e.target.value)} className={inputClass} placeholder="95"/></label>
            <label className={labelClass}>Initial status<select value={manualForm.status} onChange={e => updateManual("status", e.target.value)} className={inputClass}><option value="approved">Active</option><option value="rejected">Inactive</option></select></label>
            <label className={labelClass}>Profile scope<select value={manualForm.profileScopeMode} onChange={e => updateManual("profileScopeMode", e.target.value)} className={inputClass}>{PROFILE_SCOPE_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={labelClass}>Profile plans<input value={manualForm.profileScopePlans} onChange={e => updateManual("profileScopePlans", e.target.value)} className={inputClass} placeholder="STANDARD, MAX"/></label>
            <label className={labelClass}>Profile users<input value={manualForm.profileScopeUsers} onChange={e => updateManual("profileScopeUsers", e.target.value)} className={inputClass} placeholder="user/api key IDs"/></label>
            <label className={labelClass}>Profile IDs<input value={manualForm.profileScopeIds} onChange={e => updateManual("profileScopeIds", e.target.value)} className={inputClass} placeholder="default, office"/></label>
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
                        <span className="break-words">{rule ? rulePurpose(rule) : "Invalid rule JSON"}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] ${t_borderLight}`}>{rule?.rule_type || "instant"}</span>
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] ${t_borderLight}`}>{rule?.access_scope || "global"}</span>
                        {(rule?.plans || []).slice(0, 3).map(plan => (
                          <span key={plan} className={`px-1.5 py-0.5 rounded border text-[10px] ${t_borderLight}`}>{plan}</span>
                        ))}
                      </div>
                      <div className={`mt-1 text-[10px] ${t_textMuted}`}>
                        #{p.id}{p.approved_rule_id ? ` / ${p.approved_rule_id}` : ""}
                      </div>
                    </td>

                    <td className="p-3 align-top min-w-[220px] max-w-[280px]">
                      <div className={`font-mono text-[11px] break-all ${t_textMuted}`}>{rule ? ruleSite(rule) : "Invalid rule JSON"}</div>
                      {rule && <div className={`mt-2 text-[11px] ${t_textMuted}`}>{accessSummary(rule)}</div>}
                      {rule && (
                        <div className="mt-2 space-y-2">
                          <select
                            value={rule.access_scope || "global"}
                            onChange={e => {
                              const nextScope = e.target.value;
                              patchRuleAccess(p, {
                                access_scope: nextScope,
                                plans: ["plan", "custom"].includes(nextScope) ? (rule.plans || []) : [],
                                services: ["service", "custom"].includes(nextScope) ? ((rule.services || []).length ? rule.services : ["autofill"]) : nextScope === "global" ? ["autofill"] : [],
                                api_key_ids: ["key", "custom"].includes(nextScope) ? (rule.api_key_ids || []) : [],
                              });
                            }}
                            className={`${smallGlassInput} w-full text-[11px]`}
                          >
                            <option value="global">All users</option>
                            <option value="plan">Plans only</option>
                            <option value="service">Services only</option>
                            <option value="key">API keys</option>
                            <option value="custom">Custom</option>
                          </select>
                          {["plan", "custom"].includes(rule.access_scope || "global") && (
                            <div className="flex flex-wrap gap-1">
                              {activePlans.map(plan => {
                                const selectedPlan = (rule.plans || []).includes(plan.name);
                                return (
                                  <button
                                    key={plan.id || plan.name}
                                    type="button"
                                    onClick={() => patchRuleAccess(p, { plans: toggleArrayValue(rule.plans || [], plan.name) })}
                                    className={chipClass(selectedPlan)}
                                  >
                                    {plan.name}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
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
                      {rule && (
                        <select
                          value={rule.rule_type || "instant"}
                          onChange={e => patchRuleJson(p, {
                            rule_type: e.target.value,
                            execution: {
                              ...(rule.execution || {}),
                              delay_ms: e.target.value === "flow" ? 150 : 100,
                              wait_timeout_ms: e.target.value === "flow" ? 5000 : 2500,
                              stop_on_error: e.target.value === "flow",
                            },
                          })}
                          className={`${smallGlassInput} mt-2 w-28 text-[11px]`}
                        >
                          <option value="instant">Instant</option>
                          <option value="flow">Flow</option>
                        </select>
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
                        <div className={`rounded-xl border p-3 space-y-4 ${t_borderLight} ${isDark ? "bg-slate-950/40" : "bg-white/70"}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className={`text-sm font-semibold ${t_textHeading}`}>Edit autofill rule</div>
                              <div className={`text-[11px] ${t_textMuted}`}>Use normal fields for admin edits; raw JSON stays available for advanced fixes.</div>
                            </div>
                            <label className={`flex items-center gap-2 text-[11px] ${t_textMuted}`}>
                              <input
                                type="checkbox"
                                checked={editing.rawMode}
                                onChange={e => setEditing(prev => ({
                                  ...prev,
                                  rawMode: e.target.checked,
                                  rawText: e.target.checked ? JSON.stringify(formToRule(prev.draft), null, 2) : prev.rawText,
                                }))}
                                className="rounded cursor-pointer"
                              />
                              Advanced raw JSON
                            </label>
                          </div>

                          {editing.rawMode ? (
                            <textarea
                              value={editing.rawText}
                              onChange={e => setEditing(v => ({ ...v, rawText: e.target.value }))}
                              rows={14}
                              className={`${smallGlassInput} w-full font-mono text-[11px] resize-y`}
                            />
                          ) : (
                            <>
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                <label className={labelClass}>Rule name<input value={editing.draft.name} onChange={e => updateDraft("name", e.target.value)} className={inputClass}/></label>
                                <label className={labelClass}>Status<select value={editing.draft.status} onChange={e => updateDraft("status", e.target.value)} className={inputClass}><option value="pending">Pending</option><option value="approved">Active</option><option value="rejected">Inactive</option></select></label>
                                <label className={labelClass}>Enabled<select value={editing.draft.enabled ? "yes" : "no"} onChange={e => updateDraft("enabled", e.target.value === "yes")} className={inputClass}><option value="yes">Enabled</option><option value="no">Disabled</option></select></label>
                                <label className={labelClass}>Type<select value={editing.draft.ruleType} onChange={e => updateDraft("ruleType", e.target.value)} className={inputClass}><option value="instant">Instant</option><option value="flow">Step-by-step flow</option></select></label>
                                <label className={labelClass}>Domain<input value={editing.draft.domain} onChange={e => updateDraft("domain", e.target.value)} className={inputClass} placeholder="sarathi.parivahan.gov.in"/></label>
                                <label className={labelClass}>Path<input value={editing.draft.path} onChange={e => updateDraft("path", e.target.value)} className={inputClass} placeholder="/sarathiservice"/></label>
                                <label className={`${labelClass} md:col-span-2`}>Pattern<input value={editing.draft.pattern} onChange={e => updateDraft("pattern", e.target.value)} className={inputClass} placeholder="Optional fallback pattern"/></label>
                                <label className={labelClass}>Match mode<select value={editing.draft.matchMode} onChange={e => updateDraft("matchMode", e.target.value)} className={inputClass}>{MATCH_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                                <label className={labelClass}>Priority<input type="number" value={editing.draft.priority} onChange={e => updateDraft("priority", e.target.value)} className={inputClass}/></label>
                                <label className={labelClass}>Delay ms<input type="number" min="0" value={editing.draft.delayMs} onChange={e => updateDraft("delayMs", e.target.value)} className={inputClass}/></label>
                                <label className={labelClass}>Wait timeout ms<input type="number" min="250" value={editing.draft.waitTimeoutMs} onChange={e => updateDraft("waitTimeoutMs", e.target.value)} className={inputClass}/></label>
                                <label className={labelClass}>Stop on error<select value={editing.draft.stopOnError ? "yes" : "no"} onChange={e => updateDraft("stopOnError", e.target.value === "yes")} className={inputClass}><option value="no">Continue</option><option value="yes">Stop flow</option></select></label>
                                <label className={labelClass}>Access scope<select value={editing.draft.accessScope} onChange={e => updateDraft("accessScope", e.target.value)} className={inputClass}>{ACCESS_SCOPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                                <label className={labelClass}>API key IDs<input value={editing.draft.apiKeyIds} onChange={e => updateDraft("apiKeyIds", e.target.value)} className={inputClass} placeholder="12, 15"/></label>
                                <label className={labelClass}>Profile scope<select value={editing.draft.profileScopeMode} onChange={e => updateDraft("profileScopeMode", e.target.value)} className={inputClass}>{PROFILE_SCOPE_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                                <label className={labelClass}>Profile users<input value={editing.draft.profileScopeUsers} onChange={e => updateDraft("profileScopeUsers", e.target.value)} className={inputClass} placeholder="user/api key IDs"/></label>
                                <label className={`${labelClass} md:col-span-2`}>Custom profile IDs<input value={editing.draft.profileScopeIds} onChange={e => updateDraft("profileScopeIds", e.target.value)} className={inputClass} placeholder="default, office, agent-7"/></label>
                              </div>

                              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                                <div className={`rounded-lg border p-3 ${t_borderLight}`}>
                                  <div className={`text-[11px] font-semibold mb-2 ${t_textHeading}`}>Plan access</div>
                                  <div className="flex flex-wrap gap-2">
                                    {activePlans.map(plan => (
                                      <button key={plan.id || plan.name} type="button" onClick={() => updateDraftArray("plans", plan.name)} className={chipClass((editing.draft.plans || []).includes(plan.name))}>{plan.name}</button>
                                    ))}
                                    {!activePlans.length && <span className={`text-[11px] ${t_textMuted}`}>No plans loaded.</span>}
                                  </div>
                                </div>
                                <div className={`rounded-lg border p-3 ${t_borderLight}`}>
                                  <div className={`text-[11px] font-semibold mb-2 ${t_textHeading}`}>Service access</div>
                                  <div className="flex flex-wrap gap-2">
                                    {serviceOptions.map(service => (
                                      <button key={service} type="button" onClick={() => updateDraftArray("services", service)} className={chipClass((editing.draft.services || []).includes(service))}>{service}</button>
                                    ))}
                                  </div>
                                </div>
                                <div className={`rounded-lg border p-3 ${t_borderLight}`}>
                                  <div className={`text-[11px] font-semibold mb-2 ${t_textHeading}`}>Profile sync plans</div>
                                  <div className="flex flex-wrap gap-2">
                                    {activePlans.map(plan => (
                                      <button key={plan.id || plan.name} type="button" onClick={() => updateDraftArray("profileScopePlans", plan.name)} className={chipClass((editing.draft.profileScopePlans || []).includes(plan.name))}>{plan.name}</button>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div className={`text-[11px] font-semibold ${t_textHeading}`}>Fields, flow steps, and selectors</div>
                                  <button type="button" onClick={addStep} className={`${badgeSuccess} px-2 py-1 text-[10px] cursor-pointer flex items-center gap-1`}><Plus size={12}/> Add step</button>
                                </div>
                                {editing.draft.steps.map((draftStep, index) => (
                                  <div key={index} className={`rounded-lg border p-3 ${t_borderLight} ${isDark ? "bg-black/10" : "bg-slate-50/70"}`}>
                                    <div className="flex items-center justify-between mb-3">
                                      <span className={`text-[11px] font-semibold ${t_textHeading}`}>Step {index + 1}</span>
                                      <button type="button" onClick={() => removeStep(index)} disabled={editing.draft.steps.length === 1} className={`${iconBtn("danger")} disabled:opacity-40`} title="Remove step"><Trash2 size={12}/></button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                      <label className={labelClass}>Order<input type="number" min="1" value={draftStep.order} onChange={e => updateStep(index, "order", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>Field key<input value={draftStep.field_key} onChange={e => updateStep(index, "field_key", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>Field label<input value={draftStep.label} onChange={e => updateStep(index, "label", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>Action<select value={draftStep.action} onChange={e => updateStep(index, "action", e.target.value)} className={inputClass}>{ACTIONS.map(action => <option key={action} value={action}>{action}</option>)}</select></label>
                                      <label className={`${labelClass} md:col-span-2`}>Value<input value={draftStep.value} onChange={e => updateStep(index, "value", e.target.value)} className={inputClass} placeholder="{{profile_field}} or fixed value"/></label>
                                      <label className={labelClass}>Required<select value={draftStep.required ? "yes" : "no"} onChange={e => updateStep(index, "required", e.target.value === "yes")} className={inputClass}><option value="yes">Required</option><option value="no">Optional</option></select></label>
                                      <label className={labelClass}>Primary<select value={draftStep.primary} onChange={e => updateStep(index, "primary", e.target.value)} className={inputClass}><option value="css">CSS</option><option value="id">ID</option><option value="name">Name</option><option value="xpath">XPath</option></select></label>
                                      <label className={labelClass}>Strategy<select value={draftStep.strategy} onChange={e => updateStep(index, "strategy", e.target.value)} className={inputClass}><option value="css">CSS</option><option value="id">ID</option><option value="name">Name</option><option value="xpath">XPath</option></select></label>
                                      <label className={labelClass}>Element ID<input value={draftStep.id} onChange={e => updateStep(index, "id", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>Element name<input value={draftStep.name} onChange={e => updateStep(index, "name", e.target.value)} className={inputClass}/></label>
                                      <label className={`${labelClass} md:col-span-2`}>CSS selector<input value={draftStep.css} onChange={e => updateStep(index, "css", e.target.value)} className={inputClass}/></label>
                                      <label className={`${labelClass} md:col-span-2`}>XPath<input value={draftStep.xpath} onChange={e => updateStep(index, "xpath", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>Tag<input value={draftStep.tag} onChange={e => updateStep(index, "tag", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>Type<input value={draftStep.type} onChange={e => updateStep(index, "type", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>Placeholder<input value={draftStep.placeholder} onChange={e => updateStep(index, "placeholder", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>ARIA label<input value={draftStep.aria_label} onChange={e => updateStep(index, "aria_label", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>Confidence<input type="number" min="0" max="100" step="1" value={draftStep.confidence} onChange={e => updateStep(index, "confidence", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>Step delay<input type="number" min="0" value={draftStep.delay_ms} onChange={e => updateStep(index, "delay_ms", e.target.value)} className={inputClass}/></label>
                                      <label className={labelClass}>Step timeout<input type="number" min="0" value={draftStep.timeout_ms} onChange={e => updateStep(index, "timeout_ms", e.target.value)} className={inputClass}/></label>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
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
