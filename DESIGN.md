# Synbox design rules

How Synbox's screens should look and behave: home and search, the player, the lyrics reader, library and playlists, the account pages, admin, and the prose pages (About, What's New, Privacy, Terms). Read it before designing a screen or reviewing one.

**Order of authority.** `AGENTS.md` first, then the `better-*` skills, then this file. Where this file disagrees with either, it is wrong here; the rules `AGENTS.md` already sets (alignment, motion and morphs, copy, sheets and dialogs, touch targets, acting on release, the player's floating UI) are not repeated.

**Where the numbers come from.** Each one is tagged: `[2.5.1 system.md]` or `[2.1.5 §9.4]` for the reference material of taste-skill (github.com/Leonxlnx/taste-skill; 2.5.1 is a marketing-site kit, 2.1.5 still had an app-screen chapter), `[check: id]` for a check `bun harness/taste.ts scan` runs, `[2.1.5 rule: id]` for an app-screen rule whose checker 2.5.1 dropped (judged by a reviewer, nothing runs it), `[now: token]` for a value read from `src/globals.css` on 2026-11-19. Each check's verdict and reason is in `harness/taste/checks.json`.

**Scopes**, as in `checks.json`: _all_ (every route), _app_ (app screens except the player), _player_ (the full-screen player), _admin_, _prose_ (About, What's New, Privacy, Terms).

## 1. Decided, not defaulted

Generated interfaces converge on the same handful of habits. None of them is an error; together they say nobody made a choice. Each fails review:

| Habit | Instead |
| --- | --- |
| An icon in a tinted circle or square on every card or row [2.1.5 rule: icon-chips, icon-tiles] | A plain line icon in the text colour where it helps the eye, or none |
| The brand colour on chrome: every button, tab, pill and link | Colour only where it means something: the one primary action, the selected state, the karaoke fill |
| Gradient buttons, glows, glass cards, a soft shadow on every resting card [2.1.5 rule: button-fx, heavy-shadow, glass] | Flat fills one tone step apart; shadows only on what floats |
| Small tracked capitals as labels, or a label over every heading [2.1.5 rule: micro-label] | Title Case labels at a readable size; the heading alone |
| A greeting with an emoji; emoji anywhere in UI text [2.1.5 rule: emoji] | A noun title: the screen's or the object's name |
| A colour per category; saturated status chips with white text [2.1.5 rule: rainbow-chart] | One grey icon set; a pale tint with dark text of the same hue |
| A four-up grid whatever the count, an orphan last cell, cards stretched over nothing [check: row-gap], [2.1.5 rule: panel-void, ragged-row] | Columns chosen by the count; cards keep their own height; rows end level |
| Generic nouns ("Items", "Records", "Status") | The domain's words: songs, lines, furigana, playlists |
| Placeholder people and round vanity figures [2.1.5 rule: placeholder-data] | Real data, or nothing |

Removing these is half the job: a screen stripped bare reads as empty, not refined [2.1.5 app-screens intro]. Each screen shows its real content at real size, answers its one question with its largest block, and keeps its main job one press away. Synbox's signature is the lyric line (furigana over kanji, the karaoke fill, the translation beneath): screens that show lyrics lead with it, and nothing on them is louder than it.

## 2. Type

| Rule | Value | Source |
| --- | --- | --- |
| Faces | One UI family plus its Japanese partner; a second face only for one job (monospace for IDs and code in admin). Never three | [2.1.5 §9.1, rule: font-count] |
| Faces load | Every web face the tokens name loads; the reader's system stack is deliberate | [check: font-load] |
| Screen title (h1) | 18-32px, 20-24px on a phone; review above 34px (28 on a phone) | [2.1.5 §4.3, §12] |
| Card or row title | 14-24px at 500-600, about 16 typical | [2.1.5 §9.1] |
| Body, rows, cells | 13-16px. Synbox body 16 [now: --text-body], labels 15 [now: --text-label] | [2.1.5 §9.1] |
| Meta | 11-14px. Synbox caption 13 [now: --text-caption] | [2.1.5 §9.1] |
| Floor | Nothing read below 11px (badges 11 [now: --text-badge]). Furigana is ruby annotation and exempt. `--text-micro` (9px) is under the floor: review each use | [2.1.5 rule: tiny-text] |
| Prose pages | Running text 16px, line height 1.5-1.8, at most about 62 characters a line | [2.5.1 system.md], [check: body-size] |
| Sizes per screen | 4-9; review above 10. Steps like 12/14/16/24 | [2.1.5 §9.1] |
| Steps | One size per heading level; an h2 never as large as the h1; no heading smaller than its text | [check: heading-scale, heading-order] |
| Weights | About three per screen; 700 for one job at most; no light weight under 20px | [2.1.5 §9.1] |
| Line height | 20px for 14px text, 24px for 16px | [2.1.5 §9.1] |
| Tracking | 0; slightly negative only on large type (-0.02em at 32px) | [2.1.5 §9.1] |
| Figures | `tabular-nums` on times, durations, counts and anything that updates or lines up | [2.1.5 §9.1] |
| Breaks | A number stays with its unit (no-break space); headings wrap to two lines at most; truncation is one line and an ellipsis, never a break inside a word | [check: unit-break, cut-text] |
| Emphasis | Weight or ink, never a coloured bar or marker behind words; no face or italic switch inside a heading | [2.5.1 system.md] |

## 3. Colour

- **Mostly neutral.** About 90-95% of the interface is neutral [2.5.1 system.md]; strongly coloured chrome stays a few percent of a screen [2.1.5 app-screens intro]. Thumbnails, video and lyrics are content and don't count.
- **One accent**, magenta [now: --primary]: the one filled primary action per view, the selected state, the karaoke fill. Its label 4.5:1 on it, the fill 3:1 on the ground [2.5.1 system.md]. A saturated fill with white text stays rare: once it would mark more than about a fifth of the visible rows, use the pale pair [2.1.5 §7.6].
- **Never violet.** The accent stays outside OKLCH hue 270-330 [2.5.1 system.md]; the brand sits at 350.
- **Neutral dark ground**: no navy or slate [2.1.5 §9.3]. The graphite steps (chroma 0.004) are.
- **Text tiers**: primary near-white [now: --graphite-12]; at most two greys, clearly apart: secondary [now: --graphite-11], faint [now: --graphite-9] [2.1.5 §9.3].
- **Contrast**: running text 7:1; labels, meta, placeholders and muted lines 4.5:1; type 24px and over 3:1 [check: text-contrast]. Text over video or a thumbnail is judged on its worst patch of ground [check: contrast].
- **Disabled** stays legible and says why; never faded to near-invisible [2.1.5 §8.1].
- **Status**: a hue on a dark tint of itself; the meaning is in the words; no status colour on a zero or an unknown; red marks one fact per object, the one that failed [2.1.5 §9.3, §11].
- **Grounds** come from the graphite steps only: page, card, popover [now: --graphite-1..3], plus two functional ones, the stage black and the floating glass [check: grounds].
- **Links** are never browser blue; no blend modes on text.

## 4. Space and alignment

- **4px base**: 4, 8, 12, 16, 24, 32, 48, 64 (96 and 128 on prose) [2.5.1 system.md].
- **One gutter per group**, the same across and down; a mix of 12 and 16 in one group is a fault [2.1.5 §4.1]. Card gaps 6-24px (16 typical), card padding 12-34px (20 typical), between sections 24-64px [2.1.5 §9.4].
- **Gaps show grouping**: the gap between groups is clearly larger than any gap inside one, and a screen's section gaps stay within a quarter of each other [check: section-gaps, proximity].
- **Phone margins** 16-20px inside the safe area; text closer than 12px to an edge fails [2.1.5 §12].
- **Edges**: every block starts on the page gutter or a shared column edge and ends on the right gutter [check: off-grid, right-edge, centre-axis]; left and right margins are equal, measured inside the safe areas. A screen has two or three left edges, reused on purpose [2.1.5 critique pass 4].
- **Rows**: boxes in a row share a top, and cards a bottom [check: top-stagger], [2.1.5 rule: ragged-row]; a list's rows share one left edge [check: stagger]. A grid's columns, widths and gaps add up to its container [2.1.5 §4.2].
- **No accidental space**: a card holds no blank band over 40px and keeps its own height (`align-items: start`) rather than stretching to a neighbour [check: hole], [2.1.5 rule: panel-void]. Space that was placed looks calm; space that was left over looks unfinished [2.1.5 §10].
- **Density** moves row pitch, padding and type size together; never smaller type with the same padding [2.1.5 §10].

## 5. Surfaces

| Surface | Where | Rule |
| --- | --- | --- |
| Card fill | Anywhere | One clear tone step off the page, or no box when space alone groups the content [2.5.1 cards.md] |
| 1px border | Panels, tables, controls | 1.2-1.5:1 against its ground on dark; control outlines one step stronger [2.1.5 §9.2-9.3] |
| Border and shadow together | Nowhere | One or the other [2.1.5 §9.4] |
| Shadow | What floats: menus, popovers, tooltips, sheets, dialogs, the rail over video | Resting cards none [2.1.5 §13]. Floating: [now: --shadow-panel, --shadow-rail] |
| Glass (backdrop blur) | Bars over moving content only: tab dock, mini player, notices, the player's controls | At least 0.88 opaque so labels hold 4.5:1 over a white thumbnail [now: --glass]; never a resting card |
| Gradient | A scrim under floating UI over video, the faint top lift, the karaoke fill | Never on buttons, cards, text or grounds; no glow |
| Text shadow | Words over video | Nowhere else |
| Radius | Tight 4-8px or soft 16-24px; avoid the 11-12 middle | At most three panel radii; a nested radius is the outer minus the inset, never under 6 [2.1.5 §9.4, 2.5.1 cards.md]. Synbox: controls 4.8px [now: --radius], panels 20px [now: --radius-panel] |
| Nesting | Two levels | Never text in a box in a box [check: nesting] |
| Dividers | Tables, lists, settings | 1px, 3-7% off the surface; dashed only for an empty slot or a drop zone [2.1.5 §7.3] |

## 6. Icons

- **One line set**, lucide-react; no second set, no filled variants mixed in [2.5.1 icons.md].
- **Sizes**: nav and tab icons 14-20px (16 typical), inline 12-14px, about 10px from their label [2.1.5 §9.4]; steps of 16, 20 and 24 [2.5.1 icons.md]. Stroke draws at about 1.5px.
- **Colour**: the text colour; grey in navigation, ink when active [2.5.1 icons.md].
- **Never** in a saturated circle or tinted square, never boxed on every row or card.
- **Real marks keep their colours** (the YouTube mark [now: --color-youtube]); never redrawn or tinted.
- An icon-only control has an accessible name [check: a11y-name].

## 7. Motion

`AGENTS.md`'s Motion rules govern morphs and page changes; these are the small transitions.

| Transition | Value | Source |
| --- | --- | --- |
| Hover in / out | 150ms / 120ms | [2.5.1 motion.md] |
| Press feedback | 90ms | [2.5.1 motion.md] |
| Menu or popover open / close | 200ms with a 6px drop / 120ms | [2.5.1 motion.md] |
| Indicator travel (a tab underline) | 240ms | [2.5.1 motion.md] |
| Field focus ring | 140ms | [2.5.1 motion.md] |
| UI ease | cubic-bezier(.2,.8,.2,1) | [2.5.1 motion.md] |
| Settling ease | cubic-bezier(.22,1,.36,1) | [2.5.1 motion.md] |
| Travel ease, for travel only | cubic-bezier(.65,0,.35,1) | [2.5.1 motion.md] |

- **Animate** transform, opacity and colour; not width, height, position, margin or padding [2.5.1 motion.md]. Today's height transitions (the accordion tokens) are review items, not precedents.
- **Hover** only for a fine pointer (`(hover: hover) and (pointer: fine)`); every kind of control visibly answers a hover within 350ms [check: hover]. A hover never resizes or pushes a neighbour; no rotate, skew, glow, shine or tilt. A linked card may lift 2px; a thumbnail may zoom 1.02-1.03 inside its frame; never past 6px or 1.05 [check: tilt, hover-move].
- **Focus** never animates: it shows in full the frame it lands [check: focus-visible].
- **Scrolling moves no content**: nothing fades or rises in as it scrolls into view, no parallax, no scroll-jacking [check: scroll-reveal, scroll-linked]. Chrome that hides on scroll and the reader's follow scroll are behaviour, not decoration.
- **Nothing advances by itself**: no auto-advancing carousel, timed tabs or rotating notice; anything decorative still moving 5s after it appears stops or gets a pause control [check: loop-pause]. A row the user swipes is fine.
- **Reduce Motion**: colours still change, menus fade, a press shows as a deeper tone, movement becomes a short fade. Nothing decorative moves 1.5s after it appears [check: reduced-motion]; the karaoke fill and the video follow playback and keep running. No text waits hidden for an animation [check: hidden-content].
- **Every motion has a reason** that fits in a few words, or it goes.

## 8. States

- **Loading**: the final layout, each value a flat grey bar at its real size; rows keep their pitch; labels and headers show at once; nothing shifts when data lands [2.1.5 §11]. Synbox ships a shimmer [now: --animate-shimmer]: decide on it once and apply the decision everywhere. A refresh keeps old values on screen.
- **Empty**: the block keeps its frame and heading and adds one line across the whole block. On first use, the first action sits where the content will appear [2.1.5 §11]. A missing thumbnail shows its loading tint, never a broken image [check: empty-visual].
- **Zero and missing**: a real zero prints 0; a missing value is a grey dash at text size [2.1.5 §11].
- **Error**: inside the block that failed, never a full-screen banner: one line on what failed and a Retry text button; the error colour only on a small icon or the pill pair [2.1.5 §11]. A form error sits under its field, names what to type and keeps what was typed [2.5.1 system.md].
- **Success** shows only after a real send [check: form-send].
- **Focus**: Synbox's near-white ring, 3px with a 2px offset [now: --focus-ring], at least 3:1 against its ground, at once, never under the top bar, tab dock or mini player [check: focus-visible, focus-hidden].
- **Selected** (a row that drives a detail view): a fill distinct from hover and from focus [2.1.5 §7.8].
- **Current route**: `aria-current` and a visible change [check: nav-current].

## 9. Copy

Only what `AGENTS.md`'s copy rule leaves out.

- **Buttons** name an action, and its object where that isn't obvious; never Learn More, Read More, Discover, Explore, More or Click Here [check: copy-buttons].
- **One action, one wording** wherever it appears [check: copy-actions].
- **Headings name a thing** (Playlists, Recently Played), never a greeting or a mood [check: copy-headings].
- **The UI doesn't describe itself** ("This page shows", "Below you'll find"); a subline is about the content [2.5.1 copy-tells.md].
- **No praise of Synbox** in its own copy (honest, calm, simply, genuinely, thoughtful) and no invented figures ("10,000+ songs") [2.5.1 copy-tells.md].
- **Rationed devices** per screen: one two-fragment heading, one run of negations, two contrast frames ("not X but Y", "instead of") [2.5.1 copy-tells.md]. `bun harness/taste.ts copy` counts them on the prose pages.
- **No placeholders ship**: brackets, "to be added", example.com, sample tags, stock names in admin data [check: placeholder, sample-label].
- **Footer**: the legal row only, the copyright year current.

## 10. Lists, tables and admin

- **Row pitch**: single-line 36-53px (45 typical); two lines with a thumbnail 56-92px (the thumbnail plus 24-32); key-value rows 21-32px. The second line sits about 21px below the first, a size smaller and grey [2.1.5 §7.1]. On touch every row is at least 44px.
- **Media**: one fixed slot down a list so text starts on one edge, 10-16px from it; circles for people, 2-3px radius for artwork, 8px for photographs [2.1.5 §7.7].
- **Headers**: 11-14px, grey, regular, Title Case; no fill band; at most one rule, the table's strongest line; a sort glyph on the sorted column only [2.1.5 §7.2].
- **Dividers**: no zebra stripes; one divider style per screen [2.1.5 §7.3].
- **Figures**: right-aligned and tabular, fixed decimals per metric, thousands separators, a sign on every change; ISO dates where rows are compared, words for recency ("Today"); IDs in monospace, about 8 characters, an ellipsis and a copy button [2.1.5 §7.4].
- **Ink**: the identity and the key number in primary ink, the rest grey; the identity column gets a third to a half of the width and is never the one truncated [2.1.5 §7.4-7.5].
- **Status**: one mark per row; pills 16-24px tall, 11-12px text at 500, never wrapping [2.1.5 §7.6].
- **Row actions**: none, or one trailing menu; an action a row needs is a visible text action in one fixed trailing column. An overview caps its rows and links to all with the total; a full list shows the total, keeps its header in view and pages at the end ("1-50 of 1,284") [2.1.5 §7.8].
- **Phone**: under about 640px a table becomes two-line rows (identity and key number first, the rest in 13px grey beneath: moved, never dropped); a table that must stay one scrolls in its own frame with its first column fixed [2.1.5 §12].
- **Admin charts**: one hue per chart, at most four series, grey for the rest; 3-5 faint gridlines; no legend for one series; figures 16-40px; a group of figures is one card split by 1px dividers, label over value, no icons [2.1.5 §5-6, §13]. Every block of an admin overview shows its header and first rows on a 1440x900 screen; a sidebar folds on a phone.
- **Forms and settings**: the label above its field, 14px at 500, 8-10px apart; 16px between fields; one control height per row; one way to save per view (each control saves itself, or one Save per panel); destructive actions last, in a section of their own [2.1.5 §8].

## 11. Deliberately not adopted

| The kit's rule | Why not here |
| --- | --- |
| One section per screen, the hero alone on the first screen, sections exactly one or two screens tall | App screens are scrolling lists and tools |
| A hero entrance on every page and one or two scroll set pieces | No hero; page changes follow `AGENTS.md`'s nav motion |
| No caption under any image | A title and channel under a thumbnail are data |
| Photographs in every section; shader effects, WebGL, 3D scenes, diagram cards, card loops | Marketing devices |
| An h1 naming the category and the buyer; a hard fact on the first screen; two hero actions | Sales-page rules |
| Sentence case for labels and table headers | Conflicts with `AGENTS.md`: short labels are Title Case |
| Forms never in a modal | Conflicts with `AGENTS.md`: sign-in, confirmations and forms use a centred dialog |
| A header that never blurs, hides or changes | Conflicts with `AGENTS.md`'s player rules: the floating UI shows and hides over the lyrics |
| Nothing may cover text [check: collide, overlap-text] | Conflicts with `AGENTS.md`: the player's floating UI draws over the lyrics. Kept off the player |
| No progress or meter bars [check: progress-bar] | Scrubbers and sliders are core controls |
| Every linked card must move on hover | Touch first; a change of look is enough |
| Press as a 1px drop plus a slight scale | The existing press scale stands |
| The focus ring in the accent colour | Synbox keeps the brand colour off focus [now: --focus-ring] |
| No swipe rows or carousels at all | Rows the user scrolls are fine; only auto-advance goes |
| Text over photographs only in a hero, with no scrim | Lyrics and controls over video need a scrim or shadow |
| No glass on app screens | Bars floating over moving content need it; limited to them |
| Nothing under 13px anywhere | App meta runs 11-14px; 16px is kept for prose |
| Stock faces banned | Changing the UI face is the owner's call |
| FAQs always open | A prose-page choice for the owner |
| A palette and type drawn at random per site | Synbox has one fixed theme |
| Addresses, credits, contacts, opening hours, price tiers | Not applicable |
| Equal margins measured from the raw viewport | Measured inside the safe areas |

## Review rubric

Reweighted for an app from the kit's critique [2.1.5 critique.md].

1. **Look first.** One second, then five: which screen is this, what can I do? Squint: two or three masses, one leading. Cover the logo: could it be any music app? Count the left edges. Judge phone and desktop apart.
2. **Score 1-10.** Craft (alignment, type, colour share, surfaces; 7 is a clean system, 6 tidy but generic), usability (orientation, targets, every state present, a phone on its side), identity (the lyric line leads), copy (specific, short, none of section 9's faults). Overall = 0.35 craft + 0.35 usability + 0.2 identity + 0.1 copy.
3. **Caps.** An open FAIL on an adopted check caps the overall at 6.0; a section 1 habit at 6.5; text covered outside the player's floating UI caps usability at 6; a missing state at 7; placeholder data caps copy at 5.
4. **Write it down.** What you saw in one second, the scores and caps, then the top three problems, each with a measurement or screenshot and a fix ("could be more polished" is not a finding). Fix hierarchy first, then composition, type, colour, states, motion last; three rounds at most.
