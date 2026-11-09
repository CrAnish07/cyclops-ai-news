# Cyclops News

A responsive technology news site with a live feed. The browser checks `/articles.json` every 15 seconds. The included Node server serves the site and gives n8n a protected endpoint for publishing articles.

## Run locally

```sh
CYCLOPS_PUBLISH_TOKEN='choose-a-long-random-secret' node server.js
```

Open <http://localhost:8080>. The empty `articles.json` uses clearly labeled design preview stories until the workflow publishes real content. The secret is required for publishing; keep it out of source control.

To run the container:

```sh
docker build -t cyclops-news .
docker run --name cyclops-news -p 8080:8080 \
  -e CYCLOPS_PUBLISH_TOKEN='choose-a-long-random-secret' \
  -v "$(pwd)/articles.json:/app/articles.json" \
  cyclops-news
```

The bind mount keeps the feed on the host across container replacements. In production, put the site behind HTTPS and provide the token through your secret manager or a protected environment file.

## Connect n8n

The website expects an **array** in `articles.json`, with one article per object. The publish endpoint handles the append/update and deduplication for you, so the workflow no longer needs the Read/Write Files from Disk, Extract from File, Convert to File, or final disk-write nodes shown in the screenshots.

Use this flow:

`RSS Feed Trigger → Edit Fields → Basic LLM Chain (score) → If (score > 6) → Basic LLM Chain1 (write) → Code → HTTP Request`

Configure the HTTP Request node to send `POST` to the site server's `/api/articles`, with `Content-Type: application/json` and an `Authorization` header of `Bearer <same token as CYCLOPS_PUBLISH_TOKEN>`. If both containers share a Docker network, use `http://cyclops-news:8080/api/articles` (or the site container's actual service name). `localhost` inside n8n means the n8n container itself. If the containers are on different hosts/networks, expose the endpoint only through HTTPS and restrict access at the firewall or reverse proxy.

Replace the placeholder in the current **Code in JavaScript** node with this code. The node should run once for all items. The node names in the expressions must match your workflow exactly:

```javascript
const rss = $('Edit Fields').item.json;
const scoreText = $('Basic LLM Chain').item.json.text || '';
const articleText = $('Basic LLM Chain1').item.json.text || '';

function parseModelJson(text) {
  const cleaned = String(text).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

const rating = parseModelJson(scoreText);
const score = Number(rating.score);
if (!Number.isInteger(score) || score < 7 || score > 10) {
  throw new Error(`Refusing to publish invalid or low score: ${rating.score}`);
}
if (!articleText.trim()) throw new Error('The article writer returned empty text.');

let source = 'News desk';
try { source = new URL(rss.link).hostname.replace(/^www\./, ''); } catch {}

return [{ json: {
  title: rss.title,
  summary: rss.contentSnippet || rss.content || '',
  article: articleText.trim(),
  category: Array.isArray(rss.categories) ? rss.categories[0] : 'Technology',
  publishedAt: rss.isoDate || rss.pubDate || new Date().toISOString(),
  source,
  sourceUrl: rss.link,
  score,
} }];
```

In HTTP Request, select JSON body and use the Code node's item as the body (`{{$json}}` / `={{ $json }}`, depending on the n8n version's field editor). A successful response returns `{ "ok": true, "updated": false, "count": 1 }`. Repeated source URLs update the existing item instead of adding duplicates. The site will display it on the next poll.

The scoring model currently returns JSON as text. Turn on **Require Specific Output Format** for the scoring chain if your model supports it, or keep the parsing and score check in the Code node. The writer prompt asks for 250–500 words, but the workflow should still treat generated text as a draft and preserve the original source link.

## Article format

The endpoint accepts one object with these fields:

```json
{
  "title": "A headline",
  "summary": "A short standfirst for the story card.",
  "article": "The finished article written by the AI.",
  "category": "AI",
  "publishedAt": "2026-11-09T12:00:00.000Z",
  "source": "Publisher name",
  "sourceUrl": "https://example.com/story",
  "score": 8
}
```

The website also understands common aliases such as `contentSnippet`, `text`, `content`, `pubDate`, `isoDate`, `link`, and `categories[0]`.

## Render + Supabase live feed

The static Render site can read live stories from Supabase while n8n writes them to the database. This avoids rebuilding the site when a story arrives.

1. In Supabase **SQL Editor**, run [`supabase-schema.sql`](./supabase-schema.sql). It creates `public.articles`, makes `source_url` unique, and permits public read access only. Row Level Security stays enabled.
2. In Supabase **Project Settings → API Keys**, copy the project URL and the **publishable** key. Put them in [`supabase-config.js`](./supabase-config.js) as `supabaseUrl` and `supabasePublishableKey`. This file is shipped to every visitor, so use only the publishable key here—never a secret/service-role key. Commit and push; Render will redeploy the static site. The publishable key is safe to expose only with the table's read-only RLS policy in place.
3. In n8n, add an **HTTP Request** node after `Code in JavaScript`:
   - Method: `POST`
   - URL: `https://<project-ref>.supabase.co/rest/v1/articles?on_conflict=source_url`
   - Headers: `apikey: <Supabase secret key>`, `Content-Type: application/json`, and `Prefer: resolution=merge-duplicates,return=minimal`
   - Body type: JSON; send the mapped body below. Keep the secret key in n8n credentials or another secret store, not in this repository or website.

```javascript
={{ {
  title: $json.title,
  summary: $json.summary,
  article: $json.article,
  category: $json.category,
  published_at: $json.publishedAt,
  source: $json.source,
  source_url: $json.sourceUrl,
  score: $json.score
} }}
```

The `source_url` conflict target makes repeat RSS events update the same row. The website reads the table through Supabase's REST API and refreshes every 15 seconds. Supabase's current publishable/secret keys go in the `apikey` header; don't put the new `sb_secret_...` key in `Authorization: Bearer` because it isn't a JWT. See [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys).

If the site shows preview stories, verify that both values in `supabase-config.js` are filled in, the schema SQL ran successfully, and the deployed table is named `articles`. If a browser fetch fails, check the browser console and Supabase RLS/table grants.
