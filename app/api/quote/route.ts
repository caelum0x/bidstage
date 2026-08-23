import { NextResponse } from "next/server";

import { MarketInputError, parseRankQuoteInput } from "@/lib/market";
import { calculateRankQuote } from "@/lib/rank-quote";

export async function POST(request: Request) {
  try {
    const input = parseRankQuoteInput(await request.json());
    const quote = await calculateRankQuote(input);
    return NextResponse.json(quote, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const clientError =
      error instanceof MarketInputError || error instanceof SyntaxError;
    return NextResponse.json(
      {
        error: clientError ? "invalid_quote" : "quote_unavailable",
        message:
          error instanceof MarketInputError
            ? error.message
            : "The live rank quote is temporarily unavailable.",
      },
      {
        status: clientError ? 400 : 503,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }
}
