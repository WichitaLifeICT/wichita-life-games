# Deploying

## The short version

The games page works with no backend at all. If you just want it live today, drag
`public/` onto https://app.netlify.com/drop and you're done — both games run entirely in
the browser. Analytics is the only thing that needs the function, and you can add it later
without touching the page.

## Full deploy (page + play tracking)

Everything here is pre-bundled. The function already contains its database driver, so
there is no `npm install`, no build command, and no `package.json` to go wrong.

1. Drag this whole folder onto https://app.netlify.com/drop, or push it to a repo and
   connect it in Netlify. Leave the build command blank.

2. Create a free Neon Postgres and run this once in their SQL editor:

```sql
create table if not exists game_sessions (
  session_id    uuid primary key,
  visitor_id    text        not null,
  game          text        not null check (game in ('crossroads','wheatle')),
  puzzle_no     integer,
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  active_ms     integer     not null default 0 check (active_ms >= 0 and active_ms <= 7200000),
  played        boolean     not null default false,
  solved        boolean     not null default false,
  solved_at     timestamptz,
  guesses       integer,
  reveals       integer,
  device        text,
  ref_host      text
);
create index if not exists gs_started  on game_sessions (started_at desc);
create index if not exists gs_game_day on game_sessions (game, started_at desc);
create index if not exists gs_puzzle   on game_sessions (game, puzzle_no);
create index if not exists gs_visitor  on game_sessions (visitor_id);

create table if not exists word_suggestions (
  id           bigserial primary key,
  word         text        not null check (word ~ '^[A-Z]{5}$'),
  why          text,
  email        text,
  visitor_id   text,
  submitted_at timestamptz not null default now(),
  status       text        not null default 'new'
                 check (status in ('new','accepted','rejected'))
);
alter table word_suggestions add column if not exists reviewed_at timestamptz;
create unique index if not exists ws_once on word_suggestions (word, coalesce(visitor_id, ''));
create index if not exists ws_new on word_suggestions (status, submitted_at desc);

create table if not exists site_visits (
  session_id   uuid primary key,
  visitor_id   text        not null,
  path         text        not null default '/',
  ref_host     text,
  device       text,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active_ms    integer     not null default 0 check (active_ms >= 0 and active_ms <= 7200000)
);
create index if not exists sv_started on site_visits (started_at desc);
create index if not exists sv_visitor on site_visits (visitor_id);

create table if not exists promo_events (
  id          bigserial primary key,
  session_id  uuid        not null,
  visitor_id  text        not null,
  promo       text        not null,
  kind        text        not null check (kind in ('view','click')),
  device      text,
  hits        integer     not null default 1,
  created_at  timestamptz not null default now(),
  last_at     timestamptz not null default now()
);
create unique index if not exists pe_once on promo_events (session_id, promo, kind);
create index if not exists pe_created on promo_events (created_at desc);
create index if not exists pe_promo on promo_events (promo, kind);

create table if not exists game_scores (
  id          bigserial primary key,
  game        text        not null,
  env         text        not null default 'dev' check (env in ('dev','live')),
  name        text        not null check (name ~ '^[A-Z]{3}$'),
  score       integer     not null check (score >= 0),
  listed      boolean     not null default false,
  visitor_id  text,
  session_id  uuid        not null unique,
  device      text,
  created_at  timestamptz not null default now()
);
create index if not exists gsc_board  on game_scores (game, env, listed, score desc);
create index if not exists gsc_recent on game_scores (game, env, created_at desc);
```

**Arcade leaderboard.** Troll Patrol posts scores to `/api/score` and reads the board back
with `?game=troll-patrol&env=dev&tab=today|week|all`. Scores carry an `env` of `dev` or
`live`, so testing on `/dev` never lands on the public board — when you promote the game,
set `window.WL_SCORE_ENV = 'live'` on the live page and it starts from an empty board.

Submitting requires a signed round token from `/api/round`, and the server refuses anything
submitted sooner than a round takes to play. That stops the obvious "post a number from the
console" attempt. A determined person could still script it, so treat the board as fun
rather than a record — moderate it if something silly appears.

Set `SCORE_SECRET` in Netlify to any long random string. If you don't, tokens are signed
with `STATS_TOKEN` instead, which works but means changing your dashboard password also
invalidates in-flight rounds.

Every finished round is recorded, whether or not the player saved initials. The board shows
only the ones with initials (`listed`); the dashboard counts them all, which is how you get
rounds played versus scores submitted.

**If you already ran the schema earlier**, just run the `promo_events` block above — the
rest uses `if not exists` and is safe to re-run.

3. In Netlify → Site configuration → Environment variables:

```
DATABASE_URL     postgres://...          from Neon
STATS_TOKEN      Candace                 dashboard password at /admin
ALLOWED_ORIGINS  https://your-site.netlify.app
```

Set `ALLOWED_ORIGINS` to whatever domain the site actually serves from. If you later point
wichitalifeict.com at it, update this or the browser will block the beacons.

4. Check your numbers:

```
curl -H "Authorization: Bearer $STATS_TOKEN" \
  "https://your-site.netlify.app/api/stats?days=30"
```

## If something breaks

Open `https://your-site.netlify.app/api/health` in a browser. No password needed, and it
tells you exactly which piece is missing:

```json
{ "database_url_set": true, "stats_token_set": true, "database_reachable": true,
  "tables": { "game_sessions": "ok", "site_visits": "ok", "word_suggestions": "ok" } }
```

- `database_url_set: false` — the environment variable isn't set, or the site hasn't been
  redeployed since you set it. This is the usual cause of errors on `/admin`.
- `database_reachable: false` with a message — the connection string is wrong, or the Neon
  project is paused. Free-tier databases sleep; the first request wakes them and can take a
  few seconds.
- a table marked `missing` — run the SQL from step 1 above.
- the page itself 404s — the function isn't deployed. Drag-and-drop deploys don't always
  pick up functions; connect a Git repo instead.

The games themselves never depend on any of this. If the backend is down, both puzzles play
normally and only the tracking is lost.

## Working on a game without publishing it

`public/dev/index.html` is a full copy of the site at **/dev** on your domain. It is
identical to the live page except for one line near the top:

```html
<script>window.WL_DEV = true;</script>
```

That single line turns on dev mode, which:

- shows a striped "Dev copy — not the live site" bar so you can never confuse the two
- switches off all tracking, so your own testing never lands in the dashboard numbers
- switches off word submissions
- adds `noindex, nofollow` and prefixes the tab title with `[DEV]`

Edit `public/dev/index.html` freely — add puzzles, try layouts, break things. When you're
happy, **copy it over `public/index.html` and delete that one script line.** That's the
whole promotion step.

**It is unlisted, not private.** Nothing links to /dev and search engines are told to skip
it, but anyone who types the URL can see it. Don't put anything there you'd mind a reader
finding.

**For bigger changes, use a branch deploy instead.** If your site is connected to a Git
repo, push a branch called `dev` and Netlify builds it at
`dev--your-site.netlify.app` — a completely separate copy with its own URL, and you can
point it at a separate Neon database if you want isolated test data. That's the proper
staging setup; /dev is the quick one.

## Updating things

**Adding a crossword or changing clues** — `public/index.html`, the `PUZZLES` array near
the top of the script. Add a grid and its clues and it joins the daily rotation. Re-upload
the site; no backend involved.

**Adding Wheatle words** — same file, the `WHEATLE_WORDS` array. Five letters, uppercase.
Anything you add is automatically accepted as a guess too.

**Cadence** — the crossword turns over every Friday at 5am Wichita time; Wheatle turns over
every morning at 5am. Both clocks live near the top of the script, in `weekIndex()` and
`dayIndex()`. `ANCHOR_DAY` is the Friday that counts as crossword No. 1 and Wheatle word
No. 1, so don't change it unless you want the numbering to shift. Both follow
America/Chicago, so it's 5am CDT in summer and 5am CST in winter — 5am local either way.

To move Wheatle back to weekly, change `DAY` to `WEEK` where `wAnswer` is chosen.

**The dashboard** — go to `/admin` on your site and sign in with the `STATS_TOKEN` value.
It shows visits, unique visitors, total time on site, average time per visit, and repeat
visitors; then puzzles opened, played and finished, completion rate, time spent in puzzles,
a per-game breakdown, traffic sources, and which puzzles people gave up on. Switch between
24 hours / 7 / 30 / 90 / 365 days at the top, and the line under the tabs tells you which
window you're looking at. An empty 24-hour window says so plainly rather than showing
zeros that look like a fault.

**The password lives only in Netlify.** It's whatever `STATS_TOKEN` is set to — nothing is
baked into the site files, so changing it is one edit in Site configuration → Environment
variables, then a redeploy. The code compares against whatever is currently set, so the old
password stops working the moment you save.

It guards reader email addresses as well as your numbers, so a personal name is worth
upgrading eventually — a passphrase like `wheat-harvest-onions-42` is just as easy to type
and far harder to guess.

**Approving reader submissions** — same page, lower down. You get every pending word with the reason the reader gave, their email
if they left one, and a badge when several people sent the same word. Approve or Reject on
each; the Approved and Rejected tabs let you undo. Nothing a reader submits appears in the
game until you approve it.

The page is `noindex` and the token is held for that browser tab only — close it and you
re-enter. Anyone with the token can approve words, so treat it like a password.

Approved words are accepted as **guesses** on the site immediately. To move them into the
daily **answer** rotation, use the Copy array button at the bottom of the admin page and
paste it over `WHEATLE_WORDS` in `index.html`, then re-upload.

That last step is deliberately manual. The day's answer is chosen by counting into the word
list, so silently growing the list would change today's word for anyone already mid-game —
two readers playing the same morning would get different puzzles. Promoting on your own
schedule keeps a given day identical for everybody.

If you'd rather do it in SQL, the admin page is only a front end for this:

```sql
update word_suggestions set status = 'accepted' where word = 'DOODA';
```

**Changing the API itself** — the shipped `games.mjs` is bundled (your handler plus a
minified database driver), so it isn't meant to be hand-edited. To change a query or add a
route, work from the unbundled source and let Netlify build it: add a `package.json` with
`@neondatabase/serverless` as a dependency and drop in the readable version of the file.

**Changing the database** — run SQL directly in the Neon console. Adding a column or an
index needs no redeploy; the function picks it up on the next request. Removing or renaming
something the function reads will break it, so change the code first.

## Editing later

`public/index.html` is the whole game — puzzle data, styles, and logic in one file. The
crossword lives in the `PUZZLES` array near the top of the script; add a grid and its clues
there and it joins the daily rotation automatically.

If you change the function, you'll need to re-bundle it (it's minified vendor code plus
your handler). Easier: keep the unbundled source and let Netlify build it via `package.json`
instead. The bundled version here exists to make first deploy painless, not to be edited.

It is still readable, though, if you need a quick fix. `netlify/functions/games.mjs` is one
file in two halves: **lines 1–5234 are the vendored Neon driver** (minified, don't touch),
and **line 5235 onward is the handler** — it starts with the comment
`// netlify/functions/games.mjs` and contains the route config, the SQL and all ten
endpoints in normal readable code. Editing below that line and re-uploading works fine; the
driver above it never needs to change.

## Checks before you deploy

`package.json` has no runtime dependencies — the function is pre-bundled, so Netlify needs
no install step. The only dependency is `jsdom`, and it is dev-only, for the tests.

```
npm install     # once, to get jsdom
npm test        # runs all three checks below
```

- `npm run check:escapes` — catches literal `\uXXXX` / `\U........` / `\xXX` sequences that
  have leaked into visible markup. This has bitten the site three times, most memorably a
  bathtub emoji that rendered as `\U0001F6C1` on the Troll Patrol block.
- `npm run verify:puzzles` — every crossword: square, 180°-symmetric, fully connected, no
  two-letter words, every entry clued, no clue containing its own answer, no repeated answer
  inside a puzzle, and the grid reproducible from the entries alone.
- `npm run test:render` — loads the real page in a headless browser at every week position,
  types a full correct solution into each puzzle, and checks nothing is flagged wrong and the
  rotation wraps cleanly at the end.

`node_modules/` is not in the zip. Run `npm install` if you want to run the tests; nothing
in the deployed site depends on it.

## Caveat

Netlify Drop's support for functions is less predictable than a Git-connected deploy. If
`/api/stats` 404s after dragging the folder, connect a repo instead — same files, and
Netlify picks up `netlify/functions` reliably that way.
