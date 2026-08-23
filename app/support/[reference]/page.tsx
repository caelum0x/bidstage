import type { Metadata } from "next";

import { SupportCaseStatus } from "@/components/support-case-status";

export const metadata: Metadata = {
  title: "Private support case",
  description: "Read the status of a receipt-linked Bidstage support case.",
  robots: { index: false, follow: false },
};

export default async function SupportPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return <SupportCaseStatus reference={reference} />;
}
