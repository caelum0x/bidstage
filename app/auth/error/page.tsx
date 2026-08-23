import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GitHub sign-in failed",
  robots: { index: false, follow: false },
};

export default function AuthErrorPage() {
  return (
    <main className="void-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation"><a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a></nav>
      <section className="void-record error-record shell">
        <span>GitHub sign-in failed</span>
        <strong aria-hidden="true">401</strong>
        <h1>Your GitHub identity was not connected.</h1>
        <p>The authorization may have expired or been cancelled. No GitHub token was stored. Return to Bidstage and try again.</p>
        <a href="/">Return to Bidstage</a>
      </section>
    </main>
  );
}
