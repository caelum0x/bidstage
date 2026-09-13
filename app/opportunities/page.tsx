import type { Metadata } from "next";
import { connection } from "next/server";

import { OpportunityDirectory } from "@/components/opportunity-directory";
import { isCountryCode } from "@/lib/countries";
import { OPPORTUNITY_FAQS } from "@/lib/opportunity-content";
import { readPublicOpportunities, type PublicOpportunityData } from "@/lib/public-opportunities";

export const metadata: Metadata = {
  title: "Open Source Projects to Contribute To",
  description: "Find open-source projects to contribute to by language, category, or country. Review verified maintainer requests and repository details.",
  alternates: { canonical: "/opportunities" },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: OPPORTUNITY_FAQS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string | string[] }>;
}) {
  await connection();
  const rawCountry = (await searchParams).country;
  const requestedCountry = typeof rawCountry === "string" ? rawCountry.toUpperCase() : "";
  const initialCountry = isCountryCode(requestedCountry) ? requestedCountry : "all";
  let initialData: PublicOpportunityData | undefined;
  try {
    initialData = await readPublicOpportunities({ country: initialCountry === "all" ? null : initialCountry });
  } catch {
    // The client directory retains its retry state when the database is unavailable.
  }
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
      />
      <OpportunityDirectory initialCountry={initialCountry} initialData={initialData} />
    </>
  );
}
