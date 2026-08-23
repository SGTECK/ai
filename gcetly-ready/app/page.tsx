import ChatWindow from "@/components/ChatWindow";

/**
 * Page chrome follows html.dark set by the theme script + ChatWindow.
 * Dark = default product look; light = soft mist background.
 */
export default function Home() {
  return (
    <main className="relative min-h-screen w-full flex items-center justify-center p-3 sm:p-6 overflow-hidden bg-[#F0F4FA] dark:bg-[#070A0F] transition-colors duration-300">
      <div
        className="pointer-events-none absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full opacity-40 dark:opacity-50 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(47,143,255,0.28) 0%, rgba(47,143,255,0) 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute -bottom-32 -right-20 h-[480px] w-[480px] rounded-full opacity-30 dark:opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(23,195,162,0.22) 0%, rgba(23,195,162,0) 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45] dark:opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(47,143,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(47,143,255,0.05) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage:
            "radial-gradient(ellipse 80% 70% at 50% 50%, black 20%, transparent 100%)",
        }}
      />

      <div className="relative z-10 w-full flex justify-center">
        <ChatWindow />
      </div>
    </main>
  );
}
