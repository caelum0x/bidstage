import { connection } from "next/server";

import { CountryDirectory } from "@/components/country-directory";

export const metadata = {
  title: "Open-source country communities",
  description: "Browse sponsored open-source projects, contribution opportunities, and opt-in contributors by self-described country community.",
};

export default async function CountriesPage() {
  await connection();
  return <CountryDirectory />;
}
