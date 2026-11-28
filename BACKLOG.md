# Backlog

## Show friction signals in the panel on open

**Why:** A heatmap shows where people clicked, not where they got confused. The summariser already detects rapid repeated clicks, backtracking, long hesitation before the first click and unlabelled clicks, but that only appears in the "Export for AI" file.

**What:** When the researcher panel opens, run the existing summary detection on the loaded session and show the top findings above the heatmap. Each finding is one plain-English line, for example "Clicked "Next" 3 times in 2 seconds". Clicking a finding highlights its location on the heatmap.

**How:**
- Reuse `summarize()` in `src/analysis/summarize.ts`. Don't add capture code.
- Run detection when the panel opens (`src/viz/panel.ts`), not on every captured event, so the capture path stays light.
- Keep the AI export unchanged.

**Done when:**
- Findings appear for `tests/analysis/fixtures/complex-session.json`.
- A unit test covers the findings list, including the empty state.
- Panel open time is measured on a session of about 5,000 events and recorded in the PR.
- Build size is measured before and after, and the change is reported with the figures.

**Depends on:** nothing.

**Out of scope:** session replay, cross-session aggregation (needs an import feature, separate task).

**Open questions:**
- Wording for single-session findings versus combined sessions.
- What the panel shows when there are no findings.

## Web heatmaps: send where in the element a tap landed

**Why:** The Heatmaps page places a web tap from its page position and keeps it inside the element it hit
on the recorded page. Between phones of different widths, text wraps differently, so the same button sits
a little higher or lower; the page can only clamp a tap into the button, not put it at the same spot in it.

**What:** Send `ex` and `ey` (the tap's position inside the element, 0 to 1, which the click capture
already works out as `elementX` / `elementY`) and the page's height with each web tap. The Heatmaps page
then places a tap at that spot in the element on the recorded page, and sizes a page with no recording.

**How:** `src/remote/remote.ts` `handle()` → `push('tap', { …, ex, ey, ph })`; `dashboard/src/lib/heatmap.ts`
`placeWebTap()` uses them when present. Old taps keep working without them.

## Web heatmaps: one query per screen in the database

**Why:** The page reads up to 5,000 taps and 5,000 views and looks up their sessions from the browser. On a
busy site that is several MB and dozens of requests per screen.

**What:** An RPC, `recap_heatmap(p_app, p_screen, p_since)`, returning taps joined to their session's
window size and platform, the views and the deepest scroll per session, so the page makes one request and
can read more than 5,000 taps.

## Web heatmaps: pages that scroll inside a container

**Why:** Some web apps scroll a full-height `<div>` instead of the window. The script's scroll depth and
`pageY` both come from the window, so on those pages every tap reads as near the top and nobody scrolls.

**What:** Find the element that scrolls (the largest with `overflow: auto|scroll` and a scroll height
larger than its own), and report scroll depth and tap positions against it.

## Web heatmaps: a picture of single-page-app screens

**Why:** The web script takes a full snapshot when a page loads. A screen reached by client-side
navigation has none of its own, so its heatmap is drawn on a blank page.

**What:** Replay the recording forward from the landing page's snapshot to the moment the screen was
shown, and draw that state. rrweb's Replayer can play to a time (`pause(t)`); the work is choosing the
moment (the screen event's time, plus a short settle) and reading only the chunks up to it.

