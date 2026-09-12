/**
 * The realtime client.
 *
 * **This is an accelerator, not a source of truth.** Polling continues
 * regardless — the socket only makes updates arrive sooner. docs/API.md records
 * why: the previous build had no fallback despite a comment claiming one, so the
 * queue board silently froze at first paint whenever the socket was down, and a
 * stale queue position sends a farmer to the mandi at the wrong hour.
 *
 * So there are two defences, and both are deliberate:
 *   · the screens keep their polling intervals whether or not this connects
 *   · `useConnection()` exposes the state so a screen can SAY it is disconnected
 *     rather than showing a frozen number as though it were live
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { SOCKET_PATH, type BookingReslotted, type CapacityUpdate, type QueueUpdate } from "@mandi/shared";
import { useMe } from "../auth/session.js";
import { getAuthToken } from "./api.js";

/**
 * Where the API lives.
 *
 * Blank means "same origin", which is how the dev server works when it proxies
 * /api — the setup used to test on a phone, where the page is https:// and
 * "localhost" means the phone itself. An empty string is not nullish, so `??`
 * alone would leave BASE as "" and `new URL("/api/v1/...")` would throw.
 */
const CONFIGURED = (import.meta.env["VITE_API_URL"] ?? "").trim();
const BASE = (CONFIGURED || window.location.origin).replace(/\/$/, "");

export type ConnectionState = "connecting" | "live" | "offline";

interface RealtimeValue {
  state: ConnectionState;
  /** The last event this client saw, so a screen can show "updated just now". */
  lastEventAt: Date | null;
}

const RealtimeContext = createContext<RealtimeValue>({ state: "connecting", lastEventAt: null });

export function useConnection(): RealtimeValue {
  return useContext(RealtimeContext);
}

/**
 * Connects, subscribes to the rooms this user owns, and invalidates the queries
 * an event makes stale.
 *
 * It deliberately does NOT write event payloads into the cache. An event says
 * "something changed"; the server remains the one that says what it changed to.
 * Patching a cache from a payload is how two screens start disagreeing.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>("connecting");
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const centreId = me.officer?.centreId ?? null;
  const farmerId = me.farmer?.id ?? null;
  const isAdmin = me.role === "admin";

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      // The same token the fetch wrapper attaches. In demo mode there is none,
      // and the server resolves the demo persona instead.
      const token = await getAuthToken();
      if (cancelled) return;

      const socket = io(BASE, {
        path: SOCKET_PATH,
        auth: token ? { token } : {},
        transports: ["websocket", "polling"],
        // Reconnect quietly. The screens are still polling, so a gap costs
        // freshness rather than correctness.
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 10_000,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        setState("live");
        if (farmerId) socket.emit("farmer:subscribe", farmerId);
        if (centreId) socket.emit("centre:subscribe", centreId);
        if (isAdmin) socket.emit("admin:subscribe");
      });

      socket.on("disconnect", () => setState("offline"));
      socket.on("connect_error", () => setState("offline"));

      // The server refused a room. Worth surfacing in the console rather than
      // failing silently — it means the client asked for something that is not
      // its own, which is a bug on this side.
      socket.on("subscribe:denied", (payload: { requested: string }) => {
        console.warn(`realtime: refused room ${payload.requested}`);
      });

      const touched = () => setLastEventAt(new Date());

      socket.on("queue:update", (_p: QueueUpdate) => {
        touched();
        void queryClient.invalidateQueries({ queryKey: ["centre"] });
        void queryClient.invalidateQueries({ queryKey: ["farmer", "queue"] });
      });

      socket.on("capacity:update", (_p: CapacityUpdate) => {
        touched();
        void queryClient.invalidateQueries({ queryKey: ["centre"] });
        void queryClient.invalidateQueries({ queryKey: ["slots"] });
      });

      socket.on("booking:reslotted", (_p: BookingReslotted) => {
        touched();
        // The farmer's whole panel changes meaning when this arrives.
        void queryClient.invalidateQueries({ queryKey: ["farmer"] });
      });

      socket.on("payment:stage", () => {
        touched();
        void queryClient.invalidateQueries({ queryKey: ["farmer"] });
      });

      socket.on("admin:escalation", () => {
        touched();
        void queryClient.invalidateQueries({ queryKey: ["admin"] });
      });
    }

    void connect();

    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [queryClient, farmerId, centreId, isAdmin]);

  const value = useMemo(() => ({ state, lastEventAt }), [state, lastEventAt]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/**
 * Says out loud whether what you are looking at is live.
 *
 * Rendering nothing while disconnected is the failure this project promised not
 * to repeat: the numbers stay on screen looking authoritative while quietly
 * going stale.
 */
export function ConnectionBadge() {
  const { state, lastEventAt } = useConnection();

  if (state === "live") {
    return (
      <span className="flex items-center gap-1.5 text-caption text-stone" title={lastEventAt ? `Last update ${lastEventAt.toLocaleTimeString("en-IN")}` : "Connected"}>
        <span className="size-2 rounded-full bg-notion-blue" aria-hidden />
        Live
      </span>
    );
  }

  if (state === "connecting") {
    return <span className="text-caption text-stone">Connecting…</span>;
  }

  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-marigold px-3 py-1 text-caption font-medium text-ink-black"
      title="Live updates are not connected. The screen is still refreshing on a timer, so figures may be up to a minute old."
    >
      <span className="size-2 rounded-full bg-ink-black/50" aria-hidden />
      Not live — refreshing on a timer
    </span>
  );
}
