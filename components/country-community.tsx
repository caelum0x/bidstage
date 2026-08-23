"use client";

import { useCallback, useEffect, useState } from "react";

import { countryName, type CountryCode } from "@/lib/countries";
import type { Category } from "@/lib/market";

type CountryProject = {
  countryRank: number;
  slug: string;
  title: string;
  category: Category;
  repository: string;
  repositoryUrl: string;
  primaryLanguage: string | null;
  licenseSpdx: string;
  contributionCents: string;
  placementCount: number;
  verifiedVisits: string;
  contributionUrl: string | null;
  contributionNote: string | null;
};

type CountryOpportunity = {
  slug: string;
  title: string;
  category: Category;
  repository: string;
  repositoryUrl: string;
  primaryLanguage: string | null;
  licenseSpdx: string;
  contributionUrl: string;
  contributionNote: string;
};

type CountryContributor = {
  githubLogin: string;
  displayName: string | null;
  profileUrl: string;
  headline: string;
  bio: string | null;
  skills: string[];
  availability: "available" | "limited" | "unavailable";
};

type CountryData = {
  countryCode: CountryCode;
  summary: {
    projectCount: number;
    contributionCents: string;
    opportunityCount: number;
    contributorCount: number;
  };
  projects: CountryProject[];
  opportunities: CountryOpportunity[];
  contributors: CountryContributor[];
};

const money = new Intl.NumberFormat("en", { style: "currency", currency: "USD" });
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

const availabilityLabel: Record<CountryContributor["availability"], string> = {
  available: "Available",
  limited: "Limited availability",
  unavailable: "Unavailable",
};

function cents(value: string) {
  return money.format(Number(value) / 100);
}

export function CountryCommunity({ countryCode }: { countryCode: CountryCode }) {
  const [data, setData] = useState<CountryData>();
  const [error, setError] = useState<string>();
  const name = countryName(countryCode);

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const response = await fetch(`/api/countries?country=${encodeURIComponent(countryCode)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? `${name} community records could not be loaded.`);
      setData(body as CountryData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${name} community records could not be loaded.`);
    }
  }, [countryCode, name]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="country-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation">
        <a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a>
        <div><a href="/bids">How bidding works</a><a href="/countries">All countries</a><a href={`/opportunities?country=${countryCode}`}>Open work</a><a href={`/contributors?country=${countryCode}`}>Contributors</a></div>
      </nav>

      <section className="country-hero shell">
        <div className="eyebrow"><span>Self-described community location</span><span>{countryCode} / country board</span></div>
        <div className="country-heading">
          <div><span className="country-passport" aria-hidden="true">{countryCode}</span><h1>{name}<br /><em>open-source community.</em></h1></div>
          <p>This board joins public records chosen by project maintainers and contributors. Sponsored project rank uses disclosed placement spend; opportunity and contributor order do not.</p>
        </div>
        <dl className="country-metrics">
          <div><dt>Active projects</dt><dd>{data ? data.summary.projectCount : "—"}</dd></div>
          <div><dt>Open work</dt><dd>{data ? data.summary.opportunityCount : "—"}</dd></div>
          <div><dt>Public contributors</dt><dd>{data ? data.summary.contributorCount : "—"}</dd></div>
          <div><dt>Placement spend</dt><dd>{data ? cents(data.summary.contributionCents) : "—"}</dd></div>
        </dl>
      </section>

      <p className="visually-hidden" role="status" aria-atomic="true">
        {error ? `${name} community records unavailable.` : data ? `${data.summary.projectCount} projects, ${data.summary.opportunityCount} opportunities, and ${data.summary.contributorCount} contributors recorded.` : `Loading ${name} community records.`}
      </p>

      {error ? (
        <section className="country-failure" aria-busy="false"><div className="state error-state"><strong>Community board unavailable.</strong><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div></section>
      ) : !data ? (
        <section className="country-failure" aria-busy="true"><div className="state"><span className="loader" aria-hidden="true" /><strong>Reading public community records…</strong></div></section>
      ) : (
        <>
          <section className="country-projects">
            <div className="shell">
              <div className="country-section-heading"><div><span>Sponsored board</span><h2>Projects from {name}</h2></div><p>Ranked only by settled placement spend, then earliest placement. The country label does not affect the global board.{data.summary.projectCount > data.projects.length ? ` Showing the first ${data.projects.length} of ${data.summary.projectCount}.` : ""}</p></div>
              {data.projects.length === 0 ? <div className="country-section-empty"><strong>No active projects list this community yet.</strong><a href="/#top">List an open-source project</a></div> : <ol className="country-project-list">{data.projects.map((project) => <li key={project.slug}>
                <span className="country-rank">#{project.countryRank}</span>
                <div><span className="country-project-category">Sponsored · {project.category}</span><h3><a href={`/listing/${project.slug}`}>{project.title}</a></h3><a className="country-repository" href={project.repositoryUrl} target="_blank" rel="noopener noreferrer">{project.repository}</a><small>{project.primaryLanguage ?? "Language not reported"} · {project.licenseSpdx}</small></div>
                <dl><div><dt>Placement</dt><dd>{cents(project.contributionCents)}</dd></div><div><dt>Settlements</dt><dd>{project.placementCount}</dd></div><div><dt>Verified visits</dt><dd>{compact.format(Number(project.verifiedVisits))}</dd></div></dl>
                <a className="country-project-link" href={`/listing/${project.slug}`}>View public record</a>
              </li>)}</ol>}
            </div>
          </section>

          <section className="country-work shell">
            <div className="country-section-heading"><div><span>Maintainer-authored</span><h2>Work that needs doing</h2>{data.summary.opportunityCount > data.opportunities.length ? <small>Showing the first {data.opportunities.length} of {data.summary.opportunityCount}.</small> : null}</div><a href={`/opportunities?country=${countryCode}`}>Browse filtered directory</a></div>
            {data.opportunities.length === 0 ? <div className="country-section-empty"><strong>No contribution opportunity is published for this community.</strong><a href="/account">Manage a project</a></div> : <ol>{data.opportunities.map((opportunity, index) => <li key={opportunity.slug}>
              <div><span>{String(index + 1).padStart(2, "0")} · {opportunity.category}</span><span>{opportunity.primaryLanguage ?? "Language not reported"}</span></div>
              <h3>{opportunity.title}</h3><a href={opportunity.repositoryUrl} target="_blank" rel="noopener noreferrer">{opportunity.repository}</a>
              <p>{opportunity.contributionNote}</p>
              <div className="country-work-foot"><span>{opportunity.licenseSpdx}</span><a href={opportunity.contributionUrl} target="_blank" rel="noopener noreferrer">Open contribution page</a></div>
            </li>)}</ol>}
          </section>

          <section className="country-people">
            <div className="shell">
              <div className="country-section-heading"><div><span>Explicit public opt-in</span><h2>Contributors in this community</h2>{data.summary.contributorCount > data.contributors.length ? <small>Showing the first {data.contributors.length} of {data.summary.contributorCount}.</small> : null}</div><a href={`/contributors?country=${countryCode}`}>Browse filtered directory</a></div>
              {data.contributors.length === 0 ? <div className="country-section-empty"><strong>No public contributor profile lists this community.</strong><a href="/account#contributor-profile">Publish your profile</a></div> : <ol>{data.contributors.map((contributor) => <li key={contributor.githubLogin}>
                <div><span>{availabilityLabel[contributor.availability]}</span><span>@{contributor.githubLogin}</span></div>
                <h3>{contributor.displayName ?? `@${contributor.githubLogin}`}</h3><strong>{contributor.headline}</strong>
                {contributor.bio ? <p>{contributor.bio}</p> : null}
                <ul aria-label="Skills">{contributor.skills.map((skill) => <li key={skill}>{skill}</li>)}</ul>
                <a href={contributor.profileUrl} target="_blank" rel="noopener noreferrer">Open GitHub profile</a>
              </li>)}</ol>}
            </div>
          </section>
        </>
      )}

      <footer className="shell"><div className="brand"><span className="brand-mark">B</span>bidstage</div><p>Community location is optional and self-described.</p><div><a href="/countries">All countries</a><a href="/legal/privacy">Privacy</a></div></footer>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}
