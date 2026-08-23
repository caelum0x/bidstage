import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CountryCommunity } from "@/components/country-community";
import { countryName, isCountryCode } from "@/lib/countries";

type CountryPageProps = { params: Promise<{ code: string }> };

function checkedCountryCode(code: string) {
  const countryCode = code.toUpperCase();
  if (!isCountryCode(countryCode)) notFound();
  return countryCode;
}

export async function generateMetadata({ params }: CountryPageProps): Promise<Metadata> {
  const countryCode = checkedCountryCode((await params).code);
  const name = countryName(countryCode);
  return {
    title: `${name} open-source community`,
    description: `Browse sponsored projects, contribution opportunities, and opt-in contributors in Bidstage's ${name} open-source community.`,
    alternates: { canonical: `/country/${countryCode}` },
  };
}

export default async function CountryPage({ params }: CountryPageProps) {
  const countryCode = checkedCountryCode((await params).code);
  return <CountryCommunity countryCode={countryCode} />;
}
