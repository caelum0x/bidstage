export default function NotFound() {
  return (
    <main className="void-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation"><a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a><a href="/#board">Return to board</a></nav>
      <section className="void-record shell">
        <span>Record not found</span>
        <strong>404</strong>
        <h1>This ledger row does not exist.</h1>
        <p>The listing, receipt, support case, or page reference may be incorrect or no longer public.</p>
        <a href="/#board">View active products</a>
      </section>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}
