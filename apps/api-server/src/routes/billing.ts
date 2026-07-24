import type { FastifyInstance } from "fastify";
import { prisma } from "@daw-cast/db";
import type { SubscriptionState } from "@daw-cast/shared-types";
import { requireAuth } from "../lib/authMiddleware.js";
import { getStripeClient, isBillingConfigured } from "../lib/stripe.js";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

// Stripe's subscription.status has more values than our Prisma enum tracks
// (unpaid, incomplete_expired, paused) — anything not explicitly "still
// entitled" collapses to "canceled" rather than left unmapped.
type PrismaSubscriptionStatus = "none" | "active" | "trialing" | "past_due" | "canceled" | "incomplete";
function mapStripeStatus(status: string): PrismaSubscriptionStatus {
  if (status === "active" || status === "trialing" || status === "past_due" || status === "incomplete") {
    return status;
  }
  return "canceled";
}

function toState(sub: { tier: string; status: string; currentPeriodEnd: Date | null } | null): SubscriptionState {
  if (!sub) return { tier: "free", status: "none", currentPeriodEnd: null };
  return {
    tier: sub.tier as SubscriptionState["tier"],
    status: sub.status as SubscriptionState["status"],
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
  };
}

export async function billingRoutes(app: FastifyInstance) {
  app.get("/billing/status", { preHandler: requireAuth }, async (request, reply) => {
    const sub = await prisma.subscription.findUnique({ where: { userId: request.authUser!.sub } });
    return reply.send(toState(sub));
  });

  app.post("/billing/checkout", { preHandler: requireAuth }, async (request, reply) => {
    const stripe = getStripeClient();
    if (!stripe || !isBillingConfigured()) {
      return reply.status(503).send({ error: "billing_not_configured" });
    }

    const userId = request.authUser!.sub;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.status(404).send({ error: "not_found" });

    let sub = await prisma.subscription.findUnique({ where: { userId } });
    if (sub?.status === "active" || sub?.status === "trialing") {
      return reply.status(409).send({ error: "already_subscribed" });
    }

    // A Stripe Customer is created once per user and reused across
    // checkout attempts — avoids accumulating duplicate customers if
    // someone abandons checkout and retries.
    let stripeCustomerId = sub?.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId } });
      stripeCustomerId = customer.id;
      sub = await prisma.subscription.upsert({
        where: { userId },
        create: { userId, stripeCustomerId, tier: "free", status: "none" },
        update: { stripeCustomerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: env.STRIPE_PRICE_ID!, quantity: 1 }],
      success_url: env.STRIPE_SUCCESS_URL,
      cancel_url: env.STRIPE_CANCEL_URL,
      metadata: { userId },
    });

    if (!session.url) return reply.status(500).send({ error: "checkout_session_failed" });
    return reply.send({ url: session.url });
  });

  app.post("/billing/portal", { preHandler: requireAuth }, async (request, reply) => {
    const stripe = getStripeClient();
    if (!stripe || !isBillingConfigured()) {
      return reply.status(503).send({ error: "billing_not_configured" });
    }

    const sub = await prisma.subscription.findUnique({ where: { userId: request.authUser!.sub } });
    if (!sub?.stripeCustomerId) {
      return reply.status(400).send({ error: "no_subscription" });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: env.STRIPE_SUCCESS_URL,
    });
    return reply.send({ url: portalSession.url });
  });

  // No requireAuth here — Stripe calls this directly, authenticated instead
  // by verifying the webhook signature against the raw request body.
  app.post("/billing/webhook", async (request, reply) => {
    const stripe = getStripeClient();
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
      return reply.status(503).send({ error: "billing_not_configured" });
    }

    const signature = request.headers["stripe-signature"];
    if (!signature || !request.rawBody) {
      return reply.status(400).send({ error: "missing_signature" });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(request.rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return reply.status(400).send({ error: "invalid_signature" });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (userId && subscriptionId && typeof session.customer === "string") {
          await prisma.subscription.upsert({
            where: { userId },
            create: {
              userId,
              stripeCustomerId: session.customer,
              stripeSubscriptionId: subscriptionId,
              tier: "pro",
              status: "active",
            },
            update: { stripeSubscriptionId: subscriptionId, tier: "pro", status: "active" },
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
        const status =
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : mapStripeStatus(subscription.status);
        const periodEndItem = subscription.items.data[0]?.current_period_end;
        await prisma.subscription.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            status,
            tier: status === "active" || status === "trialing" ? "pro" : "free",
            currentPeriodEnd: periodEndItem ? new Date(periodEndItem * 1000) : null,
          },
        });
        break;
      }
      default:
        break;
    }

    return reply.send({ received: true });
  });
}
