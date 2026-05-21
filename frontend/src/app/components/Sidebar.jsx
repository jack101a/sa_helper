import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { NavLink, useLocation } from "react-router-dom";
import { 
  LayoutDashboard, Database, Activity, BrainCircuit, Settings, 
  Sun, Moon, LogOut, MapPin, Download, Code, Menu, X,
  Users, CreditCard
} from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";

const NAV_ITEMS = [
  { path: "/dashboard",   label: "Dashboard",      icon: LayoutDashboard },
  { path: "/subscriptions", label: "Subscriptions",  icon: CreditCard },
  { path: "/userscripts", label: "Userscripts",     icon: Code },
  { path: "/models",      label: "Models",          icon: Database },
  { path: "/autofill",    label: "Autofill Rules",  icon: Activity },
  { path: "/captcha",     label: "Captcha Routes",  icon: MapPin },
  { path: "/exam",        label: "MCQ/Exam",        icon: BrainCircuit },
  { path: "/settings",    label: "Settings",        icon: Settings },
];

export function Sidebar({ handleLogout }) {
  const { isDark, toggleDark, t_textHeading, t_textMuted, glassNav, glassPanel } = useThemeContext();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  const closeMobile = () => setMobileMenuOpen(false);

  const navClass = ({ isActive }) =>
    `text-sm font-medium transition-colors flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded px-1 py-0.5 ${isActive ? t_textHeading : `${t_textMuted} hover:text-indigo-500`}`;

  return (
    <>
      <nav className={`sticky top-0 z-50 transition-colors duration-500 ${glassNav}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <NavLink to="/dashboard" className="flex items-center gap-3" aria-label="Tata Captcha — Home">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <BrainCircuit size={18} className="text-white" />
              </div>
              <span className={`text-xl font-bold tracking-tight ${t_textHeading}`}>
                tata<span className="text-indigo-500">captcha</span>
              </span>
            </NavLink>
            
            <div className="hidden md:flex items-center gap-6">
              {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
                <NavLink key={path} to={path} className={navClass}>
                  <Icon size={16}/> {label}
                </NavLink>
              ))}
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <button onClick={toggleDark} className={`p-2 rounded-lg transition-colors backdrop-blur-md ${isDark ? 'hover:bg-white/10 text-amber-400' : 'hover:bg-black/5 text-slate-700'}`} title="Toggle Theme" aria-label="Toggle dark/light theme">
                {isDark ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              <button onClick={handleLogout} className={`p-2 rounded-lg hover:text-rose-500 transition-colors ${t_textMuted}`} title="Logout" aria-label="Logout">
                <LogOut size={20} />
              </button>
              <button onClick={() => setMobileMenuOpen(true)} className={`md:hidden p-2 rounded-lg transition-colors ${t_textMuted}`} title="Menu" aria-label="Open navigation menu" aria-expanded={mobileMenuOpen}>
                <Menu size={20} />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={closeMobile} />
          <div className={`fixed top-0 right-0 z-50 h-full w-64 md:hidden ${glassPanel} border-l ${isDark ? "border-white/[0.05]" : "border-black/[0.05]"} overflow-y-auto`}>
            <div className="flex items-center justify-between p-4 border-b border-white/[0.05]">
              <span className={`text-sm font-bold ${t_textHeading}`}>Navigation</span>
              <button onClick={closeMobile} className={`p-1 rounded-lg ${t_textMuted} hover:text-rose-500`} aria-label="Close navigation menu">
                <X size={20} />
              </button>
            </div>
            <div className="p-2 space-y-1">
              {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
                const active = location.pathname === path;
                const activeBg = isDark ? "bg-white/10" : "bg-black/5";
                const inactiveHover = isDark ? "hover:bg-white/5" : "hover:bg-black/5";
                return (
                  <NavLink
                    key={path}
                    to={path}
                    onClick={closeMobile}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? `${activeBg} ${t_textHeading}`
                        : `${t_textMuted} ${inactiveHover}`
                    }`}
                  >
                    <Icon size={18} /> {label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

Sidebar.propTypes = {
  handleLogout: PropTypes.func.isRequired,
};
