import { connection } from "next/server";

import { ContributorDirectory } from "@/components/contributor-directory";
import { isCountryCode } from "@/lib/countries";

export const metadata = {
  title: "Open-source contributors",
  description: "Find opt-in, GitHub-linked open-source contributors by skill, country, and availability.",
};

export default async function ContributorsPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string | string[] }>;
}) {
  await connection();
  const rawCountry = (await searchParams).country;
  const requestedCountry = typeof rawCountry === "string" ? rawCountry.toUpperCase() : "";
  return <ContributorDirectory initialCountry={isCountryCode(requestedCountry) ? requestedCountry : "all"} />;
}
