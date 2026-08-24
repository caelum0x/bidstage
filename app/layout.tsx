import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bidstage.app"),
  title: {
    default: "Bidstage — sponsored discovery for open source",
    template: "%s | Bidstage",
  },
  description: "A transparent sponsored board for owner-verified, OSI-licensed open-source projects.",
  icons: { icon: "/icon.svg" },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Bidstage",
    title: "Bidstage — sponsored discovery for open source",
    description: "A transparent sponsored board for owner-verified, OSI-licensed open-source projects.",
    url: "/",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Bidstage — open-source projects, ranked in public" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bidstage — sponsored discovery for open source",
    description: "A transparent sponsored board for owner-verified, OSI-licensed open-source projects.",
    images: ["/twitter-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://bidstage.app/#organization",
      name: "BidStage",
      url: "https://bidstage.app",
      description: "A transparent sponsored board for owner-verified, OSI-licensed open-source projects.",
      logo: "https://bidstage.app/icon.svg",
    },
    {
      "@type": "WebSite",
      "@id": "https://bidstage.app/#website",
      name: "BidStage",
      url: "https://bidstage.app",
      description: "A transparent sponsored board for owner-verified, OSI-licensed open-source projects.",
      publisher: { "@id": "https://bidstage.app/#organization" },
      inLanguage: "en",
    },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to main content</a><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />{children}</body></html>;
}
