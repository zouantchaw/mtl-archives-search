import React from "react";
import { colors } from "../lib/brand";
import { figtree } from "../lib/fonts";

/**
 * CTA pill — matches the game's floating action button.
 * Mirrors: GameClient.tsx mobile CTA pill (h-[52px], rounded-full, shadow-xl)
 */
type Props = {
  label: string;
  active?: boolean;
};

export const CtaPill: React.FC<Props> = ({ label, active = true }) => (
  <div
    style={{
      height: 52,
      minWidth: 220,
      borderRadius: 52,
      backgroundColor: active ? "white" : "rgba(255,255,255,0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      paddingLeft: 32,
      paddingRight: 32,
      boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
    }}
  >
    <span
      style={{
        fontFamily: figtree.fontFamily,
        fontSize: 16,
        fontWeight: 500,
        color: active ? colors.charcoal : "rgba(255,255,255,0.55)",
      }}
    >
      {label}
    </span>
  </div>
);
