import { BidBoard } from "@/components/bid-board";
import { connection } from "next/server";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const values = await searchParams;
  const placement = typeof values.placement === "string" && /^[a-z0-9-]{3,100}$/.test(values.placement)
    ? values.placement
    : null;
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  return <BidBoard turnstileSiteKey={turnstileSiteKey ?? ""} placementSlug={placement} />;
}
