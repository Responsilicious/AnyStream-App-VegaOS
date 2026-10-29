# AnyStream design plan

Source: Will, 29 Oct 2026. Sections 1–10 are the design as given. "Notes for implementation" at the end records how it meets the code and the older plan; those notes are working notes, not decisions.

## 1. Design direction

Make choosing and resuming something effortless from the sofa.

Use a dark, image-led interface with generous spacing, persistent titles and clear remote focus. Give the app its own identity through deep navy surfaces and a restrained cyan accent.

Avoid oversized promotional banners. The user's library and viewing progress should lead the experience.

## 2. Home screen layout

Design at 1920 × 1080, with a 96 px horizontal safe margin and at least 54 px vertically. These are reference design pixels; translate them into the platform's layout units during implementation.

| Area | Design |
| --- | --- |
| Navigation | Home, Movies, Series, Genres, Search and profile |
| Featured preview | Two-column layout: information on the left, 640 × 360 image on the right |
| Continue Playing | First content row, fully visible on initial load |
| Up Next | Next unwatched episodes from series already being watched |
| Recently Added | Newly available movies and episodes |
| Genre reels | Horizontal rows such as Sci-Fi, Comedy, Drama and Documentaries |

Keep navigation and the preview compact enough for one complete content row and the next row heading to appear on the opening screen.

Recommended order: Continue Playing → Up Next → Recently Added → genre reels. Let users reorder or hide rows.

## 3. Medium preview

Use a 16:9 preview at 640 × 360 px beside the selected title's information.

Show:

- Title, year, age rating and duration.
- Episode number and episode name where relevant.
- A synopsis limited to three lines.
- One primary action: Play or Resume.
- One secondary action: Details.

Use a still image by default. If video previews are offered, make them optional, muted and delayed until focus settles. Stop previews immediately when playback starts or the user moves away.

Keep the previous image visible while the next loads to prevent flashing.

## 4. Cards and visible text

Use 320 × 180 px landscape artwork for Continue Playing and Up Next. Five cards fit comfortably across the main content width.

For movie and genre browsing, use 240 × 360 px posters. Keep each row's card shape consistent.

Always place titles below the artwork. Artwork logos should supplement readable text.

| Text | Suggested size at 1080p |
| --- | --- |
| Featured title | 48–56 px |
| Row heading | 32–36 px |
| Navigation and card title | 28–30 px |
| Synopsis and metadata | 24–26 px |
| Supporting labels | Minimum 22 px |

Allow two lines for long card titles. On focus, show the complete title in the preview information area rather than using continuously scrolling text.

## 5. Continue Playing

Each card should show:

- Movie or series title.
- Episode identification for series.
- Playback progress bar.
- Clear remaining time: "23 min left."

Selecting a card resumes playback directly. Provide Details, Play from beginning and Remove from Continue Playing through a clearly labelled secondary menu.

Keep progress specific to the active Jellyfin profile. Reconcile progress after playback and when returning from another device.

Hide the row when empty.

## 6. Up Next

Keep this distinct from Continue Playing:

- Continue Playing: something started but unfinished.
- Up Next: the next unwatched episode available to watch.

Show the series title, episode number, episode name and runtime. Avoid showing the same episode in both rows. Prioritise finishing an incomplete episode before promoting its successor.

At the end of an episode, display a compact next-episode panel with:

Play next · Cancel autoplay · View series

Use a suggested 15-second countdown, with autoplay configurable per profile. Cancelling should leave playback stopped. Do not cover subtitles or important end-credit content.

## 7. Genre reels

Use familiar, descriptive headings: Action, Comedy, Sci-Fi & Fantasy, Documentaries and Family.

Each reel should:

- Scroll horizontally without moving neighbouring rows.
- Remember its position when the user returns.
- End with a View all tile.
- Use library metadata for genre membership.
- Disappear when no matching titles are available.

Keep filtering inside View all: genre, year, watched status and sort order. Use recommendation labels such as "Because you watched…" only when actual recommendation logic supports them.

## 8. Visual system

| Token | Suggested value |
| --- | --- |
| Background | `#0B101B` |
| Raised surfaces | `#172131` |
| Primary text | `#F5F7FB` |
| Secondary text | `#B8C3D3` |
| Accent | `#67D8EF` |
| Focus outline | `#FFFFFF` |
| Card corners | 10–12 px |
| Card gap | 24 px |
| Row separation | 40–48 px |

Check text contrast against the actual background. Place descriptions on solid surfaces or strong gradients rather than busy artwork.

## 9. Remote navigation and playback

Every screen must have an obvious initial focus. Use a 4 px focus outline, with enough space around cards to prevent clipping. Optional enlargement should stay subtle.

- Left/right moves within a row.
- Up/down moves between rows at the nearest horizontal position.
- Back closes the current overlay, then returns to the previous screen.
- Returning from Details or playback restores the previous card and scroll position.
- Moving focus must never start full playback.

Vega requires deliberate focus handling, including restoring focus after navigating back. See Amazon's focus-management guidance.

During playback, provide play/pause, seeking, elapsed and remaining time, subtitles, audio tracks and next episode. Auto-hide controls after inactivity; keep them visible while a menu is open.

## 10. Additional recommendations

- **Accessibility.** Offer larger text, reduced motion, adjustable subtitles and an option to hide episode artwork and descriptions to avoid spoilers.
- **Failures.** Make library failures understandable. Preserve loaded rows while another refreshes. Show "Server unavailable — Retry" when appropriate. Use title placeholders when artwork is missing.
- **Playback compatibility.** Treat it as device-specific. A 1080p interface can still play higher-resolution video. Validate codecs, HDR, audio and subtitles on the target Vega hardware; Jellyfin may remux or transcode incompatible media. See Jellyfin's playback compatibility documentation.
- **States.** Include empty history, missing artwork, long titles, unavailable next episodes, buffering, playback errors and profile switching.
- **Sofa test.** Test at normal viewing distance using only a remote. Confirm that titles remain readable, focus is unmistakable, and a returning user can resume playback with a single selection.

**First release priorities:** reliable playback, Continue Playing, Up Next, search, genre browsing and subtitles. Add animated previews and advanced recommendations once those foundations work well.

---

## Visual references

Added 29 Oct 2026, in `docs/design/`:

- `home-mockup.png` (1672 × 941): the Home screen. Logo and Home, Movies, Series, Genres on the top bar, with Search as an icon and a profile avatar at the right. The Featured preview has the title, year, age rating, genre and runtime, a two-line synopsis, **Resume episode** and **Details** on the left, and a wide still on the right. Below: **Continue Playing** (five wide cards, progress bar, "S1 E4 · 23 min left"), **Up Next** (four wide cards, "S2 E2 · The Crossing") and **Browse by genre** (wide tiles).
- `logo-on-navy.png` (1983 × 793, opaque navy background): the logo for dark surfaces. A blue-to-cyan "A" with a play triangle, and "AnyStream" in white.
- `logo-transparent-a.png` and `logo-transparent-b.png` (2172 × 724, transparent): near-identical versions with an off-white wordmark. They suit the dark UI and the top bar. They look blank on a white background because the text is white.

Where the mockup differs from the written sections above (the mockup wins unless Will says otherwise):

- **Search is an icon** at the right of the top bar, beside the profile avatar, not a text entry in the list.
- **Genres:** the mockup shows "Browse by genre" as wide image tiles, where section 7 describes genre reels of posters with a View all tile. Both can be kept: tiles as the entry point, reels inside each genre.
- **Logo** sits at the left of the top bar.

## Notes for implementation

How this meets the code and `PLAN.md` as of 29 Oct 2026. Items marked **Decide** need Will's call.

### Where this replaces earlier plans

- **No hero banner.** `PLAN.md` describes a hero banner with Play / More Info; this design replaces it with the Featured preview (section 2 and 3). Treat this document as the source for Home.
- **Rows:** the old plan's "Continue Watching, Next Up, Recently Added per library, genre rows" becomes the section 2 order. "Continue Watching" is now called Continue Playing.
- **Navigation:** the old plan had a collapsing side nav; this design lists Home, Movies, Series, Genres, Search and profile. Decided 29 Oct 2026: start with a top bar. The server switcher from the old plan still needs a home (the profile entry is the likely place).
- **Library screen:** the current poster grid (M2) is a stopgap; Movies, Series and Genres "View all" take its place.

### Code that exists and what changes

- **Theme.** Done 29 Oct 2026: `src/theme.ts` now has the section 8 colours and the section 4 type scale (minimum 22). Dark text on the cyan accent, because white on cyan is too faint. Spacing still uses the old 48 margin outside the top bar; move screens to `useScale()` as they are reworked.
- **Layout units.** The design is in 1080p reference pixels. Measured 29 Oct 2026: the Fire TV Stick 4K Select reports a 960 × 540 window at scale 2. `src/layout.ts` converts design pixels by window width / 1920 (`px()` and `useScale()`), and every size, text included, now goes through it.
- **M2 screens.** Movie detail and series screens exist. They need the new look and focus restore on return. FocusButton, PosterCard and the top bar now use the 4 px outline with a subtle 1.04 scale. Navigation already keeps a stack, so restoring the previous card and scroll position is added on top of it.
- **Playback.** Controls already auto-hide after 5 s and Back leaves the player. Missing: elapsed and remaining time together, subtitle and audio-track pickers, and the next-episode panel.

### Server calls the new rows need (Jellyfin)

All must be verified against Will's server before building on them.

- **Continue Playing:** resume items for the user, filtered to unfinished (`/Users/{id}/Items/Resume`).
- **Up Next:** next unwatched episodes (`/Shows/NextUp`). To avoid duplicates with Continue Playing, filter out any episode already in the resume list.
- **Recently Added:** `/Users/{id}/Items/Latest`, per library.
- **Genre reels:** genre list per library (`/Genres?ParentId=`), then items filtered by genre. Hide reels with no items.
- **Remove from Continue Playing:** decided 29 Oct 2026: it marks the item as watched. In Jellyfin that is the "played" call for the user and item (believed to be `POST /Users/{id}/PlayedItems/{itemId}`; verify against the server). Marking an item played clears its resume position, so it leaves the row. For a series episode, Up Next then offers the following episode. Label the menu entry so it says what it does (for example "Mark as watched"), since "Remove" alone suggests the title is deleted from the library.
- **Artwork:** landscape 320 × 180 images for Continue Playing and Up Next. Episodes have stills; movies may need the backdrop instead. Pick a fallback order (thumb, backdrop, primary).
- **Progress per profile:** Jellyfin keeps this per user already. "Profile" here means the Jellyfin user; confirm that is intended (the old plan also lists Plex Home users).

### Needs new storage or settings

- Row order and hidden rows, per profile.
- Autoplay on or off, per profile (default and countdown length).
- Accessibility options: larger text, reduced motion, subtitle appearance, hide episode artwork and descriptions.
- Last focused card and scroll position per row.

### Suggested order of work (first release)

1. Theme tokens, scale helper and a focus component with the 4 px outline.
2. Home with Continue Playing and Up Next, then Recently Added.
3. Genre reels and View all with filters.
4. Search.
5. Player controls: subtitles, audio tracks, time, then the next-episode panel and autoplay.
6. Row customisation, accessibility options, failure and empty states.
7. Later: video previews and recommendation labels.

### Built so far (29 Oct 2026, code and unit tests only; not yet tried on the stick)

- Logo in the top bar and on the startup screen (`src/assets/logo.png`, from `logo-transparent-a.png`). Search is an icon and the profile is an avatar with the first letter of the user name, as in the mockup.
- Home as in the mockup: Featured preview (information, Resume or Play, Details, and a 640 × 360 still), then Continue Playing, Up Next, Recently Added and Browse by genre. Rows hide when empty, one failing row leaves the others, and Up Next and Recently Added never repeat what is above them. Back from a title or the player lands on the card that had focus.
- Genres: tiles open that genre's titles.
- Card menu (press and hold a card, or the More button in the preview): Details, Play from beginning (once there is a resume point) and Mark as watched, which also takes the title out of Continue Playing. It replaces the screen while open so focus cannot wander.
- App icon: `assets/image/icon.png`, 512 × 512 PNG (Amazon's stated size and format) made from the logo mark on the navy background, declared as `icon = "@image/icon.png"` in the manifest. `scripts/apply-to-vega-project.mjs` now copies `assets/`. Amazon suggests light, solid icons for the Settings menu, and this one is colourful; judge it on the stick.
- Not built yet: "View all" tiles and filters, genre reels on Home, autoplay panel, subtitle and audio pickers, row reordering, Search.

### Genres and Search (29 Oct 2026, from `docs/design/genres-mockup.png` and `search-mockup.png`; code and tests only)

- **Genres:** a title, chips (All libraries, Movies, Series) on their own row and one reel per genre: heading, wide cards captioned "Series · 2026", then a View all tile. The mockup's "View all ›" link at the right of each heading was left out on 29 Oct 2026 because it sat between the cards and the chips, so Up landed on it and skipped the chips (the same on Home's Continue Playing). Genres with nothing for the chosen kind disappear. Reels are limited to the first 8 genres, sorted by name, and each holds up to 24 titles, newest added first (changed 29 Oct 2026 at Will's request; the genre View all page is newest first too).
- **Search:** the keyboard and query on the left (A to Z, 1 to 0, Space, Delete, Clear), "Results for ..." with chips (All, Movies, Series, Episodes) and a three-column grid on the right. A search runs 300 ms after typing pauses. Results open the title page.
- **Differences from the mockup:** Back leaves Search for Home (the mockup says "Close keyboard"); the profile avatar is an initial, not a photo; reels are not yet reorderable.
- **Not built:** voice or a phone keyboard, recent searches, searching across several servers (needs the multi-server work in M4).

### Continue Playing rules (29 Oct 2026, from Will; code and tests only)

These are AnyStream defaults, kept in `CONTINUE_RULES` in `src/home.ts`. They are separate from Jellyfin, which decides when an item can resume or counts as watched. Home filtering never changes the server.

| Rule | Value |
| --- | --- |
| Series grouping | One card per series (Jellyfin series id) |
| Episode chosen | The one played most recently, not the highest number |
| Minimum progress | 60 seconds watched |
| Nearly finished episode | Hidden at 95 percent or more watched AND 3 minutes or less left |
| Nearly finished movie | Hidden at 95 percent or more watched AND 5 minutes or less left |
| Order | Most recent playback first |
| Home limit | 12 titles, then a View all tile |
| Older entries | Untouched for 90 days: behind View all, progress kept |

- The current episode is chosen before the nearly-finished test, so hiding it never brings back an older abandoned episode.
- A series with a card in Continue Playing gets no Up Next card.
- Card: series title, "S2 E4 · Episode title", "10 min left" and a progress bar. Menu: Resume, Start again, Details, Mark watched, Remove from row.
- **Remove from row** is local to this device and profile: it hides the whole series (or the movie) until it is played again, and the server's resume point stays. **Mark watched** is the server call.
- **View all** (`ContinueScreen`) lists everything the rules keep, older entries included. Nearly finished entries are not listed anywhere but their series page.
- **Unverified:** when the current episode is hidden as nearly finished, Jellyfin's Next Up may skip that series too, because the episode is not marked watched. Check on the server and decide whether to fetch the next episode ourselves.

### Series and movie pages (29 Oct 2026; see `docs/title-pages.md`)

- **Phase 1 built (code and tests, not yet tried on the stick):** every movie, series and episode card now opens its title page. Home Continue Playing and Up Next cards, View all, Search, Genres and the library grids no longer play directly. The Featured preview's Play or Resume button and the card menu's Resume and Start again are explicit actions, so they still play. The series page selects the right episode by entry point, shows the selected episode's details and still together, and has a season selector over an episode row. The movie page has facts, director and cast, saved progress, Play or Resume or Play again, Start again, Favourite, Mark watched or unwatched, and More like this. The top bar shows on both pages and leaves them for a section.
- **Phase 2, not built:** quality badges (4K, HDR, 5.1), the Audio and subtitles panel and a versions selector. These need the media streams from the server, and the player has no track picker yet.
- **Phase 3, not built:** artwork fallbacks beyond the basics, last-browsed selection for a fully watched series, Specials ordering options, Retry on unavailable media.

### Start, connection and sign-in (29 Oct 2026; see `docs/sign-in.md`)

- **Built (code and tests, not yet tried on the stick):** Welcome with Help, Connect to server with a network search, username and password sign-in, Quick Connect, and the returning-user check (Home, sign in again after expiry, or Server unavailable with Retry and Change server). One on-screen keyboard for address, username and password. `docs/sign-in.md` has the design as given, how it was built, and what differs.

### Open decisions

1. ~~Top navigation bar or side navigation~~ Decided: top bar to start; revisit after trying it on the stick.
2. ~~How "Remove from Continue Playing" is done on the server~~ Decided: mark as watched.
3. Whether "profile" means Jellyfin users only for now.
4. Whether the Featured preview shows the first Continue Playing item or the focused item only (section 3 says the selected title's information, so the focused item).
