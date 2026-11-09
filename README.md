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
