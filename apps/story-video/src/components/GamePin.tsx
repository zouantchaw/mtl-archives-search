import React from "react";
import { colors } from "../lib/brand";

/**
 * Guess pin marker — matches the game's blue circle pin.
 * Mirrors: GameClient.tsx .game-marker-guess
 */
export const GuessPin: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      backgroundColor: colors.blue,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
      border: `3px solid white`,
    }}
  >
    <svg
      width={size * 0.45}
      height={size * 0.45}
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth="2.5"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  </div>
);

/**
 * Actual location pin — matches the game's green checkmark circle.
 * Mirrors: GameClient.tsx .game-marker-actual
 */
export const ActualPin: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      backgroundColor: "#22c55e", // emerald-500
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
      border: `3px solid white`,
    }}
  >
    <svg
      width={size * 0.45}
      height={size * 0.45}
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth="2.5"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  </div>
);
