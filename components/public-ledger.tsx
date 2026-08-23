"use client";

import { useState } from "react";

export type PublicLedgerEntry = {
  id: string;
  entryType: "contribution" | "refund_reversal" | "dispute_reversal";
  amountCents: number;
  createdAt: string;
  receiptReference: string;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function PublicLedger({
  slug,
  initialEntries,
  initialCursor,
}: {
  slug: string;
  initialEntries: PublicLedgerEntry[];
  initialCursor: string | null;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/listings/${encodeURIComponent(slug)}/ledger?cursor=${encodeURIComponent(cursor)}`);
      const body = await response.json();
      if (!response.ok) throw new Error("Earlier ledger movements could not be loaded.");
      setEntries((current) => [...current, ...(body.entries as PublicLedgerEntry[])]);
      setCursor(body.nextCursor as string | null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Earlier ledger movements could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ledger-table" role="table" aria-label="Product rank ledger">
      <div className="ledger-row ledger-header" role="row">
        <span role="columnheader">Movement</span><span role="columnheader">Amount</span><span role="columnheader">Recorded</span><span role="columnheader">Receipt</span>
      </div>
      {entries.map((entry) => (
        <div className={`ledger-row ${entry.amountCents < 0 ? "ledger-negative" : ""}`} role="row" key={entry.id}>
          <span role="cell">{ledgerLabel(entry.entryType)}</span>
          <strong role="cell">{entry.amountCents > 0 ? "+" : "−"}{money.format(Math.abs(entry.amountCents) / 100)}</strong>
          <time role="cell" dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
          <a role="cell" href={`/receipt/${entry.receiptReference}`}>{entry.receiptReference.slice(0, 8)}…</a>
        </div>
      ))}
      {error ? <p className="ledger-load-error" role="alert">{error}</p> : null}
      {cursor ? <button className="ledger-load" type="button" onClick={() => void loadMore()} disabled={loading}>{loading ? "Loading…" : "Load earlier movements"}</button> : null}
    </div>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function ledgerLabel(type: PublicLedgerEntry["entryType"]): string {
  if (type === "refund_reversal") return "Refund reversal";
  if (type === "dispute_reversal") return "Dispute reversal";
  return "Settled contribution";
}
