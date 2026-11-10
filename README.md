# Family Watch Party

A personal app for downloading Lucas's and Grace's hockey games from LiveBarn (PANO view), saving them to Google Drive, and clipping highlights to keep or share. Built in stages; see the build plan in the Family Watch Party project.

Live site: https://scalisec.github.io/family-watch-party/

## The LiveBarn helper (Chrome extension)

The helper is the only part that touches LiveBarn. It uses your own signed-in LiveBarn account and LiveBarn's own Download button, one game at a time, only when you ask.

### What it can do (its permissions)

| Permission | Why |
| --- | --- |
| `downloads` | To give the game files LiveBarn downloads tidy names and a folder (`Downloads/FamilyWatchParty/<kid>/<date and game>/`), or, in Drive mode, to cancel Chrome's copy of a LiveBarn file so the helper can move it into Drive instead. It only touches files coming from LiveBarn's media host, and never starts a download by itself. |
| `https://watch.livebarn.com/*` | To press LiveBarn's buttons on the game page: PANO, Download › 30 minute clip, and the files that overlap the game. |
| `https://livebarn-prod-vod-media.s3.amazonaws.com/*` | Drive mode: to read the game file LiveBarn just gave you (after its own Download button was pressed), so it can be streamed into Drive. |
| `https://www.googleapis.com/*` | Drive mode: to save those files into your Family Hockey folders in Google Drive and leave a small note for the app. |
| `identity` | To sign the helper in to Google once (you approve it), with the same **drive.file** permission as the app: only files this app created. The pass lasts about an hour and renews quietly while you're signed in to Google in Chrome. |
| `offscreen` | An invisible helper page that moves a file into Drive while it downloads, so long transfers aren't cut off. |
| `storage` | Remembers that you connected it, and keeps the short-lived Google pass only until Chrome closes (session storage). |
| Talks only to `https://scalisec.github.io` | Only the Family Watch Party site can send it requests (`externally_connectable`, and the background worker checks the sender's address). Any other website is ignored. |

It has no access to other websites, your browsing history, cookies, passwords or other tabs, and loads no code from the internet. Its only network requests are the LiveBarn file you asked for and Google's Drive API.

### Install (while it's in testing)

1. Download this repository (**Code › Download ZIP** on GitHub) and unzip it somewhere you'll keep it, e.g. `Documents\family-watch-party`.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Press **Load unpacked** and choose the `extension` folder inside the unzipped repository.
5. "Family Watch Party – LiveBarn helper" appears in the list. Its ID should be `ihlieolhaepnpncmgebcejlabomnifmi`.

To update it later: replace the folder with the new version, then press the reload arrow on the helper's card in `chrome://extensions`.

Once it's stable, it can move to the Chrome Web Store as an unlisted extension, and Developer mode can be switched off.

### What it does for one game

1. Opens the game on LiveBarn at the right rink, date and 30-minute window.
2. Switches the player to **PANO**.
3. Opens **Download › 30 minute clip** and reads the list of recording files and your minutes used.
4. Checks the files are PANO ones; if LiveBarn offers AUTO files instead, it stops without downloading.
5. Presses **Download** on each file that overlaps the game, one at a time, waiting for each to start. It never presses the same file twice, and stops if one doesn't start.
6. Moves to the next 30-minute window until the game is covered, then closes the LiveBarn tab. Chrome finishes the downloads in the background.

A **dry run** does steps 1–4 and reports what it would download, using none of your minutes.

## Google access

The app runs entirely in the browser and talks only to Google's own API hosts. It asks for two permissions, once per visit when you press **Connect Google**:

| Permission | Why |
| --- | --- |
| `drive.file` | Create the **Family Hockey** folders and upload games and clips. It can only see files this app created, not the rest of your Drive. |
| `calendar.readonly` | Read the two TeamSnap calendars synced into Google Calendar, to add tournament games the league feeds don't have. It can't change anything. |

The sign-in pass (it lasts about an hour) is kept only for the browser tab, so moving between screens keeps you connected. It is erased when the tab closes or the pass expires; nothing longer-lived is ever stored. While the Google Cloud project is in Testing mode, Google shows an "unverified app" screen (press Continue) and asks again about once a week.

What the app has stored is listed in `Family Hockey/family-watch-party-record.json` in Drive (which games have files, and each file's original name and size so nothing is imported twice).

### Streaming

`sw.js` is a small service worker that lets the player stream a file from Drive in pieces. It only answers this app's own `drive-stream/<id>` addresses, only fetches from `www.googleapis.com`, and asks the open page for the Google pass when it needs it, keeping it in memory only.

### Releasing a new version

Update the version in `package.json`, `version.json`, `js/version.js` (add a line to `RELEASES`) and each page's byline. The tests check they all match. Open copies of the app notice the new `version.json` and offer **Update now**.

## Run locally

Any static file server works, for example:

```
npx serve .
```

Then open `http://localhost:3000`. (The helper only talks to the live site, so test it there.)

## Tests

```
node --test tests/*.test.mjs
```

## Stages

- [x] Stage 0: app skeleton and the PANO playback check (`pano-check.html`)
- [x] Stage 1: LiveBarn helper extension (`extension/`, test page `helper-test.html`)
- [x] Stage 2: home screen and game list
- [x] Stage 3: Google sign-in, Family Hockey folders in Drive, importing existing downloads (`import.html`), TeamSnap games via Google Calendar
- [x] Stage 3a: Mark start & end (`join.html`): mark puck drop and the final buzzer, then join a view's parts into one full-game file in Drive (cut at keyframes, no re-processing); the parts go to Drive's trash
- [x] Clips page (`clips.html`: play, save, share, open in Drive) and Settings page (`settings.html`)
- [x] Import straight from the PC per game (`join.html`) or in bulk (`import.html`): mark puck drop and the final buzzer (or use whole files) before upload, so each game is stored as one file per camera view
- [x] Watch games: full games stream from Drive into a player on the game page (zoom and drag around the PANO view)
- [x] Install the app, version and release history in Settings, update check (`js/version.js`, `version.json`)
- [x] Clip editor: wide or tall, follow framing, slow motion, freeze-and-draw (spotlight, arrows, circles, text), save to Drive, save or share
- [x] Season highlight reel: pick a kid's clips, joined in game order with title cards, saved to `Highlight reels` in Drive
- [x] Pick rink: LiveBarn rink for games without a link (known rinks from all league schedules, or paste a LiveBarn link), saved in the Drive record; Open in LiveBarn at the game's time
- [ ] Stage 3b: download from LiveBarn straight into Drive, and "Pick rink" for games without a LiveBarn link
- [ ] Stage 4: game page and player
- [ ] Stage 5: clip editor, save and share
- [ ] Stage 6: settings and polish
