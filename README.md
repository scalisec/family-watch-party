# Family Watch Party

A personal app for downloading Lucas's and Grace's hockey games from LiveBarn (PANO view), saving them to Google Drive, and clipping highlights to keep or share. Built in stages; see the build plan in the Family Watch Party project.

Live site: https://scalisec.github.io/family-watch-party/

## Downloading from LiveBarn (guided)

There's no browser extension: you download from LiveBarn yourself, and the app does the rest.

1. On a played game, press **Download guide** (or ＋ to put it on the **To-download list**, from your phone or PC).
2. The guide lists the 30-minute LiveBarn windows the game covers, each with an **Open in LiveBarn** button at the right rink and time, and which part of each window to take. In LiveBarn: **PANO**, then **Download → Download 30 minute clip**, and download the files covering those times. Save them wherever you like.
3. Back on the game page, **Pick files** (opens in Downloads). The app matches the files, pre-sets puck drop and the final buzzer from the schedule, and saves one trimmed file per view to `Family Hockey › <kid> › <season team> › <date opponent> › full game`.

Each LiveBarn file counts against your monthly minutes for its full length, so a 1-hour game uses up to about 90 minutes.

An automatic helper (a Chrome extension that downloaded straight to Drive) was built and tested, then set aside to keep the app simpler and more secure. It's kept in git on the branch `auto-helper-0.2.0`.

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
- [x] Guided LiveBarn download: per-game guide with window links, To-download list synced through Drive (automatic helper set aside, branch `auto-helper-0.2.0`)
- [ ] Later, if wanted: bring back the automatic helper (branch `auto-helper-0.2.0`) with the security hardening
- [ ] Stage 4: game page and player
- [ ] Stage 5: clip editor, save and share
- [ ] Stage 6: settings and polish
