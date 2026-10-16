import React from 'react';
import { Moon, Sun, MonitorSmartphone } from 'lucide-react';
import { useApp } from '../context/AppContext';

type Theme = 'light' | 'dark' | 'system';

const ORDER: Theme[] = ['light', 'dark', 'system'];

const LABEL: Record<Theme, string> = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'Match the device theme',
};

const ICON: Record<Theme, React.ReactNode> = {
  light: <Sun className="w-4 h-4" aria-hidden />,
  dark: <Moon className="w-4 h-4" aria-hidden />,
  system: <MonitorSmartphone className="w-4 h-4" aria-hidden />,
};

export const ThemeToggle: React.FC<{ className?: string; tone?: 'surface' | 'onDark' }> = ({
  className = '',
  tone = 'surface',
}) => {
  const { theme, setTheme } = useApp();

  const next = () => setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]);

  const tones =
    tone === 'onDark'
      ? 'border-white/25 bg-white/10 text-slate-100 hover:border-[#F59A16] hover:text-[#F59A16]'
      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-[#F59A16] hover:text-[#123B60] dark:hover:text-[#F59A16]';

  return (
    <button
      type="button"
      onClick={next}
      title={`${LABEL[theme]} — click to switch`}
      aria-label={LABEL[theme]}
      className={`inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider ${tones} ${className}`}
    >
      {ICON[theme]}
      <span>{theme}</span>
    </button>
  );
};

export default ThemeToggle;
