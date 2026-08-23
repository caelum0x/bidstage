"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="void-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation"><a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a><a href="/">Home</a></nav>
      <section className="void-record error-record shell">
        <span>Request failed</span>
        <strong>500</strong>
        <h1>Bidstage could not load this record.</h1>
        <p>No payment or ranking conclusion should be inferred from this error. Retry the request or use the receipt support flow if it continues.</p>
        <button type="button" onClick={reset}>Try again</button>
      </section>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}
