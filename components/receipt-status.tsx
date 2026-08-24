"use client";

import { useCallback, useEffect, useState } from "react";
import { countryName, type CountryCode } from "@/lib/countries";

type Receipt = {
  reference: string;
  paymentProvider: "stripe" | "creem" | "dodo";
  canManage: boolean;
  state: "creating" | "pending" | "settled" | "failed" | "expired" | "partially_refunded" | "refunded" | "disputed";
  product: {
    title: string;
    destination: string;
    category: string;
    kind: "commercial" | "open_source";
    countryCode: CountryCode | null;
    fundingProvider: "github_sponsors" | "open_collective" | null;
    fundingUrl: string | null;
    contributionUrl: string | null;
    contributionNote: string | null;
    repository: null | {
      owner: string;
      name: string;
      url: string;
      stars: number;
      licenseSpdx: string;
      primaryLanguage: string | null;
      verificationMethod: "personal_owner" | "repository_file" | null;
    };
    listingSlug: string | null;
    listingStatus: "active" | "review" | "removed" | null;
  };
  contributionCents: number;
  quote: {
    categoryRank: number | null;
    overallRank: number | null;
    projectedTotalCents: number;
    asOf: string;
  };
  settlement: null | {
    settledAt: string;
    categoryRank: number | null;
    overallRank: number | null;
    ledgerEntryId: string | null;
  };
  adjustment: null | {
    state: "partial_refund" | "refunded" | "disputed";
    reversedCents: number;
    netContributionCents: number;
    ledgerEntryCount: number;
    adjustedAt: string | null;
  };
  moderation: null | {
    action: "approve" | "suspend" | "remove" | "restore";
    publicNote: string | null;
    moderatedAt: string | null;
  };
  createdAt: string;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function ReceiptStatus({ reference }: { reference: string }) {
  const [receipt, setReceipt] = useState<Receipt>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const response = await fetch(`/api/receipts/${encodeURIComponent(reference)}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Receipt status could not be loaded.");
      setReceipt(body as Receipt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Receipt status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!receipt || !["creating", "pending"].includes(receipt.state)) return;
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [load, receipt]);

  const settled = receipt?.state === "settled" && receipt.settlement;
  const adjusted = receipt?.adjustment && receipt.settlement;
  const reviewing = receipt?.state === "settled" && receipt.settlement && receipt.product.listingStatus === "review";
  const removed = receipt?.state === "settled" && receipt.settlement && receipt.product.listingStatus === "removed";
  const retryable = receipt && ["failed", "expired"].includes(receipt.state);
  const pending = receipt && ["creating", "pending"].includes(receipt.state);

  return (
    <main className="receipt-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation">
        <a className="brand" href="/" aria-label="Bidstage home">
          <span className="brand-mark">B</span>bidstage
        </a>
        <a href="/#board">Return to board ↗</a>
      </nav>

      <section className="receipt-shell shell" aria-live="polite">
        <div className="receipt-index">04 / settlement receipt</div>

        {loading ? (
          <div className="receipt-state">
            <span className="receipt-spinner" />
            <h1>Reading the ledger.</h1>
            <p>Checking the signed payment event and immutable rank entry.</p>
          </div>
        ) : error ? (
          <div className="receipt-state receipt-failed">
            <span className="settlement-stamp">Status unavailable</span>
            <h1>We could not read this receipt.</h1>
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>Try again</button>
          </div>
        ) : pending && receipt ? (
          <div className="receipt-state receipt-pending">
            <span className="settlement-stamp"><i /> Awaiting signed event</span>
            <h1>Payment returned.<br /><em>Settlement is pending.</em></h1>
            <p>{providerName(receipt.paymentProvider)} is confirming the payment. Bidstage will not move the project until the signed webhook matches the approved amount and checkout.</p>
            <ReceiptFacts receipt={receipt} />
          </div>
        ) : adjusted && receipt ? (
          <div className="receipt-state receipt-adjusted">
            <span className="settlement-stamp"><i /> Ledger adjusted</span>
            <h1>{adjustmentTitle(receipt)}<br /><em>Ranking value reversed.</em></h1>
            <p>{adjustmentDescription(receipt)} The original payment remains in the ledger and every reversal is recorded as a separate negative entry.</p>
            <ReceiptFacts receipt={receipt} />
            <div className="adjustment-effect">
              <div><span>Original contribution</span><strong>{money.format(receipt.contributionCents / 100)}</strong></div>
              <span className="rank-arrow">→</span>
              <div><span>Current ranking value</span><strong>{money.format(receipt.adjustment!.netContributionCents / 100)}</strong></div>
            </div>
            <div className="receipt-actions">
              <a className="primary-link" href="/#board">View corrected board <span>↗</span></a>
              {receipt.state === "partially_refunded" && receipt.product.listingSlug ? (
                <a href={`/go/${receipt.product.listingSlug}`} target="_blank" rel="sponsored noopener">Open destination ↗</a>
              ) : null}
            </div>
          </div>
        ) : reviewing && receipt ? (
          <div className="receipt-state receipt-reviewing">
            <span className="settlement-stamp"><i /> Payment settled · review open</span>
            <h1>Payment verified.<br /><em>Safety review pending.</em></h1>
            <p>The contribution is permanently recorded, but a new destination does not enter the public board until an operator approves it. The quoted rank remains a projection during review.</p>
            <ReceiptFacts receipt={receipt} />
            {receipt.canManage ? (
              <OwnershipProof reference={receipt.reference} destination={receipt.product.destination} />
            ) : null}
            <div className="rank-effect review-effect">
              <div><span>Projected category rank</span><strong>#{pad(receipt.quote.categoryRank)}</strong></div>
              <span className="rank-arrow">→</span>
              <div><span>Listing state</span><strong>Review</strong></div>
            </div>
            <div className="receipt-actions">
              <a className="primary-link" href="/#board">View public board <span>↗</span></a>
            </div>
          </div>
        ) : removed && receipt ? (
          <div className="receipt-state receipt-adjusted">
            <span className="settlement-stamp"><i /> Placement removed</span>
            <h1>Listing unavailable.<br /><em>Payment history preserved.</em></h1>
            <p>{receipt.moderation?.publicNote ?? "This destination was removed under the marketplace rules."} Removal stops public ranking and redirects but does not erase the original settlement record.</p>
            <ReceiptFacts receipt={receipt} />
            <div className="receipt-actions">
              <a className="primary-link" href="/legal/rules">Read board rules <span>↗</span></a>
              {receipt.canManage ? <a href="#receipt-support">Open receipt support ↓</a> : null}
            </div>
          </div>
        ) : settled && receipt ? (
          <div className="receipt-state receipt-settled">
            <span className="settlement-stamp"><i /> Ledger settled</span>
            <h1>Placement verified.<br /><em>Receipt published.</em></h1>
            <p>The contribution is recorded once in the public rank ledger. No payer identity is included in this receipt.</p>
            <ReceiptFacts receipt={receipt} />
            <div className="rank-effect">
              <div><span>Quoted category rank</span><strong>#{pad(receipt.quote.categoryRank)}</strong></div>
              <span className="rank-arrow">→</span>
              <div><span>Current category rank</span><strong>#{pad(receipt.settlement!.categoryRank)}</strong></div>
            </div>
            <div className="receipt-actions">
              <a className="primary-link" href="/#board">View live board <span>↗</span></a>
              {receipt.product.listingSlug ? (
                <a href={`/go/${receipt.product.listingSlug}`} target="_blank" rel="sponsored noopener">Open destination ↗</a>
              ) : null}
            </div>
          </div>
        ) : retryable && receipt ? (
          <div className="receipt-state receipt-failed">
            <span className="settlement-stamp">Checkout {receipt.state}</span>
            <h1>No ranking value<br /><em>was created.</em></h1>
            <p>{receipt.state === "expired" ? "The checkout ended before a signed payment settlement arrived." : "Bidstage could not create or confirm this checkout."} Start a new live quote before trying again. If money left your account, open a support case below instead of paying twice.</p>
            <ReceiptFacts receipt={receipt} />
            <div className="receipt-actions"><a className="primary-link" href="/#top">Start a new quote <span>↗</span></a></div>
          </div>
        ) : receipt ? (
          <div className="receipt-state receipt-failed">
            <span className="settlement-stamp">{receipt.state}</span>
            <h1>This checkout was not settled.</h1>
            <p>No rank was created from this payment state. Contact support with the receipt reference below.</p>
            <ReceiptFacts receipt={receipt} />
          </div>
        ) : null}
        {receipt && !loading ? <FounderAccessState canManage={receipt.canManage} /> : null}
        {receipt?.canManage && !loading ? (
          <SupportIntake
            receiptReference={receipt.reference}
            appealEligible={["review", "removed"].includes(receipt.product.listingStatus ?? "")}
          />
        ) : null}
      </section>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}

function FounderAccessState({ canManage }: { canManage: boolean }) {
  return (
    <section className={`founder-access ${canManage ? "founder-access-active" : "founder-access-public"}`}>
      <span>{canManage ? "Founder controls" : "Public receipt"}</span>
      <strong>{canManage ? "Management access is active in this browser." : "Management actions are hidden."}</strong>
      <p>
        {canManage
          ? "You may create DNS ownership proof and open private receipt support. Access is stored in an HttpOnly cookie and is never included in the public ledger."
          : "Payment and ranking history remain public. DNS ownership proof and receipt support require the secure browser that created checkout."}
      </p>
    </section>
  );
}

function SupportIntake({ receiptReference, appealEligible }: { receiptReference: string; appealEligible: boolean }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("placement");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [caseUrl, setCaseUrl] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptReference, category, message }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Support case could not be created.");
      setCaseUrl(body.caseUrl as string);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Support case could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="support-intake" id="receipt-support">
      <div className="support-intake-heading">
        <div><span>Receipt support</span><strong>{appealEligible ? "Need help or want to appeal?" : "Need help with this placement?"}</strong></div>
        {!open && !caseUrl ? <button type="button" aria-expanded={open} aria-controls="receipt-support-form" onClick={() => setOpen(true)}>Open support case</button> : null}
      </div>
      {caseUrl ? (
        <div className="support-created">
          <p>Your case was created. Save the private link—it contains the only token that can read the response.</p>
          <a href={caseUrl}>Open private case</a>
        </div>
      ) : open ? (
        <form id="receipt-support-form" onSubmit={submit}>
          <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{appealEligible ? <option value="appeal">Appeal moderation decision</option> : null}<option value="placement">Placement or review</option><option value="payment">Payment</option><option value="refund">Refund</option><option value="destination">Destination</option><option value="technical">Technical problem</option></select></label>
          <label>What happened?<textarea minLength={20} maxLength={1200} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe what you expected and what happened." required /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div><button type="button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" disabled={submitting}>{submitting ? "Creating case…" : "Create case"}</button></div>
        </form>
      ) : null}
    </section>
  );
}

type Verification = {
  available: true;
  method: "dns_txt";
  hostname: string;
  recordName: string;
  recordValue: string;
  state: "pending" | "verified" | "expired";
  attemptCount: number;
  expiresAt: string;
  verifiedAt: string | null;
};

function OwnershipProof({ reference, destination }: { reference: string; destination: string }) {
  const [verification, setVerification] = useState<Verification>();
  const [working, setWorking] = useState<"create" | "verify">();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState<"name" | "value">();
  const hostname = new URL(destination).hostname;

  if (hostname === "x.com" || hostname.endsWith(".x.com")) {
    return (
      <section className="ownership-proof ownership-manual">
        <div><span>Ownership proof</span><strong>Manual handle review</strong></div>
        <p>DNS verification is not available for an X handle. The operator will review the public account and submitted product identity.</p>
      </section>
    );
  }

  async function act(action: "create" | "verify") {
    setWorking(action);
    setError(undefined);
    try {
      const response = await fetch(`/api/receipts/${encodeURIComponent(reference)}/verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (body.available) setVerification(body as Verification);
      if (!response.ok) throw new Error(body.message ?? "Ownership verification could not be completed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ownership verification could not be completed.");
    } finally {
      setWorking(undefined);
    }
  }

  async function copy(value: string, field: "name" | "value") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      window.setTimeout(() => setCopied((current) => current === field ? undefined : current), 1_500);
    } catch {
      setError("Copy failed. Select the record text manually.");
    }
  }

  if (!verification) {
    return (
      <section className="ownership-proof ownership-start">
        <div><span>Optional ownership proof</span><strong>Verify {hostname} by DNS</strong></div>
        <p>Publishing one TXT record proves control of the destination and gives the operator verified evidence during review.</p>
        {error ? <p className="verification-error" role="alert">{error}</p> : null}
        <button type="button" onClick={() => void act("create")} disabled={working === "create"}>
          {working === "create" ? "Creating challenge…" : "Create DNS challenge"}
        </button>
      </section>
    );
  }

  return (
    <section className={`ownership-proof ownership-slip ${verification.state === "verified" ? "ownership-verified" : ""}`}>
      <div className="ownership-title">
        <div><span>DNS ownership proof</span><strong>{verification.state === "verified" ? "Domain verified" : "Add this TXT record"}</strong></div>
        <span className="ownership-state">{verification.state}</span>
      </div>
      <dl>
        <div><dt>Type</dt><dd><code>TXT</code></dd></div>
        <div><dt>Host / name</dt><dd><code>{verification.recordName}</code><button type="button" onClick={() => void copy(verification.recordName, "name")}>{copied === "name" ? "Copied" : "Copy"}</button></dd></div>
        <div><dt>Value</dt><dd><code>{verification.recordValue}</code><button type="button" onClick={() => void copy(verification.recordValue, "value")}>{copied === "value" ? "Copied" : "Copy"}</button></dd></div>
      </dl>
      {verification.state === "verified" ? (
        <p className="verification-success">Verified {verification.verifiedAt ? formatDate(verification.verifiedAt) : "in public DNS"}. The operator can now use this proof during review.</p>
      ) : (
        <div className="verification-action">
          <p>Keep the record public until review completes. Challenge expires {formatDate(verification.expiresAt)}.</p>
          <button type="button" onClick={() => void act("verify")} disabled={working === "verify" || verification.state === "expired"}>
            {working === "verify" ? "Checking public DNS…" : "Check DNS record"}
          </button>
        </div>
      )}
      {error ? <p className="verification-error" role="alert">{error}</p> : null}
    </section>
  );
}

function ReceiptFacts({ receipt }: { receipt: Receipt }) {
  const adjusted = receipt.adjustment && receipt.adjustment.reversedCents > 0;
  return (
    <dl className="receipt-facts">
      <div><dt>Product</dt><dd>{receipt.product.title}</dd></div>
      <div><dt>{adjusted ? "Net ranking value" : "Contribution"}</dt><dd>{money.format((adjusted ? receipt.adjustment!.netContributionCents : receipt.contributionCents) / 100)}</dd></div>
      <div><dt>Category</dt><dd>{receipt.product.category}</dd></div>
      <div><dt>Product type</dt><dd>{receipt.product.kind === "open_source" ? "Open source" : "Commercial"}</dd></div>
      <div><dt>Community country</dt><dd>{receipt.product.countryCode ? <a href={`/country/${receipt.product.countryCode}`}>{countryName(receipt.product.countryCode)}</a> : "Global"}</dd></div>
      {receipt.product.repository ? <div><dt>Verified source</dt><dd><a href={receipt.product.repository.url} target="_blank" rel="noopener">{receipt.product.repository.owner}/{receipt.product.repository.name}</a> · {receipt.product.repository.licenseSpdx} · {receipt.product.repository.verificationMethod === "repository_file" ? "repository proof" : receipt.product.repository.verificationMethod === "personal_owner" ? "owner match" : "legacy record"}</dd></div> : null}
      {receipt.product.fundingUrl ? <div><dt>Project funding</dt><dd><a href={receipt.product.fundingUrl} target="_blank" rel="noopener">{receipt.product.fundingProvider === "github_sponsors" ? "GitHub Sponsors" : "Open Collective"}</a> · outside ranking</dd></div> : null}
      {receipt.product.contributionUrl ? <div><dt>Contribution opportunity</dt><dd><a href={receipt.product.contributionUrl} target="_blank" rel="noopener">{receipt.product.contributionNote}</a></dd></div> : null}
      <div><dt>Projected total</dt><dd>{money.format(receipt.quote.projectedTotalCents / 100)}</dd></div>
      <div><dt>Receipt reference</dt><dd><code>{receipt.reference}</code></dd></div>
      <div><dt>Payment processor</dt><dd>{providerName(receipt.paymentProvider)}</dd></div>
      <div><dt>{adjusted ? "Adjusted" : receipt.settlement ? "Settled" : "Created"}</dt><dd>{formatDate(adjusted ? receipt.adjustment!.adjustedAt ?? receipt.settlement!.settledAt : receipt.settlement?.settledAt ?? receipt.createdAt)}</dd></div>
    </dl>
  );
}

function adjustmentTitle(receipt: Receipt): string {
  if (receipt.state === "disputed") return "Payment disputed.";
  if (receipt.state === "refunded") return "Payment refunded.";
  return "Partial refund recorded.";
}

function adjustmentDescription(receipt: Receipt): string {
  const amount = money.format((receipt.adjustment?.reversedCents ?? 0) / 100);
  if (receipt.state === "disputed") {
    return `${amount} was removed from the product after a payment dispute.`;
  }
  return `${amount} was refunded and removed from the product's ranking total.`;
}

function pad(value: number | null): string {
  if (value === null) return "—";
  return String(value).padStart(2, "0");
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function providerName(provider: Receipt["paymentProvider"]): string {
  if (provider === "dodo") return "Dodo Payments";
  if (provider === "creem") return "Creem";
  return "Legacy processor";
}
