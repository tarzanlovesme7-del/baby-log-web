# Baby Log

Bilingual (Korean/Vietnamese) baby-care tracker with real server-side auto-translation.

Originally built as a Claude Artifact; moved to a real hosted app (Node/Express + Postgres)
because a published Artifact's browser security policy only allows outbound requests to
Google Fonts, which makes real automatic translation impossible client-side.

## Stack

- **Server**: Node.js + Express (`server/server.js`)
- **Database**: Postgres (Neon free tier) — a single JSONB document + version counter,
  mutated through a reducer (`server/mutations.js`) so concurrent edits from different
  family members/devices don't clobber each other (optimistic concurrency, see `server/db.js`)
- **Translation**: server-side call to the unofficial Google Translate endpoint
  (`server/translate.js`) — no API key needed, but unofficial/unsupported; swap for the
  official Google Cloud Translation API or DeepL if it becomes unreliable
- **Frontend**: single static page (`public/index.html`), polls `/api/state` every 4s
  so every open tab picks up other people's edits

## Local development

```
npm install
export DATABASE_URL="postgresql://...(a Neon connection string)..."
npm start
```

Then open http://localhost:3000

## Testing the reducer without a database

```
node server/mutations.test.js
```

## Deploying

Deployed on Render (Node web service) + Neon (Postgres), both free tier. Render needs
`DATABASE_URL` set to the Neon connection string as an environment variable.
