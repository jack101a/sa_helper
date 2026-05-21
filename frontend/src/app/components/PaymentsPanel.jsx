import React, { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { CreditCard, Loader2, CheckCircle, XCircle, Clock, Search, ShieldCheck, AlertTriangle } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { apiGet, apiPostJson } from "../../api/client";

const STATUS_COLORS = {
  pending_payment: "bg-blue-500/20 text-blue-400",
  pending: "bg-amber-500/20 text-amber-400",
  screenshot_submitted: "bg-purple-500/20 text-purple-400",
  ocr_processing: "bg-cyan-500/20 text-cyan-400",
  ocr_matched: "bg-emerald-500/20 text-emerald-400",
  ocr_mismatch: "bg-orange-500/20 text-orange-400",
  ready_for_admin_approval: "bg-indigo-500/20 text-indigo-400",
  approved: "bg-emerald-500/20 text-emerald-400",
  rejected: "bg-red-500/20 text-red-400",
  expired: "bg-gray-500/20 text-gray-400",
};

export function PaymentsPanel({ showToast }) {
  const { t_textHeading, t_textMuted, t_borderLight, glassPanel, glassInput, solidButton, iconBtn, isDark } = useThemeContext();
  const [payments, setPayments] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [page, setPage] = useState(0);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const limit = 20;

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ offset: page * limit, limit });
      if (statusFilter) params.set("status", statusFilter);
      const data = await apiGet(`/admin/api/payments?${params}`);
      setPayments(data.payments || []);
      setTotal(data.total || 0);
    } catch (e) {
      showToast("Failed to load payments", "error");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, showToast]);

  const fetchPendingCount = useCallback(async () => {
    try {
      const data = await apiGet("/admin/api/payments/pending-count");
      setPendingCount(data.pending_count || 0);
    } catch (_) {}
  }, []);

  useEffect(() => { fetchPayments(); fetchPendingCount(); }, [fetchPayments, fetchPendingCount]);

  const handleApprove = async (paymentId) => {
    try {
      await apiPostJson(`/admin/api/payments/${paymentId}/approve`);
      showToast("Payment approved");
      fetchPayments();
      fetchPendingCount();
    } catch (e) {
      showToast(e.message || "Failed to approve", "error");
    }
  };

  const handleReject = async (paymentId) => {
    try {
      await apiPostJson(`/admin/api/payments/${paymentId}/reject`, { rejection_reason: rejectReason });
      showToast("Payment rejected");
      setRejecting(null);
      setRejectReason("");
      fetchPayments();
      fetchPendingCount();
    } catch (e) {
      showToast(e.message || "Failed to reject", "error");
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/20 text-amber-500 rounded-lg backdrop-blur-md">
            <CreditCard size={20} />
          </div>
          <div>
            <h2 className={`text-lg font-semibold ${t_textHeading}`}>Payment Approvals</h2>
            <p className={`text-xs ${t_textMuted}`}>
              {pendingCount > 0 && <span className="text-amber-400 font-medium">{pendingCount} pending</span>}
              {pendingCount === 0 && "All clear"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {["", "pending_payment", "screenshot_submitted", "ready_for_admin_approval", "approved", "rejected"].map((s) => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === s ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : `${t_textMuted} border ${t_borderLight}`
              }`}>
              {s || "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className={`rounded-2xl overflow-hidden ${glassPanel}`}>
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>
        ) : payments.length === 0 ? (
          <div className="p-12 text-center"><p className={t_textMuted}>No payments found</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${t_borderLight}`}>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>ID</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>User</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Mobile</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Plan</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Amount</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Ref</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>UPI ID</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Screenshot</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>OCR</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Status</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Date</th>
                  <th className={`text-right p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className={`border-b ${t_borderLight} ${isDark ? "hover:bg-white/[0.02]" : "hover:bg-black/[0.02]"}`}>
                    <td className={`p-3 font-mono text-xs ${t_textHeading}`}>#{p.id}</td>
                    <td className={`p-3 ${t_textHeading}`}>
                      <div>{p.user_full_name || p.payer_name || `User #${p.user_id}`}</div>
                      <div className={`font-mono text-[10px] ${t_textMuted}`}>{p.telegram_user_id || "—"}</div>
                    </td>
                    <td className={`p-3 font-mono text-xs ${t_textMuted}`}>{p.user_mobile_number || "—"}</td>
                    <td className={`p-3 text-xs ${t_textMuted}`}>{p.plan_name || (p.plan_id ? `#${p.plan_id}` : "—")}</td>
                    <td className={`p-3 font-medium ${t_textHeading}`}>₹{(p.amount / 100).toFixed(2)}</td>
                    <td className={`p-3 font-mono text-xs ${t_textMuted}`}>{p.payment_ref || "—"}</td>
                    <td className={`p-3 font-mono text-xs ${t_textMuted}`}>{p.upi_id_used || "—"}</td>
                    <td className="p-3">
                      {p.payment_screenshot_path ? (
                        <a href={`/admin/api/payments/${p.id}/screenshot`} target="_blank" rel="noreferrer"
                           className="text-blue-400 hover:text-blue-300 underline text-xs">
                          View 📸
                        </a>
                      ) : (
                        <span className={`text-xs ${t_textMuted}`}>—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {p.payment_screenshot_path ? (
                        <div className="flex flex-col gap-0.5">
                          {p.ocr_matched === true ? (
                            <span className="flex items-center gap-1 text-emerald-400" title={`Matched: ${p.ocr_extracted_ref || ''}`}>
                              <ShieldCheck size={14} />
                              <span className="text-xs font-medium">Matched</span>
                            </span>
                          ) : p.ocr_matched === false ? (
                            <span className="flex items-center gap-1 text-amber-400" title={`Extracted: ${p.ocr_extracted_ref || 'none'}`}>
                              <AlertTriangle size={14} />
                              <span className="text-xs">Unverified</span>
                            </span>
                          ) : (
                            <span className={`text-xs ${t_textMuted}`}>—</span>
                          )}
                          {p.ocr_extracted_amount && (
                            <span className={`text-[10px] ${t_textMuted}`}>Amt: {p.ocr_extracted_amount}</span>
                          )}
                          {p.ocr_extracted_date && (
                            <span className={`text-[10px] ${t_textMuted}`}>Date: {p.ocr_extracted_date}</span>
                          )}
                        </div>
                      ) : (
                        <span className={`text-xs ${t_textMuted}`}>—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status] || "bg-slate-500/20 text-slate-400"}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className={`p-3 ${t_textMuted}`}>{(p.submitted_at || p.created_at) ? new Date(p.submitted_at || p.created_at).toLocaleString() : "—"}</td>
                    <td className="p-3">
                      {(p.status === "pending" || p.status === "pending_payment" || p.status === "screenshot_submitted" || p.status === "ready_for_admin_approval") && (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleApprove(p.id)} className={iconBtn} title="Approve">
                            <CheckCircle size={16} className="text-emerald-400" />
                          </button>
                          <button onClick={() => setRejecting(p.id)} className={iconBtn} title="Reject">
                            <XCircle size={16} className="text-red-400" />
                          </button>
                        </div>
                      )}
                      {p.status === "rejected" && p.rejection_reason && (
                        <span className={`text-xs ${t_textMuted}`}>{p.rejection_reason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setRejecting(null)}>
          <div className={`${glassPanel} rounded-2xl p-6 w-full max-w-md border ${t_borderLight}`} onClick={(e) => e.stopPropagation()}>
            <h3 className={`text-lg font-semibold mb-4 ${t_textHeading}`}>Reject Payment #{rejecting}</h3>
            <div className="space-y-3">
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Rejection Reason</label>
                <textarea className={glassInput} rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this payment rejected?" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => handleReject(rejecting)} className={`px-4 py-2 rounded-xl text-sm font-medium bg-red-500/20 text-red-400 border border-red-500/30`}>Reject</button>
                <button onClick={() => setRejecting(null)} className={`px-4 py-2 rounded-xl text-sm ${t_textMuted} border ${t_borderLight}`}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

PaymentsPanel.propTypes = {
  showToast: PropTypes.func.isRequired,
};
