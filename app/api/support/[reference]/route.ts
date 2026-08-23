import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import { authorizedSupportCase, bearerToken } from "@/lib/support";

type MessageRow = {
  id: string;
  author_type: "founder" | "operator";
  body: string;
  created_at: Date;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ reference: string }> },
) {
  const { reference } = await context.params;
  const token = bearerToken(request);
  const supportCase = token ? await authorizedSupportCase(reference, token) : undefined;
  if (!supportCase) {
    return NextResponse.json({ error: "case_not_found" }, { status: 404 });
  }
  const messages = await query<MessageRow>(
    `SELECT id::text, author_type, body, created_at
     FROM support_case_messages
     WHERE support_case_id = $1
     ORDER BY created_at ASC, id ASC`,
    [supportCase.id],
  );
  return NextResponse.json(
    {
      reference: supportCase.public_reference,
      receiptReference: supportCase.receipt_reference,
      category: supportCase.category,
      state: supportCase.state,
      messages: messages.map((message) => ({
        id: message.id,
        author: message.author_type,
        body: message.body,
        createdAt: message.created_at.toISOString(),
      })),
      createdAt: supportCase.created_at.toISOString(),
      updatedAt: supportCase.updated_at.toISOString(),
      resolvedAt: supportCase.resolved_at?.toISOString() ?? null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
