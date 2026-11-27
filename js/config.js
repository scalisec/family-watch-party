// Family Watch Party settings for the 2026-27 season.
// Games and scores come from the Alliance Tracker's published data, at its Bench Boss Labs
// address (GitHub Pages lets other sites read it). Tournaments come from the TeamSnap calendars
// already synced into Google Calendar.
export const DATA_BASE = 'https://bench-boss-labs.github.io/alliance-tracker/';

export const GOOGLE_CLIENT_ID = '1061398617166-8t015jus9o3vb95n6r46t01v46jnetkk.apps.googleusercontent.com';
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',        // only files and folders this app creates
  'https://www.googleapis.com/auth/calendar.readonly', // read the TeamSnap calendars
];

// Google's file picker, used once a season to open the Bulldogs Game Book (the coaches' file in the team folder).
// The key is restricted in Google Cloud to this site and to the Picker API; it isn't a password.
export const GOOGLE_API_KEY = 'AIzaSyBhrBU2BSe04MsQotyDJyK5d9Cf0hbHQRs';
export const GOOGLE_APP_ID = '1061398617166';   // this app's Google Cloud project number

export const SEASON_START = '2026-08-01T00:00:00-04:00';
export const SEASON_END = '2027-06-01T00:00:00-04:00';

export const TEAMS = [
  {
    key: 'lucas',
    kid: 'Lucas',
    label: 'U10BB Bulldogs Blue',
    season: '2026-27',
    feed: 'data/games/2712.json',
    feedName: 'Burlington Bulldogs Blue',
    logo: 'logos/49dba036a6a8.png',
    calendarName: 'U10 Burlington Bulldogs Blue',
    // the coaches' Game Book in the Bulldogs team folder: picked once a season
    gameBook: { shared: true, team: 'Bulldogs U10 Blue', sheetNames: ['Burlington Bulldogs Blue', 'Bulldogs U10 Blue'] },
  },
  {
    key: 'grace',
    kid: 'Grace',
    label: 'U13B Barracudas',
    season: '2026-27',
    feed: 'data/games/bghc-2066.json',
    feedName: 'Burlington Barracudas',
    logo: 'logos/c3d0e88fbd9e.png',
    calendarName: '2026/27 Cudas U13B',
    // our own Game Book in the Family Hockey folder
    gameBook: { shared: false, team: 'Barracudas U13 B', sheetNames: ['Burlington Barracudas', 'Barracudas U13 B', 'Barracudas'] },
  },
];
