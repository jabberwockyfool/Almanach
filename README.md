# Almanach

A media tracker for a small group of friends: films, series, games, anime, manga, light novels and novels. It keeps a calendar of everything finished during the year, a yearly recap, a shared activity feed and AniList-style pages for each work. It syncs with AniList, Letterboxd, Steam and MangaDex, and with Backloggd through a local companion that drives a real browser, since Backloggd has no API.

## Running

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill `APP_SECRET`, `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` in `.env.local` (Discord redirect: `<app url>/api/auth/discord/callback`). The other keys are optional and described in `.env.example`. Without `TURSO_DATABASE_URL` the data lives in `data/almanach.db`; on Vercel, add a Turso database from the Marketplace. The first account to sign in becomes the admin.

## Credits

- AniList, VNDB, IGDB, TMDB, TVmaze, Open Library, Wikidata, animethemes.moe, PCGamingWiki, Steam, SteamGridDB and MangaDex for their data.
- nik250dev for [Apploggd](https://github.com/nik250dev/apploggd), used as a reference for reading Backloggd.

## Notes

Contributions are welcome. Using AI is fine sometimes, but the code must always be reviewed by a human. Code that is entirely vibecoded will be discarded.
