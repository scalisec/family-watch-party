// Game Book core: everything an app needs to read and write a team's Game Book. No screens, no network:
// apps load and save the file themselves (Google Drive) and use these functions in between.
export const VERSION = '0.2.1';
export * from './sheet.js';
export * from './book.js';
export * from './merge.js';
export * from './file.js';
