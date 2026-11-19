import test from "node:test";
import assert from "node:assert/strict";
import { catalog, demoSpaces, fixtures } from "../lib/fixtures.ts";
import {
  initialDemo,
  followDemo,
  snapshotDemo,
  readDemo,
} from "../lib/demo.ts";
import {
  parseSource,
  filterPosts,
  cairoTime,
  sourceUrl,
} from "../lib/model.ts";

const [mazid, rasd] = demoSpaces.map((s) => s.id);
test("normalises page, public-group and X URL variants; rejects a post or unsupported host", () => {
  for (const [raw, key] of [
    ["https://m.facebook.com/Youm7/?ref=share", "facebook:page:youm7"],
    ["facebook.com/groups/783030320118289/", "facebook:group:783030320118289"],
    ["twitter.com/Youm7", "x:account:youm7"],
    ["https://facebook.com.attacker.example/Youm7", null],
    ["https://facebook.com/Youm7/posts/1", null],
    ["https://x.com/intent", null],
    ["https://x.com/u/status/1", null],
    ["https://x.com@other.example/u", null],
    ["javascript:alert(0)", null],
    ["https://facebook.com/profile.php?id=4", null],
  ])
    assert.equal(parseSource(raw), key, raw);
  assert.equal(
    parseSource(sourceUrl("facebook:group:987")),
    "facebook:group:987",
  );
});
test("a shared post is visible in both spaces; private selections and stopping are scoped", () => {
  const s = initialDemo(),
    shared = catalog[0].id;
  assert.equal(
    Object.values(s).flatMap((x) => Object.keys(x.follows)).length,
    4,
  );
  assert.equal(
    new Set(Object.values(s).flatMap((x) => Object.keys(x.follows))).size,
    3,
  );
  assert.equal(
    snapshotDemo(s, rasd).posts.filter((p) => p.id === fixtures[4].id).length,
    1,
  );
  assert.equal(
    snapshotDemo(s, rasd).posts.find((p) => p.id === fixtures[4].id).sources
      .length,
    2,
  );
  assert.equal(
    snapshotDemo(s, mazid).posts.find((p) => p.id === fixtures[4].id).sources
      .length,
    1,
  );
  s[mazid].follows[shared] = false;
  assert.ok(!snapshotDemo(s, mazid).posts.some((p) => p.id === fixtures[0].id));
  assert.ok(snapshotDemo(s, rasd).posts.some((p) => p.id === fixtures[0].id));
});
test("batch retry, pending requests and account persistence do not duplicate or cross workspaces", () => {
  const s = initialDemo();
  assert.equal(followDemo(s, mazid, catalog[3].locator), "added");
  assert.equal(followDemo(s, mazid, catalog[3].locator), "already");
  assert.equal(followDemo(s, mazid, "facebook:group:123"), "queued");
  assert.equal(followDemo(s, mazid, "facebook:group:123"), "pending");
  const restored = readDemo(JSON.stringify(s));
  assert.deepEqual(snapshotDemo(restored, mazid), snapshotDemo(s, mazid));
  assert.deepEqual(snapshotDemo(restored, rasd).pending, []);
  assert.equal(
    filterPosts(snapshotDemo(s, mazid).posts, "x", "all", "", "").length,
    1,
  );
});
test("Arabic search, source/media filters and independent Cairo timestamps", () => {
  const posts = snapshotDemo(initialDemo(), mazid).posts;
  assert.equal(
    filterPosts(posts, "facebook", "photo", catalog[0].id, "إلكِتاب").length,
    1,
  );
  assert.equal(filterPosts(posts, "facebook", "video", "", "").length, 1);
  assert.equal(cairoTime(null), "غير متاح");
  assert.match(cairoTime("2026-11-18T10:15:00Z"), /١٢:١٥/);
});
