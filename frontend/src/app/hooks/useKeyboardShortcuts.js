import { useEffect, useRef } from 'react';

export function useKeyboardShortcuts(shortcuts = {}) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts if the user is typing in an input or textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      const s = shortcutsRef.current;

      if (e.key === '/') {
        e.preventDefault();
        if (s.onSearch) s.onSearch();
      }

      if (e.key === 'Escape') {
        if (s.onEscape) s.onEscape();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // use ref to avoid re-attaching on every render
}