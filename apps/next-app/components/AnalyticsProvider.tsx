"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/cloudflare-analytics";
export function AnalyticsProvider() {
  const path = usePathname();
  useEffect(() => { if (path && !path.startsWith("/api/")) track("pageview"); }, [path]);
  return null;
}
