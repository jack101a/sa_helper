import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Key, Plus, ShieldCheck, XCircle, Inbox, Users, Loader2 } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { EmptyState } from "./EmptyState";
import { apiGet } from "../../api/client";

export function KeysPanel({
  apiKeys,
  access,
  masterKeyInfo,
  createKeyAllDomains,
  setCreateKeyAllDomains,
  createKeyDomainSelections,
  toggleCreateKeyDomain,
  handleCreateKey,
  handleRevokeKey,
  handleDeleteRevokedKey,
  handleViewStoredKey,
  handleToggleGlobalAccess,
  handleRemoveDomain,
  handleAddDomain,
}) {
  const { isDark, t_textHeading, t_textMuted, t_borderLight, glassPanel, glassButton, glassInput, badgeSuccess, badgeWarning, dangerButton, solidButton } = useThemeContext();
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* API Keys Container */}
      <div className={`rounded-2xl flex flex-col transition-colors duration-500 overflow-hidden ${glassPanel}`}>
        <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
          <div className="p-2 bg-indigo-500/20 text-indigo-500 rounded-lg backdrop-blur-md"><Key size={20}/></div>
          <div>
            <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Legacy / System API Credentials</h2>
            <p className={`text-xs ${t_textMuted}`}>Plan-managed customers are created and renewed from User Management.</p>
          </div>
        </div>
        
        <div className="p-5 flex-1 flex flex-col">
          {/* Master Key Section */}
          {masterKeyInfo && (
            <div className={`mb-6 p-4 rounded-xl border-2 border-dashed transition-all ${isDark ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-indigo-50 border-indigo-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-500 text-white rounded-md shadow-lg shadow-indigo-500/20">
                    <ShieldCheck size={14}/>
                  </div>
                  <span className={`text-xs font-bold uppercase tracking-wider ${t_textHeading}`}>Master Administrative Key</span>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">PERSISTENT</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`flex-1 font-mono text-sm p-2 rounded-lg border overflow-hidden truncate ${isDark ? 'bg-black/40 border-white/10 text-indigo-300' : 'bg-white border-indigo-100 text-indigo-700'}`}>
                  {masterKeyInfo.key}
                </div>
                <button 
                  onClick={() => { navigator.clipboard.writeText(masterKeyInfo.key).catch(() => {}); }}
                  className={`p-2 rounded-lg border transition-all ${glassButton}`}
                  title="Copy Master Key"
                  aria-label="Copy master key to clipboard"
                >
                  <Plus size={16} className="rotate-45" /> {/* Use Plus as a placeholder for copy if needed, or just let it be */}
                </button>
              </div>
              <p className={`text-[10px] mt-2 italic leading-tight ${t_textMuted}`}>
                This key never expires and survives all system updates. Use it to unlock full "Master Mode" in the extension.
              </p>
            </div>
          )}

          <div className="overflow-auto max-h-72 mb-6 flex-1 pr-2 custom-scrollbar">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead>
                <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
                  <th className="pb-3 font-medium px-2">Name</th>
                  <th className="pb-3 font-medium px-2">Status</th>
                  <th className="pb-3 font-medium px-2 hidden sm:table-cell">Expires</th>
                  <th className="pb-3 text-right font-medium px-2">Action</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${t_borderLight}`}>
                {apiKeys.map(key => (
                  <tr key={key.id} className="group">
                    <td className="py-3 px-2">
                      <div className={`font-medium ${t_textHeading}`}>{key.name}</div>
                      <div className={`text-[10px] font-mono ${t_textMuted}`}>ID: {key.id}</div>
                    </td>
                    <td className="py-3 px-2">
                      {key.enabled ? <span className={badgeSuccess}>Active</span> : <span className={badgeWarning}>Revoked</span>}
                    </td>
                    <td className={`py-3 px-2 text-xs hidden sm:table-cell ${t_textMuted}`}>{key.expires_at_display}</td>
                    <td className="py-3 px-2 text-right">
                      <div className="inline-flex items-center gap-2">
                        {typeof key.id === 'string' && key.id.startsWith('U-') ? (
                          <span className={`text-xs italic ${t_textMuted}`}>Managed in Users</span>
                        ) : (
                          <>
                            <button onClick={() => handleViewStoredKey(key.id)} className={glassButton} aria-label={`View key ${key.name}`}>View</button>
                            {key.enabled ? (
                              <button onClick={() => handleRevokeKey(key.id)} className={`${dangerButton} sm:opacity-0 group-hover:opacity-100 focus:opacity-100`}>Revoke</button>
                            ) : (
                              <>
                                <span className={`text-xs ${t_textMuted}`}>{key.revoked_at_display}</span>
                                <button onClick={() => handleDeleteRevokedKey(key.id)} className={dangerButton}>Delete</button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {apiKeys.length === 0 && <EmptyState icon={Inbox} title="No API keys" description="Create your first key below." />}
              </tbody>
            </table>
          </div>
          
          <form onSubmit={handleCreateKey} className="flex flex-col sm:flex-row gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              <div>
                <label className={`text-xs ${t_textMuted}`}>Key Name</label>
                <input type="text" name="key_name" required placeholder="New key name..." className={glassInput} />
              </div>
              <div>
                <label className={`text-xs ${t_textMuted}`}>Expiry (days)</label>
                <input type="number" name="expiry_days" defaultValue="30" min="1" className={glassInput} title="Expiry days" />
              </div>
              <label className={`flex items-center gap-2 text-xs ${t_textMuted}`}>
                <input type="checkbox" checked={createKeyAllDomains} onChange={(e) => setCreateKeyAllDomains(e.target.checked)} /> All domains access
              </label>
              <div className={`max-h-24 overflow-auto rounded-xl border p-2 ${t_borderLight} ${createKeyAllDomains ? "opacity-50 pointer-events-none" : ""}`}>
                {access.allowed_domains.length === 0 && (
                  <div className={`text-xs ${t_textMuted}`}>No allowed domains configured yet.</div>
                )}
                {access.allowed_domains.map((domain) => (
                  <label key={domain} className={`flex items-center gap-2 text-xs ${t_textMuted}`}>
                    <input type="checkbox" checked={createKeyDomainSelections.includes(domain)} onChange={() => toggleCreateKeyDomain(domain)} />
                    {domain}
                  </label>
                ))}
              </div>
              <div>
                <label className={`text-xs ${t_textMuted}`}>Rate Limit RPM (requests/min)</label>
                <input type="number" name="requests_per_minute" defaultValue="60" min="1" className={glassInput} title="Per-key RPM" />
              </div>
              <div>
                <label className={`text-xs ${t_textMuted}`}>Key Type</label>
                <select name="key_type" className={glassInput} title="Key Type">
                  <option value="user">Legacy Device-bound Key</option>
                  <option value="master">Master Key (No Restrictions)</option>
                </select>
              </div>
              <div>
                <label className={`text-xs ${t_textMuted}`}>Burst (extra requests/min)</label>
                <input type="number" name="burst" defaultValue="10" min="0" className={glassInput} title="Per-key burst" />
              </div>
              <div>
                <label className={`text-xs ${t_textMuted}`}>Legacy Plan Label</label>
                <input type="text" name="plan_name" defaultValue="Standard" className={glassInput} title="Legacy plan label" />
              </div>
              <div>
                <label className={`text-xs ${t_textMuted}`}>Mobile</label>
                <input type="text" name="mobile" className={glassInput} title="User mobile" />
              </div>
              <div>
                <label className={`text-xs ${t_textMuted}`}>Telegram ID</label>
                <input type="text" name="telegram_id" className={glassInput} title="Telegram ID" />
              </div>
              <div className={`sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border p-2 ${t_borderLight}`}>
                {["autofill", "captcha", "exam", "solver"].map((svc) => (
                  <label key={svc} className={`flex items-center gap-2 text-xs capitalize ${t_textMuted}`}>
                    <input type="checkbox" name={`service_${svc}`} defaultChecked />
                    {svc}
                  </label>
                ))}
              </div>
            </div>
            <button
              type="submit"
              className={`${solidButton} w-full sm:w-auto self-end`}
            >
              <span className="inline-flex items-center gap-1"><Plus size={14}/> Create</span>
            </button>
          </form>
        </div>
      </div>

      {/* Access Control Container */}
      <div className={`rounded-2xl flex flex-col transition-colors duration-500 overflow-hidden ${glassPanel}`}>
        <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
          <div className="p-2 bg-purple-500/20 text-purple-500 rounded-lg backdrop-blur-md"><ShieldCheck size={20}/></div>
          <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>Access Control</h2>
        </div>
        
        <div className="p-5 flex-1 space-y-6">
          <label className={`flex items-start sm:items-center gap-3 cursor-pointer p-4 rounded-xl border transition-colors backdrop-blur-md ${isDark ? 'bg-white/[0.03] border-white/10 hover:bg-white/[0.08]' : 'bg-white/50 border-white/80 hover:bg-white/80'}`}>
            <input 
              type="checkbox" 
              checked={access.global_access}
              onChange={(e) => handleToggleGlobalAccess(e.target.checked)}
              className={`mt-1 sm:mt-0 w-5 h-5 rounded text-indigo-500 focus:ring-indigo-500 ${isDark ? 'border-gray-600 bg-gray-700/50' : 'border-slate-300 bg-white/50'}`} 
            />
            <div>
              <div className={`text-sm font-medium ${t_textHeading}`}>Enable Global Access</div>
              <div className={`text-xs ${t_textMuted}`}>Skip all domain-based restrictions</div>
            </div>
          </label>

          <div>
            <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 drop-shadow-sm ${t_textMuted}`}>Allowed Domains Whitelist</h4>
            <div className="flex flex-wrap gap-2 mb-4 max-h-32 overflow-auto pr-1 custom-scrollbar">
              {access.allowed_domains.map(domain => (
                <div key={domain} className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg text-sm transition-colors backdrop-blur-md ${isDark ? 'bg-white/[0.05] border-white/10 hover:bg-white/[0.1]' : 'bg-white/60 border-white/80 hover:bg-white shadow-sm'}`}>
                  <span className={`font-mono text-xs ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>{domain}</span>
                  <button onClick={() => handleRemoveDomain(domain)} className="text-gray-400 hover:text-rose-500 transition-colors" aria-label={`Remove domain ${domain}`}><XCircle size={14}/></button>
                </div>
              ))}
            </div>
            
            <form onSubmit={handleAddDomain} className="flex flex-col sm:flex-row gap-3">
              <input type="text" name="new_domain" placeholder="Add domain (e.g. site.gov.in)" className={glassInput} />
              <button type="submit" className={`w-full sm:w-auto ${glassButton}`}>Add</button>
            </form>
          </div>
        </div>
      </div>
    </div>

    {/* User-linked API keys (from Telegram bot registrations) */}
    <div className="mt-6">
      <UserKeysSection />
    </div>
    </>
  );
}

// ── User API Keys Section (self-contained, fetches its own data) ─────────────

function UserKeysSection() {
  const { t_textHeading, t_textMuted, t_borderLight, glassPanel, badgeSuccess, badgeWarning } = useThemeContext();
  const [userKeys, setUserKeys] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet("/admin/api/user-keys?status=active&limit=100")
      .then(data => { setUserKeys(data.keys || []); setTotal(data.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className={`rounded-2xl p-6 ${glassPanel} flex justify-center`}>
      <Loader2 className="animate-spin text-indigo-500" size={24} />
    </div>
  );

  if (userKeys.length === 0) return null;

  return (
    <div className={`rounded-2xl flex flex-col transition-colors duration-500 overflow-hidden ${glassPanel}`}>
      <div className={`p-5 border-b flex items-center gap-3 ${t_borderLight}`}>
        <div className="p-2 bg-emerald-500/20 text-emerald-500 rounded-lg backdrop-blur-md"><Users size={20}/></div>
        <div>
          <h2 className={`text-lg font-semibold tracking-wide drop-shadow-sm ${t_textHeading}`}>User API Keys</h2>
          <p className={`text-xs ${t_textMuted}`}>Keys created via Telegram bot registration — {total} total</p>
        </div>
      </div>
      <div className="overflow-auto max-h-72 p-5 custom-scrollbar">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead>
            <tr className={`border-b ${t_textMuted} ${t_borderLight}`}>
              <th className="pb-3 font-medium px-2">User</th>
              <th className="pb-3 font-medium px-2">Mobile</th>
              <th className="pb-3 font-medium px-2">Key Prefix</th>
              <th className="pb-3 font-medium px-2">Version</th>
              <th className="pb-3 font-medium px-2">Status</th>
              <th className="pb-3 font-medium px-2">Issued</th>
              <th className="pb-3 font-medium px-2">Last Used</th>
              <th className="pb-3 font-medium px-2">Usage</th>
              <th className="pb-3 font-medium px-2">Expires</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${t_borderLight}`}>
            {userKeys.map(k => (
              <tr key={`uk-${k.id}`} className="group">
                <td className={`py-3 px-2 font-medium ${t_textHeading}`}>{k.user_name || "—"}</td>
                <td className={`py-3 px-2 text-xs ${t_textMuted}`}>{k.user_mobile || "—"}</td>
                <td className={`py-3 px-2 font-mono text-xs ${t_textHeading}`}>{k.key_prefix || "—"}</td>
                <td className={`py-3 px-2 text-xs ${t_textMuted}`}>v{k.key_version}</td>
                <td className="py-3 px-2">
                  {k.status === "active" ? <span className={badgeSuccess}>Active</span> : <span className={badgeWarning}>{k.status}</span>}
                </td>
                <td className={`py-3 px-2 text-xs ${t_textMuted}`}>{k.issued_at ? new Date(k.issued_at).toLocaleDateString() : "—"}</td>
                <td className={`py-3 px-2 text-xs ${t_textMuted}`}>{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "—"}</td>
                <td className={`py-3 px-2 text-xs ${t_textMuted}`}>{k.usage_count || 0}</td>
                <td className={`py-3 px-2 text-xs ${t_textMuted}`}>{k.expires_at ? new Date(k.expires_at).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

KeysPanel.propTypes = {
  apiKeys: PropTypes.array.isRequired,
  access: PropTypes.object.isRequired,
  masterKeyInfo: PropTypes.object,
  createKeyAllDomains: PropTypes.bool.isRequired,
  setCreateKeyAllDomains: PropTypes.func.isRequired,
  createKeyDomainSelections: PropTypes.array.isRequired,
  toggleCreateKeyDomain: PropTypes.func.isRequired,
  handleCreateKey: PropTypes.func.isRequired,
  handleRevokeKey: PropTypes.func.isRequired,
  handleDeleteRevokedKey: PropTypes.func.isRequired,
  handleViewStoredKey: PropTypes.func.isRequired,
  handleToggleGlobalAccess: PropTypes.func.isRequired,
  handleRemoveDomain: PropTypes.func.isRequired,
  handleAddDomain: PropTypes.func.isRequired,
};
