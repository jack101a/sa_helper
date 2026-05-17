import React, { useEffect } from "react";
import PropTypes from "prop-types";
import { BrainCircuit, Inbox } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { EmptyState } from "./EmptyState";

export function ModelsPanel({
  models,
  editingModelId,
  editingModelDraft,
  setEditingModelDraft,
  handleRegisterModel,
  handleChangeModelState,
  beginEditModel,
  cancelEditModel,
  handleSaveModelEdit,
  handleDeleteModel,
}) {
  const { isDark, t_textHeading, t_textMuted, t_borderLight, glassPanel, glassButton, glassInput, solidButton, badgeSuccess, badgeWarning, dangerButton } = useThemeContext();

  useEffect(() => {
    if (editingModelId === null) return;
    const onBefore = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [editingModelId]);

  return (
    <div id="models-section" className={`rounded-2xl transition-colors duration-500 overflow-hidden ${glassPanel}`}>
      <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
        <div className="p-2 bg-blue-500/20 text-blue-500 rounded-lg backdrop-blur-md"><BrainCircuit size={20}/></div>
        <div>
          <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Model Registry</h2>
          <p className={`text-[11px] ${t_textMuted}`}>Manage ONNX weights & task types</p>
        </div>
      </div>
      <div className="p-5">
        <div className="overflow-x-auto max-h-64 mb-6 pr-2 custom-scrollbar">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead>
              <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                <th className="pb-3 font-medium pr-4">Model Data</th>
                <th className="pb-3 font-medium px-4">Status</th>
                <th className="pb-3 text-right font-medium pl-4">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${t_borderLight}`}>
              {models.map(model => (
                <React.Fragment key={model.id}>
                  <tr>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-indigo-500 drop-shadow-sm">{model.ai_model_name} <span className={`text-xs ${t_textMuted}`}>{model.version}</span></div>
                      <div className={`text-xs mt-0.5 ${t_textMuted}`}>ID: #{model.id} • {model.task_type}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={model.lifecycle_state === 'production' ? badgeSuccess : badgeWarning}>
                        {model.lifecycle_state}
                      </span>
                    </td>
                    <td className="py-3 pl-4 text-right space-x-2">
                      <button onClick={() => handleChangeModelState(model.id, 'production')} className={`${glassButton} text-[11px] px-2 py-1`}>Promote</button>
                      <button
                        onClick={() => beginEditModel(model)}
                        className={`${glassButton} text-[11px] px-2 py-1`}
                      >
                        Edit
                      </button>
                      <button onClick={() => handleDeleteModel(model.id)} className={`${dangerButton} text-[11px] px-2 py-1`}>Del</button>
                    </td>
                  </tr>
                  {editingModelId === model.id && editingModelDraft && (
                    <tr>
                      <td colSpan={3} className={`py-3 px-3 border-t ${t_borderLight}`}>
                        <form onSubmit={(e) => handleSaveModelEdit(e, model.id)} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <input className={glassInput} value={editingModelDraft.ai_model_name} onChange={(e) => setEditingModelDraft((prev) => ({ ...prev, ai_model_name: e.target.value }))} placeholder="Model Name" required />
                          <input className={glassInput} value={editingModelDraft.version} onChange={(e) => setEditingModelDraft((prev) => ({ ...prev, version: e.target.value }))} placeholder="Version" required />
                          <select className={glassInput} value={editingModelDraft.task_type} onChange={(e) => setEditingModelDraft((prev) => ({ ...prev, task_type: e.target.value }))}>
                            <option value="image">image</option>
                            <option value="audio">audio</option>
                            <option value="text">text</option>
                          </select>
                          <select className={glassInput} value={editingModelDraft.lifecycle_state} onChange={(e) => setEditingModelDraft((prev) => ({ ...prev, lifecycle_state: e.target.value }))}>
                            <option value="candidate">candidate</option>
                            <option value="staging">staging</option>
                            <option value="production">production</option>
                            <option value="rolled_back">rolled_back</option>
                          </select>
                          <input className={`sm:col-span-2 ${glassInput}`} value={editingModelDraft.notes} onChange={(e) => setEditingModelDraft((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes" />
                          <div className="sm:col-span-2 flex justify-end gap-2">
                            <button type="button" onClick={cancelEditModel} className={glassButton}>Cancel</button>
                            <button type="submit" className={solidButton}>Save</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {models.length === 0 && <EmptyState icon={Inbox} title="No models registered" description="Upload an ONNX model to get started." />}
            </tbody>
          </table>
        </div>

        <form
          onSubmit={handleRegisterModel}
          action="/admin/models/upload"
          method="post"
          encType="multipart/form-data"
          className="space-y-3"
        >
          <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 drop-shadow-sm ${t_textMuted}`}>Register New Model</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input type="text" name="ai_model_name" required placeholder="Model Name" className={glassInput} />
            <input type="text" name="version" defaultValue="v1" placeholder="Version" className={glassInput} />
            <select name="task_type" className={glassInput}>
              <option value="image">Task: Image</option>
              <option value="audio">Task: Audio</option>
              <option value="text">Task: Text</option>
            </select>
            <select name="runtime" className={glassInput}><option value="onnx">onnx</option></select>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center mt-3 pt-3 border-t border-white/5">
            <input type="file" name="model_file" accept=".onnx" className={`flex-1 text-xs file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-500/10 file:text-indigo-500 hover:file:bg-indigo-500/20 w-full ${t_textMuted}`} />
            <button type="submit" className={`w-full sm:w-auto ${solidButton}`}>Upload</button>
          </div>
        </form>
      </div>
    </div>
  );
}

ModelsPanel.propTypes = {
  models: PropTypes.array.isRequired,
  editingModelId: PropTypes.number,
  editingModelDraft: PropTypes.object,
  setEditingModelDraft: PropTypes.func.isRequired,
  handleRegisterModel: PropTypes.func.isRequired,
  handleChangeModelState: PropTypes.func.isRequired,
  beginEditModel: PropTypes.func.isRequired,
  cancelEditModel: PropTypes.func.isRequired,
  handleSaveModelEdit: PropTypes.func.isRequired,
  handleDeleteModel: PropTypes.func.isRequired,
};
