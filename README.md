# Family Watch Party

A personal app for downloading Lucas's and Grace's hockey games from LiveBarn (PANO view), saving them to Google Drive, and clipping highlights to keep or share. Built in stages; see the build plan in the Family Watch Party project.

## Run locally

Any static file server works, for example:

```
npx serve .
```

Then open `http://localhost:3000`.

## Tests

```
node --test tests/*.test.mjs
```

## Stages

- [x] Stage 0: app skeleton and the PANO playback check (`pano-check.html`)
- [ ] Stage 1: LiveBarn helper extension
- [ ] Stage 2: home screen and game list
- [ ] Stage 3: download to Drive
- [ ] Stage 4: game page and player
- [ ] Stage 5: clip editor, save and share
- [ ] Stage 6: settings and polish
