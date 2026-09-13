"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

import { countryName, type CountryCode } from "@/lib/countries";
import { CATEGORIES, type Category } from "@/lib/market";
import { DirectoryExplainer } from "@/components/directory-explainer";

type Opportunity = {
  slug: string;
  title: string;
  category: Category;
  repository: string;
  repositoryUrl: string;
  primaryLanguage: string | null;
  licenseSpdx: string;
  countryCode: CountryCode | null;
  contributionUrl: string;
  contributionNote: string;
  updatedAt: string;
};

type OpportunityData = {
  opportunities: Opportunity[];
  facets: { languages: string[]; countries: CountryCode[] };
};

export function OpportunityDirectory({
  initialCountry = "all",
}: {
  initialCountry?: CountryCode | "all";
}) {
  const [data, setData] = useState<OpportunityData>();
  const [category, setCategory] = useState<Category | "all">("all");
  const [language, setLanguage] = useState("all");
  const [country, setCountry] = useState<CountryCode | "all">(initialCountry);
  const [error, setError] = useState<string>();
  const [applicationSlug, setApplicationSlug] = useState<string>();
  const [applicationMessage, setApplicationMessage] = useState("");
  const [applicationFeedback, setApplicationFeedback] = useState<string>();
  const [applicationFeedbackError, setApplicationFeedbackError] = useState(false);
  const [applicationNeedsSignIn, setApplicationNeedsSignIn] = useState(false);
  const [applicationSending, setApplicationSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (language !== "all") params.set("language", language);
      if (country !== "all") params.set("country", country);
      const response = await fetch(`/api/opportunities${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Contribution opportunities could not be loaded.");
      setData(body as OpportunityData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Contribution opportunities could not be loaded.");
    }
  }, [category, country, language]);

  useEffect(() => { void load(); }, [load]);

  async function apply(event: FormEvent<HTMLFormElement>, slug: string) {
    event.preventDefault();
    setApplicationSending(true);
    setApplicationFeedback(undefined);
    setApplicationFeedbackError(false);
    setApplicationNeedsSignIn(false);
    try {
      const response = await fetch(`/api/opportunities/${encodeURIComponent(slug)}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: applicationMessage }),
      });
      const body = await response.json();
      if (!response.ok) {
        setApplicationNeedsSignIn(response.status === 401);
        throw new Error(body.message ?? "Application could not be submitted.");
      }
      setApplicationFeedback("Application sent privately to the project maintainer.");
      setApplicationFeedbackError(false);
      setApplicationMessage("");
    } catch (cause) {
      setApplicationFeedback(cause instanceof Error ? cause.message : "Application could not be submitted.");
      setApplicationFeedbackError(true);
    } finally {
      setApplicationSending(false);
    }
  }

  return (
    <main className="opportunities-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation"><a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a><div><a href="/bids">How bidding works</a><a href="/countries">Countries</a><a href="/contributors">Contributors</a><a href="/account">Maintainer account</a></div></nav>
      <section className="opportunities-hero shell">
        <div className="eyebrow"><span>Maintainer-authored requests</span><span>Verified repositories</span></div>
        <div className="opportunities-heading"><h1>Start with work<br /><em>that needs doing.</em></h1><p>These requests come from maintainers with active sponsored project records and link back inside the verified repository. Recently updated project records appear first; placement spend does not set this order.</p></div>
        <div className="opportunity-filters">
          <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as Category | "all")}><option value="all">All categories</option>{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">All languages</option>{data?.facets.languages.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Country<select value={country} onChange={(event) => setCountry(event.target.value as CountryCode | "all")}><option value="all">All countries</option>{data?.facets.countries.map((code) => <option key={code} value={code}>{countryName(code)}</option>)}</select></label>
        </div>
      </section>
      <DirectoryExplainer
        eyebrow="Before you apply"
        id="opportunity-directory-guide"
        title="Check the repository, scope, and contact path."
      >
        <p>
          Every request begins with a maintainer who controls an active,
          owner-verified project record. The public opportunity link must point
          back into that repository, so you can inspect the issue, discussion,
          contribution guide, license, and recent activity before responding.
        </p>
        <p>
          Filter by language, category, or community to narrow the list. Open
          the project record to review its disclosed sponsored placement and
          verification history. Placement spend does not move an opportunity up
          this directory; recently updated project records appear first.
        </p>
        <p>
          A private application sends your published contributor profile and
          message to the maintainer. It does not create employment, a bounty, or
          a payment promise. Agree on scope, review expectations, attribution,
          and compensation outside Bidstage before starting work.
        </p>
      </DirectoryExplainer>
      <p className="visually-hidden" role="status" aria-atomic="true">{error ? "Contribution opportunities unavailable." : data ? `${data.opportunities.length} opportunities match the selected filters.` : "Loading contribution opportunities."}</p>
      <section className="opportunity-results shell" aria-busy={!data && !error}>
        {error ? <div className="state error-state"><strong>Opportunities unavailable.</strong><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div> : !data ? <div className="state"><span className="loader" aria-hidden="true" /><strong>Reading contribution requests…</strong></div> : data.opportunities.length === 0 ? <div className="directory-empty"><strong>No opportunities match these filters.</strong><p>Change the filters or ask a verified maintainer to publish a concrete contribution request.</p><a href="/account">Manage a project</a></div> : <ol className="opportunity-cards">{data.opportunities.map((opportunity, index) => <li key={opportunity.slug}>
          <div className="opportunity-card-index"><span>{String(index + 1).padStart(2, "0")}</span><span>{opportunity.category}</span></div>
          <h2>{opportunity.title}</h2>
          <a className="opportunity-repository" href={opportunity.repositoryUrl} target="_blank" rel="noopener">{opportunity.repository}</a>
          <strong>{opportunity.contributionNote}</strong>
          <dl><div><dt>Language</dt><dd>{opportunity.primaryLanguage ?? "Not reported"}</dd></div><div><dt>License</dt><dd>{opportunity.licenseSpdx}</dd></div><div><dt>Community</dt><dd>{opportunity.countryCode ? countryName(opportunity.countryCode) : "Global"}</dd></div></dl>
          <div className="opportunity-actions"><a href={`/listing/${opportunity.slug}`}>Project record</a><button type="button" aria-expanded={applicationSlug === opportunity.slug} aria-controls={`application-${opportunity.slug}`} onClick={() => { setApplicationSlug(applicationSlug === opportunity.slug ? undefined : opportunity.slug); setApplicationFeedback(undefined); setApplicationFeedbackError(false); setApplicationNeedsSignIn(false); }}>Apply privately</button><a className="open-opportunity" href={opportunity.contributionUrl} target="_blank" rel="noopener">Open opportunity</a></div>
          {applicationSlug === opportunity.slug ? <form className="opportunity-application" id={`application-${opportunity.slug}`} onSubmit={(event) => void apply(event, opportunity.slug)}><label>Why you can help<textarea value={applicationMessage} onChange={(event) => setApplicationMessage(event.target.value)} minLength={20} maxLength={800} required placeholder="Share relevant experience and how you would approach this work." /></label><p>Your published contributor profile and this message are shared only with the project maintainer. This is not a paid bounty or employment contract.</p><div><button type="button" onClick={() => setApplicationSlug(undefined)}>Cancel</button><button type="submit" disabled={applicationSending}>{applicationSending ? "Sending…" : "Send application"}</button></div>{applicationFeedback ? <p className="application-feedback" role={applicationFeedbackError ? "alert" : "status"}>{applicationFeedback}{applicationNeedsSignIn ? <> <a href={`/api/auth/github/start?returnTo=${encodeURIComponent("/opportunities")}`}>Sign in</a> and publish your profile from Account.</> : null}</p> : null}</form> : null}
        </li>)}</ol>}
      </section>
      <footer className="shell"><div className="brand"><span className="brand-mark">B</span>bidstage</div><p>Opportunities come from active sponsored projects; spend does not order this page.</p><div><a href="/legal/rules">Rules</a><a href="/contributors">Contributors</a></div></footer>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}
