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
