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

## Game Book (0.15)

Each kid's team has a **Game Book**: the one record of every game's scorers, assists and penalties, from the GameSheet PDF with corrections on top. The screens are shared with Bulldogs Watch Party ([bench-boss-labs/game-book](https://github.com/bench-boss-labs/game-book), a fixed copy in `vendor/game-book/<version>/`).

- **Game page:** a **Summary** tab (the family summary: score by period, goals, your kid's points, import a game sheet, correct a goal) and a **Video** tab (download, join, save to Drive, as before). A game opens on Video until its full game is in Drive, then on Summary.
- **Stats page:** your kid's season, game by game, and the team table.
- **Home:** your kid's points under each game's score.
- **Settings › Game Book:** each kid's jersey number (kept in the record file, not in the Game Book), and where each book is.

| Team | Game Book file | How the app reaches it |
| --- | --- | --- |
| Grace · Barracudas U13 B | `Family Hockey/Game Book – Barracudas U13 B 2026-27.json` | Made by this app |
| Lucas · Bulldogs U10 Blue | `Game Book – Bulldogs U10 Blue 2026-27.json` in the Bulldogs team folder | Made by Bulldogs Watch Party (another Google Cloud project), so it's picked once a season with Google's file picker (`GOOGLE_API_KEY` in `js/config.js`, restricted to this site and the Picker API). Other devices on the same Google account then find it on their own. |

Each book is kept in the browser too, so it opens at the rink; changes go to Drive when connected and are merged with the coaches' (three-way merge, per goal and correction).

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
python3 tests/e2e_gamebook.py [screenshot-dir]   # the Game Book in a browser, against a simulated Google (needs Playwright)
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
- [x] Upload queue: Save keeps the trimmed file in the browser's private storage on this PC (OPFS) and uploads it to Drive in the background from any page; resumes after closing the app (Drive keeps an unfinished upload about a week). PANO only by default; AUTO is a tick box.
- [ ] Later, if wanted: bring back the automatic helper (branch `auto-helper-0.2.0`) with the security hardening
- [ ] Stage 4: game page and player
- [ ] Stage 5: clip editor, save and share
- [ ] Stage 6: settings and polish
