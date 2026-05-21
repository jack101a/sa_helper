import React, { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Users, UserPlus, Search, Loader2, ChevronLeft, ChevronRight, Edit3, Ban, CheckCircle, XCircle, Trash2 } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { apiGet, apiPostJson, apiPutJson, apiDelete } from "../../api/client";

const STATUS_COLORS = {
  active: "bg-emerald-500/20 text-emerald-400",
  blocked: "bg-red-500/20 text-red-400",
  inactive: "bg-slate-500/20 text-slate-400",
  expired: "bg-amber-500/20 text-amber-400",
  pending_payment: "bg-blue-500/20 text-blue-400",
  pending_approval: "bg-purple-500/20 text-purple-400",
  deleted: "bg-gray-500/20 text-gray-400",
};

export function UsersPanel({ showToast }) {
  const { t_textHeading, t_textMuted, t_borderLight, glassPanel, glassInput, solidButton, iconBtn, isDark } = useThemeContext();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({ full_name: "", mobile_number: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const limit = 20;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ offset: page * limit, limit });
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      const data = await apiGet(`/admin/api/users?${params}`);
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (e) {
      showToast("Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search, showToast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPostJson("/admin/api/users", form);
      showToast("User created");
      setShowCreate(false);
      setForm({ full_name: "", mobile_number: "", notes: "" });
      fetchUsers();
    } catch (e) {
      showToast(e.message || "Failed to create user", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPutJson(`/admin/api/users/${editingUser.id}`, form);
      showToast("User updated");
      setEditingUser(null);
      fetchUsers();
    } catch (e) {
      showToast(e.message || "Failed to update user", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (userId, newStatus) => {
    try {
      await apiPostJson(`/admin/api/users/${userId}/status`, { status: newStatus });
      showToast(`User ${newStatus}`);
      fetchUsers();
    } catch (e) {
      showToast(e.message || "Failed to change status", "error");
    }
  };

  const handleDelete = async (userId) => {
    if (!confirm("Soft-delete this user?")) return;
    try {
      await apiDelete(`/admin/api/users/${userId}`);
      showToast("User deleted");
      fetchUsers();
    } catch (e) {
      showToast(e.message || "Failed to delete", "error");
    }
  };

  const openEdit = (user) => {
    setEditingUser(user);
    setForm({ full_name: user.full_name || "", mobile_number: user.mobile_number || "", notes: user.notes || "" });
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/20 text-indigo-500 rounded-lg backdrop-blur-md">
            <Users size={20} />
          </div>
          <div>
            <h2 className={`text-lg font-semibold ${t_textHeading}`}>User Management</h2>
            <p className={`text-xs ${t_textMuted}`}>{total} total users</p>
          </div>
        </div>
        <button onClick={() => { setShowCreate(true); setForm({ full_name: "", mobile_number: "", notes: "" }); }} className={solidButton}>
          <UserPlus size={16} /> Add User
        </button>
      </div>

      {/* Filters */}
      <div className={`rounded-2xl p-4 ${glassPanel} flex flex-wrap gap-3 items-center`}>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${t_textMuted}`} />
          <input className={`${glassInput} pl-9 w-full`} placeholder="Search name or mobile..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <select className={glassInput} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="pending_payment">Pending Payment</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="blocked">Blocked</option>
          <option value="expired">Expired</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className={`rounded-2xl overflow-hidden ${glassPanel}`}>
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center"><p className={t_textMuted}>No users found</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${t_borderLight}`}>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Name</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Mobile</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Telegram ID</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Plan</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Expiry</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Status</th>
                  <th className={`text-left p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Created</th>
                  <th className={`text-right p-3 text-xs font-semibold uppercase tracking-wider ${t_textMuted}`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={`border-b ${t_borderLight} ${isDark ? "hover:bg-white/[0.02]" : "hover:bg-black/[0.02]"}`}>
                    <td className={`p-3 font-medium ${t_textHeading}`}>{u.full_name || "—"}</td>
                    <td className={`p-3 ${t_textMuted}`}>{u.mobile_number || "—"}</td>
                    <td className={`p-3 font-mono text-xs ${t_textMuted}`}>{u.telegram_user_id || "—"}</td>
                    <td className={`p-3 ${t_textHeading}`}>
                      {u.plan_name ? (
                        <span>{u.plan_name}<br/><span className={`text-xs ${t_textMuted}`}>{u.usage_used || 0}/{u.plan_monthly_limit || "?"} used</span></span>
                      ) : <span className={t_textMuted}>—</span>}
                    </td>
                    <td className={`p-3 ${t_textMuted}`}>
                      {u.subscription_expiry ? new Date(u.subscription_expiry).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[u.status] || "bg-slate-500/20 text-slate-400"}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className={`p-3 ${t_textMuted}`}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(u)} className={iconBtn} title="Edit"><Edit3 size={14} /></button>
                        {u.status !== "active" && u.status !== "deleted" && (
                          <button onClick={() => handleStatusChange(u.id, "active")} className={iconBtn} title="Activate"><CheckCircle size={14} className="text-emerald-400" /></button>
                        )}
                        {u.status === "active" && (
                          <button onClick={() => handleStatusChange(u.id, "blocked")} className={iconBtn} title="Block"><Ban size={14} className="text-red-400" /></button>
                        )}
                        {u.status !== "deleted" && (
                          <button onClick={() => handleDelete(u.id)} className={iconBtn} title="Delete"><Trash2 size={14} className="text-red-400" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className={`text-xs ${t_textMuted}`}>Page {page + 1} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className={iconBtn}><ChevronLeft size={16} /></button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className={iconBtn}><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreate || editingUser) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { setShowCreate(false); setEditingUser(null); }}>
          <div className={`${glassPanel} rounded-2xl p-6 w-full max-w-md border ${t_borderLight}`} onClick={(e) => e.stopPropagation()}>
            <h3 className={`text-lg font-semibold mb-4 ${t_textHeading}`}>{editingUser ? "Edit User" : "Create User"}</h3>
            <form onSubmit={editingUser ? handleUpdate : handleCreate} className="space-y-3">
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Full Name</label>
                <input className={glassInput} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Mobile Number</label>
                <input className={glassInput} value={form.mobile_number} onChange={(e) => setForm({ ...form, mobile_number: e.target.value })} placeholder="+91..." />
              </div>
              <div>
                <label className={`text-xs block mb-1 ${t_textMuted}`}>Notes</label>
                <textarea className={glassInput} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" className={solidButton} disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : "Save"}</button>
                <button type="button" onClick={() => { setShowCreate(false); setEditingUser(null); }} className={`px-4 py-2 rounded-xl text-sm ${t_textMuted} border ${t_borderLight}`}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

UsersPanel.propTypes = {
  showToast: PropTypes.func.isRequired,
};
