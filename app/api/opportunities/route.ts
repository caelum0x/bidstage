import { NextResponse } from "next/server";

import { isCountryCode } from "@/lib/countries";
import { CATEGORIES, type Category } from "@/lib/market";
import { readPublicOpportunities } from "@/lib/public-opportunities";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const category = url.searchParams.get("category") || null;
    const language = url.searchParams.get("language")?.trim() || null;
    const country = url.searchParams.get("country")?.trim().toUpperCase() || null;
    if (category && !CATEGORIES.includes(category as Category)) {
      return NextResponse.json({ error: "invalid_category" }, { status: 400 });
    }
    if (language && (language.length > 80 || !/^[\p{L}\p{N} .+#_-]+$/u.test(language))) {
      return NextResponse.json({ error: "invalid_language" }, { status: 400 });
    }
    if (country && !isCountryCode(country)) {
      return NextResponse.json({ error: "invalid_country" }, { status: 400 });
    }
    const data = await readPublicOpportunities({
      category: category as Category | null,
      language,
      country: country && isCountryCode(country) ? country : null,
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "opportunities_unavailable", message: "Contribution opportunities are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
