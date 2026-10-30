# Amazon hls.js build

**Installed:** `hls-rel-v1.5.11-r1.7` (hls.js v1.5.11 plus Amazon's 7 patches), vendored 28 Oct 2026.
`src/PlayerBase.ts` and `src/PlayerInterface.ts` come from the same package. Local changes: a
`@ts-nocheck` line on `PlayerBase.ts`, and `async` removed from three `PlayerInterface` members
(tsc rejects it on type members). These files are Amazon proprietary; don't publish them.

Anything the server has to transcode is delivered as HLS, and that needs Amazon's patched
hls.js, which Amazon distributes as a tarball rather than an npm package.

## Install or upgrade

1. Download the Amazon hls.js patch package for Vega (`hls-rel-v1.5.11-r<N>.tar.gz`, latest
   revision) from the Vega documentation page **Media Player > HLS Player**.
2. Extract it, then `cd hls-rel/scripts && ./setup.sh`. This clones hls.js v1.5.11, applies
   Amazon's patches and builds a `dist` folder.
3. Copy into this project, replacing the placeholders:
   - `hls-rel/src/*` into `src/` (this provides `src/hlsjsplayer/HlsJsPlayer.ts`)
   - the generated `dist` folder into `src/hlsjsplayer/dist`
   - `hls-rel/polyfills` into `src/hlsjsplayer/polyfills`
4. Add the runtime dependencies Amazon lists for that revision to `package.json`
   (at the time of writing: `base-64`, `@xmldom/xmldom` or `xmldom`, and
   `fastestsmallesttextencoderdecoder`), then `npm install`.

`apps/vega/src/platform/createEngine.ts` (which, in the generated project, becomes `src/platform/createEngine.ts`) already imports the same paths and call shapes the Amazon sample
uses (`new HlsJsPlayer(videoPlayer)`, `load(content, autoplay)`, `unload()`, and each polyfill's
`install()`), so nothing else changes.

Check each Amazon revision's notes: r1.5 changed an import to `@amazon-devices/react-native-w3cmedia/dist/headless`,
and r1.7 swapped `xmldom` for `@xmldom/xmldom`.
