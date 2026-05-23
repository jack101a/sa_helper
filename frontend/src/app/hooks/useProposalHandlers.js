import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPostJson, apiPatchJson, apiDelete } from '../../api/client';
import { queryKeys } from '../../api/queries';

export function useProposalHandlers({ showToast }) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.autofillProposals });
    queryClient.invalidateQueries({ queryKey: queryKeys.captchaProposals });
    queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
  };

  const approveAutofill = useMutation({
    mutationFn: (id) => apiPostJson(`/admin/api/autofill/proposals/${id}/approve`, {}),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.autofillProposals });
      const previous = queryClient.getQueryData(queryKeys.autofillProposals);
      queryClient.setQueryData(queryKeys.autofillProposals, (old) =>
        (old || []).map(p => p.id === id ? { ...p, status: 'approved' } : p)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.autofillProposals, context.previous);
      showToast("Failed to approve autofill rule", "error");
    },
    onSettled: () => invalidate(),
    onSuccess: () => showToast("Autofill rule approved."),
  });

  const rejectAutofill = useMutation({
    mutationFn: (id) => apiPostJson(`/admin/api/autofill/proposals/${id}/reject`, {}),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.autofillProposals });
      const previous = queryClient.getQueryData(queryKeys.autofillProposals);
      queryClient.setQueryData(queryKeys.autofillProposals, (old) =>
        (old || []).map(p => p.id === id ? { ...p, status: 'rejected' } : p)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.autofillProposals, context.previous);
      showToast("Failed to reject autofill rule", "error");
    },
    onSettled: () => invalidate(),
    onSuccess: () => showToast("Autofill rule rejected.", "error"),
  });

  const bulkApproveAutofill = useMutation({
    mutationFn: (ids) => apiPostJson("/admin/api/autofill/proposals/bulk-approve", { proposal_ids: ids.map(Number) }),
    onSuccess: (_, ids) => { showToast(`Approved ${ids.length} rules.`); invalidate(); },
    onError: () => showToast("Failed to bulk approve rules", "error"),
  });

  const bulkRejectAutofill = useMutation({
    mutationFn: (ids) => apiPostJson("/admin/api/autofill/proposals/bulk-reject", { proposal_ids: ids.map(Number) }),
    onSuccess: (_, ids) => { showToast(`Rejected ${ids.length} rules.`, "error"); invalidate(); },
    onError: () => showToast("Failed to bulk reject rules", "error"),
  });

  const editAutofill = useMutation({
    mutationFn: ({ id, patch }) => apiPatchJson(`/admin/api/autofill/proposals/${id}`, patch),
    onSuccess: () => { showToast("Autofill proposal updated."); invalidate(); },
    onError: (e) => showToast(e.message || "Failed to update", "error"),
  });

  const deleteAutofill = useMutation({
    mutationFn: (id) => apiDelete(`/admin/api/autofill/proposals/${id}`),
    onSuccess: () => { showToast("Autofill proposal deleted.", "error"); invalidate(); },
    onError: () => showToast("Failed to delete proposal", "error"),
  });

  const importAutofill = useMutation({
    mutationFn: (rules) => apiPostJson("/admin/api/autofill/import", { rules }),
    onSuccess: (body) => {
      showToast(`Imported ${body.imported || 0} autofill rule(s).`);
      invalidate();
    },
    onError: (e) => showToast(e.message || "Failed to import autofill rules", "error"),
  });

  const approveCaptcha = useMutation({
    mutationFn: ({ id, model_id }) => apiPostJson(`/admin/api/captcha/proposals/${id}/approve`, { model_id: Number(model_id) }),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.captchaProposals });
      const previous = queryClient.getQueryData(queryKeys.captchaProposals);
      queryClient.setQueryData(queryKeys.captchaProposals, (old) =>
        (old || []).map(p => p.id === id ? { ...p, status: 'approved' } : p)
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.captchaProposals, context.previous);
      showToast("Failed to approve", "error");
    },
    onSettled: () => invalidate(),
    onSuccess: () => showToast("Captcha route approved and mapped."),
  });

  const rejectCaptcha = useMutation({
    mutationFn: (id) => apiPostJson(`/admin/api/captcha/proposals/${id}/reject`, {}),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.captchaProposals });
      const previous = queryClient.getQueryData(queryKeys.captchaProposals);
      queryClient.setQueryData(queryKeys.captchaProposals, (old) =>
        (old || []).map(p => p.id === id ? { ...p, status: 'rejected' } : p)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.captchaProposals, context.previous);
      showToast("Failed to reject", "error");
    },
    onSettled: () => invalidate(),
    onSuccess: () => showToast("Captcha route rejected.", "error"),
  });

  const bulkApproveCaptcha = useMutation({
    mutationFn: ({ ids, model_id }) => apiPostJson("/admin/api/captcha/proposals/bulk-approve", { proposal_ids: ids.map(Number), model_id: Number(model_id) }),
    onSuccess: (d) => {
      showToast(`Approved ${d.count} captcha route(s).`);
      if (d.errors?.length) showToast(`${d.errors.length} failed`, "error");
      invalidate();
    },
    onError: (e) => showToast(e.message || "Failed to bulk approve", "error"),
  });

  const bulkRejectCaptcha = useMutation({
    mutationFn: (ids) => apiPostJson("/admin/api/captcha/proposals/bulk-reject", { proposal_ids: ids.map(Number) }),
    onSuccess: (_, ids) => { showToast(`Rejected ${ids.length} captcha routes.`, "error"); invalidate(); },
    onError: () => showToast("Failed to bulk reject", "error"),
  });

  const editCaptcha = useMutation({
    mutationFn: ({ id, patch }) => apiPatchJson(`/admin/api/captcha/proposals/${id}`, patch),
    onSuccess: () => { showToast("Captcha proposal updated."); invalidate(); },
    onError: (e) => showToast(e.message || "Failed to update", "error"),
  });

  const deleteCaptcha = useMutation({
    mutationFn: (id) => apiDelete(`/admin/api/captcha/proposals/${id}`),
    onSuccess: () => { showToast("Captcha proposal deleted.", "error"); invalidate(); },
    onError: () => showToast("Failed to delete proposal", "error"),
  });

  return {
    handleApproveAutofillProposal: (id) => approveAutofill.mutate(id),
    handleRejectAutofillProposal: (id) => { if (window.confirm("Reject proposal?")) rejectAutofill.mutate(id); },
    handleBulkApproveAutofillProposals: (ids) => bulkApproveAutofill.mutate(ids),
    handleBulkRejectAutofillProposals: (ids) => bulkRejectAutofill.mutate(ids),
    handleEditAutofillProposal: (id, patch) => editAutofill.mutateAsync({ id, patch }).then(() => true).catch(() => false),
    handleDeleteAutofillProposal: (id) => { if (window.confirm("Permanently delete this autofill proposal?")) deleteAutofill.mutate(id); },
    handleImportAutofillRules: (rules) => importAutofill.mutateAsync(rules).then(() => true).catch(() => false),
    handleApproveCaptchaProposal: (id, model_id) => approveCaptcha.mutate({ id, model_id }),
    handleRejectCaptchaProposal: (id) => { if (window.confirm("Reject this captcha route proposal?")) rejectCaptcha.mutate(id); },
    handleBulkApproveCaptchaProposals: (ids, model_id) => bulkApproveCaptcha.mutate({ ids, model_id }),
    handleBulkRejectCaptchaProposals: (ids) => bulkRejectCaptcha.mutate(ids),
    handleEditCaptchaProposal: (id, patch) => editCaptcha.mutateAsync({ id, patch }).then(() => true).catch(() => false),
    handleDeleteCaptchaProposal: (id) => { if (window.confirm("Permanently delete this captcha proposal?")) deleteCaptcha.mutate(id); },
  };
}
