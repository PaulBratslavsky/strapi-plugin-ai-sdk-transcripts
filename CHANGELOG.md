# Changelog

## 2.6.1 - 2026-09-28

Three fixes found by installing 2.6.0 into a clean Strapi 5.55.1 app.

`PROXY_URL` now does what the boot warning said it did. The warning told you to
"Set PROXY_URL in .env", but the default config was a hard-coded empty string
and nothing read that variable, so following the advice changed nothing. The
default for `proxyUrl` now reads `PROXY_URL`, and the warning also names the
plugin config route: `proxyUrl` in `config/plugins.ts`. A `proxyUrl` set there
still wins over the variable. Checked in a real Strapi: with `PROXY_URL` in
`.env` and no plugin config, a transcript fetch went through a local proxy that
logged both YouTube requests.

One behaviour change follows from that. A host that already had `PROXY_URL` set
for something else, and no `proxyUrl` in the plugin config, will now send
YouTube requests through that proxy. Set `proxyUrl: ''` in the plugin config to
opt out.

`@strapi/sdk-plugin` is no longer a peer dependency. It is the build tool for
this package, not something a host needs, and npm 7+ installs non-optional peers
automatically, so every host that installed the plugin also got
`@strapi/sdk-plugin` (5.4.0 in the clean install). It stays in devDependencies,
and nothing in the built package imports it. Checked by installing the packed
tarball into a fresh Strapi 5.55.1 app: `@strapi/sdk-plugin` is absent from
`node_modules` and from the lockfile.

The README config example did not boot: it used the key `ai-sdk-yt-transcripts`
with `resolve: "strapi-plugin-youtube-transcripts"`, which Strapi rejects with
"couldn't be resolved". It now uses the key `youtube-transcripts` with no
`resolve`, and no longer says ai-chat must be configured first, since ai-chat is
optional.

The first boot of a fresh database no longer logs a migration error. The
migration from the old `ai-sdk-yt-transcripts` id runs in register, before
Strapi creates `admin_permissions`, so on a new install its grant rename failed
with `no such table: admin_permissions` and logged a red "migration failed"
line. Harmless, since there are no old grants on a new database, but every new
install saw it. That step is now skipped when the table does not exist. Present
since 2.1.0.

## 2.6.0 - 2026-09-16

The plugin now puts its own tools on Strapi's MCP server.

Until now a chat host did it: strapi-plugin-ai-chat read the five tools from the
`ai-tools` service and registered them on `/mcp`. So the tools disappeared from
MCP whenever ai-chat was not installed, even though a chat host needs nothing
more than the `ai-tools` service. strapi-plugin-tanstack-ai, for one, uses the
tools in its chat and never registers them.

Bootstrap now registers them, gated on the permissions this plugin already
owns, under the names clients already call: `youtube_transcripts__fetch_transcript`,
`__list_transcripts`, `__get_transcript`, `__search_transcript` and
`__find_transcripts`. Nothing changes for a client.

Results keep the shape ai-chat gave them, including the refusal of a result too
large for an MCP client, with a message the model can act on.

A tool name that is already taken is left alone and logged at info level.
ai-chat 3.4.0 and earlier still register these names, and bootstrap order is not
ours to control, so whichever side runs first owns the tool. Checked in a real
Strapi against all three hosts: the local ai-chat 3.5.0, no ai-chat at all, and
the published ai-chat 3.4.0. In every case the five tools were on MCP and
answered with stored transcripts.

Pairs with strapi-plugin-ai-chat 3.5.0, which stops registering them. With an
older ai-chat everything still works, but that plugin logs a "Skipped tool"
warning for each of the five on every boot.

## 2.5.0 - 2026-09-04

The plugin now owns its own permissions, so it works installed on its own.

Its five tool permissions were registered by strapi-plugin-ai-chat, which
declared an action for every tool contributed to it. Installed without ai-chat,
this plugin had nothing in Settings > Roles at all. Even alongside ai-chat the
actions only existed when the MCP server happened to be enabled, because that
registration pass sits behind the MCP check.

It now registers `plugin::youtube-transcripts.tool.<slug>` in its own bootstrap.
These are the same ids ai-chat produced, deliberately: Strapi's
`cleanPermissionsInDatabase` deletes grant rows whose action no longer exists,
so a different slug would silently revoke everyone's access. Verified by boot:
ten existing grants survived the handover untouched.

Registration skips any action already present. Strapi builds the admin action
provider with the default `throwOnDuplicates`, an older ai-chat still declares
these same ids, and plugin bootstrap order is not ours to control, so whichever
side runs first registers and the other stands down. A failure is logged rather
than thrown; permissions should not stop the host booting.

The admin route `/yt-transcript/:videoId` is now gated on
`plugin::youtube-transcripts.tool.fetch-transcript`. It previously had an empty
policy list, so any authenticated admin could call it whatever their role said.
This is a behaviour change: grant that action to the roles that need it.

Each tool handed to a host now carries the action that gates it, on a new
`action` field supplied by the `ai-tools` service. A host should check that id
rather than deriving one from the tool name: derivation only holds while both
sides implement identical slug rules, and when they silently disagree the tool
disappears with no error on either side. `fetchTranscript` happens to agree
today; a PascalCase name would produce a leading hyphen here, which is not a
valid uid. Internal tools carry no action, because none is registered for them,
and a host should read an absent `action` as "not gated" rather than "denied".

Pairs with strapi-plugin-ai-chat 3.4.0, which stops registering these. Older
versions of that plugin still work, since the duplicate skip covers them.

## 2.4.0 - 2026-08-29

Completes the video metadata, including one field that never worked.

`videoPublishedAt` was null for every video ever stored. The extraction read it
from `primary_info`, but the caller used `getBasicInfo`, which resolves that
key to undefined. The field was added in 2.1.0, renamed to dodge Strapi's
reserved `publishedAt`, and never once held a value. The fetch now prefers
`getInfo`, which carries the date and everything `getBasicInfo` returns, and
falls back to `getBasicInfo` if it fails, because a transcript is worth more
than a date and the extra endpoint is the flakier of the two.

`thumbnails` keeps every size YouTube offers rather than only the largest.
A list view was loading a 1920x1080 image and scaling it down in the browser;
there are five sizes down to 168x94. `thumbnailUrl` still holds the largest,
so nothing reading it needs to change.

`viewCount` is stored again, as a `biginteger`. A popular video exceeds the
2,147,483,647 ceiling of a 32-bit integer, so an `integer` column would have
rejected it on Postgres. It survived local testing only because SQLite is
dynamically typed. Strapi returns `biginteger` as a string, so read it as one.

Backfill now also picks up rows written by 2.1 through 2.3. The gate previously
required every metadata field to be null, which counted those rows as complete,
and they are exactly the rows carrying a null publish date. It gates on
`thumbnails` rather than on the date, because thumbnails come from `basic_info`
and are present whenever a fetch succeeds, so the pass converges instead of
retrying a video whose date is legitimately unavailable.

The wiring is covered by tests that drive the real fetch with youtubei.js
mocked, not just the helpers in isolation: reverting the call site alone now
turns a test red. Unit tests for the helper passed happily while the caller
ignored it, which is exactly how ai-chat 3.1.0 shipped a fix that was not there.

Backfill carries the three new fields, so `backfillMetadata: true` fills them
on rows stored earlier.

## 2.3.0 - 2026-08-28

Adds browser-level tests, which this plugin had none of.

Four Playwright specs. Two check the admin page mounts at its route and loads
without console errors, which is the only level that can catch a plugin failing
to register or a bundle that was never rebuilt: the id changed from
`ai-sdk-yt-transcripts` to `youtube-transcripts` and that moved the route.

The other two assert the REST route reports failures usefully, and need no
login, so they run anywhere the server does. They lock in the 2.2.0 fix: an
unavailable video must answer **404 with a reason**, never the bare
`Internal Server Error` that every failure used to produce. Both pass against a
running server.

The admin specs are opt-in through `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`,
skipping rather than failing without them. Run with `npm run test:browser`.

## 2.2.0 - 2026-08-28

Makes the caption download survive YouTube refusing it, and stops the API route
hiding why a fetch failed.

**Retries.** Fetching the caption track failed intermittently and a single
attempt turned that into a failed fetch. The failure is not deterministic:
three identical calls seconds apart produced a 1.4s success, a 36.5s success and
a 40.8s failure. YouTube rate limits large caption downloads, hardest from a
residential address, and one refusal was enough to lose the transcript.

Three attempts now, with 1s then 3s of backoff, and a 25s ceiling per attempt so
one hung request cannot consume the whole budget. Measured on the transcript
that was failing: five consecutive direct fetches, no proxy, five successes,
where the same video previously failed one run in three.

**The API route reported nothing.** Every failure came back as
`ctx.throw(500, message)`, and Koa hides the message on any 5xx, so the response
was a bare `Internal Server Error`. A video with no captions, a mistyped id and
YouTube refusing the request were indistinguishable, and all three read as a bug
in this plugin. Failures are now classified: 404 when the video genuinely has
nothing to fetch, 502 when YouTube would not return it, both carrying the reason.

## 2.1.1 - 2026-08-27

Fixes the peer dependency, which named a package that no longer receives
updates. It was `strapi-plugin-ai-sdk@^2.0.0`; that package is frozen at 2.6.0
under a name the hub plugin has since left behind, and the range excluded the
current release anyway. It is now `strapi-plugin-ai-chat@^3.0.0`, still optional
because this plugin works standalone and only exposes AI tools when the hub is
installed.

Also adds `repository`, `homepage` and `bugs`, which were missing entirely, so
npm had no link back to the source, and updates the README's references to the
hub's old name.

## 2.1.0 - 2026-08-27

Captures the video metadata that was already being fetched and thrown away.

A transcript row held a title and the text, nothing else. The YouTube response
the fetch already makes carries far more, so this costs no extra request. It was
being lost to narrowing: the fetch util returned four fields, the service
re-listed those same four, and the tool listed them a third time. Each layer
independently re-declared the shape, so metadata was dropped three times over.
Those now spread, and the next field added flows through without editing three
files.

New fields: `author`, `channelId`, `thumbnailUrl`, `durationSec`,
`description`, `keywords`, `category`, `videoPublishedAt`, `language`, and
`fetchedAt`.

`viewCount` and `likeCount` are deliberately absent. They are volatile counters
that would be stale the moment they were written, and a stored figure that looks
authoritative is worse than no figure. Session-specific flags from the same
response (`is_liked`, `is_owner_viewing` and friends) are left out for the same
reason: they describe the account doing the fetching, not the video.

The field is `videoPublishedAt`, not `publishedAt`, because Strapi reserves that
name for draft-and-publish state. A custom field of that name is never the value
you set and is never null.

**Backfill for existing rows.** Rows stored before this release have null
metadata. `backfillMetadata: true` in plugin config refetches it after boot, or
call `strapi.plugin('youtube-transcripts').service('transcript').backfillMetadata()`.

It is opt-in because it makes one YouTube request per stored video, which is not
something a plugin should start on someone's behalf. It only touches rows
actually missing metadata, so a second run costs nothing. It never replaces the
stored transcript: captions can change or disappear, and silently overwriting
good text with a worse copy would be far more damaging than a null thumbnail.
One video at a time with a pause between.

## 2.0.0 - 2026-08-27

**Breaking.** The plugin id changed from `ai-sdk-yt-transcripts` to
`youtube-transcripts`, and the database table from `transcript` to
`youtube_transcripts`. A migration ships with the release and runs on first
boot.

**What you must do:** rename the key in `config/plugins.ts`.

```diff
-'ai-sdk-yt-transcripts': {
+'youtube-transcripts': {
   enabled: true,
 }
```

**What the migration does for you:** renames the table in place, preserving rows
and ids, and rewrites every `plugin::ai-sdk-yt-transcripts.*` permission grant.
It runs in `register()`, the only point where the rename can happen before
Strapi's schema sync creates the new table and orphans the old one beside it. It
is idempotent and logs rather than throws, so a failed migration cannot take the
host down.

**Why.** The old id named a plugin this one does not depend on, and it prefixed
every tool name and permission action. The old table name was worse: plain
`transcript`, with no namespace at all, which any other plugin or content type
could have taken.

Tool names change accordingly, from `ai-sdk-yt-transcripts__fetchTranscript` to
`youtube-transcripts__fetchTranscript`.

## 1.3.0 - 2026-08-26

Renamed on npm from `strapi-plugin-ai-sdk-yt-transcripts` to
`strapi-plugin-youtube-transcripts`. The old name advertised a dependency that
does not exist: this plugin works standalone and exposes AI tools only when
`strapi-plugin-ai-chat` happens to be installed.

## 1.2.0 - 2026-08-24

`findTranscripts` no longer returns every timecode of every match. One 12 minute
video came to about 31KB, roughly 7,800 tokens, from a tool whose job is to say
which videos matched. Search results now omit timecodes and report
`segmentCount` instead: 31,440 bytes became 950. `includeFullContent: true` is
unchanged.

`extractYouTubeID` accepts `youtu.be` links, the format YouTube's own share
button produces, along with `/embed/`, `/live/` and the `m.` and `music.`
subdomains. It previously rejected them as invalid.

Adds a test suite, where the plugin previously had only typechecks.
