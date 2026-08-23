import type { Metadata } from "next";

import { ReceiptStatus } from "@/components/receipt-status";

export const metadata: Metadata = {
  title: "Settlement receipt",
  description: "Verify a Bidstage sponsored-placement settlement.",
  robots: { index: false, follow: false },
};

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  return <ReceiptStatus reference={reference} />;
}
