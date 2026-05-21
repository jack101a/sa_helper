import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPostForm } from '../../api/client';
import { queryKeys } from '../../api/queries';

export function useModelHandlers({
  showToast,
  setEditingModelId, setEditingModelDraft, editingModelDraft,
  setEditingMappingId, setEditingMappingDraft, editingMappingDraft,
  setAssigningDomainDraft, assigningDomainDraft,
  failedPayloads, selectedPayloads, setSelectedPayloads, allPayloadSelected,
}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });

  const handleRegisterModel = async (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const modelFile = fd.get("model_file");
    if (!modelFile || typeof modelFile === "string" || !modelFile.name) {
      showToast("Please choose an ONNX model file first", "error"); return;
    }
    const upload = new FormData();
    ["ai_model_name","version","task_type","runtime"].forEach(k => upload.append(k, fd.get(k)));
    let blob = modelFile;
    try { blob = new Blob([await modelFile.arrayBuffer()], { type: modelFile.type || "application/octet-stream" }); }
    catch { showToast("Could not read selected file.", "error"); return; }
    upload.append("ai_model_file", blob, modelFile.name);
    try {
      await apiPostForm("/admin/models/upload", upload, { headers: { "x-admin-api": "1" } });
      invalidate(); formEl.reset(); showToast(`Model registered: ${modelFile.name || "done"}`);
    } catch (err) { showToast(err.message || "Failed to register model", "error"); }
  };

  const changeModelState = useMutation({
    mutationFn: ({ id, state }) => apiPost("/admin/models/promote", { ai_model_id: id, lifecycle_state: state }),
    onSuccess: (_, { id, state }) => { invalidate(); showToast(`Model #${id} \u2192 ${state}.`); },
    onError: () => showToast("Failed to change model state", "error"),
  });

  const handleChangeModelState = (id, state) => changeModelState.mutate({ id, state });

  const deleteModel = useMutation({
    mutationFn: (id) => apiPost("/admin/models/remove", { ai_model_id: String(id) }),
    onSuccess: (_, id) => { invalidate(); showToast(`Model #${id} removed.`, "error"); },
    onError: (err) => showToast(err.message || "Failed to remove model", "error"),
  });

  const handleDeleteModel = (id) => {
    if (!window.confirm("Delete this AI model? This will fail if mappings still reference it.")) return;
    deleteModel.mutate(id);
  };

  const beginEditModel = (model) => {
    setEditingModelId(model.id);
    setEditingModelDraft({ ai_model_name: model.ai_model_name||"", version: model.version||"v1", task_type: model.task_type||"image", lifecycle_state: model.lifecycle_state||"candidate", notes: model.notes||"" });
  };
  const cancelEditModel = () => { setEditingModelId(null); setEditingModelDraft(null); };

  const saveModelEdit = useMutation({
    mutationFn: (modelId) => apiPost("/admin/models/update", { ai_model_id: modelId, ...editingModelDraft }),
    onSuccess: (_, modelId) => { invalidate(); showToast(`Model #${modelId} updated.`); cancelEditModel(); },
    onError: () => showToast("Failed to update model", "error"),
  });

  const handleSaveModelEdit = (e, modelId) => {
    e.preventDefault();
    saveModelEdit.mutate(modelId);
  };

  const saveMapping = useMutation({
    mutationFn: (fd) => apiPost("/admin/mappings/set", { domain: fd.get("domain"), source_data_type:"image", source_selector: fd.get("source_selector"), target_selector: fd.get("target_selector"), target_data_type:"text_input", ai_model_id: Number(fd.get("ai_model_id")) }),
    onSuccess: (_, _vars, { e }) => { invalidate(); e.target.reset(); showToast("Field mapping created."); },
    onError: () => showToast("Failed to create mapping", "error"),
  });

  const handleSaveMapping = (e) => {
    e.preventDefault();
    saveMapping.mutate(new FormData(e.target), { e });
  };

  const beginEditMapping = (mapping) => {
    setEditingMappingId(mapping.id);
    setEditingMappingDraft({ domain: mapping.domain||"", source_data_type: mapping.source_data_type||"image", source_selector: mapping.source_selector||"", target_data_type: mapping.target_data_type||"text_input", target_selector: mapping.target_selector||"", ai_model_id: Number(mapping.ai_model_id) });
  };
  const cancelEditMapping = () => { setEditingMappingId(null); setEditingMappingDraft(null); };

  const saveMappingEdit = useMutation({
    mutationFn: (mappingId) => apiPost("/admin/mappings/update", { mapping_id: mappingId, ...editingMappingDraft }),
    onSuccess: () => { invalidate(); showToast("Mapping updated."); cancelEditMapping(); },
    onError: () => showToast("Failed to update mapping", "error"),
  });

  const handleSaveMappingEdit = (e, mappingId) => {
    e.preventDefault();
    saveMappingEdit.mutate(mappingId);
  };

  const beginAssignDomainModel = (domain, domainMappings, allModels) => {
    const fm = domainMappings.find(m => Number(m.ai_model_id));
    const fa = allModels?.length > 0 ? allModels[0] : null;
    setAssigningDomainDraft({ domain, ai_model_id: fm ? Number(fm.ai_model_id) : fa ? Number(fa.id) : "" });
  };
  const cancelAssignDomainModel = () => setAssigningDomainDraft(null);

  const assignDomainModel = useMutation({
    mutationFn: () => apiPost("/admin/mappings/domain/assign-model", { domain: assigningDomainDraft.domain, ai_model_id: String(assigningDomainDraft.ai_model_id) }),
    onSuccess: () => { invalidate(); showToast(`Model assigned to ${assigningDomainDraft.domain}.`); cancelAssignDomainModel(); },
    onError: (err) => showToast(err.message || "Failed to assign model", "error"),
  });

  const handleSaveDomainModelAssign = (e) => {
    e.preventDefault();
    if (!assigningDomainDraft?.ai_model_id) { showToast("Please select a model first", "error"); return; }
    assignDomainModel.mutate();
  };

  const removeMapping = useMutation({
    mutationFn: (id) => apiPost("/admin/mappings/remove", { mapping_id: id }),
    onSuccess: () => { invalidate(); showToast("Mapping removed.", "error"); },
    onError: () => showToast("Failed to remove mapping", "error"),
  });

  const handleRemoveMapping = (id) => {
    if (!window.confirm("Delete this routing map?")) return;
    removeMapping.mutate(id);
  };

  const testMapping = useMutation({
    mutationFn: ({ mappingId, domain }) => apiPost("/admin/mappings/test", { mapping_id: mappingId }),
    onSuccess: (_, { domain }) => showToast(`Test triggered for ${domain}`),
    onError: () => showToast("Failed to test mapping", "error"),
  });

  const handleTestMapping = (mappingId, domain) => testMapping.mutate({ mappingId, domain });

  const labelPayload = useMutation({
    mutationFn: ({ filename, domain, aiGuess, text }) => apiPost("/admin/datasets/label", { filename, domain, ai_guess: aiGuess, corrected_text: text }),
    onSuccess: (_, { text }) => { invalidate(); showToast(`Labeled as "${text}".`); },
    onError: () => showToast("Failed to label payload", "error"),
  });

  const handleLabelPayload = (filename, domain, aiGuess, e) => {
    e.preventDefault();
    const text = new FormData(e.target).get("corrected_text");
    labelPayload.mutate({ filename, domain, aiGuess, text });
  };

  const ignorePayload = useMutation({
    mutationFn: (filename) => apiPost("/admin/datasets/ignore", { filename }),
    onSuccess: () => { invalidate(); showToast("Payload ignored."); },
    onError: () => showToast("Failed to ignore payload", "error"),
  });

  const handleIgnorePayload = (filename) => {
    if (!window.confirm("Discard payload?")) return;
    ignorePayload.mutate(filename);
  };

  const togglePayload = (name) => setSelectedPayloads(prev => ({ ...prev, [name]: !prev[name] }));
  const toggleAllPayloads = () => {
    if (allPayloadSelected) { setSelectedPayloads({}); return; }
    const next = {}; failedPayloads.forEach(p => { next[p.name] = true; }); setSelectedPayloads(next);
  };

  const handleBulkIgnorePayloads = async () => {
    const sel = failedPayloads.filter(p => selectedPayloads[p.name]);
    if (!sel.length) return;
    if (!window.confirm(`Ignore ${sel.length} selected payload${sel.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    try {
      for (const item of sel) await apiPost("/admin/datasets/ignore", { filename: item.name });
      setSelectedPayloads({}); invalidate(); showToast(`Ignored ${sel.length} payload(s).`);
    } catch { showToast("Bulk ignore failed", "error"); }
  };

  const handleBulkSavePayloads = async () => {
    const sel = failedPayloads.filter(p => selectedPayloads[p.name]);
    if (!sel.length) return;
    if (!window.confirm(`Save ${sel.length} selected payload${sel.length > 1 ? "s" : ""}?`)) return;
    try {
      for (const item of sel) await apiPost("/admin/datasets/label", { filename: item.name, domain: item.domain, ai_guess: item.ocr_guess, corrected_text: item.corrected_text || item.ocr_guess });
      setSelectedPayloads({}); invalidate(); showToast(`Saved ${sel.length} payload(s).`);
    } catch { showToast("Bulk save failed", "error"); }
  };

  const quickEditMapping = useMutation({
    mutationFn: ({ id, patch }) => apiPost("/admin/mappings/update", { mapping_id: id, ...patch }),
    onSuccess: () => { invalidate(); showToast("Mapping updated."); },
    onError: () => showToast("Failed to update mapping", "error"),
  });

  const handleQuickEditMapping = async (id, patch) => {
    try {
      await quickEditMapping.mutateAsync({ id, patch });
      return true;
    } catch { return false; }
  };

  return {
    handleRegisterModel, handleChangeModelState, handleDeleteModel,
    beginEditModel, cancelEditModel, handleSaveModelEdit,
    handleSaveMapping, beginEditMapping, cancelEditMapping, handleSaveMappingEdit,
    handleQuickEditMapping,
    beginAssignDomainModel, cancelAssignDomainModel, handleSaveDomainModelAssign,
    handleRemoveMapping, handleTestMapping,
    handleLabelPayload, handleIgnorePayload,
    togglePayload, toggleAllPayloads, handleBulkIgnorePayloads, handleBulkSavePayloads,
  };
}