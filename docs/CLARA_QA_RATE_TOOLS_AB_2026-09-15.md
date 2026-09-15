# Clara QA — buyer limits, faster tools and isolated A/B candidates

Date: 2026-09-15

## Scope

This checkpoint is QA-only. It does not change Vercel Production, the production ElevenLabs agent, Shopify live or Neon `main`.

## Buyer access and limits

- A fresh Shopify link signs `v`, `customer_id`, `orders_count` and `issued_at` together and expires after five minutes.
- The application exchanges that link for a random HttpOnly, Secure, SameSite=Lax ticket stored in Vercel KV, then removes all query parameters from the visible URL.
- The stored ticket contains only a derived customer key and the minimal greeting context. It does not store the Shopify customer ID, email, surname, HMAC token or signed URL.
- The legacy customer-ID-only signature remains a transitional QA input, but purchase count is re-read from Shopify; the unsigned URL count is never trusted.
- Paid session creation fails closed if KV is unavailable.
- Each derived buyer identity is limited atomically to one active conversation and three starts per rolling hour. The active lock expires after 12 minutes and is released on browser stop, post-call completion or provider startup failure.
- ElevenLabs retains the existing 600-second maximum conversation duration.

## Tool latency

- Product search keeps a four-minute public catalog cache keyed by a hash of the normalized query.
- Routine save deduplicates handles and verifies all requested products in one Shopify GraphQL request instead of one request per step.
- Search and save log only allowlisted timing/count fields: total, Shopify, Neon, cache hit and result count.
- Shopify remains the source of truth; cache failure is non-blocking and every saved product is freshly validated.

## ElevenLabs candidates

Both candidates branch from `qa-memory-products-2026-09-15` and have 0% traffic:

1. `qa-intelligence-terra-2026-09-15`: only LLM changes to `gpt-5.6-terra`, reasoning low.
2. `qa-voice-v3-2026-09-15`: only TTS changes to `eleven_v3_conversational`; the cloned voice and all other settings stay unchanged.

The baseline remains at 100%. The initial five-test comparison was baseline 3/5, voice 2/5 and intelligence 1/5. Do not expose either candidate until the tool-call failures are understood and the exact same tests pass at an acceptable rate. Voice quality still requires a human listening test because text simulations cannot evaluate identity, prosody or lip-sync.

## Rollback

Restore the prior Vercel Preview deployment. The active ElevenLabs branch does not need a rollback because A/B candidates are at 0%. Do not delete data or change production resources.
