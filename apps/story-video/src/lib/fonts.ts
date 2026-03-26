import { loadFont as loadSpectral } from "@remotion/google-fonts/Spectral";
import { loadFont as loadFigtree } from "@remotion/google-fonts/Figtree";
import { loadFont as loadIBMPlexMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadManrope } from "@remotion/google-fonts/Manrope";

export const spectral = loadSpectral("normal", {
  weights: ["400", "600", "700"],
  subsets: ["latin", "latin-ext"],
});

export const figtree = loadFigtree("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin", "latin-ext"],
});

export const ibmPlexMono = loadIBMPlexMono("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});

export const manrope = loadManrope("normal", {
  weights: ["700", "800"],
  subsets: ["latin", "latin-ext"],
});
