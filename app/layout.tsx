import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bidstage.app"),
  title: {
    default: "Bidstage — Discover Open-Source Projects & Promote Yours",
    template: "%s | Bidstage",
  },
  description: "Browse open-source projects by language and country to find where to contribute — or promote your own repo with transparent, labeled placement. Every spend and click is public.",
  keywords: [
    "open source projects to contribute to",
    "find open source projects by language",
    "promote open source project",
    "open source project directory",
    "sponsor open source",
    "good first issues",
  ],
  icons: { icon: "/icon.svg" },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Bidstage",
    title: "Bidstage — Discover Open-Source Projects & Promote Yours",
    description: "Browse open-source projects by language and country to find where to contribute — or promote your own repo with transparent, labeled placement. Every spend and click is public.",
    url: "/",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Bidstage — discover and promote open-source projects in public" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bidstage — Discover Open-Source Projects & Promote Yours",
    description: "Browse open-source projects by language and country to find where to contribute — or promote your own repo with transparent, labeled placement.",
    images: ["/twitter-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

const siteDescription =
  "Browse open-source projects by language and country to find where to contribute, or promote your own repository with transparent, labeled placement where every spend and click is public.";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://bidstage.app/#organization",
      name: "Bidstage",
      url: "https://bidstage.app",
      description: siteDescription,
      logo: "https://bidstage.app/icon.svg",
    },
    {
      "@type": "WebSite",
      "@id": "https://bidstage.app/#website",
      name: "Bidstage",
      url: "https://bidstage.app",
      description: siteDescription,
      publisher: { "@id": "https://bidstage.app/#organization" },
      inLanguage: "en",
    },
    {
      "@type": "WebApplication",
      "@id": "https://bidstage.app/#webapp",
      name: "Bidstage",
      url: "https://bidstage.app",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      description: siteDescription,
      isAccessibleForFree: true,
      publisher: { "@id": "https://bidstage.app/#organization" },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free to browse and discover open-source projects; maintainers pay only for optional labeled placement.",
      },
    },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to main content</a><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />{children}</body></html>;
}
