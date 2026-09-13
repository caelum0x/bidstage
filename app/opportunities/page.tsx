import { connection } from "next/server";

import { OpportunityDirectory } from "@/components/opportunity-directory";
import { isCountryCode } from "@/lib/countries";

export const metadata = {
  title: "Open-source contribution opportunities",
  description: "Find maintainer-authored contribution opportunities bound to verified open-source repositories.",
  alternates: { canonical: "/opportunities" },
};

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string | string[] }>;
}) {
  await connection();
  const rawCountry = (await searchParams).country;
  const requestedCountry = typeof rawCountry === "string" ? rawCountry.toUpperCase() : "";
  return <OpportunityDirectory initialCountry={isCountryCode(requestedCountry) ? requestedCountry : "all"} />;
}
