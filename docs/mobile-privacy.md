# Recap for mobile: privacy and store disclosures

Recap is first-party product analytics that runs entirely in infrastructure the app owner controls. This
page has copy-paste material for Apple and Google's disclosure forms. It is guidance, not legal advice:
the app owner is responsible for their own declarations and privacy policy.

## What the SDK collects

| Data | Example | Notes |
| --- | --- | --- |
| Screen names | `Home`, `/products/[id]` | From the app's navigation |
| Tap positions | 52% across, 80% down | Relative to the screen |
| Button labels | `Add to basket` | Only where the developer adds `recapPress()` |
| Scroll depth | 75% | Milestones only |
| App foreground / background | | |
| Custom events | `checkout_completed` | Whatever the developer sends with `recap.track()` |
| Device details | iOS 18.1, iPhone 16, 393×852, en-GB, app 2.4.0 | |
| Session id | random UUID | New per session; not a device identifier |
| User id (optional) | `usr_8812` | Only if the developer calls `setUserId()` |

Not collected: typed text, screenshots or screen recordings, IP-based location (Supabase may log request
IPs in its own infrastructure logs, as any server does), advertising identifiers (IDFA/GAID), contacts,
photos, precise location or health data. Nothing is sent to Recap's authors or any third party.

## Apple: privacy manifest

Recap's SDK is plain JavaScript and uses none of Apple's "required reason" APIs and no tracking domains.
The app still declares what it collects. For Expo, add to `app.json`:

```json
{
  "expo": {
    "ios": {
      "privacyManifests": {
        "NSPrivacyTracking": false,
        "NSPrivacyCollectedDataTypes": [
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeProductInteraction",
            "NSPrivacyCollectedDataTypeLinked": false,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAnalytics"]
          }
        ]
      }
    }
  }
}
```

For a bare React Native app, add the same `NSPrivacyCollectedDataTypes` entry to `ios/<App>/PrivacyInfo.xcprivacy`.
If the app calls `recap.setUserId()`, set `Linked` to `true` and also declare
`NSPrivacyCollectedDataTypeUserID` with purpose Analytics. Merge these entries with any the app already has.

## Apple: App Store Connect "App Privacy"

- Data type: **Usage Data, Product Interaction**. Used for: **Analytics**.
- Linked to the user's identity: **No** (Yes if `setUserId()` is used, then also declare **Identifiers, User ID**).
- Used for tracking: **No**.
- Device details (model, OS version) fall under **Diagnostics, Other Diagnostic Data** if the owner chooses
  to declare them; purpose Analytics, not linked, not tracking.

App Tracking Transparency: **not required** for Recap. It does not access the IDFA, combine data with
other companies' data, or share data with data brokers.

## Google Play: Data safety form

- Does the app collect or share user data? **Yes, collected.**
- Is all data encrypted in transit? **Yes** (HTTPS to Supabase).
- Can users request deletion? **Yes**, if the owner handles requests (the dashboard's Team page can delete
  every session for a user id).
- Data types: **App activity, App interactions**. Collected, not shared. Processing is not ephemeral.
  Required or optional: optional if `requireConsent` is on, otherwise required. Purpose: **Analytics**.
- If `setUserId()` is used: also **Personal info, User IDs**, purpose Analytics.
- Device or other IDs: **No** (the session id is random per session, not a device id).

## GDPR / UK GDPR checklist for app owners

1. Pick a lawful basis. Many owners use consent for analytics: set `requireConsent: true` and call
   `recap.optIn()` from the existing consent flow.
2. Offer an opt-out (`recap.optOut()`) in settings.
3. Choose a Supabase region near your users (an EU region for EU users) when creating the project.
4. Set retention, e.g. 90 days with `recap_purge(90)` on a schedule.
5. Handle deletion requests from the dashboard's Team page, or with `select recap_forget_user('<id>')`.
6. Mention in-app analytics, storage location and retention in the privacy policy. Supabase acts as the
   owner's processor under its own DPA.
