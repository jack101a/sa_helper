import React from "react";
import { useThemeContext } from "../context/ThemeContext";

export function SkeletonCard() {
  const { isDark } = useThemeContext();
  const base = isDark ? "bg-white/10" : "bg-black/10";
  return (
    <div className={`rounded-2xl p-5 ${isDark ? "bg-white/[0.03] border border-white/5" : "bg-black/[0.03] border border-black/5"}`}>
      <div className={`h-3 w-24 rounded mb-3 ${base} skeleton-shimmer`} />
      <div className={`h-8 w-16 rounded mb-2 ${base} skeleton-shimmer`} />
      <div className={`h-4 w-12 rounded ${base} skeleton-shimmer`} />
    </div>
  );
}

export function SkeletonTableRow({ cols = 4 }) {
  const { isDark } = useThemeContext();
  const base = isDark ? "bg-white/10" : "bg-black/10";
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="p-3">
          <div className={`h-4 rounded w-full max-w-[120px] ${base} skeleton-shimmer`} />
        </td>
      ))}
    </tr>
  );
}