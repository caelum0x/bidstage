"use client";

import { useCallback, useEffect, useState } from "react";

import { countryName, type CountryCode } from "@/lib/countries";

type CountrySummary = {
  countryCode: CountryCode;
  projectCount: number;
  contributionCents: string;
  verifiedVisits: string;
  opportunityCount: number;
  contributorCount: number;
  availableContributorCount: number;
};

type CountryIndex = { countries: CountrySummary[] };

const money = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function placementTotal(cents: string) {
  return money.format(Number(cents) / 100);
}

export function CountryDirectory() {
  const [data, setData] = useState<CountryIndex>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const response = await fetch("/api/countries");
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Country communities could not be loaded.");
      setData(body as CountryIndex);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Country communities could not be loaded.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="countries-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation">
        <a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a>
        <div><a href="/bids">How bidding works</a><a href="/#board">Projects</a><a href="/opportunities">Opportunities</a><a href="/contributors">Contributors</a></div>
      </nav>

      <section className="countries-hero shell">
        <div className="eyebrow"><span>Voluntary community location</span><span>Country boards</span></div>
        <div className="countries-heading">
          <div>
            <h1>Open source,<br /><em>community by community.</em></h1>
            <p>Browse sponsored projects, concrete contribution work, and opt-in contributors connected to the same country community.</p>
          </div>
          <aside className="country-boundary">
            <strong>What “country” means here</strong>
            <p>A maintainer or contributor chooses their primary community location. It is not a claim about nationality, incorporation, residence, or repository ownership.</p>
          </aside>
        </div>
        <div className="country-index-count" aria-hidden="true">
          <span>Represented now</span><strong>{data ? data.countries.length : "—"}</strong><small>country communities with public records</small>
        </div>
      </section>

      <p className="visually-hidden" role="status" aria-atomic="true">
        {error ? "Country communities unavailable." : data ? `${data.countries.length} country communities loaded.` : "Loading country communities."}
      </p>
      <section className="country-index-results" aria-busy={!data && !error}>
        <div className="shell">
          {error ? (
            <div className="state error-state"><strong>Country communities unavailable.</strong><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div>
          ) : !data ? (
            <div className="state"><span className="loader" aria-hidden="true" /><strong>Reading public community records…</strong></div>
          ) : data.countries.length === 0 ? (
            <div className="country-index-empty"><strong>No country-specific records yet.</strong><p>Global projects and contributors remain available on the main directories. A country board appears when an active project or public contributor profile names that community.</p><a href="/#top">List an open-source project</a></div>
          ) : (
            <ol className="country-index-grid">
              {data.countries.map((country, index) => (
                <li key={country.countryCode}>
                  <div className="country-card-cap"><span>{String(index + 1).padStart(2, "0")}</span><span>{country.countryCode}</span></div>
                  <div className="country-stamp" aria-hidden="true">{country.countryCode}</div>
                  <h2>{countryName(country.countryCode)}</h2>
                  <dl>
                    <div><dt>Sponsored projects</dt><dd>{country.projectCount}</dd></div>
                    <div><dt>Open work</dt><dd>{country.opportunityCount}</dd></div>
                    <div><dt>Public contributors</dt><dd>{country.contributorCount}</dd></div>
                    <div><dt>Available now</dt><dd>{country.availableContributorCount}</dd></div>
                  </dl>
                  <p><strong>{placementTotal(country.contributionCents)}</strong> disclosed placement spend · {compact.format(Number(country.verifiedVisits))} verified visits</p>
                  <a href={`/country/${country.countryCode}`}>Open community board</a>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <footer className="shell"><div className="brand"><span className="brand-mark">B</span>bidstage</div><p>Country affiliation is optional and self-described.</p><div><a href="/legal/privacy">Privacy</a><a href="/contributors">Contributors</a></div></footer>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}
