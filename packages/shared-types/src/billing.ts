import { z } from "zod";

export const SubscriptionTierSchema = z.enum(["free", "pro"]);
export type SubscriptionTier = z.infer<typeof SubscriptionTierSchema>;

export const SubscriptionStatusSchema = z.enum([
  "none",
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

// Free tier: host + 1 joiner. Pro tier ($9.99/mo): host + up to 14 joiners.
export const SESSION_CAPACITY: Record<SubscriptionTier, number> = {
  free: 2,
  pro: 15,
};

export const SubscriptionStateSchema = z.object({
  tier: SubscriptionTierSchema,
  status: SubscriptionStatusSchema,
  currentPeriodEnd: z.string().datetime().nullable(),
});
export type SubscriptionState = z.infer<typeof SubscriptionStateSchema>;

export const CreateCheckoutSessionResponseSchema = z.object({
  url: z.string().url(),
});
export type CreateCheckoutSessionResponse = z.infer<typeof CreateCheckoutSessionResponseSchema>;

export const CreatePortalSessionResponseSchema = z.object({
  url: z.string().url(),
});
export type CreatePortalSessionResponse = z.infer<typeof CreatePortalSessionResponseSchema>;
