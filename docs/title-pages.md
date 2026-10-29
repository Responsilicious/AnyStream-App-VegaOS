# Series and movie page design guide

Source: Will, 29 Oct 2026. Mockups: `docs/design/series-page-mockup.png` and `docs/design/movie-page-mockup.png` (fictional titles and artwork). Sections 1 to 6 are the guide as given. "Implementation notes" at the end is working notes, not decisions.

## 1. Navigation and playback

- Selecting any movie, series or episode card opens its title page. This includes cards in Search, Genres, Continue Playing and Up Next.
- Playback begins only when the user selects an explicit Play, Resume or Start again action. This replaces the earlier recommendation to resume directly from a homepage card.
- Back returns to the previous page, restoring its focused card and scroll position.

## 2. Shared layout

- The existing AnyStream navy, cyan and white identity at 1920 × 1080.
- Compact branded navigation across the top.
- Title, description, metadata and playback actions on the left.
- A contained 16:9 preview on the right.
- Episodes or related titles beneath the main information.
- Visible titles below thumbnails.
- Clear remote focus, readable text and sufficient spacing around controls.
- A still preview by default. Opening a page must not start a trailer or the feature.

## 3. Series page: select the correct episode

Resolve the initial selection by where the user came from:

| Entry point | Initial selection |
| --- | --- |
| Continue Playing | The exact episode represented by the card, with its saved position |
| Up Next | The exact next episode represented by the card |
| Episode search result | That specific episode and its season |
| General series card | Current resumable episode; otherwise the next unwatched episode |
| Series never started | First available regular episode |
| Fully watched series | Restore the last browsed selection, or select the first regular episode with a clearly labelled replay action |

Use the active profile's history. Respect the one-card-per-series rule, including deliberate rewatches. Treat Specials separately unless the library's episode ordering includes them. Automatically select the episode's season and scroll its card into view.

## 4. Series page: information hierarchy

Keep the series identity visible: title, "2026 · 12 · Sci-Fi · 2 seasons", short synopsis.

Below it, a distinct selected-episode section: "S1 E4 · The Signal", the episode description, "48 min · 23 min left".

The selected episode controls all of these together: preview artwork; episode number and title; episode synopsis and runtime; watched status and saved progress; the primary playback action. Never show one episode's description beside another episode's image or Resume button.

### Season and episode controls

- A season selector above an independently scrolling episode row.
- Each episode card: image, episode number, title, runtime and a text status: Watched, Unwatched or "23 min left".
- Selecting an episode updates the details panel without playing it. Focus moves to the matching Play or Resume action.
- Changing seasons selects the current resumable episode in that season, or its first unwatched episode, falling back to its first available episode. The whole details panel updates together.
- Selected episode: cyan border and a "Selected" label. Focused control: bright white outline.
- The primary button names its target: Resume S1 E4, Play S1 E5 or Replay S1 E1. Offer Start episode again when a resume position exists.

## 5. Movie page

Show: title, year, age rating, genre and runtime; short synopsis, director and principal cast; preview artwork; saved progress and remaining time; audio and subtitle selection; favourite and watched-status actions.

| Movie state | Primary action |
| --- | --- |
| Not started | Play movie |
| In progress | Resume movie |
| Watched | Play again |

Show Start again alongside Resume. Let users inspect or change audio and subtitles before playback. Show quality badges (4K, HDR, 5.1) only when the selected media version supports them. If several cuts or versions exist, a labelled selector updates the runtime and available tracks. An independently scrolling "More like this" row sits below; selecting a title opens its page.

## 6. Loading, errors and returning from playback

- Playback stays disabled until the selected item and the current profile's progress are loaded. During season or episode changes, never leave a stale playback action enabled.
- Missing artwork: use series artwork or a neutral placeholder, keeping the correct title. Unavailable media: explain, and offer Retry or another episode.
- After playback, refresh progress and watched status. Keep the episode just played selected; offer Play next episode when appropriate rather than silently changing its details.

---

## Implementation notes

Phases, in order. Items marked **Decide** need Will's call.

1. **Navigation rule and both pages' core** (this phase): all cards open title pages; series page with selection rules, details panel, season chips, episode row, primary action naming, Start episode again, Favourite; movie page with details, director and cast, progress, primary action, Start again, Favourite, Watched toggle, More like this.
2. **Playback options:** quality badges from the media streams, Audio and subtitles panel (the player has no subtitle or audio picker yet, so choosing a track needs player and server work), versions selector.
3. **Polish:** retry states, artwork fallbacks, "Play next episode" after playback, Specials handling.

Existing code that changes: `DetailScreen` and `SeriesScreen` are replaced by the pages here; Home cards no longer play directly (the preview's Play and Resume buttons still do, since they are explicit actions); the card menu keeps its actions.

### Phase 2 on the movie page (29 Oct 2026, code and tests; not yet tried on the stick)

- **Badges** under the facts line come from the selected version's own streams: 4K (width 3200 or more, so scope films count), Dolby Vision or HDR, 7.1 or 5.1 from the default audio track, and Atmos. None are shown for a plain HD stereo file.
- **Audio and subtitles:** a button after the play actions, labelled with the current choice ("English  ·  Subtitles off"), opens the same panel as the player. It only appears when there is a second audio track or any subtitle. Back closes the panel.
- **Version:** when the server lists more than one version, a "Version" row of buttons follows the actions, ticking the chosen one. Choosing a version updates the runtime, badges and track list, and resets tracks to that version's defaults.
- Play, Resume and Start again pass only what differs from the defaults, so an untouched page can still direct play.
- **Series page** (same evening): the selected episode shows its own badges, Audio and subtitles button and Version row. Choices are kept by language for the visit, so English subtitles picked on one episode are already on when the next is selected, and "Play next" looks up the next episode's tracks to keep them.

### In-player audio and subtitles (29 Oct 2026; confirmed working on the stick the same evening)

- The remote's Menu button (three lines) opens a panel over the right of the picture: Audio on the left, Subtitles (Off first) on the right, with a tick on what is playing. Down opens it too, in case the stick names the Menu key differently. Back closes it; playback keeps going behind it.
- Choosing a track asks the server for a new stream at the current position, tells the server the old viewing ended, and swaps. If the server cannot make the new stream, the old one keeps playing and the panel says so.
- Audio: choosing anything but the default track rules out direct play (a plain file cannot switch tracks), but the server may still remux. Choosing the default again allows direct play.
- Subtitles: the server burns the chosen subtitle into the picture, whatever its format. That needs a full encode, which is slower to start and uses server CPU. Showing text subtitles through the captions view instead, without an encode, is a later improvement.
- The movie page's Audio and subtitles row (phase 2) can reuse the same track list once it is shown before playback.
