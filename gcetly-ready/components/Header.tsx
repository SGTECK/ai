"use client";

import { Plus, Moon, Sun } from "lucide-react";
import CollegeLogo from "./CollegeLogo";

export default function Header({
  darkMode,
  onToggleDark,
  onNewChat,
  language,
  onToggleLanguage,
}: {
  darkMode: boolean;
  onToggleDark: () => void;
  onNewChat: () => void;
  language: "en" | "ta";
  onToggleLanguage: () => void;
}) {
  const t = {
    newChat: language === "ta" ? "புதிய அரட்டை" : "New Chat",
    dark: language === "ta" ? "இருண்ட முறை" : "Switch to dark mode",
    light: language === "ta" ? "வெளிச்ச முறை" : "Switch to light mode",
    status:
      language === "ta"
        ? "தயார் · அதிகாரப்பூர்வ தகவல் உதவியாளர்"
        : "Online · Official College Information Assistant",
  };

  const btn =
    "p-2 rounded-full transition-all duration-200 " +
    "text-slate-600 hover:text-slate-900 bg-slate-100/80 hover:bg-slate-200/90 border border-slate-200/80 " +
    "dark:text-white/70 dark:bg-white/[0.04] dark:hover:bg-white/[0.10] dark:hover:text-white dark:border-transparent dark:hover:border-white/[0.06]";

  return (
    <div data-testid="app-header" className="relative bg-gradient-to-b from-white to-slate-50 border-b border-slate-200/80 dark:from-surfaceRaised/80 dark:to-surface dark:border-white/[0.06]">
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(47,143,255,0.45), rgba(23,195,162,0.35), transparent)",
        }}
      />
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative shrink-0">
            <CollegeLogo size={36} />
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-white dark:ring-surface" />
          </div>
          <div className="min-w-0">
            <p className="font-display font-bold text-[13.5px] tracking-tight text-slate-900 dark:text-white leading-tight truncate">
              GCE-TLY AI Assistant
            </p>
            <p className="text-[10.5px] text-slate-500 dark:text-white/55 flex items-center gap-1.5 mt-0.5">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent" />
              </span>
              <span className="truncate">{t.status}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onToggleLanguage}
            data-testid="btn-language"
            className="px-2.5 py-1.5 text-[11px] font-semibold rounded-full transition-all text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 dark:text-white/80 dark:bg-white/[0.05] dark:hover:bg-white/[0.12] dark:border-white/[0.06]"
            title={language === "ta" ? "Switch to English" : "Switch to Tamil"}
            aria-label={language === "ta" ? "Switch to English" : "Switch to Tamil"}
          >
            {language === "ta" ? "EN" : "தமிழ்"}
          </button>
          <button onClick={onNewChat} data-testid="btn-new-chat" className={btn} title={t.newChat} aria-label={t.newChat}>
            <Plus size={15} />
          </button>
          <button
            onClick={onToggleDark}
            data-testid="btn-theme"
            className={btn}
            title={darkMode ? t.light : t.dark}
            aria-label={darkMode ? t.light : t.dark}
          >
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
