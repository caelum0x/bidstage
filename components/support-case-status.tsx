"use client";

import { useCallback, useEffect, useState } from "react";

type SupportCase = {
  reference: string;
  receiptReference: string;
  category: string;
  state: "open" | "needs_customer" | "resolved" | "closed";
  messages: Array<{
    id: string;
    author: "founder" | "operator";
    body: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export function SupportCaseStatus({ reference }: { reference: string }) {
  const [supportCase, setSupportCase] = useState<SupportCase>();
  const [error, setError] = useState<string>();
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const token = window.location.hash.slice(1);
    if (!token) {
      setError("This private case link is missing its access token.");
      return;
    }
    try {
      const response = await fetch(`/api/support/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("This support case could not be opened with the supplied private link.");
      setSupportCase(await response.json() as SupportCase);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Support case is unavailable.");
    }
  }, [reference]);

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = window.location.hash.slice(1);
    if (!token) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/support/${encodeURIComponent(reference)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Reply could not be sent.");
      setReply("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reply could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!supportCase || !["open", "needs_customer"].includes(supportCase.state)) return;
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load, supportCase]);

  return (
    <main className="receipt-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation"><a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a><a href="/#board">Return to board</a></nav>
      <section className="support-case shell">
        <div className="receipt-index">Private support case / {reference}</div>
        {!supportCase && error ? <div className="receipt-state receipt-failed"><span className="settlement-stamp">Access unavailable</span><h1>Case not available.</h1><p>{error}</p></div> : !supportCase ? <div className="receipt-state"><span className="receipt-spinner" /><h1>Reading case.</h1></div> : <div className="receipt-state"><span className="settlement-stamp">{supportCase.state.replace("_", " ")}</span><h1>Support case<br /><em>{supportCase.reference}</em></h1><dl className="receipt-facts"><div><dt>Category</dt><dd>{supportCase.category}</dd></div><div><dt>Opened</dt><dd>{formatDate(supportCase.createdAt)}</dd></div><div><dt>Receipt</dt><dd><a href={`/receipt/${supportCase.receiptReference}`}>{supportCase.receiptReference}</a></dd></div></dl><section className="case-thread">{supportCase.messages.map((message) => <article className={message.author === "operator" ? "operator-reply" : ""} key={message.id}><span>{message.author === "operator" ? "Bidstage response" : "Your message"} · {formatDate(message.createdAt)}</span><p>{message.body}</p></article>)}{supportCase.messages.every((message) => message.author !== "operator") ? <article><span>Waiting for response</span><p>The operator queue has received this case. This page refreshes automatically while it remains open.</p></article> : null}</section>{["open", "needs_customer"].includes(supportCase.state) ? <form className="case-reply" onSubmit={sendReply}><label>{supportCase.state === "needs_customer" ? "Operator requested more information" : "Add information"}<textarea minLength={3} maxLength={1200} value={reply} onChange={(event) => setReply(event.target.value)} required /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button type="submit" disabled={submitting}>{submitting ? "Sending…" : "Send reply"}</button></form> : null}</div>}
      </section>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
