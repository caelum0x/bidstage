import type { Metadata } from "next";

import { FounderAccount } from "@/components/founder-account";

export const metadata: Metadata = {
  title: "Your products",
  description: "Review Bidstage project records, contributor identity, and private opportunity applications.",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <FounderAccount />;
}
