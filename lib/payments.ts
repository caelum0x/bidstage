import { createCreemCheckout } from "./creem";
import { createDodoCheckout } from "./dodo";
import { creemEnv, dodoEnv } from "./env";
import type { PaymentProvider } from "./payment-settlement";

export type CreatePlacementCheckoutInput = {
  requestId: string;
  amountCents: number;
  successUrl: string;
  metadata: Record<string, string | number>;
};

export async function createPlacementCheckout(
  provider: PaymentProvider,
  input: Readonly<CreatePlacementCheckoutInput>,
) {
  if (provider === "dodo") return createDodoCheckout(input);
  if (provider === "creem") return createCreemCheckout(input);
  throw new Error("Unsupported placement payment provider");
}

export function assertPlacementPaymentConfigured(provider: PaymentProvider): void {
  if (provider === "dodo") dodoEnv();
  else if (provider === "creem") creemEnv();
  else throw new Error("Unsupported placement payment provider");
}
