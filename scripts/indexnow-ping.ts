// Notifies IndexNow (Bing, Yandex, and other participating search engines) of
// every URL in the live sitemap after each deploy, so new country/category/
// listing pages get crawled within minutes instead of waiting on organic
// discovery. Google doesn't consume IndexNow directly but indexes faster once
// Bing has already crawled a URL.
const SITE_URL = "https://bidstage.app";
const INDEXNOW_KEY = "9333e1a1412ac47cf55df20b5d3f501f";

type SitemapEntry = { loc: string };

async function fetchSitemapUrls(): Promise<string[]> {
  const res = await fetch(`${SITE_URL}/sitemap.xml`);
  if (!res.ok) {
    throw new Error(`failed to fetch sitemap: ${res.status}`);
  }
  const xml = await res.text();
  const entries: SitemapEntry[] = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => ({ loc: match[1] }),
  );
  return entries.map((entry) => entry.loc);
}

async function pingIndexNow(urls: string[]): Promise<void> {
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(SITE_URL).host,
      key: INDEXNOW_KEY,
      keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
      urlList: urls,
    }),
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`IndexNow submission failed: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const urls = await fetchSitemapUrls();
  console.log(`submitting ${urls.length} URLs to IndexNow`);
  // IndexNow caps a single submission at 10,000 URLs.
  for (let i = 0; i < urls.length; i += 10000) {
    await pingIndexNow(urls.slice(i, i + 10000));
  }
  console.log("IndexNow submission complete");
}

main().catch((error) => {
  console.error("IndexNow ping failed (non-fatal, deploy continues):", error);
  // Never fail the deploy over a best-effort indexing ping.
  process.exit(0);
});
