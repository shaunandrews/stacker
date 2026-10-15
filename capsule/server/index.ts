import { capsule, endpoint, json, mutation, number, query, string, table, userId } from "@spacefast/zero/server";
import type { ServerContext, WriteDatabaseOf } from "@spacefast/zero/server";

// Stacker's rooms (docs/11): open rooms where players build on one shared plate.
// The build travels as edits (app/src/edits.ts) in a numbered log per room; the room's
// host folds old edits into a snapshot so joining stays quick. Poses don't come through
// here: they ride the realtime relay's presence (app/src/net/cast.ts).

const ROOM_TTL = 2 * 60_000; // a room with nobody heartbeating for this long is closed
const MEMBER_TTL = 45_000;
const MAX_DATA = 60_000; // a string field holds about 64 KB

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const schema = {
  rooms: table({
    code: string(),
    name: string(),
    seq: number().default(0), // last edit number handed out
    base: number().default(0), // edits up to here are folded into the snapshot
    seen: number().default(0),
    players: number().default(0),
  })
    .index("by_code", ["code"])
    .index("by_seen", ["seen"]),
  edits: table({ room: string(), seq: number(), player: string(), data: string() }).index("by_room", ["room", "seq"]),
  snaps: table({ room: string(), seq: number(), n: number(), of: number(), data: string() }).index("by_room", ["room", "seq"]),
  members: table({
    room: string(),
    player: string(),
    name: string(),
    color: number(),
    joined: number(),
    seen: number(),
    user: userId(),
  })
    .index("by_room", ["room"])
    .index("by_player", ["player"]),
  signals: table({ room: string(), from: string(), to: string(), data: string() }).index("by_to", ["room", "to"]),
};

export default capsule({
  name: "Stacker",
  schema,
  queries: {
    openRooms: query(async (ctx) => {
      const rows = await ctx.db.rooms.withIndex("by_seen", (r) => r.gt("seen", Date.now() - ROOM_TTL)).collect();
      return rows.filter((r) => r.players > 0).map((r) => ({ code: r.code, name: r.name, players: r.players }));
    }),
    room: query(async (ctx, code: string) => {
      const r = await ctx.db.rooms.withIndex("by_code", (q) => q.eq("code", code)).first();
      return r ? { code: r.code, name: r.name, seq: r.seq, base: r.base, players: r.players } : null;
    }),
    roomLog: query(async (ctx, code: string) => {
      const r = await ctx.db.rooms.withIndex("by_code", (q) => q.eq("code", code)).first();
      if (!r) return [];
      const rows = await ctx.db.edits.withIndex("by_room", (q) => q.eq("room", code).gt("seq", r.base)).collect();
      return rows.map((e) => ({ seq: e.seq, player: e.player, data: e.data }));
    }),
    roomMembers: query(async (ctx, code: string) => {
      const rows = await ctx.db.members.withIndex("by_room", (q) => q.eq("room", code)).collect();
      const now = Date.now();
      return rows
        .filter((m) => m.seen > now - MEMBER_TTL)
        .sort((a, b) => a.joined - b.joined)
        .map((m) => ({ player: m.player, name: m.name, color: m.color, joined: m.joined }));
    }),
    mySignals: query(async (ctx, code: string, player: string) => {
      const rows = await ctx.db.signals.withIndex("by_to", (q) => q.eq("room", code).eq("to", player)).collect();
      return rows.map((s) => ({ id: s.id, from: s.from, data: s.data }));
    }),
  },
  mutations: {
    createRoom: mutation(async (ctx, name: string) => {
      ctx.auth.requireIdentity();
      let code = "";
      for (let tries = 0; tries < 8; tries++) {
        const hex = await ctx.crypto.sha256(`${Date.now()}:${Math.random()}:${tries}`);
        code = "";
        for (let i = 0; i < 5; i++) code += CODE_CHARS[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % CODE_CHARS.length];
        if (!(await ctx.db.rooms.withIndex("by_code", (q) => q.eq("code", code)).first())) break;
      }
      await ctx.db.rooms.insert({ code, name: (name || "Stacker room").slice(0, 40), seen: Date.now() });
      ctx.invalidate("openRooms");
      return code;
    }),
    joinRoom: mutation(async (ctx, code: string, player: string, name: string, color: number) => {
      const { userId } = ctx.auth.requireIdentity();
      const room = await ctx.db.rooms.withIndex("by_code", (q) => q.eq("code", code)).first();
      if (!room) return { error: "No room with that code" };
      const now = Date.now();
      const me = await ctx.db.members.withIndex("by_player", (q) => q.eq("player", player)).first();
      if (me && me.room === code) await ctx.db.members.update(me.id, { name: name.slice(0, 24), color, seen: now });
      else {
        if (me) await ctx.db.members.delete(me.id);
        await ctx.db.members.insert({ room: code, player, name: name.slice(0, 24), color, joined: now, seen: now, user: userId });
      }
      await touchRoom(ctx, code, now);
      ctx.invalidate("openRooms", "roomMembers", "room");
      return { ok: true, seq: room.seq, base: room.base };
    }),
    heartbeat: mutation(async (ctx, code: string, player: string) => {
      ctx.auth.requireIdentity();
      const me = await ctx.db.members.withIndex("by_player", (q) => q.eq("player", player)).first();
      if (!me || me.room !== code) return false;
      const now = Date.now();
      await ctx.db.members.update(me.id, { seen: now });
      await touchRoom(ctx, code, now);
      ctx.invalidate("openRooms", "roomMembers");
      return true;
    }),
    leaveRoom: mutation(async (ctx, code: string, player: string) => {
      ctx.auth.requireIdentity();
      const me = await ctx.db.members.withIndex("by_player", (q) => q.eq("player", player)).first();
      if (me && me.room === code) await ctx.db.members.delete(me.id);
      for (const s of await ctx.db.signals.withIndex("by_to", (q) => q.eq("room", code).eq("to", player)).collect()) await ctx.db.signals.delete(s.id);
      await touchRoom(ctx, code, Date.now());
      ctx.invalidate("openRooms", "roomMembers");
      return true;
    }),
    /** One edit (or one slice of a big one) into the room's log; returns its number. */
    pushEdit: mutation(async (ctx, code: string, player: string, data: string) => {
      ctx.auth.requireIdentity();
      if (data.length > MAX_DATA) return { error: "Edit too big" };
      const room = await ctx.db.rooms.withIndex("by_code", (q) => q.eq("code", code)).first();
      if (!room) return { error: "No room with that code" };
      const seq = room.seq + 1;
      await ctx.db.rooms.update(room.id, { seq, seen: Date.now() });
      await ctx.db.edits.insert({ room: code, seq, player, data });
      ctx.invalidate("roomLog");
      return { seq };
    }),
    /**
     * The host folds the log into a snapshot: chunks 0..of-1 of the build as of edit `seq`.
     * The last chunk moves the room's base up and drops what it replaced.
     */
    putSnapshot: mutation(async (ctx, code: string, seq: number, n: number, of: number, data: string) => {
      ctx.auth.requireIdentity();
      if (data.length > MAX_DATA) return { error: "Chunk too big" };
      const room = await ctx.db.rooms.withIndex("by_code", (q) => q.eq("code", code)).first();
      if (!room || seq <= room.base || seq > room.seq) return { error: "Stale snapshot" };
      await ctx.db.snaps.insert({ room: code, seq, n, of, data });
      if (n < of - 1) return { ok: true };
      const chunks = await ctx.db.snaps.withIndex("by_room", (q) => q.eq("room", code).eq("seq", seq)).collect();
      if (new Set(chunks.map((c) => c.n)).size !== of) return { error: "Missing chunks" };
      await ctx.db.rooms.update(room.id, { base: seq });
      for (const s of await ctx.db.snaps.withIndex("by_room", (q) => q.eq("room", code).lt("seq", seq)).collect()) await ctx.db.snaps.delete(s.id);
      for (const e of await ctx.db.edits.withIndex("by_room", (q) => q.eq("room", code).lte("seq", seq)).collect()) await ctx.db.edits.delete(e.id);
      ctx.invalidate("roomLog", "room");
      return { ok: true };
    }),
    /** Voice: WebRTC connection setup between two players, passed through the room. */
    signal: mutation(async (ctx, code: string, from: string, to: string, data: string) => {
      ctx.auth.requireIdentity();
      if (data.length > MAX_DATA) return false;
      await ctx.db.signals.insert({ room: code, from, to, data });
      ctx.invalidate("mySignals");
      return true;
    }),
    ackSignals: mutation(async (ctx, code: string, player: string, ids: string[]) => {
      ctx.auth.requireIdentity();
      for (const id of ids) {
        const s = await ctx.db.signals.get(id);
        if (s && s.room === code && s.to === player) await ctx.db.signals.delete(id);
      }
      return true;
    }),
  },
  endpoints: {
    /** The room's snapshot as one JSON body: { seq, state } (state null before the first one). */
    snapshot: endpoint({ method: "GET", path: "/api/rooms/snapshot" }, async (ctx, req) => {
      const code = req.query.get("code") ?? "";
      // Endpoints see the database untyped.
      const room = (await ctx.db.rooms.withIndex("by_code", (q) => q.eq("code", code)).first()) as { base: number } | null;
      if (!room) return json({ error: "No room with that code" }, { status: 404 });
      if (!room.base) return json({ seq: 0, state: null });
      const chunks = (await ctx.db.snaps.withIndex("by_room", (q) => q.eq("room", code).eq("seq", room.base)).collect()) as unknown as Array<{ n: number; data: string }>;
      chunks.sort((a, b) => a.n - b.n);
      return json({ seq: room.base, state: JSON.parse(chunks.map((c) => c.data).join("")) });
    }),
  },
});

type Ctx = ServerContext<WriteDatabaseOf<{ schema: typeof schema }>>;

/** Keep the room open and its player count current. */
async function touchRoom(ctx: Ctx, code: string, now: number): Promise<void> {
  const room = await ctx.db.rooms.withIndex("by_code", (q) => q.eq("code", code)).first();
  if (!room) return;
  const members = await ctx.db.members.withIndex("by_room", (q) => q.eq("room", code)).collect();
  const players = members.filter((m) => m.seen > now - MEMBER_TTL).length;
  await ctx.db.rooms.update(room.id, { seen: now, players });
}
