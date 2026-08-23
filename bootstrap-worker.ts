const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bidstage — Production setup</title>
  <meta name="description" content="Bidstage is preparing its production platform for open-source project discovery, contribution, and transparent placement bidding.">
  <style>
    :root{color-scheme:light;--paper:#fff;--ink:#111;--muted:#5d6168;--blue:#002fa7;--line:#c9cdd4}
    *{box-sizing:border-box}
    html{background:var(--paper);font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:var(--ink)}
    body{margin:0;min-height:100vh;display:grid;grid-template-rows:auto 1fr auto}
    header,main,footer{display:grid;grid-template-columns:minmax(20px,1fr) minmax(0,1120px) minmax(20px,1fr)}
    header{border-bottom:1px solid var(--ink)}
    header>div,main>div,footer>div{grid-column:2}
    header>div{min-height:72px;display:flex;align-items:center;justify-content:space-between}
    .wordmark{font-size:18px;font-weight:800;letter-spacing:-.04em}
    .status{font-size:12px;color:var(--blue);font-weight:700}
    main>div{display:grid;grid-template-columns:2fr 1fr;gap:0;border-left:1px solid var(--line);border-right:1px solid var(--line)}
    .intro{padding:clamp(48px,8vw,112px) clamp(24px,6vw,80px);border-right:1px solid var(--line)}
    .stage{font-size:clamp(120px,24vw,320px);font-weight:800;line-height:.72;letter-spacing:-.1em;color:var(--blue);margin-left:-.08em}
    h1{max-width:760px;margin:56px 0 20px;font-size:clamp(42px,7vw,94px);line-height:.92;letter-spacing:-.07em}
    .intro p{max-width:620px;margin:0;font-size:clamp(17px,2vw,23px);line-height:1.45;color:var(--muted)}
    aside{padding:48px 28px;align-self:end;border-top:1px solid var(--line)}
    aside h2{font-size:13px;margin:0 0 24px;text-transform:uppercase;letter-spacing:.1em}
    dl{margin:0}
    dl div{padding:16px 0;border-top:1px solid var(--line)}
    dt{font-size:12px;color:var(--muted);margin-bottom:7px}
    dd{margin:0;font:600 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
    footer{border-top:1px solid var(--ink)}
    footer>div{min-height:58px;display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted)}
    @media(max-width:760px){main>div{grid-template-columns:1fr}.intro{border-right:0}.stage{font-size:42vw}aside{align-self:auto}footer>div{display:grid;gap:5px;padding:16px 0}}
  </style>
</head>
<body>
  <header><div><span class="wordmark">Bidstage</span><span class="status">Production domain live</span></div></header>
  <main><div>
    <section class="intro"><div class="stage" aria-hidden="true">01</div><h1>Open-source projects, ranked in public.</h1><p>Bidstage is preparing production access for project owners and contributors. The database and edge infrastructure are online; account connections are being configured.</p></section>
    <aside><h2>Account callbacks</h2><dl>
      <div><dt>GitHub</dt><dd>https://bidstage.app/api/auth/github/callback</dd></div>
      <div><dt>Google</dt><dd>https://bidstage.app/api/auth/google/callback</dd></div>
    </dl></aside>
  </div></main>
  <footer><div><span>Bidstage</span><span>Open-source discovery, contribution, and transparent placement.</span></div></footer>
</body>
</html>`;

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { ...securityHeaders, Allow: "GET, HEAD" } });
    }
    if (url.pathname === "/api/health") {
      return Response.json(
        { status: "setup", service: "bidstage", database: "configured", authentication: "pending" },
        { status: 200, headers: securityHeaders },
      );
    }
    if (url.pathname === "/api/auth/github/callback" || url.pathname === "/api/auth/google/callback") {
      return Response.json(
        { error: "authentication_setup_in_progress", provider: url.pathname.includes("github") ? "github" : "google" },
        { status: 503, headers: { ...securityHeaders, "Retry-After": "3600" } },
      );
    }
    return new Response(request.method === "HEAD" ? null : page, {
      status: 200,
      headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
