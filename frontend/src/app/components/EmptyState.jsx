import React from "react";
import PropTypes from "prop-types";
import { useThemeContext } from "../context/ThemeContext";

export function EmptyState({ icon: Icon, title, description, colSpan = 99 }) {
  const { t_textMuted, t_textHeading, isDark } = useThemeContext();
  return (
    <td colSpan={colSpan} className="py-16 text-center">
      <div className="flex flex-col items-center gap-4">
        {Icon && <div className={`p-4 rounded-2xl border ${isDark ? 'bg-white/[0.03] border-white/[0.05]' : 'bg-black/[0.02] border-black/[0.05]'}`}>
          <Icon size={36} className={t_textMuted} />
        </div>}
        <p className={`text-sm font-semibold ${t_textHeading}`}>{title}</p>
        {description && <p className={`text-xs ${t_textMuted} max-w-sm`}>{description}</p>}
      </div>
    </td>
  );
}

EmptyState.propTypes = {
  icon: PropTypes.elementType,
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  colSpan: PropTypes.number,
};