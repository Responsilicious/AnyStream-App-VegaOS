# Servers: Jellyfin and Plex, saved connections, switching

Implements the multi-provider spec (Will, 29 Oct 2026). Status: code and unit tests only; nothing here has run on Vega hardware yet.

## Where things live

| Area | Files |
|---|---|
| Saved servers, accounts, connections, startup choice | `src/connections/model.ts`, `connectionStore.ts` (key `anystream.connections.v2`; migrates `anystream.state.v1` once and leaves it in place) |
| Safe switching (check, prepare, commit; generation guard) | `src/connections/contextCoordinator.ts` |
| Is a saved connection usable now | `src/connections/status.ts` |
| The TV's Plex signing key | `src/connections/plexKey.ts` |
| Plex link code, polling, JWT, server discovery | `src/providers/plex/` |
| Wording and choices for the server screens | `src/servers.ts` |
| Screens | `AddServerFlow`, `ProviderChooserScreen`, `PlexLinkScreen`, `PlexServerPickerScreen`, `ServerManagerScreen`, `QuickSwitcher`, `ProviderPendingScreen`; header pill in `TopBar` |

## Decisions

- **Storage.** Vega gives apps no keystore. Tokens and the Plex signing key are kept in app-private MMKV under their own keys (`anystream.secret.v1.*`), never inside the records blob. This is the same protection the Jellyfin token always had. Encrypting with a key stored beside it would only hide it. Will has been asked whether this is acceptable for release one.
- **Plex sign-in.** PIN linking at plex.tv/link with an Ed25519 JWK on the PIN (Plex's current JWT path). Ed25519 is pure JS (`tweetnacl`) because keplercrypto's WebCrypto rejects Ed25519; the seed comes from keplercrypto's native random source, with no `Math.random` fallback. If Plex ignores the key it returns a legacy token, which is accepted and marked `legacy`.
- **Verified 29 Oct 2026 (desktop, no account):** `POST clients.plex.tv/api/v2/pins` with the JWK returns 201 and a 4-character code valid for 900 s. **Not verified:** the approved poll returning a JWT, token refresh (`/api/v2/auth/nonce`, `/api/v2/auth/token`), and anything on a real Plex server. These need a Plex test account.
- **Server addresses.** Secure local, secure remote, plain-HTTP local, relay last; plain HTTP to a remote address is never used. An address must answer `/identity` with the right machine id before it gets a token.
- **Switching.** The quick switcher and manager only switch after the destination answers, accepts its token and (Jellyfin) lists its libraries. A failure keeps the current server. The player has no header, so a switch cannot start during playback.
- **Removing** a Plex server remembers it, so a later discovery shows it unticked instead of re-adding it. Account sign-out lists every server it removes.

## Known limitations

- **Plex sign-in uses legacy tokens for now** (`PLEX_JWT_SIGN_IN` in config.ts). Tested 29 Oct 2026: JWT linking works and plex.tv returns a JWT, but Plex Media Server 1.43.5 answered 401 to the server token issued to that account, as header or query. Legacy-token linking is Plex's documented fallback.
- **Plex browsing and playback** (`src/providers/plex/items.ts`, `playback.ts`, `provider.ts`) work on the Fire TV Stick 4K Select against Will's Plex Media Server 1.43.5 (29 Oct 2026: browsing and playback confirmed by Will, including The Matrix and Aladdin 4K HEVC with burned-in subtitles, the same checks Jellyfin passed). The decision call needs `X-Plex-Client-Profile-Name=Generic`, since Plex has no profile for Vega. Direct play is MP4 with codecs the TV decodes; everything else goes through Plex's universal transcoder as HLS (H.264 1080p 8-bit, AAC, MPEG-TS). On Deck is split into Continue Playing (has a resume point) and Up Next. Plex has no favourites, so that action says so. Choosing tracks saves them on the Plex part, as Plex clients do.
- Plex Home profiles: Profile page, then Switch profile, opens Who's watching? (`ProfilePickerScreen`). A protected profile asks for its own PIN. The switch fetches that profile's own server token, so Plex keeps enforcing restrictions; relinking the account never overwrites a profile's token with the owner's. Confirmed working on the stick by Will, 29 Oct 2026.
- JWT refresh is written but not called anywhere yet; a JWT account will need relinking after 7 days until it is.
- Search is active-server only.

## Differences from the mockups (29 Oct 2026)

- Provider names are text, not the Jellyfin and Plex logos: the marks in the mockups are illustrative, and real logos need their owners' assets and permission.
- The quick switcher is a right-hand panel on a plain dark backdrop rather than over a live Home screen, because an overlay on Vega does not stop D-pad focus reaching the controls underneath. Worth revisiting once tried on the stick.
- Settings → Servers has the logo and a breadcrumb but not the full top navigation bar.
- The "…" row menus are left out: Select on a row moves focus into the details panel, which has the same actions.
