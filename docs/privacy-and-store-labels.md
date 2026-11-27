# Privacy policy wording and store labels for Recap

Templates to adapt when you add Recap to a live website or app. They describe what Recap itself does;
adjust the bracketed parts to your setup. **This is not legal advice.** Check the rules where your users
are (in the UK and EU, analytics storage on a device usually needs consent or a clear, easy objection) and
have your policy reviewed.

Recap stores everything in **your own Supabase project**. Nothing goes to Recap's authors.

## What Recap collects

| | Analytics only (default) | With page recordings (`recordings`) |
| --- | --- | --- |
| Screens visited, in order | Yes (path only; query strings and `#` parts removed) | Yes |
| Taps | Position on screen and which control (its `data-ut-label` or ARIA attributes; **not** the words on screen once sent to a dashboard) | Yes |
| Scroll depth | Yes | Yes |
| Custom events | Only what you `track()` | Yes |
| Device | Platform, browser, OS, screen size, language | Yes |
| An identifier | A random id in `localStorage` (`recap-remote-anon`), not linked to an account | Yes |
| What was on screen | No | **Yes, for the share of visits you sample:** the page as shown, rebuilt for replay. Text people type is never recorded (every form field is masked); anything marked `recap-private` is left out |
| Where it is stored | Your Supabase project, in the region you chose | Yes |
| How long | `keep_days` on the dashboard's Storage page (default 90 days) | Yes |

Recap respects Global Privacy Control and has `Recap.optOut()` (and `requireConsent` + `Recap.optIn()`
for opt-in). Wire `optOut()` to a switch in your settings and mention it in the policy.

## Privacy policy wording

### Analytics only

> **App usage.** To understand how [App] is used and improve it, we record which screens you open, where
> you tap (the position and which control, never the words on the screen), how far you scroll, and basic
> device details (device type, operating system, screen size and language). These records carry a random
> identifier stored on your device. They are not linked to your account, name, email or the content you
> create. They are stored by Supabase in [region, e.g. London] in a database used only for this, and
> deleted after [90] days. You can turn this off at any time in [Settings → …]; turning it off stops it at
> once and deletes the records not yet sent and the identifier. If your browser sends Global Privacy
> Control, we don't record anything.

### With page recordings

Add:

> **Screen replays.** For a share of visits, we also record the screens as you see them, so we can replay
> how a visit went and fix what gets in the way. A replay shows what was on screen, which can include
> [your training data, your name and email, your conversations with the coach, …]. It never includes
> anything you type: every form field is hidden. [Payments happen in the App Store / Google Play / our
> payment provider and are never recorded.] Replays follow the same rules as app usage above: stored by
> Supabase in [region], deleted after [90] days, and turned off by the same switch.

### Cookies and similar storage

> We don't use cookies for this. Recap keeps a random identifier in your browser's local storage
> (`recap-remote-anon`), one identifier per visit in session storage, your choice about analytics
> (`recap-consent`), and a local copy of recent records (`recap-sessions`, kept for up to 30 days). None of
> it is used for advertising or shared with others. Turning analytics off deletes them.

### Who we share with (processors)

> **Supabase** (database hosting) stores the app usage records [and screen replays] for us in [region].

## Apple App Store: App Privacy

Answer in App Store Connect → your app → App Privacy → Data Types. Keep `PrivacyInfo.xcprivacy` in the iOS
app consistent with it (Apple flags mismatches in review).

**Analytics only:** add **Usage Data → Product Interaction**:

- Purpose: **Analytics**
- Linked to the user's identity: **No** (Recap's id is random and not tied to the account; answer Yes if
  you add your own account ids to Recap's events)
- Used for tracking: **No**

`PrivacyInfo.xcprivacy`:

```xml
<dict>
  <key>NSPrivacyCollectedDataType</key>
  <string>NSPrivacyCollectedDataTypeProductInteraction</string>
  <key>NSPrivacyCollectedDataTypeLinked</key>
  <false/>
  <key>NSPrivacyCollectedDataTypeTracking</key>
  <false/>
  <key>NSPrivacyCollectedDataTypePurposes</key>
  <array>
    <string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
  </array>
</dict>
```

**With page recordings:** also add **Analytics** as a purpose to every data type that can appear on a
recorded screen (for example Fitness, Health, Name, Email Address, Other User Content), with the same
"linked" answer you already give for that type.

## Google Play: Data safety

Play Console → App content → Data safety.

**Analytics only:** **App activity → App interactions**: collected, not shared (Supabase is your service
provider, which Play doesn't count as sharing), not processed ephemerally, purpose **Analytics**, encrypted
in transit. "Users can choose whether this data is collected" if your app has the switch and nothing else
collects app interactions as required.

**With page recordings:** also add **Analytics** as a purpose to each data type that can appear on a
recorded screen (for example Health and fitness, Personal info, Other user-generated content).

## Before you switch it on

1. Policy updated and live (set its "last updated" date).
2. The opt-out switch is in the app and calls `Recap.optOut()` / `Recap.optIn()`.
3. Store labels updated before (or with) the app version that includes Recap.
4. If your policy promises notice before material changes, give it.
