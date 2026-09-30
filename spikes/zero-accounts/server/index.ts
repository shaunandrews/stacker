import { capsule, endpoint, json, mutation, number, query, string, table, userId } from "@spacefast/zero/server";

// Spike: can plain (non-Preact) Stacker code save and load builds through Zero?
export default capsule({
  name: "Stacker Spike",
  schema: {
    builds: table({
      owner: userId(),
      title: string(),
      data: string(),
      blocks: number().default(0),
      visibility: string().default("friends"),
    }).index("by_owner", ["owner"]),
    links: table({ code: string(), device: userId(), account: string().optional() }).index("by_code", ["code"]),
  },
  auth: {
    onGuestUpgrade(ctx, { guestUserId, userId }) {
      ctx.log.info("guest upgraded", { guestUserId, userId });
    },
  },
  queries: {
    myBuilds: query(async (ctx) => {
      const { userId } = ctx.auth.requireIdentity();
      const rows = await ctx.db.builds.withIndex("by_owner", (r) => r.eq("owner", userId)).collect();
      return rows.map((b) => ({ id: b.id, title: b.title, blocks: b.blocks, bytes: b.data.length }));
    }),
  },
  mutations: {
    saveBuild: mutation(async (ctx, title: string, data: string, blocks: number) => {
      const { userId } = ctx.auth.requireIdentity();
      return (await ctx.db.builds.insert({ owner: userId, title, data, blocks })).id;
    }),
  },
  endpoints: {
    me: endpoint({ method: "GET", path: "/api/me" }, (ctx) => json({ userId: ctx.auth.userId, isGuest: ctx.auth.isGuest, isSignedIn: ctx.auth.isSignedIn, provider: ctx.auth.provider })),
    list: endpoint({ method: "GET", path: "/api/builds" }, async (ctx) => {
      const { userId } = ctx.auth.requireIdentity();
      const rows = await ctx.db.builds.withIndex("by_owner", (r) => r.eq("owner", userId)).collect();
      return json(rows.map((b) => ({ id: b.id, title: b.title, blocks: b.blocks, bytes: b.data.length })));
    }),
    get: endpoint({ method: "GET", path: "/api/build" }, async (ctx, req) => {
      const b = await ctx.db.builds.get(req.query.get("id") ?? "");
      if (!b || b.owner !== ctx.auth.userId) return json({ error: "not found" }, { status: 404 });
      return json({ id: b.id, title: b.title, data: b.data });
    }),
    readText: endpoint({ method: "POST", path: "/api/t-text" }, async (ctx, req) => {
      const t0 = Date.now();
      const t = await req.text();
      return json({ len: t.length, ms: Date.now() - t0 });
    }),
    readBytes: endpoint({ method: "POST", path: "/api/t-bytes" }, async (ctx, req) => {
      const t0 = Date.now();
      const b = await req.bytes();
      return json({ len: b.length, ms: Date.now() - t0 });
    }),
    decode: endpoint({ method: "POST", path: "/api/t-decode" }, async (ctx, req) => {
      const { userId } = ctx.auth.requireIdentity();
      const t0 = Date.now();
      const b = await req.bytes();
      const hasTD = typeof TextDecoder !== "undefined";
      let text = "";
      if (hasTD) text = new TextDecoder().decode(b);
      else for (let i = 0; i < b.length; i += 8192) text += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 8192)));
      const t1 = Date.now();
      const body = JSON.parse(text) as { title: string; data: string; blocks: number };
      const t2 = Date.now();
      const row = await ctx.db.builds.insert({ owner: userId, title: body.title, data: body.data, blocks: body.blocks });
      return json({ id: row.id, hasTD, decode: t1 - t0, parse: t2 - t1, insert: Date.now() - t2, len: body.data.length });
    }),
    insertOnly: endpoint({ method: "POST", path: "/api/t-insert" }, async (ctx, req) => {
      const { userId } = ctx.auth.requireIdentity();
      const n = Number(req.query.get("kb") ?? "10") * 1024;
      const t0 = Date.now();
      const data = "x".repeat(n);
      const t1 = Date.now();
      await ctx.db.builds.insert({ owner: userId, title: "insert", data, blocks: 0 });
      return json({ make: t1 - t0, insert: Date.now() - t1 });
    }),
    save: endpoint({ method: "POST", path: "/api/builds" }, async (ctx, req) => {
      const { userId } = ctx.auth.requireIdentity();
      const body = await req.json<{ title: string; data: string; blocks: number }>();
      const row = await ctx.db.builds.insert({ owner: userId, title: body.title, data: body.data, blocks: body.blocks });
      return json({ id: row.id, bytes: body.data.length });
    }),
  },
});
