import Stripe from "stripe";
import { env } from "../env.js";

// Billing is entirely optional infrastructure: without real Stripe keys the
// app still runs (everyone just stays on the free tier), so this client is
// only constructed lazily, the first time a billing route actually needs it.
let client: Stripe | null | undefined;

export function getStripeClient(): Stripe | null {
  if (client !== undefined) return client;
  client = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
  return client;
}

export function isBillingConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
}
