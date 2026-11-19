import { pathToFileURL } from "node:url";
import {
  catalog,
  demoSpaces,
  fixtures,
  startingFollows,
} from "../lib/fixtures.ts";

const quote = (value) =>
  value === null ? "null" : "'" + String(value).replaceAll("'", "''") + "'";
const recent = (value) =>
  value === null
    ? "null"
    : "statement_timestamp() - interval '" +
      (Date.parse("2026-11-18T10:30:00Z") - Date.parse(value)) +
      " milliseconds'";
export function fixtureSQL() {
  const sql = [];
  for (const org of demoSpaces)
    sql.push(
      "insert into newsroom.organizations(id,name) values (" +
        [org.id, org.name].map(quote) +
        ") on conflict do nothing;",
    );
  for (const s of catalog)
    sql.push(
      "insert into newsroom.sources(id,platform,kind,native_key,locator,name) values (" +
        [s.id, s.platform, s.kind, "fixture-" + s.id, s.locator, s.name].map(
          quote,
        ) +
        ") on conflict do nothing;",
    );
  for (const [org, items] of Object.entries(startingFollows))
    for (const id of items)
      sql.push(
        "insert into newsroom.subscriptions(org_id,source_id) values (" +
          [org, id].map(quote) +
          ") on conflict do nothing;",
      );
  for (const p of fixtures) {
    sql.push(
      "insert into newsroom.posts(id,platform,native_key,body,media,media_url,published_at) values (" +
        [p.id, p.platform, "fixture-" + p.id, p.text, p.media, p.asset].map(
          quote,
        ) +
        "," +
        recent(p.published) +
        ") on conflict do nothing;",
    );
    for (const a of p.appearances)
      sql.push(
        "insert into newsroom.appearances(platform,source_id,post_id,seen_at) values (" +
          [p.platform, a.sourceId, p.id].map(quote) +
          "," +
          recent(a.seen) +
          ") on conflict do nothing;",
      );
  }
  return sql.join("\n");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.stdout.write("begin;\n" + fixtureSQL() + "\ncommit;\n");
}
