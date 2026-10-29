# Start, connection and sign-in

Source: Will, 29 Oct 2026 ("AnyStream — Start, connection and login design"). Sections 1–8 are the design as given, lightly condensed. "Implementation" at the end records how the code meets it; those are working notes, not decisions. Mockups, in `docs/design/`: `start-mockup.png` (Welcome), `connect-mockup.png` (server address with its keyboard), `sign-in-mockup.png` (password entry) and `quick-connect-mockup.png`. Where the text and a mockup differ, the mockup wins unless noted below.

## 1. Entry flow

- **First launch:** Welcome → Connect to server → Sign in or Quick Connect → Home.
- **Returning user:** restore the saved session and open Home. If the server is unavailable, offer Retry and Change server. If authentication has expired, return to sign-in with the server retained.
- Keep the AnyStream logo visible throughout. Introduce library navigation only after successful authentication.

## 2. App start

- A welcoming illustration, a short explanation and one primary action: **Connect to server**.
- **Help with setup** as a secondary action. Explain that an existing Jellyfin server and account are required.
- No artificial loading delay or mandatory animated introduction.

## 3. Server connection

- A labelled **Server address** field and a **Connect** action. Accept full HTTP or HTTPS addresses, including custom ports and paths.
- **Find servers on this network** separately from manual entry. Discovery is local-network only; remote servers need an address.
- Connection states explain what is happening: *Checking server…*, *Server found — continue to sign-in*, *Server unavailable — check the address or network*, *Certificate could not be verified*, *Address does not point to a Jellyfin server*.
- Preserve the entered address after errors. Show the verified server name before asking for credentials.

## 4. On-screen keyboard

One keyboard structure for server, username and password entry, with shortcuts adapted to the field.

| Field | Keyboard |
| --- | --- |
| Server address | Letters, numbers, punctuation, and shortcuts for `https://`, `http://` and `:8096` |
| Username | Letters, numbers, Shift, Symbols and Space; no automatic capitalisation |
| Password | Full character support, Shift, Symbols and Space; masked by default |

- Character insertion, caret movement, Delete, Clear and Done. Preserve exact case, punctuation and spaces in credentials. Additional character layouts or native text input for international usernames and passwords.
- **Done closes the keyboard; it does not submit the form.** Back first closes the keyboard, then returns to the previous screen.
- A bright white outline marks the single focused control. A quieter cyan border marks the field being edited. Disabled or unused keyboard cells must not receive focus.

## 5. Username and password

- Show the connected server name and address, with **Change server**.
- Selecting either field opens its keyboard. (The mockup shows password entry; username entry uses the same layout with visible text.)
- **Sign in** is the primary action. **Use Quick Connect** when the server supports and enables it. An explicit **Show/Hide** password control.
- Keep passwords masked when reopening the screen. On failure, distinguish a rejected sign-in from a connection problem. Keep the username, and never reveal whether an account exists.
- Store session credentials securely using platform facilities; never keep the plaintext password.

## 6. Jellyfin Quick Connect

- Connect to the server first, then request and display its temporary six-character code.
- Tell the person to open an already signed-in Jellyfin client, go to Settings → Quick Connect, enter the TV's code and approve. The TV signs in by itself after approval.
- Show the server identity beside the code.
- Waiting, approved, expired and connection-error states. On expiry, **Get new code**. Always offer **Use username & password** and **Cancel**.
- Stop checking for approval when the person leaves the screen. Show the server's code exactly; the mockup's code is illustrative.

## 7. Remote and accessibility

- Essential controls and text inside the TV safe area. Readable labels, generous keyboard targets, predictable directional movement.
- Restore focus after closing the keyboard or an error. Announce connection and sign-in status changes to accessibility services. Respect reduced motion.

---

## Implementation (29 Oct 2026; code and unit tests, not yet tried on the stick)

### Where things are

| Part | File |
| --- | --- |
| Flow and Back between steps | `src/authFlow.ts`, `src/screens/AuthFlow.tsx` |
| Welcome and Help | `src/screens/WelcomeScreen.tsx` |
| Server connection and network search | `src/screens/ConnectServerScreen.tsx`, `src/discovery.ts` |
| Username and password | `src/screens/SignInScreen.tsx` |
| Quick Connect | `src/screens/QuickConnectScreen.tsx` |
| Returning user, server down | `src/screens/ServerUnavailableScreen.tsx`, start-up check in `src/App.tsx` |
| Keyboard layouts and editing | `src/keyboard.ts`, `src/components/OnScreenKeyboard.tsx` |
| Field, frame, status line | `src/components/TextField.tsx`, `src/components/AuthFrame.tsx` |
| Wording for every state | `src/connect.ts` |
| Tests | `__tests__/sign-in.test.ts` |

`AddServerScreen` is gone; `AuthFlow` replaces it.

### Behaviour

- **Start-up:** a saved sign-in is checked (`GET /Users/{id}`) while the codec probe runs, so Home does not wait longer than before. A 401/403/404 means expired: the token is dropped, the server and username are kept, and sign-in opens with "Your sign-in has expired". Anything else (offline, timeout, certificate) shows **Server unavailable** with Retry and Change server; the token is kept so Retry can go straight to Home.
- **Layout (from the mockups):** every entry screen uses `AuthFrame`: the logo top left inside the 96 × 54 safe area, a Back link under it (at the bottom on Welcome), a large heading, full-width stacked buttons with icons (`AuthButton`, cyan primary with dark text), and a right-hand column. No top bar until signed in. Welcome's artwork is cut from `start-mockup.png` (`src/assets/welcome-art.jpg`, 1010 × 700); replace it with licensed artwork before release if those images are not yours to ship.
- **Status:** a coloured dot and text ("Address not yet checked", "Checking server…", "Waiting for approval… Keep this screen open."), not a spinner, so nothing moves on screen; reduced motion needs nothing extra.
- **Connect:** the address is checked locally first (no spaces, http or https only, a host, a valid port), then probed. https is tried before http for names, http first for IPs and `:8096`. While checking, the Connect button becomes Cancel and keeps focus. On success: "Server found", the server name, and **Continue to sign in** (focused) or **Use a different address**.
- **Certificate errors:** fetch gives only a message, so `JellyfinHttp` treats messages mentioning certificate, SSL, TLS, handshake or trust anchor as `certificate`. The wording of Vega's fetch errors is unverified; if it says none of these, a bad certificate shows as "Server unavailable".
- **Keyboard:** a titled panel on the right ("Server address", "Enter username", "Enter password"), six cells wide as in the mockups, with "Back · Close keyboard" under it. Address: a–x, `y z . : / -`, `1 2 3 4 5 _`, `6 7 8 9 0 #+=`, then `http:// https:// :8096 . / :`. Credentials: a–x, `y z 1 2 3 4`, `5 6 7 8 9 0`, then Shift, Symbols, Space. Both end with ‹ › (caret, added to the mockup because the design asks for caret movement), Delete, Clear, Done. The mockup leaves the cells after 5 and 0 empty on the address keyboard; they hold `_` and the Symbols key here, because empty cells must not take focus. The credential Symbols key cycles letters → symbols (all printable ASCII, € £ ¿ ¡) → accented letters. Shift stays on until pressed again and is shown lit. Key ids and rows stay the same across Shift and pages, so the focused key never disappears.
- **Focus:** the white 4 px outline on the focused control; the edited field keeps a cyan border. When the keyboard closes (Done or Back), the field remounts with preferred focus.
- **Sign-in:** username and password are sent exactly as typed. A refusal says "Sign-in failed. Check the username and password", clears the password and keeps the username; a connection problem says "Could not reach <server>" and keeps both. The password starts masked every time the screen opens.
- **Quick Connect:** code cells show the server's code as given, with "Signing in to <name>" and the address above it. States: Getting a code, Waiting for approval, Approved (signing in), This code has expired (Get new code), and connection errors. Polling is cancelled when the screen unmounts. A server that turns Quick Connect off mid-way shows that, with the password route.
- **Accessibility:** `StatusLine` is a polite live region and also calls `announceForAccessibility`. The Quick Connect code is read one character at a time; a masked password is read as "N characters, hidden".

### Platform findings

- **Secure storage:** Vega has no app keystore on npm as of 29 Oct 2026 (`@amazon-devices/keplercrypto` makes and uses keys but has no persistent named key store; no keychain or encrypted-storage port). The token stays in MMKV, which is private to the app's data folder. The password is never written anywhere. If Amazon ships a keystore, `SessionStore` is the one place to change.
- **Network search:** Jellyfin's discovery is a UDP broadcast on port 7359, and Vega has no UDP socket for apps. Instead the app reads the TV's IP and netmask from `@amazon-devices/keplerscript-netmgr-lib` (`NetworkManager.getIpConfig`; its NetInfo `fetch()` returned no address on Wi-Fi on the stick because it reads a Wi-Fi detail the app may not see), then asks every address on that /24 for `/System/Info/Public` on port 8096, 24 at a time with a 1.5 s timeout (`DISCOVERY_*` in `config.ts`). It finds only servers on the default port. Needs the package in the Vega project and `com.amazon.network.service` plus the `com.amazon.network.privilege.net-info` privilege in the manifest (works on the Fire TV Stick 4K Select, 29 Oct 2026: found the server without a prompt). Without them the search says "Could not search this network" and points to the address field.

### Not built, or differs from the design

- **Native text input** for international names: the accented-letters page covers Latin scripts only. A "use the system keyboard" key was not added because Vega's `TextInput` behaviour on the stick is untested.
- **Expired sign-in during use** (a 401 from Home after start-up) does not yet send the person back to sign-in; only the start-up check does.
- **Change server** from "Server unavailable" opens Connect with the old address filled in; Back from there goes to Welcome, not back to the unavailable screen.
- **Mockup details left out:** the soft glow behind focused buttons and panels, the gradient background, and the mockup's icons for Delete, Clear, Done, Shift and Symbols (keys are words only; there is no icon font on the device).
