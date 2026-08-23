import type { MetadataRoute } from "next";

const SITE_URL = "https://bidstage.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/account", "/auth/", "/go/", "/receipt/", "/support/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
