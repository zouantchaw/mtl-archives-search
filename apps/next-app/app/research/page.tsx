import type { Metadata } from "next";
import ReadingRoom from "./reading-room";
import { decodeCollection } from "@/lib/research/collection-url";
export const metadata: Metadata = {
  title: "Salle de lecture — Reading room",
  description:
    "Explore Montréal’s photographic archives through conversation, with photographs and sources side by side.",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; c?: string }>;
}) {
  const params = await searchParams;
  return (
    <ReadingRoom
      initialLang={params.lang === "en" ? "en" : "fr"}
      initialIds={decodeCollection(params.c)}
    />
  );
}
