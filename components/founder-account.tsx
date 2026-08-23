"use client";

import { type FormEvent, useEffect, useState } from "react";

import { CATEGORIES, type Category } from "@/lib/market";
import { COUNTRY_CODES, countryName, type CountryCode } from "@/lib/countries";
import { ContributorProfileEditor } from "@/components/contributor-profile-editor";
import { ContributionApplications } from "@/components/contribution-applications";
import { PrivacyRequestPanel } from "@/components/privacy-request-panel";

type AccountData = {
  founder: { githubLogin: string; displayName: string | null; profileUrl: string };
  records: Array<{
    reference: string;
    title: string;
    destination: string;
    category: Category;
    productKind: "commercial" | "open_source";
    repositoryUrl: string | null;
    countryCode: CountryCode | null;
    fundingProvider: "github_sponsors" | "open_collective" | null;
    fundingUrl: string | null;
    repositoryVerificationMethod: "personal_owner" | "repository_file" | null;
    contributionUrl: string | null;
    contributionNote: string | null;
    contributionCents: number;
    checkoutState: string;
    createdAt: string;
    settledAt: string | null;
    listingSlug: string | null;
    listingStatus: "review" | "active" | "removed" | null;
    canEdit: boolean;
    listingTotalCents: number | null;
  }>;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const countryOptions = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) }))
  .sort((left, right) => left.name.localeCompare(right.name));

export function FounderAccount() {
  const [data, setData] = useState<AccountData>();
  const [error, setError] = useState<string>();
  const [signedOut, setSignedOut] = useState(false);
  const [editingReference, setEditingReference] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>();

  useEffect(() => {
    void fetch("/api/account/products", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (response.status === 401) {
          setSignedOut(true);
          return;
        }
        if (!response.ok) throw new Error(body.message ?? "Your product records could not be loaded.");
        setData(body as AccountData);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Your product records could not be loaded."));
  }, []);

  async function saveListing(
    event: FormEvent<HTMLFormElement>,
    reference: string,
    slug: string,
  ) {
    event.preventDefault();
    setSaving(true);
    setSaveMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/account/listings/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.get("title"), category: form.get("category"), countryCode: form.get("countryCode"), fundingUrl: form.get("fundingUrl"), contributionUrl: form.get("contributionUrl"), contributionNote: form.get("contributionNote") }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The listing could not be updated.");
      setData((current) => current ? {
        ...current,
        records: current.records.map((record) => record.listingSlug === slug
          ? { ...record, title: body.listing.title, category: body.listing.category, countryCode: body.listing.countryCode, fundingUrl: body.listing.fundingUrl, fundingProvider: body.listing.fundingProvider, contributionUrl: body.listing.contributionUrl, contributionNote: body.listing.contributionNote, listingStatus: body.listing.status }
          : record),
      } : current);
      setSaveMessage(body.message);
      setEditingReference(undefined);
    } catch (cause) {
      setSaveMessage(cause instanceof Error ? cause.message : "The listing could not be updated.");
      setEditingReference(reference);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="account-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation"><a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a><a href="/#top">Add a project</a></nav>
      <section className="account-shell shell">
        <span className="kicker">Maintainer account / GitHub verified</span>
        <div className="account-heading"><div><h1>Your project<br /><em>paper trail.</em></h1><p>Checkout, settlement, moderation, project funding, and public listing state from the authoritative records.</p></div>{data ? <a href={data.founder.profileUrl} target="_blank" rel="noopener">Signed in as @{data.founder.githubLogin}</a> : null}</div>
        {saveMessage ? <p className="account-notice" role="status">{saveMessage}</p> : null}
        {signedOut ? (
          <div className="account-empty"><strong>Sign in to read your project records.</strong><p>GitHub supplies durable maintainer identity. Bidstage does not store your GitHub access token.</p><a href="/api/auth/github/start?returnTo=%2Faccount">Sign in with GitHub</a></div>
        ) : error ? (
          <div className="account-empty" role="alert"><strong>Account unavailable.</strong><p>{error}</p></div>
        ) : !data ? (
          <div className="account-empty" role="status"><span className="loader" aria-hidden="true" /><strong>Reading maintainer records…</strong></div>
        ) : data.records.length === 0 ? (
          <div className="account-empty"><strong>No signed-in submissions yet.</strong><p>Your next checkout will appear here when it is created.</p><a href="/#top">Submit a project</a></div>
        ) : (
          <ol className="account-records">{data.records.map((record) => (
            <li key={record.reference}>
              <div className="record-cap"><span>Open source · {record.category}{record.countryCode ? ` · ${countryName(record.countryCode)}` : " · Global"}</span><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleDateString()}</time></div>
              <h2>{record.title}</h2>
              <a className="record-destination" href={record.destination} target="_blank" rel="noopener">{new URL(record.destination).hostname.replace(/^www\./, "")}</a>
              <dl><div><dt>Payment</dt><dd>{record.checkoutState.replaceAll("_", " ")}</dd></div><div><dt>Placement spend</dt><dd>{money.format(record.contributionCents / 100)}</dd></div><div><dt>Repository proof</dt><dd>{record.repositoryVerificationMethod === "repository_file" ? "Committed file" : record.repositoryVerificationMethod === "personal_owner" ? "Owner match" : "Legacy record"}</dd></div><div><dt>Listing total</dt><dd>{record.listingTotalCents === null ? "—" : money.format(record.listingTotalCents / 100)}</dd></div></dl>
              <div className="record-actions"><a href={`/receipt/${record.reference}`}>Open receipt</a>{record.listingSlug && record.listingStatus === "active" ? <a href={`/listing/${record.listingSlug}`}>Public record</a> : null}{record.canEdit && record.listingSlug && record.listingStatus === "active" ? <a className="repeat-placement-link" href={`/?placement=${encodeURIComponent(record.listingSlug)}#top`}>Add placement</a> : null}{record.repositoryUrl ? <a href={record.repositoryUrl} target="_blank" rel="noopener">Source repository</a> : null}{record.fundingUrl ? <a href={record.fundingUrl} target="_blank" rel="noopener">Project funding</a> : null}{record.contributionUrl ? <a href={record.contributionUrl} target="_blank" rel="noopener">Contribution opportunity</a> : null}{record.canEdit && record.listingSlug ? <button type="button" aria-expanded={editingReference === record.reference} aria-controls={`listing-editor-${record.reference}`} onClick={() => { setEditingReference(record.reference); setSaveMessage(undefined); }}>Edit listing</button> : null}</div>
              {editingReference === record.reference && record.canEdit && record.listingSlug ? (
                <form className="record-edit" id={`listing-editor-${record.reference}`} onSubmit={(event) => void saveListing(event, record.reference, record.listingSlug!)}>
                  <p>The paid destination and repository stay fixed. Saving returns an active listing to operator review.</p>
                  <label>Project name<input name="title" defaultValue={record.title} minLength={2} maxLength={64} required /></label>
                  <label>Category<select name="category" defaultValue={record.category}>{CATEGORIES.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
                  <label>Community country<select name="countryCode" defaultValue={record.countryCode ?? ""}><option value="">Global / not country-specific</option>{countryOptions.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
                  <label>Direct project funding<input name="fundingUrl" type="url" defaultValue={record.fundingUrl ?? ""} placeholder="https://github.com/sponsors/you" /></label>
                  <label>Contribution opportunity URL<input name="contributionUrl" type="url" defaultValue={record.contributionUrl ?? ""} placeholder="https://github.com/you/project/issues/42" /></label>
                  <label>Contribution request<input name="contributionNote" minLength={10} maxLength={180} defaultValue={record.contributionNote ?? ""} placeholder="Describe the concrete help this project needs." /></label>
                  <div><button type="button" onClick={() => setEditingReference(undefined)}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save and submit for review"}</button></div>
                </form>
              ) : null}
            </li>
          ))}</ol>
        )}
        <ContributorProfileEditor />
        <ContributionApplications />
        {data ? <PrivacyRequestPanel /> : null}
      </section>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}
