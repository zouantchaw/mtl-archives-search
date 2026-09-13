import type { Metadata } from "next";
import ReadingRoom from "./reading-room";
export const metadata: Metadata = {
  title: "Salle de lecture — Reading room",
  description:
    "Explore Montréal’s photographic archives through conversation, with photographs and sources side by side.",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  return (
    <ReadingRoom
      initialLang={(await searchParams).lang === "en" ? "en" : "fr"}
    />
  );
}
