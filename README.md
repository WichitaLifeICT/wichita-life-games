# Wichita Life Games

games.wichitalifeict.com: Wheatle, Crossroads and Troll Patrol, plus the stats dashboard at
`/admin`. The Wichita Life app opens these pages inside the app, so a change here shows up
on the website, app.wichitalifeict.com and the phone apps at once.

- `public/` is the website. `public/dev/` is a test copy at `/dev/`.
- `netlify/functions/games.mjs` serves `/api/*`: word suggestions, scores, play tracking
  and stats. It reads `DATABASE_URL`, `SCORE_SECRET`, `STATS_TOKEN` and `ALLOWED_ORIGINS`
  from the Netlify project's environment variables (never commit them).
- Netlify deploys every push to `main`. `npm test` (escaping and crossword checks) runs
  first; if it fails, the deploy stops and the live site stays as it was.
- See `DEPLOY.md` for the database setup.

The app opens the games with `?app=1`, which hides this site's header, hero, shop promo,
newsletter box and footer (the app has its own title bar).
