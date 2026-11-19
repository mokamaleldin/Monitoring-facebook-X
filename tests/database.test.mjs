import {before, after, beforeEach, afterEach, test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {demoSpaces,catalog,fixtures} from "../lib/fixtures.ts";
import {fixtureSQL} from "../scripts/fixture-sql.mjs";

const db=new PGlite();
const [m,r]=demoSpaces.map(s=>s.id);
const users=["40000000-0000-4000-9000-000000000001","40000000-0000-4000-9000-000000000002","40000000-0000-4000-9000-000000000003"];
async function asUser(i) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users[i]]);
}
async function value(sql,params=[]) { const {rows}=await db.query(sql,params); return Object.values(rows[0])[0]; }
async function denied(sql,params=[]) {
  await db.exec("savepoint denied_check");
  await assert.rejects(db.query(sql,params),error=>error.code==="42501");
  await db.exec("rollback to savepoint denied_check; release savepoint denied_check");
}
before(async()=>{
  await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
  await db.exec(await readFile(new URL("../supabase/migrations/202611190001_newsroom.sql",import.meta.url),"utf8"));
  await db.exec(fixtureSQL());
  for (const [i,user] of users.entries()) {
    await db.query("insert into auth.users values($1)",[user]);
    await db.query("insert into newsroom.members values($1,$2,$3)",[user,[m,r,null][i],i===2?"platform_admin":"editor"]);
  }
});
beforeEach(async()=>{await db.exec("begin")});
afterEach(async()=>{await db.exec("rollback")});
after(async()=>{await db.close()});
test("database plans 3 sources for 4 subscriptions and retries only once in the same slot",async()=>{
  assert.equal(Number(await value("select count(*) from newsroom.subscriptions")),4);
  assert.equal(await value("select newsroom.plan_slot('2026-11-19T10:00Z')"),3);
  assert.equal(await value("select newsroom.plan_slot('2026-11-19T10:29Z')"),0);
  await asUser(0);
  await value("select public.newsroom_pause($1,$2)",[m,catalog[0].id]);
  await db.exec("reset role");
  assert.equal(await value("select newsroom.plan_slot('2026-11-19T10:30Z')"),3);
  await asUser(1);
  await value("select public.newsroom_pause($1,$2)",[r,catalog[0].id]);
  await db.exec("reset role");
  assert.equal(await value("select newsroom.plan_slot('2026-11-19T11:00Z')"),2);
});
test("editor cannot read another workspace or reach its exclusive story by ID",async()=>{
  await asUser(0);
  assert.deepEqual((await value("select public.newsroom_workspaces()")).map(s=>s.id),[m]);
  await denied("select public.newsroom_snapshot($1)",[r]);
  await denied("select public.newsroom_follow($1,$2)",[r,catalog[3].locator]);
  await denied("select public.newsroom_pause($1,$2)",[r,catalog[0].id]);
  await denied("select max_sources from newsroom.organizations");
  await denied("select * from newsroom.collection_jobs");
  assert.equal((await db.query("select id from newsroom.posts where id=$1",[fixtures[2].id])).rows.length,0);
  const result=await value("select public.newsroom_snapshot($1)",[m]);
  assert.equal(result.sources.length,2);assert.equal(result.posts.length,4);
  assert.equal(result.posts.find(p=>p.id===fixtures[4].id).sources.length,1);
  await asUser(1);
  const rasd=await value("select public.newsroom_snapshot($1)",[r]);
  assert.equal(rasd.posts.find(p=>p.id===fixtures[4].id).sources.length,2);
  assert.equal(rasd.posts.filter(p=>p.id===fixtures[4].id).length,1);
});
test("pause hides shared stories immediately for one tenant and preserves the other's feed",async()=>{
  await asUser(0);
  await value("select public.newsroom_pause($1,$2)",[m,catalog[0].id]);
  assert.equal((await db.query("select id from newsroom.posts where id=$1",[fixtures[0].id])).rows.length,0);
  await asUser(1);
  assert.ok((await value("select public.newsroom_snapshot($1)",[r])).posts.some(p=>p.id===fixtures[0].id));
});
test("source cap reserves waiting requests, releases on cancellation, and aliases are idempotent",async()=>{
  await db.query("update newsroom.organizations set max_sources=3 where id=$1",[m]);
  await db.query("insert into newsroom.aliases values($1,$2)",["facebook:page:officialyoum7",catalog[0].id]);
  await asUser(0);
  const add=loc=>value("select public.newsroom_follow($1,$2)",[m,loc]);
  assert.equal(await add("facebook:page:officialyoum7"),"already");
  assert.equal(await add("facebook:group:999"),"queued");assert.equal(await add("facebook:group:999"),"pending");
  assert.equal(await add(catalog[3].locator),"limit");
  await value("select public.newsroom_cancel_request($1,$2)",[m,"facebook:group:999"]);
  assert.equal(await add(catalog[3].locator),"added");assert.equal(await add(catalog[3].locator),"already");
});
test("anonymous access is denied; editors cannot lift restrictions; admin workspace feed still filters by org",async()=>{
  await db.query("update newsroom.organizations set allow_add=false where id=$1",[m]);
  await db.exec("set role anon");await denied("select public.newsroom_workspaces()");
  await asUser(0);assert.equal(await value("select public.newsroom_follow($1,$2)",[m,catalog[3].locator]),"disabled");
  await denied("update newsroom.organizations set max_sources=500");
  await asUser(2);assert.equal((await value("select public.newsroom_workspaces()")).length,2);
  assert.ok(!(await value("select public.newsroom_snapshot($1)",[m])).posts.some(p=>p.id===fixtures[2].id));
  assert.equal(await value("select public.newsroom_follow($1,$2)",[m,catalog[3].locator]),"added");
});
test("an old observation stays outside the editor window; unknown publication time stays null",async()=>{
  await db.query("update newsroom.appearances set seen_at=now()-interval '8 days' where post_id=$1",[fixtures[0].id]);
  await db.query("update newsroom.posts set published_at=null where id=$1",[fixtures[1].id]);
  await asUser(0);
  const result=await value("select public.newsroom_snapshot($1)",[m]);
  assert.ok(!result.posts.some(p=>p.id===fixtures[0].id));
  assert.equal(result.posts.find(p=>p.id===fixtures[1].id).publishedAt,null);
  assert.equal((await db.query("select id from newsroom.posts where id=$1",[fixtures[0].id])).rows.length,0);
});
