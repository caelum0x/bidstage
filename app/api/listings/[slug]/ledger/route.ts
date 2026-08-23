import { NextResponse } from "next/server";

import { query } from "@/lib/db";

type Cursor = { at: string; id: string };
type LedgerRow = {
  id: string;
  entry_type: "contribution" | "refund_reversal" | "dispute_reversal";
  amount_cents: number;
  created_at: Date;
  public_reference: string;
};

function decodeCursor(value: string | null): Cursor | undefined {
  if (!value || value.length > 300) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (
      typeof parsed.at !== "string" || !Number.isFinite(new Date(parsed.at).getTime()) ||
      typeof parsed.id !== "string" || !/^[a-f0-9-]{36}$/i.test(parsed.id)
    ) return undefined;
    return parsed as Cursor;
  } catch {
    return undefined;
  }
}

function encodeCursor(entry: LedgerRow): string {
  return Buffer.from(JSON.stringify({ at: entry.created_at.toISOString(), id: entry.id })).toString("base64url");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) {
    return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const suppliedCursor = url.searchParams.get("cursor");
  const cursor = decodeCursor(suppliedCursor);
  if (suppliedCursor && !cursor) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }
  const rows = await query<LedgerRow>(
    `SELECT ledger.id::text, ledger.entry_type, ledger.amount_cents,
            ledger.created_at, checkout.public_reference
     FROM rank_ledger AS ledger
     JOIN payment_checkouts AS checkout ON checkout.id = ledger.checkout_id
     JOIN listings ON listings.id = ledger.listing_id
     WHERE listings.slug = $1 AND listings.status = 'active'
       AND ($2::timestamptz IS NULL OR (ledger.created_at, ledger.id) < ($2::timestamptz, $3::uuid))
     ORDER BY ledger.created_at DESC, ledger.id DESC
     LIMIT 26`,
    [slug, cursor?.at ?? null, cursor?.id ?? null],
  );
  const hasMore = rows.length > 25;
  const entries = rows.slice(0, 25);
  const last = entries.at(-1);
  return NextResponse.json(
    {
      entries: entries.map((entry) => ({
        id: entry.id,
        entryType: entry.entry_type,
        amountCents: entry.amount_cents,
        createdAt: entry.created_at.toISOString(),
        receiptReference: entry.public_reference,
      })),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    },
    { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=45" } },
  );
}
