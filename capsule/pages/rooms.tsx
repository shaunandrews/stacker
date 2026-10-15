"use client";
import { useQuery } from "@spacefast/zero/client";

// The lobby on the web: open rooms, each a link into Stacker (works in the headset's browser too).
export default function Rooms() {
  const rooms = useQuery<Array<{ code: string; name: string; players: number }>>("openRooms");
  return (
    <>
      <h1>Stacker rooms</h1>
      {rooms === undefined ? (
        <p>Loading…</p>
      ) : rooms.length === 0 ? (
        <p>
          No open rooms right now. <a href="/">Start one in Stacker</a> (Together → Start a room).
        </p>
      ) : (
        <ul>
          {rooms.map((r) => (
            <li key={r.code}>
              <a href={`/?room=${r.code}`}>{r.name}</a> · {r.players} here · <code>{r.code}</code>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
