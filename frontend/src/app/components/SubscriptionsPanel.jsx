import React, { useState } from "react";
import PropTypes from "prop-types";
import { Users, CreditCard, Tag } from "lucide-react";
import { useThemeContext } from "../context/ThemeContext";
import { UsersPanel } from "./UsersPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import { PlansPanel } from "./PlansPanel";

const TABS = [
  { id: "users",    label: "Users",    icon: Users },
  { id: "plans",    label: "Plans",    icon: Tag },
  { id: "payments", label: "Payments", icon: CreditCard },
];

export function SubscriptionsPanel({ showToast }) {
  const { t_textHeading, t_textMuted, glassPanel, isDark } = useThemeContext();
  const [activeTab, setActiveTab] = useState("users");

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className={`rounded-2xl p-1.5 flex gap-1 transition-colors duration-500 ${glassPanel}`}>
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                active
                  ? isDark
                    ? "bg-white/10 text-white shadow-sm"
                    : "bg-white text-gray-800 shadow-sm"
                  : `${t_textMuted} hover:${t_textHeading}`
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active panel */}
      {activeTab === "users"    && <UsersPanel    showToast={showToast} />}
      {activeTab === "plans"    && <PlansPanel    showToast={showToast} />}
      {activeTab === "payments" && <PaymentsPanel showToast={showToast} />}
    </div>
  );
}

SubscriptionsPanel.propTypes = {
  showToast: PropTypes.func.isRequired,
};