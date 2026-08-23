"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { COUNTRY_CODES, countryName, type CountryCode } from "@/lib/countries";
import { CATEGORIES, MIN_BID_CENTS, type Category, type ProductKind } from "@/lib/market";

type Listing = {
  rank: string; slug: string; title: string; destination: string; category: Category;
  product_kind: ProductKind; github_owner: string | null; github_name: string | null;
  github_url: string | null; github_stars: number | null; github_license_spdx: string | null;
  github_primary_language: string | null;
  country_code: CountryCode | null; funding_provider: "github_sponsors" | "open_collective" | null;
  funding_url: string | null;
  github_verification_method: "personal_owner" | "repository_file" | null;
  contribution_url: string | null;
  contribution_note: string | null;
  total_cents: string; bid_count: number; outbound_clicks: string; last_bid_at: string;
};
type BoardData = { listings: Listing[]; totals: { entries: string; volume_cents: string; clicks: string }; languages: string[]; countries: CountryCode[] };
type RankQuote = {
  normalizedDestination: string;
  category: Category;
  productKind: ProductKind;
  contributionCents: number;
  currentTotalCents: number;
  projectedTotalCents: number;
  projectedCategoryRank: number;
  projectedCategoryEntries: number;
  projectedOverallRank: number;
  projectedOverallEntries: number;
  categoryLeaderCents: number;
  minimumContributionToLeadCents: number;
  asOf: string;
  requiresReview: boolean;
};
type CurrentQuote = RankQuote & { requestKey: string };
type Founder = { githubUserId: number; githubLogin: string; profileUrl: string };
type PlacementProject = {
  slug: string;
  title: string;
  destination: string;
  category: Category;
  repositoryUrl: string;
  countryCode: CountryCode | null;
  fundingUrl: string | null;
  contributionUrl: string | null;
  contributionNote: string | null;
  currentTotalCents: number;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const cents = (value: string | number) => money.format(Number(value) / 100);
const repositoryVerificationLabel = (method: Listing["github_verification_method"]) => method === "repository_file"
  ? "Repository authorized"
  : method === "personal_owner" ? "Owner verified" : "Legacy verification";
const countryOptions = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) }))
  .sort((left, right) => left.name.localeCompare(right.name));

export function BidBoard({
  turnstileSiteKey,
  placementSlug,
}: {
  turnstileSiteKey: string;
  placementSlug: string | null;
}) {
  const [board, setBoard] = useState<BoardData>();
  const [category, setCategory] = useState<Category | "all">("all");
  const [language, setLanguage] = useState("all");
  const [country, setCountry] = useState<CountryCode | "all">("all");
  const [boardError, setBoardError] = useState<string>();
  const [checkoutError, setCheckoutError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [bidCategory, setBidCategory] = useState<Category>("ai");
  const productKind = "open_source" as const;
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [projectCountry, setProjectCountry] = useState<CountryCode | "">("");
  const [fundingUrl, setFundingUrl] = useState("");
  const [contributionUrl, setContributionUrl] = useState("");
  const [contributionNote, setContributionNote] = useState("");
  const [amount, setAmount] = useState(String(MIN_BID_CENTS / 100));
  const [quote, setQuote] = useState<CurrentQuote>();
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const pendingCheckout = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const [founder, setFounder] = useState<Founder | null>();
  const [placementProject, setPlacementProject] = useState<PlacementProject>();
  const [placementLoading, setPlacementLoading] = useState(Boolean(placementSlug));
  const [placementError, setPlacementError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setBoardError(undefined);
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (language !== "all") params.set("language", language);
      if (country !== "all") params.set("country", country);
      const query = params.size ? `?${params.toString()}` : "";
      const response = await fetch(`/api/board${query}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The board could not be loaded.");
      setBoard(body);
    } catch (cause) {
      setBoardError(cause instanceof Error ? cause.message : "The board could not be loaded.");
    }
  }, [category, country, language]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : { founder: null })
      .then((body) => setFounder(body.founder as Founder | null))
      .catch(() => setFounder(null));
  }, []);

  useEffect(() => {
    if (!placementSlug) return;
    const controller = new AbortController();
    setPlacementLoading(true);
    setPlacementError(undefined);
    void fetch(`/api/listings/${encodeURIComponent(placementSlug)}/placement`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "The project record could not be loaded.");
        const project = body.project as PlacementProject;
        setPlacementProject(project);
        setTitle(project.title);
        setDestination(project.destination);
        setBidCategory(project.category);
        setRepositoryUrl(project.repositoryUrl);
        setProjectCountry(project.countryCode ?? "");
        setFundingUrl(project.fundingUrl ?? "");
        setContributionUrl(project.contributionUrl ?? "");
        setContributionNote(project.contributionNote ?? "");
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setPlacementError(cause instanceof Error ? cause.message : "The project record could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlacementLoading(false);
      });
    return () => controller.abort();
  }, [placementSlug]);

  async function signOut() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (response.ok) setFounder(null);
  }

  const amountCents = Math.round(Number(amount) * 100);
  const quoteReady =
    destination.trim().length >= 3 &&
    Number.isSafeInteger(amountCents) &&
    amountCents >= MIN_BID_CENTS &&
    amountCents <= 5_000_000;
  const quoteRequestKey = `${destination.trim()}|${bidCategory}|${productKind}|${amountCents}`;
  const currentQuote = quote?.requestKey === quoteRequestKey ? quote : undefined;

  useEffect(() => {
    if (!quoteReady) {
      setQuote(undefined);
      setQuoteError(undefined);
      setQuoteLoading(false);
      return;
    }

    const controller = new AbortController();
    setQuote(undefined);
    setQuoteError(undefined);
    setQuoteLoading(true);
    const timer = window.setTimeout(() => {
      void fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          category: bidCategory,
          productKind,
          amountCents,
        }),
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.message ?? "The live rank quote could not be loaded.");
          }
          setQuote({ ...(body as RankQuote), requestKey: quoteRequestKey });
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setQuoteError(
            cause instanceof Error
              ? cause.message
              : "The live rank quote could not be loaded.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuoteLoading(false);
        });
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [amountCents, bidCategory, destination, productKind, quoteReady, quoteRefresh, quoteRequestKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setQuoteRefresh((value) => value + 1), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCheckoutError(undefined);
    if (!currentQuote) {
      setCheckoutError("Wait for a current rank quote before opening checkout.");
      return;
    }
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const turnstileToken = form.get("cf-turnstile-response");
    if (typeof turnstileToken !== "string" || !turnstileToken) {
      setCheckoutError("Complete the human verification before checkout.");
      setSubmitting(false);
      return;
    }
    const checkoutInput = {
      title,
      destination,
      category: bidCategory,
      productKind,
      repositoryUrl,
      countryCode: projectCountry || null,
      fundingUrl: fundingUrl.trim() || null,
      contributionUrl: contributionUrl.trim() || null,
      contributionNote: contributionNote.trim() || null,
      amountCents,
      acceptedRules: form.get("rules") === "on",
    };
    const fingerprint = JSON.stringify(checkoutInput);
    if (pendingCheckout.current?.fingerprint !== fingerprint) {
      pendingCheckout.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pendingCheckout.current.key,
        },
        body: JSON.stringify({ ...checkoutInput, turnstileToken }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Checkout could not be created.");
      window.location.assign(body.checkoutUrl);
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : "Checkout could not be created.");
      (window as typeof window & { turnstile?: { reset(): void } }).turnstile?.reset();
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content">
      <nav className="nav shell" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Bidstage home"><span className="brand-mark">B</span>bidstage</a>
        <div className="nav-links"><a href="#board">Projects</a><a href="/categories">Categories</a><a href="/bids">How bidding works</a><a href="/countries">Countries</a><a href="/opportunities">Opportunities</a><a href="/contributors">Contributors</a><a href="#how">How it works</a><a href="/legal/rules">Rules</a></div>
        <div className="nav-account">
          <span className="live-pill"><i /> live ledger</span>
          {founder === undefined ? null : founder ? (
            <span className="founder-session"><a href="/account">@{founder.githubLogin}</a><button type="button" onClick={() => void signOut()}>Sign out</button></span>
          ) : <a className="github-signin" href="/api/auth/github/start?returnTo=%2F%23top">Sign in with GitHub</a>}
        </div>
      </nav>

      <section className="hero shell" id="top">
        <div className="eyebrow"><span>Verified open-source discovery</span><span>01 / public ledger</span></div>
        <div className="hero-grid">
          <div>
            <h1>Put useful code<br /><em>where people look.</em></h1>
            <p className="lede">A sponsored discovery board for public, OSI-licensed projects. Repository ownership, placement spend, position changes, and outbound visits stay visible.</p>
            <div className="proof-row">
              <span><strong>{board ? board.totals.entries : "—"}</strong> verified projects</span>
              <span><strong>{board ? cents(board.totals.volume_cents) : "—"}</strong> placement spend</span>
              <span><strong>{board ? compact.format(Number(board.totals.clicks)) : "—"}</strong> verified visits</span>
            </div>
            <div className="money-boundary" aria-label="How money moves on Bidstage">
              <article><span>Sponsored placement</span><strong>Paid to Bidstage</strong><p>A one-time budget buys a clearly labeled board position. It never becomes project or contributor funding.</p></article>
              <article><span>Project funding</span><strong>Paid to maintainers</strong><p>Maintainer-published links route support to GitHub Sponsors or Open Collective. Bidstage does not hold those funds.</p></article>
            </div>
          </div>

          <form className="bid-card" onSubmit={submit}>
            <div className="card-cap"><span>{placementProject ? "Add placement" : "List a project"}</span><span>One-time placement</span></div>
            {placementProject ? (
              <div className="repeat-placement-slip">
                <span>Existing active project</span>
                <strong>{placementProject.title}</strong>
                <p>Current placement total: {cents(placementProject.currentTotalCents)}. Project identity stays fixed; this checkout adds one signed ledger entry after settlement.</p>
                <a href="/#top">List a different project</a>
              </div>
            ) : (
              <div className="eligibility-stamp"><span>Required</span><strong>Public repository + OSI-approved license</strong></div>
            )}
            {placementLoading ? <p className="placement-prefill-state" role="status">Loading the verified project record…</p> : null}
            {placementError ? <p className="form-error" role="alert">{placementError}</p> : null}
            <label>Project name<input name="title" minLength={2} maxLength={64} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Your project" disabled={Boolean(placementProject)} required /></label>
            <label>Project website<input name="destination" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="yourproject.org" autoCapitalize="none" autoCorrect="off" disabled={Boolean(placementProject)} required /></label>
            {founder ? (
              <label>GitHub repository<input name="repositoryUrl" type="url" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/you/project" autoCapitalize="none" autoCorrect="off" disabled={Boolean(placementProject)} required /><small className="field-note">Personal repositories verify through GitHub ownership. For an organization repository, commit <code>.bidstage.json</code> to its default branch with <code>{`{"type":"bidstage_repository_authorization","version":1,"github_user_id":${founder.githubUserId}}`}</code>. The SPDX license must also be OSI approved.</small></label>
            ) : (
              <div className="github-gate"><strong>GitHub ownership required</strong><p>Sign in with the personal account that owns the repository. Bidstage reads public identity and repository metadata; it does not retain a GitHub access token.</p><a href="/api/auth/github/start?returnTo=%2F%23top">Verify with GitHub</a></div>
            )}
            <div className="form-row project-profile-fields">
              <label>Community country<select name="countryCode" value={projectCountry} onChange={(event) => setProjectCountry(event.target.value as CountryCode | "")} disabled={Boolean(placementProject)}><option value="">Global / not country-specific</option>{countryOptions.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select><small className="field-note">Optional. Choose where the project community is primarily based.</small></label>
              <label>Direct project funding<input name="fundingUrl" type="url" value={fundingUrl} onChange={(event) => setFundingUrl(event.target.value)} placeholder="https://github.com/sponsors/you" autoCapitalize="none" autoCorrect="off" disabled={Boolean(placementProject)} /><small className="field-note">Optional GitHub Sponsors or Open Collective link. Funding stays outside the ranking ledger.</small></label>
            </div>
            <fieldset className="opportunity-fields">
              <legend>Contribution opportunity <span>Optional</span></legend>
              <p>Point contributors to concrete work inside this verified repository.</p>
              <label>GitHub issue or contribution page<input name="contributionUrl" type="url" value={contributionUrl} onChange={(event) => setContributionUrl(event.target.value)} placeholder="https://github.com/you/project/issues/42" autoCapitalize="none" autoCorrect="off" disabled={Boolean(placementProject)} required={Boolean(contributionNote.trim())} /></label>
              <label>What help is needed?<input name="contributionNote" minLength={10} maxLength={180} value={contributionNote} onChange={(event) => setContributionNote(event.target.value)} placeholder="Help reproduce and fix Windows installation failures." disabled={Boolean(placementProject)} required={Boolean(contributionUrl.trim())} /></label>
            </fieldset>
            <div className="form-row">
              <label>Category<select name="category" value={bidCategory} onChange={(event) => setBidCategory(event.target.value as Category)} disabled={Boolean(placementProject)}>{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label>Placement budget<div className="money-input"><span>$</span><input name="amount" type="number" min={MIN_BID_CENTS / 100} max={50_000} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div></label>
            </div>
            <RankQuotePanel
              quote={currentQuote}
              loading={quoteLoading}
              error={quoteError}
              ready={quoteReady}
              onRefresh={() => setQuoteRefresh((value) => value + 1)}
              onSetLeaderBid={(value) => setAmount(formatDollarInput(value))}
            />
            <label className="check"><input name="rules" type="checkbox" required /><span>I own this repository, may promote its destination, and accept the <a href="/legal/rules">board rules</a>.</span></label>
            {turnstileSiteKey ? (
              <>
                <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
                <div
                  className="cf-turnstile turnstile"
                  data-sitekey={turnstileSiteKey}
                  data-action="checkout"
                  data-theme="light"
                  data-size="flexible"
                  data-appearance="interaction-only"
                />
              </>
            ) : <p className="form-error" role="alert">Checkout verification is not configured.</p>}
            {checkoutError ? <p className="form-error" role="alert">{checkoutError}</p> : null}
            <button className="primary" type="submit" disabled={submitting || placementLoading || Boolean(placementError) || !currentQuote || !turnstileSiteKey || !founder || !repositoryUrl.trim()}>{submitting ? "Opening secure checkout…" : placementProject ? "Continue to placement checkout" : "Continue to verified checkout"}</button>
            <p className="fine">This payment is only for sponsored placement. Rank changes after the payment provider confirms settlement through a signed event.</p>
          </form>
        </div>
      </section>

      <section className="board-section" id="board">
        <div className="shell">
          <div className="section-title"><div><span className="kicker">02 / live board</span><h2>Open source, with receipts.</h2></div><button className="refresh" type="button" onClick={() => void load()} aria-label="Refresh leaderboard">Refresh</button></div>
          <div className="filters" aria-label="Filter leaderboard by category">
            {(["all", ...CATEGORIES] as const).map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
          <div className="contributor-tools">
            <div><span>Contributor view</span><strong>Find a codebase in your language.</strong><p>Filter verified projects, then open the repository to read its contribution guide, issues, and source.</p></div>
            <div className="discovery-selects"><label>Primary language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">All languages</option>{board?.languages.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Community country<select value={country} onChange={(event) => setCountry(event.target.value as CountryCode | "all")}><option value="all">All countries</option>{board?.countries.map((code) => <option key={code} value={code}>{countryName(code)}</option>)}</select></label></div>
          </div>

          {boardError ? <div className="state error-state" role="alert"><strong>Live data paused.</strong><span>{boardError}</span><button type="button" onClick={() => void load()}>Try again</button></div> : null}
          {!boardError && !board ? <div className="state"><span className="loader" /><strong>Reading the verified ledger…</strong></div> : null}
          {!boardError && board?.listings.length === 0 ? <div className="state empty-state"><span className="empty-number">00</span><div><strong>The stage is open.</strong><p>No verified entries in this view yet. The first listing appears only after a real payment confirmation.</p></div></div> : null}
          {board?.listings.length ? <ol className="leaderboard">
            {board.listings.map((listing) => <li key={listing.slug} className={listing.rank === "1" ? "leader" : ""}>
              <span className="rank">#{listing.rank.padStart(2, "0")}</span>
              <div className="listing-copy"><span className="sponsored">Sponsored placement · {listing.category}</span><h3><a href={`/listing/${listing.slug}`}>{listing.title}</a></h3><span className="domain">{new URL(listing.destination).hostname.replace("www.", "")}</span><span className="repository-meta">{listing.github_license_spdx} license · {listing.github_stars ?? 0} GitHub stars{listing.github_primary_language ? ` · ${listing.github_primary_language}` : ""}{listing.country_code ? ` · ${countryName(listing.country_code)}` : " · Global"} · {repositoryVerificationLabel(listing.github_verification_method)}</span>{listing.contribution_note ? <span className="opportunity-note">Help wanted: {listing.contribution_note}</span> : null}</div>
              <div className="signals"><span>{listing.bid_count} verified {listing.bid_count === 1 ? "placement" : "placements"}</span><span>{compact.format(Number(listing.outbound_clicks))} verified outbound</span></div>
              <strong className="total">{cents(listing.total_cents)}</strong>
              <div className="project-actions">{listing.contribution_url ? <a className="opportunity-link" href={listing.contribution_url} target="_blank" rel="noopener">Open opportunity</a> : null}{listing.funding_url ? <a className="fund-link" href={listing.funding_url} target="_blank" rel="noopener">Fund project</a> : null}<a className="source-link" href={listing.github_url ?? listing.destination} target="_blank" rel="noopener">Contribute</a><a className="visit" href={`/go/${listing.slug}`} target="_blank" rel="sponsored noopener">Visit project</a></div>
            </li>)}
          </ol> : null}
        </div>
      </section>

      <section className="how shell" id="how">
        <div className="section-title"><div><span className="kicker">03 / mechanics</span><h2>Simple enough to audit.</h2></div></div>
        <div className="steps">
          <article><span>01</span><h3>Verify the source</h3><p>Sign in as the repository owner. Bidstage checks that the repository is public and its SPDX license appears in OSI’s approved catalog.</p></article>
          <article><span>02</span><h3>Buy labeled placement</h3><p>Your one-time placement budget is the exact checkout amount. Returning projects add to their public, verified placement total.</p></article>
          <article><span>03</span><h3>Fund work directly</h3><p>Project funding stays separate from ranking. Maintainers may publish a canonical GitHub Sponsors or Open Collective link without sending those funds through Bidstage.</p></article>
        </div>
      </section>

      <footer className="shell"><div className="brand"><span className="brand-mark">B</span>bidstage</div><p>Transparent sponsored discovery for open-source projects.</p><div><a href="/legal/privacy">Privacy</a><a href="/legal/processors">Providers</a><a href="/legal/refunds">Refunds</a><a href="/legal/terms">Terms</a><a href="/legal/rules">Rules</a><a href="mailto:support@bidstage.app">Support</a></div></footer>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}

function RankQuotePanel({
  quote,
  loading,
  error,
  ready,
  onRefresh,
  onSetLeaderBid,
}: {
  quote?: RankQuote;
  loading: boolean;
  error?: string;
  ready: boolean;
  onRefresh: () => void;
  onSetLeaderBid: (amountCents: number) => void;
}) {
  return (
    <section className="quote-panel" aria-label="Live rank quote" aria-live="polite">
      <div className="quote-cap">
        <span><i /> Live rank quote</span>
        <button type="button" onClick={onRefresh} disabled={!ready || loading}>Refresh</button>
      </div>

      {!ready ? (
        <p className="quote-prompt">Enter a destination and placement budget to price your position against the settled ledger.</p>
      ) : loading ? (
        <div className="quote-loading"><span className="loader" /><span>Calculating position…</span></div>
      ) : error ? (
        <div className="quote-error"><strong>Quote unavailable</strong><span>{error}</span></div>
      ) : quote ? (
        <>
          <div className="quote-result">
            <div>
              <span>Projected in open source / {quote.category}</span>
              <strong>#{String(quote.projectedCategoryRank).padStart(2, "0")}</strong>
              <small>of {quote.projectedCategoryEntries} after {quote.requiresReview ? "approval" : "settlement"}</small>
            </div>
            <div>
              <span>Projected overall</span>
              <strong>#{String(quote.projectedOverallRank).padStart(2, "0")}</strong>
              <small>of {quote.projectedOverallEntries} projects</small>
            </div>
          </div>
          <div className="price-ladder">
            <div><span>Category leader now</span><strong>{cents(quote.categoryLeaderCents)}</strong></div>
            <div className="projected"><span>Your settled total</span><strong>{cents(quote.projectedTotalCents)}</strong></div>
            <div><span>Current product total</span><strong>{cents(quote.currentTotalCents)}</strong></div>
          </div>
          {quote.projectedCategoryRank === 1 ? (
            <p className="quote-verdict">This placement budget reaches the category lead at this ledger snapshot.</p>
          ) : (
            <button className="leader-button" type="button" onClick={() => onSetLeaderBid(quote.minimumContributionToLeadCents)}>
              Set placement budget to reach #1 · {cents(quote.minimumContributionToLeadCents)}
            </button>
          )}
          {quote.requiresReview ? <p className="quote-review">New destinations appear only after payment settlement and safety review.</p> : null}
          <p className="quote-freshness">Quoted {formatQuoteTime(quote.asOf)} from settled payments. Final rank can move before your payment settles{quote.requiresReview ? " or review completes" : ""}.</p>
        </>
      ) : null}
    </section>
  );
}

function formatDollarInput(amountCents: number): string {
  const value = amountCents / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatQuoteTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "just now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
