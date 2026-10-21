# Wichita Life Games

games.wichitalifeict.com: Wheatle, Crossroads and Troll Patrol.

- `site/` is the website (imported from the live site on 2026-10-21). Netlify serves
  `troll-patrol.html` at `/troll-patrol`.
- The `/api/*` endpoints (words, scores, leaderboards, word suggestions, stats) come from a
  Netlify function named `games`. **Its source isn't in this repo yet.** Until it is, don't
  connect this repo to Netlify for automatic deploys: a deploy without the function would
  switch the API off.

The Wichita Life app opens the games with `?app=1`, which hides this site's header, hero,
shop promo, newsletter box and footer (the app has its own title bar).
