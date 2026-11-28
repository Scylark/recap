# Heatmaps on a website

The dashboard's **Heatmaps** page draws a web page at its full length and puts each tap where it landed
on the page, for phones, tablets and desktops separately (their layouts differ, so one map for all of
them would mean nothing). What makes the maps good:

- **Turn on recordings.** The page behind the taps is the newest recorded visit of that page at that
  window size. Without one, the taps are drawn on a blank page. If the newest visit is an odd one (a menu
  open, signed out), **Try another recording** draws the next.
- **Name your key buttons** with `data-ut-label="Start trial"` (or give them an `id`). Most tapped then
  lists them by that name, and the same name in every visit groups their taps even when the layout moves.
- **Let the window scroll.** Scroll depth and page positions come from the window. A page that scrolls
  inside its own container (a full-height `<div>` with `overflow: auto`) reports every tap and scroll as
  if it were at the top.
- **Bars that stay on screen** (a fixed header, a bottom tab bar) are found on the recorded page and
  their taps drawn on them, at the top or bottom of the map.

How to read it:

- **The fold** is the bottom of a typical window at that size when the page opens. **Taps above the fold**
  counts the taps made without scrolling.
- **How far down**: the share of visits that scrolled 25%, 50%, 75% of the way and to the end. Each line
  on the map is where the bottom of the window was at that depth.
- **Rage taps**: three or more quick taps on one spot in one visit, usually something that didn't respond.
- **Dead taps**: taps on something that isn't a link, button or form field and has no `data-ut-label`.
  People expected it to do something: a price, a card, a picture.
- **Which visits**: compare the visits that sent one of your events (`Recap.track('signed_up')`) with
  the visits that didn't.
- Under 30 visits the page says so: a pattern that small can be chance.

Limits: a map reads the newest 5,000 taps on a screen in the period. Charts drawn on a `<canvas>` show
blank on the map (they replay fine in a session). Pages that change a lot from visit to visit (a feed, a
basket) are drawn as the recorded visit saw them, so taps from other visits can land on different items.

## What we learned

WattPlan's owner looked at the first web heatmaps and saw a phone-sized frame with no scrolling. Both came
from treating a web page like an app screen. What we changed, and what to know:

- **A web page is longer than the window.** Taps used to be placed as shares of the window, so a tap after
  scrolling landed in the first screenful. Web taps now go where they were on the page (`pageY`, sent by
  every web script since 1.3), and the map is the whole page.
- **One map per device size.** Phone, tablet and desktop layouts differ, so their taps can't share a map.
  The page opens on the size with the most taps; the size is in the link, so a shared link opens the same
  view.
- **The page behind the taps is a recording.** The newest recorded visit at that size is rebuilt at full
  length. A tall frame makes `100vh` mean the whole page, so window-height units are turned into the
  visitor's pixels first. Without recordings the taps sit on a blank page, so turn recordings on.
- **Fixed bars need their own rule.** A bottom tab bar is tapped at every scroll position. Its taps are
  matched to the bar on the recorded page and drawn on it, or they smear down the whole page.
- **Marketing reads it differently from engineering.** The measures that mattered: share of visits that
  tapped each element (not share of taps), dead taps (on things that aren't links or buttons: a price that
  looks clickable), rage taps by element, taps above the fold, how far down visits scrolled, and the
  visits that signed up set against the ones that didn't. Under 30 visits the page says the pattern can be
  chance.
- **Name the buttons that matter** with `data-ut-label`: the same name groups taps even when the layout
  moves, and Most tapped lists it by name. Without it, names are read from the recorded page.
- **CSV cells can be formulas.** Element names come from pages visitors' browsers recorded, so the CSV
  export starts any cell a spreadsheet would run with a quote.

What still needs the script's help (where in the element a tap landed, pages that scroll inside a
container) is in [BACKLOG.md](../BACKLOG.md).
