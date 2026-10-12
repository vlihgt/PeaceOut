# PeaceOut

Hold up a peace sign (✌️) and fade out of your own Google Meet video. Show it again to fade back in. Works entirely on your own machine — no server, no account, nothing leaves your browser.

![status](https://img.shields.io/badge/status-personal%20project-blue)

## What it does

- Hooks your camera feed inside Google Meet only (no other site is touched)
- Lets you photograph an "empty room" once, so when you fade out, the empty room shows through instead of you
- Watches your hand with on-device hand tracking (Google's MediaPipe, bundled locally — nothing is downloaded at runtime)
- Shows a peace sign for about a third of a second → smooth fade out. Show it again → fade back in.
- A keyboard shortcut (`Ctrl/Cmd+Shift+Y`) does the same thing without the gesture

## Install (2 minutes, no building)

1. Click the green **Code** button on this repo → **Download ZIP**, and unzip it somewhere you'll keep it (e.g. your Documents folder)
2. Open Chrome and go to `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the unzipped `PeaceOut` folder
5. The icon shows up in your toolbar — that's it, no further setup

### Prefer to have an AI do it for you?

If you use [Claude Code](https://claude.com/claude-code) (or a similar coding agent) in your editor, open this folder and say:

> "Load this as an unpacked Chrome extension for me — open chrome://extensions, enable developer mode if it isn't on, and walk me through it."

It can drive the same steps above and tell you exactly where to click.

## Using it

1. Join a Google Meet call
2. Click the small pill in the top-left corner of the page → **capture empty room**
3. Step out of frame for 3 seconds while it photographs the empty room
4. Come back — the pill should say **armed**
5. Hold up a peace sign (✌️) toward the camera for about a third of a second — you fade out
6. Show it again — you fade back in
7. `Ctrl/Cmd+Shift+Y` works as a backup trigger if the gesture ever misfires

**Order matters:** have the extension loaded and the empty room captured *before* you expect to need it mid-call — capturing requires you to step out of frame for a few seconds.

## How it works, briefly

`content.js` intercepts Google Meet's own camera request and swaps in a canvas that either shows the live feed, the saved empty-room photo, or a cross-fade between the two. `gesture.js` runs MediaPipe's hand landmark model against the same camera feed (locally, no network calls) and looks for the index and middle fingers extended with the ring and pinky curled — the peace-sign shape — using distance ratios that hold regardless of hand size or distance from the camera.

One deliberate trade-off, disclosed here on purpose: Google Meet enforces a browser security feature called Trusted Types, and the bundled hand-tracking library isn't written to be compatible with it. To load it at all, the extension installs a permissive Trusted Types policy on the Meet page. That's a known, standard workaround for using a Trusted-Types-incompatible library — but it does mean this specific protection is relaxed on Meet tabs while the extension is active. Nothing is sent anywhere either way; this is strictly about what's allowed to run inside the tab.

## Privacy

Everything — camera frames, the empty-room photo, hand tracking — stays in your browser. The empty-room photo is kept in `localStorage` on `meet.google.com` only, so it survives a reload without needing to be recaptured every time. Nothing is uploaded anywhere.

## License

Do whatever you want with this — personal use, forks, remixes, credit appreciated but not required.
