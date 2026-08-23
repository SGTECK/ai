"use client";

export interface QuickAction {
  emoji: string;
  labelEn: string;
  labelTa: string;
  question: string;
  primary?: boolean;
}

/** Primary six first (demo-friendly), rest secondary */
export const QUICK_ACTIONS: QuickAction[] = [
  { emoji: "🎓", labelEn: "Admissions", labelTa: "சேர்க்கை", question: "What is the admission process?", primary: true },
  { emoji: "📚", labelEn: "Courses", labelTa: "படிப்புகள்", question: "What are the B.E. courses available?", primary: true },
  { emoji: "🏠", labelEn: "Hostel", labelTa: "விடுதி", question: "Tell me about hostel facilities and fees.", primary: true },
  { emoji: "💰", labelEn: "Fees", labelTa: "கட்டணம்", question: "What is the fee structure?", primary: true },
  { emoji: "💼", labelEn: "Placements", labelTa: "வேலைவாய்ப்பு", question: "Tell me about placements.", primary: true },
  { emoji: "📞", labelEn: "Contact", labelTa: "தொடர்பு", question: "How can I contact the college?", primary: true },
  { emoji: "🏫", labelEn: "Departments", labelTa: "துறைகள்", question: "What departments are available?" },
  { emoji: "🎓", labelEn: "Scholarships", labelTa: "உதவித்தொகை", question: "Are scholarships available?" },
  { emoji: "📅", labelEn: "Calendar", labelTa: "நாட்காட்டி", question: "What is the academic calendar?" },
  { emoji: "📢", labelEn: "Notices", labelTa: "அறிவிப்புகள்", question: "What are the latest admission notifications?" },
  { emoji: "🔬", labelEn: "Research", labelTa: "ஆராய்ச்சி", question: "Tell me about research activities at GCE-TLY." },
  { emoji: "🏢", labelEn: "Facilities", labelTa: "வசதிகள்", question: "What facilities are available on campus?" },
];

export default function QuickActions({
  onPick,
  language,
}: {
  onPick: (question: string) => void;
  language: "en" | "ta";
}) {
  const primary = QUICK_ACTIONS.filter((a) => a.primary);
  const more = QUICK_ACTIONS.filter((a) => !a.primary);

  const title =
    language === "ta" ? "பிரபலமான தலைப்புகள்" : "Popular topics";
  const moreTitle =
    language === "ta" ? "மேலும்" : "More";

  return (
    <div className="px-3 pb-2 space-y-2.5 fade-up">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500 text-slate-600 px-0.5">
        {title}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {primary.map((a) => (
          <button
            key={a.labelEn}
            type="button"
            onClick={() => onPick(a.question)}
            aria-label={`Ask: ${a.question}`}
            className="chip-press min-h-[52px] flex flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2.5 text-center
                       bg-slate-50 border border-slate-200 hover:border-accent/50 hover:bg-accent/5
                       dark:bg-surfaceRaised/80 dark:border-white/[0.08] dark:hover:border-accent/45 dark:hover:bg-accent/10
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent/60 focus-visible:outline-offset-2
                       transition-all duration-200"
          >
            <span className="text-lg leading-none" aria-hidden="true">
              {a.emoji}
            </span>
            <span className="text-[10px] font-medium text-slate-700 dark:text-slate-200 leading-tight">
              {language === "ta" ? a.labelTa : a.labelEn}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 px-0.5 pt-0.5">
        {moreTitle}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {more.map((a) => (
          <button
            key={a.labelEn}
            type="button"
            onClick={() => onPick(a.question)}
            aria-label={`Ask: ${a.question}`}
            className="chip-press min-h-[44px] flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-center
                       bg-white border border-slate-200/80 hover:border-slate-300 hover:bg-slate-50
                       dark:bg-surface/60 dark:border-white/[0.05] dark:hover:border-white/15 dark:hover:bg-surfaceRaised
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent/50 focus-visible:outline-offset-2
                       transition-all duration-200"
          >
            <span className="text-sm leading-none" aria-hidden="true">
              {a.emoji}
            </span>
            <span className="text-[9.5px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
              {language === "ta" ? a.labelTa : a.labelEn}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
