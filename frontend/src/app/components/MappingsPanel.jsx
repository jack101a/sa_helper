import React, { useEffect } from "react";
import PropTypes from "prop-types";
import { Database, Inbox } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { EmptyState } from "./EmptyState";

export function MappingsPanel({
  mappingsByDomain,
  models,
  editingMappingId,
  editingMappingDraft,
  setEditingMappingDraft,
  assigningDomainDraft,
  setAssigningDomainDraft,
  handleSaveMapping,
  handleRemoveMapping,
  handleTestMapping,
  beginEditMapping,
  cancelEditMapping,
  handleSaveMappingEdit,
  beginAssignDomainModel,
  cancelAssignDomainModel,
  handleSaveDomainModelAssign,
}) {
  const { isDark, t_textHeading, t_textMuted, t_borderLight, t_rowHover, glassPanel, glassButton, glassInput, solidButton } = useThemeContext();

  useEffect(() => {
    if (editingMappingId === null && assigningDomainDraft === null) return;
    const onBefore = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [editingMappingId, assigningDomainDraft]);

  return (
    <div className={`rounded-2xl transition-colors duration-500 overflow-hidden ${glassPanel}`}>
      <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
        <div className="p-2 bg-cyan-500/20 text-cyan-500 rounded-lg backdrop-blur-md"><Database size={20}/></div>
        <div>
          <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Domain Mapping</h2>
          <p className={`text-[11px] ${t_textMuted}`}>Map domains to AI models & selectors</p>
        </div>
      </div>
      <div className="p-5">
        <div className="overflow-x-auto max-h-64 mb-6 pr-2 custom-scrollbar">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead>
              <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                <th className="pb-3 font-medium pr-4">Routing Logic</th>
                <th className="pb-3 font-medium px-4">Selectors (Src -&gt; Tgt)</th>
                <th className="pb-3 text-right font-medium pl-4">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${t_borderLight}`}>
              {mappingsByDomain.map(([domain, domainMappings]) => (
                <React.Fragment key={domain}>
                  <tr className={isDark ? "bg-white/[0.03]" : "bg-black/[0.03]"}>
                    <td colSpan={3} className="py-2 px-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className={`font-mono text-xs ${t_textHeading}`}>{domain}</div>
                        <div className={`text-[10px] ${t_textMuted}`}>{domainMappings.length} route(s)</div>
                        {assigningDomainDraft?.domain === domain ? (
                            <form onSubmit={handleSaveDomainModelAssign} className="flex flex-wrap items-center gap-2">
                              <select
                                className={`h-7 px-2 rounded-md text-xs ${isDark ? 'bg-black/20 border border-white/10 text-white' : 'bg-white border border-slate-300 text-slate-800'}`}
                                value={String(assigningDomainDraft.ai_model_id)}
                                onChange={(e) => setAssigningDomainDraft((prev) => ({ ...prev, ai_model_id: Number(e.target.value) }))}
                                required
                              >
                                <option value="" disabled>Select model</option>
                                {models.map((m) => (
                                  <option key={m.id} value={m.id}>{m.ai_model_name} ({m.task_type})</option>
                                ))}
                              </select>
                              <button type="button" onClick={cancelAssignDomainModel} className={`text-[11px] px-2 py-1 rounded border ${isDark ? 'border-white/20 text-slate-300 hover:bg-white/10' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}>Cancel</button>
                              <button type="submit" className={`text-[11px] px-2 py-1 rounded border font-medium ${isDark ? 'border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10' : 'border-indigo-400 text-indigo-600 bg-indigo-50 hover:bg-indigo-100'}`}>Apply</button>
                            </form>
                          ) : (
                            <button onClick={() => beginAssignDomainModel(domain, domainMappings, models)} className={`text-[11px] px-2 py-1 rounded border ${isDark ? 'border-white/20 text-slate-300 hover:bg-white/10' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}>Assign Model</button>
                          )}
                      </div>
                    </td>
                  </tr>
                  {domainMappings.map((mapping) => (
                    <React.Fragment key={mapping.id}>
                      <tr className={t_rowHover}>
                        <td className="py-3 pr-4">
                          {mapping.ai_model_name ? (
                            <div className="text-[10px] text-indigo-500 mt-1">use: {mapping.ai_model_name}</div>
                          ) : (
                            <div className="text-[10px] text-rose-500 mt-1">model missing (reassign required)</div>
                          )}
                          <div className={`text-[10px] ${t_textMuted}`}>type: {mapping.source_data_type || "image"}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs">
                          <div className={isDark ? 'text-gray-300' : 'text-slate-700'}>S: {mapping.source_selector}</div>
                          <div className={t_textMuted}>T: {mapping.target_selector || "-"}</div>
                        </td>
                        <td className="py-3 pl-4 text-right space-x-2">
                          <button
                            onClick={() => handleTestMapping(mapping.id, mapping.domain)}
                            disabled={!mapping.ai_model_name}
                            className={`text-[11px] px-2 py-1 rounded transition-colors backdrop-blur-md border ${isDark ? 'bg-white/[0.05] border-white/10 hover:bg-white/[0.1] text-gray-300' : 'bg-white/60 border-white/80 hover:bg-white text-slate-700 shadow-sm'} disabled:opacity-40 disabled:cursor-not-allowed`}
                          >
                            Test
                          </button>
                          <button
                            onClick={() => beginEditMapping(mapping)}
                            className={`text-[11px] px-2 py-1 rounded transition-colors backdrop-blur-md border ${isDark ? 'bg-white/[0.05] border-white/10 hover:bg-white/[0.1] text-gray-300' : 'bg-white/60 border-white/80 hover:bg-white text-slate-700 shadow-sm'}`}
                          >
                            Edit
                          </button>
                          <button onClick={() => handleRemoveMapping(mapping.id)} className="text-[11px] text-rose-500 hover:text-rose-600 bg-rose-500/10 px-2 py-1 rounded transition-colors backdrop-blur-md border border-rose-500/20">Del</button>
                        </td>
                      </tr>
                      {editingMappingId === mapping.id && editingMappingDraft && (
                        <tr>
                          <td colSpan={3} className={`py-3 px-3 border-t ${t_borderLight}`}>
                            <form onSubmit={(e) => handleSaveMappingEdit(e, mapping.id)} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <input className={glassInput} value={editingMappingDraft.domain} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, domain: e.target.value }))} placeholder="Domain" required />
                              <select className={glassInput} value={editingMappingDraft.source_data_type} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, source_data_type: e.target.value }))}>
                                <option value="image">image</option>
                                <option value="audio">audio</option>
                                <option value="text">text</option>
                              </select>
                              <input className={glassInput} value={editingMappingDraft.source_selector} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, source_selector: e.target.value }))} placeholder="Source selector" required />
                              <input className={glassInput} value={editingMappingDraft.target_selector} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, target_selector: e.target.value }))} placeholder="Target selector" required />
                              <select className={glassInput} value={editingMappingDraft.target_data_type} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, target_data_type: e.target.value }))}>
                                <option value="text_input">text_input</option>
                                <option value="text">text</option>
                              </select>
                              <select className={glassInput} value={String(editingMappingDraft.ai_model_id || "")} onChange={(e) => setEditingMappingDraft((prev) => ({ ...prev, ai_model_id: Number(e.target.value) }))} required>
                                <option value="" disabled>Select model</option>
                                {models.map((m) => <option key={m.id} value={m.id}>{m.ai_model_name} ({m.version})</option>)}
                              </select>
                              <div className="sm:col-span-2 flex justify-end gap-2">
                                <button type="button" onClick={cancelEditMapping} className={glassButton}>Cancel</button>
                                <button type="submit" className={solidButton}>Save</button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
              {mappingsByDomain.length === 0 && <EmptyState icon={Inbox} title="No mappings configured" description="Create your first domain routing map below." />}
            </tbody>
          </table>
        </div>

        <form onSubmit={handleSaveMapping} className="space-y-3">
          <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 drop-shadow-sm ${t_textMuted}`}>Create Routing Map</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input type="text" name="domain" required placeholder="Domain (e.g. site.com)" className={glassInput} />
            <select name="ai_model_id" required className={glassInput} defaultValue="">
              <option value="" disabled>Assign Model...</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.ai_model_name}</option>)}
            </select>
            <input type="text" name="source_selector" required placeholder="Source Selector (#img)" className={glassInput} />
            <input type="text" name="target_selector" required placeholder="Target Selector (#txt)" className={glassInput} />
          </div>
          <input type="hidden" name="source_data_type" value="image" />
          <button type="submit" className={`w-full mt-2 ${solidButton}`}>Deploy Route Mapping</button>
        </form>
      </div>
    </div>
  );
}

MappingsPanel.propTypes = {
  mappingsByDomain: PropTypes.array.isRequired,
  models: PropTypes.array.isRequired,
  editingMappingId: PropTypes.number,
  editingMappingDraft: PropTypes.object,
  setEditingMappingDraft: PropTypes.func.isRequired,
  assigningDomainDraft: PropTypes.object,
  setAssigningDomainDraft: PropTypes.func.isRequired,
  handleSaveMapping: PropTypes.func.isRequired,
  handleRemoveMapping: PropTypes.func.isRequired,
  handleTestMapping: PropTypes.func.isRequired,
  beginEditMapping: PropTypes.func.isRequired,
  cancelEditMapping: PropTypes.func.isRequired,
  handleSaveMappingEdit: PropTypes.func.isRequired,
  beginAssignDomainModel: PropTypes.func.isRequired,
  cancelAssignDomainModel: PropTypes.func.isRequired,
  handleSaveDomainModelAssign: PropTypes.func.isRequired,
};
