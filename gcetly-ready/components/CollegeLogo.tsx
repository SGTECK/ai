"use client";

import { useState } from "react";
import { GraduationCap } from "lucide-react";

/**
 * Real official GCE-TLY logo, hotlinked from the college's own site (not a
 * redistributed copy) -- same asset verified and used across every preview
 * iteration (V4 onward), but this was never actually added to the
 * downloadable production project until this pass. If the hotlink fails
 * for any reason (offline, asset moved), falls back to a plain icon rather
 * than a broken-image glyph.
 */
export default function CollegeLogo({ size = 36 }: { size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="flex items-center justify-center rounded-full text-white bg-navy shrink-0"
        style={{ width: size, height: size }}
      >
        <GraduationCap size={size * 0.5} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external hotlink, not a local asset next/image can optimize
    <img
      src="https://gcetly.ac.in/imgs/gcelogo.jpg"
      alt="Government College of Engineering, Tirunelveli official logo"
      width={size}
      height={size}
      className="rounded-full object-cover shrink-0 bg-white"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
