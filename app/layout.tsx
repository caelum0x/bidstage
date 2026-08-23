import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bidstage.app"),
  title: {
    default: "Bidstage — sponsored discovery for open source",
    template: "%s | Bidstage",
  },
  description: "A transparent sponsored board for owner-verified, OSI-licensed open-source projects.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Bidstage",
    title: "Bidstage — sponsored discovery for open source",
    description: "A transparent sponsored board for owner-verified, OSI-licensed open-source projects.",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "Bidstage — sponsored discovery for open source",
    description: "A transparent sponsored board for owner-verified, OSI-licensed open-source projects.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to main content</a>{children}</body></html>;
}
