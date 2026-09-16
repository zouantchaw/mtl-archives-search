import type { Metadata } from "next";
import { archiveOrigin } from "@/lib/research/archive";
import { PACKAGE_ID_RE, type ProvenancePackage } from "@/lib/research/package";
import PackageDossier from "./package-dossier";
import styles from "./package.module.css";

export const metadata: Metadata = {
  title: "Provenance package",
  robots: { index: false, follow: false },
};

async function getPackage(id: string): Promise<ProvenancePackage | null> {
  try {
    const response = await fetch(new URL(`/api/packages/${id}`, archiveOrigin), {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as ProvenancePackage;
  } catch {
    return null;
  }
}

export default async function PackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { id } = await params;
  const { lang } = await searchParams;
  if (!PACKAGE_ID_RE.test(id)) return <Missing />;
  const pkg = await getPackage(id);
  if (!pkg) return <Missing />;
  return (
    <PackageDossier initial={pkg} lang={lang === "en" ? "en" : "fr"} />
  );
}

function Missing() {
  return (
    <main className={styles.page}>
      <div className={styles.empty}>
        <h1>Package not found</h1>
        <p>This handoff link is unknown or no longer available.</p>
      </div>
    </main>
  );
}
