/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // v3.0: modern dark-mode "AI assistant" aesthetic -- near-black
        // surfaces with a single bright blue accent, replacing the earlier
        // navy/gold letterhead system. Old navy/gold tokens kept as aliases
        // so nothing referencing them elsewhere silently breaks.
        bg: "#0B0E13",           // app background, near-black
        surface: "#151A22",      // cards, header, composer bar
        surfaceRaised: "#1C222C", // hover/active state on surface
        accent: "#2F8FFF",       // primary blue -- buttons, user bubble, active states
        accentSoft: "#7AB8FF",   // lighter blue for text-on-dark, subtle highlights
        mist: "#F4F7FB",
        paper: "#FAFAF8",
        // Legacy aliases (kept for any class still referencing them)
        night: "#0B1120",
        panel: "#151A22",
        navy: "#0B0E13",
        navyDeep: "#0B0E13",
        gold: "#2F8FFF",
        goldSoft: "#7AB8FF",
        brandTeal: "#17C3A2",
        brandTealSoft: "#5EEAD4",
      },
      fontFamily: {
        // Sora was already being loaded (see app/layout.tsx) but never
        // actually applied anywhere -- v2.0 puts it to use as the display
        // face for institutional/header moments, paired with Inter for
        // body/chat text, per a deliberate two-role type pairing.
        display: ["Sora", "sans-serif"],
        body: ["Inter", "sans-serif"],
        tamil: ["Noto Sans Tamil", "Inter", "sans-serif"],
      },
      backgroundImage: {
        // Pure-CSS ambient grid -- no external asset -- low-opacity blue
        // dot/line texture behind the empty state, echoing the reference
        // design's faint radial pattern without copying any actual asset.
        "blueprint-grid":
          "linear-gradient(rgba(47,143,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(47,143,255,0.05) 1px, transparent 1px)",
        "blueprint-grid-dark":
          "linear-gradient(rgba(47,143,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(47,143,255,0.07) 1px, transparent 1px)",
      },
      backgroundSize: {
        blueprint: "18px 18px",
      },
      keyframes: {
        blink: { "50%": { opacity: "0" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        blink: "blink 1s step-end infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
