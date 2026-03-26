import React from "react";
import { colors } from "../lib/brand";
import { manrope, ibmPlexMono } from "../lib/fonts";

/**
 * Game header bar — matches the game's dark top bar.
 * Mirrors: GameClient.tsx <header> (h-12, bg-brand-dark, border-white/8)
 */
type Props = {
  scoreText?: string;
  mode?: string;
};

export const GameHeader: React.FC<Props> = ({
  scoreText = "-- PTS",
  mode = "Quotidien",
}) => (
  <div
    style={{
      height: 56,
      backgroundColor: colors.dark,
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: 16,
      paddingRight: 16,
    }}
  >
    {/* Left — back arrow + brand */}
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(255,255,255,0.88)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span
        style={{
          fontFamily: manrope.fontFamily,
          fontSize: 13,
          fontWeight: 700,
          color: "rgba(255,255,255,0.88)",
          letterSpacing: "0.04em",
        }}
      >
        mtl archives
      </span>
    </div>

    {/* Right — score + mode */}
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          fontFamily: ibmPlexMono.fontFamily,
          fontSize: 11,
          fontWeight: 500,
          color: colors.blue,
          letterSpacing: "0.12em",
          textTransform: "uppercase" as const,
        }}
      >
        {scoreText}
      </span>
      <span
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
        }}
      >
        {mode}
      </span>
    </div>
  </div>
);
