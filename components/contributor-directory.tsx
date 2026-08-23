"use client";

import { useCallback, useEffect, useState } from "react";

import { countryName, type CountryCode } from "@/lib/countries";
import type { ContributorAvailability } from "@/lib/contributor-profile";

type Contributor = {
  githubLogin: string;
  displayName: string | null;
  profileUrl: string;
  headline: string;
  bio: string | null;
  countryCode: CountryCode | null;
  skills: string[];
  availability: ContributorAvailability;
  updatedAt: string;
};

type DirectoryData = {
  contributors: Contributor[];
  facets: { skills: string[]; countries: CountryCode[] };
};

const availabilityLabel: Record<ContributorAvailability, string> = {
  available: "Available for contributions",
  limited: "Limited availability",
  unavailable: "Not currently available",
};

export function ContributorDirectory({
  initialCountry = "all",
}: {
  initialCountry?: CountryCode | "all";
}) {
  const [data, setData] = useState<DirectoryData>();
  const [skill, setSkill] = useState("all");
  const [country, setCountry] = useState<CountryCode | "all">(initialCountry);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const params = new URLSearchParams();
      if (skill !== "all") params.set("skill", skill);
      if (country !== "all") params.set("country", country);
      const response = await fetch(`/api/contributors${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The contributor directory could not be loaded.");
      setData(body as DirectoryData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The contributor directory could not be loaded.");
    }
  }, [country, skill]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="contributors-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation"><a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a><div><a href="/bids">How bidding works</a><a href="/countries">Countries</a><a href="/#board">Projects</a><a href="/account#contributor-profile">Publish your profile</a></div></nav>
      <section className="contributors-hero shell">
        <div className="eyebrow"><span>Opt-in GitHub identities</span><span>Contributor directory</span></div>
        <div className="contributors-heading"><div><h1>Find people who<br /><em>want to contribute.</em></h1><p>Every profile is published by its signed-in GitHub owner. Filter by skill or country, then contact contributors through their public GitHub profile.</p></div><div className="directory-count"><span>Public profiles</span><strong>{data ? data.contributors.length : "—"}</strong><small>in this filtered view</small></div></div>
        <div className="directory-filters">
          <label>Skill<select value={skill} onChange={(event) => setSkill(event.target.value)}><option value="all">All skills</option>{data?.facets.skills.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Country<select value={country} onChange={(event) => setCountry(event.target.value as CountryCode | "all")}><option value="all">All countries</option>{data?.facets.countries.map((code) => <option key={code} value={code}>{countryName(code)}</option>)}</select></label>
          <button type="button" onClick={() => void load()}>Refresh</button>
        </div>
      </section>

      <p className="visually-hidden" role="status" aria-atomic="true">{error ? "Contributor directory unavailable." : data ? `${data.contributors.length} contributor profiles match the selected filters.` : "Loading contributor profiles."}</p>
      <section className="contributor-results shell" aria-busy={!data && !error}>
        {error ? <div className="state error-state"><strong>Directory unavailable.</strong><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div> : !data ? <div className="state"><span className="loader" aria-hidden="true" /><strong>Reading public profiles…</strong></div> : data.contributors.length === 0 ? <div className="directory-empty"><strong>No public profiles match these filters.</strong><p>Change the filters or publish the first opt-in contributor profile for this view.</p><a href="/account#contributor-profile">Publish your profile</a></div> : <ol className="contributor-cards">{data.contributors.map((contributor, index) => <li key={contributor.githubLogin}>
          <div className="contributor-card-cap"><span>{String(index + 1).padStart(2, "0")}</span><span>{availabilityLabel[contributor.availability]}</span></div>
          <h2>{contributor.displayName ?? `@${contributor.githubLogin}`}</h2>
          <a className="contributor-login" href={contributor.profileUrl} target="_blank" rel="noopener">@{contributor.githubLogin}</a>
          <strong>{contributor.headline}</strong>
          {contributor.bio ? <p>{contributor.bio}</p> : null}
          <ul aria-label="Skills">{contributor.skills.map((item) => <li key={item}>{item}</li>)}</ul>
          <div className="contributor-card-foot"><span>{contributor.countryCode ? countryName(contributor.countryCode) : "Country not listed"}</span><a href={contributor.profileUrl} target="_blank" rel="noopener">Open GitHub profile</a></div>
        </li>)}</ol>}
      </section>
      <footer className="shell"><div className="brand"><span className="brand-mark">B</span>bidstage</div><p>Contributor profiles are public only by explicit opt-in.</p><div><a href="/legal/privacy">Privacy</a><a href="/account#contributor-profile">Manage profile</a></div></footer>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}
