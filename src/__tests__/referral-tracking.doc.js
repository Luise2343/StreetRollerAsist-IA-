/**
 * Documentation: Referral Tracking Feature
 *
 * This document describes the referral tracking feature added to capture
 * ad campaign information from WhatsApp Cloud API webhook messages.
 *
 * FEATURE OVERVIEW:
 * -----------------
 * When a user messages from a WhatsApp ad (via Meta Ads), the webhook payload
 * includes a `message.referral` object with:
 *   - source_id: The ad ID that triggered the click
 *   - headline: The ad headline (optional)
 *   - body: The ad body text (optional)
 *
 * This data is captured and stored in wa_profile.facts_json for later analysis.
 *
 * IMPLEMENTATION:
 * ----------------
 *
 * 1. New Repository: src/repositories/wa-profile.repository.js
 *    - upsertProfileFact(tenantId, waId, facts)
 *      Upserts wa_profile, merging facts_json using PostgreSQL JSONB || operator
 *    - getProfileFacts(tenantId, waId)
 *      Retrieves facts_json from wa_profile
 *
 * 2. Updated Webhook Handler: src/routes/whatsapp.webhook.js
 *    - After message validation and deduplication
 *    - Checks if msg.referral is present
 *    - Captures referral data with timestamp
 *    - Stores in wa_profile.facts_json as:
 *      {
 *        "referral": {
 *          "ad_id": "source_id from Meta",
 *          "headline": "Ad headline",
 *          "body": "Ad body text",
 *          "captured_at": "ISO timestamp"
 *        }
 *      }
 *    - Logs capture event with tenant, wa_id, and ad_id
 *    - Errors are caught and logged without blocking message flow
 *
 * DATABASE SCHEMA:
 * ----------------
 * The wa_profile table already exists (from migrations/002_multi_tenant.sql):
 *   CREATE TABLE wa_profile (
 *     tenant_id  INT PRIMARY KEY REFERENCES tenant(id),
 *     wa_id      TEXT PRIMARY KEY,
 *     facts_json JSONB,
 *     updated_at TIMESTAMPTZ
 *   )
 *
 * No schema changes required. Facts are merged using ||:
 *   facts_json = wa_profile.facts_json || {"referral": {...}}
 *
 * EXAMPLE WEBHOOK PAYLOAD:
 * -------------------------
 * {
 *   "object": "whatsapp_business_account",
 *   "entry": [{
 *     "changes": [{
 *       "value": {
 *         "messages": [{
 *           "id": "wamid.xxx",
 *           "type": "text",
 *           "from": "1234567890",
 *           "text": { "body": "Hola quiero info" },
 *           "referral": {
 *             "source_id": "123456789012345",
 *             "source_type": "ad",
 *             "headline": "50% off gaming chairs",
 *             "body": "Check our special offer"
 *           }
 *         }]
 *       }
 *     }]
 *   }]
 * }
 *
 * USAGE IN AI CONTEXT:
 * --------------------
 * The referral data is stored in wa_profile.facts_json and is loaded
 * during context rehydration (context.rehydrate.js). It can be used
 * in AI prompts to personalize responses based on which ad brought
 * the customer in.
 *
 * Example in prompt:
 *   "Customer came from ad: {{referral.headline}}"
 *
 * TESTING:
 * --------
 * To test locally with ngrok:
 *
 * 1. Start ngrok:
 *    ngrok http 3000
 *
 * 2. Update Meta App Dashboard webhook URL to: https://abc123.ngrok.io/webhooks/whatsapp
 *
 * 3. Send a test message from an ad campaign. Check logs:
 *    LOG: [WA] referral captured { tenantId: 3, from: "1234567890", ad_id: "123456789" }
 *
 * 4. Query database to verify:
 *    SELECT facts_json FROM wa_profile WHERE tenant_id = 3 AND wa_id = '1234567890';
 *    Result: {"referral": {"ad_id": "123456789", ..., "captured_at": "2026-04-20T..."}}
 *
 * FUTURE ENHANCEMENTS:
 * ---------------------
 * - Add analytics endpoint GET /admin/analytics/referrals to aggregate ad performance
 * - Store referral counts in analytics table for faster querying
 * - Use referral source in order attribution (link order to ad_id)
 * - A/B test different prompts based on referral source
 */

export default {};
