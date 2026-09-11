/**
 * Socket.IO.
 *
 * Two faults in the previous build that must not survive, both recorded in
 * docs/API.md:
 *
 *   1. **Rooms were unauthenticated.** Any connected socket could call
 *      `farmer:subscribe` with any id and receive another farmer's slot and
 *      payment events. Here the handshake is verified and every subscribe is
 *      authorised against the session, so an id in a payload is a request and
 *      never a grant.
 *
 *   2. **There was no polling fallback**, despite a comment claiming one, so the
 *      queue board silently froze at first paint whenever the socket was down.
 *      The client keeps polling regardless; this is an accelerator, not the only
 *      source of truth. A stale queue position sends a farmer to the mandi at
 *      the wrong hour.
 *
 * One replica, always. These rooms are in-process, so a second replica would
 * silently drop half the broadcasts — scaling out needs a Redis adapter.
 */

import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { verifyToken } from "@clerk/express";
import {
  SOCKET_PATH, room, isRole,
  type AdminEscalation, type BookingReslotted, type CapacityUpdate,
  type PaymentStageChanged, type QueueUpdate, type Role,
} from "@mandi/shared";
import { env } from "./env.js";
import { prisma } from "./db.js";

/** What the handshake established. Never taken from a later payload. */
interface SocketSession {
  userId: string;
  role: Role | null;
  /** The farmer row this socket may listen to, if any. */
  farmerId: string | null;
  /** The centre this officer runs. Null for an admin, who reaches every centre. */
  centreId: string | null;
}

type AppSocket = Socket & { session?: SocketSession };

let io: Server | null = null;

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, {
    path: SOCKET_PATH,
    // Same rule as the REST CORS: exactly the web origin, never `*`.
    cors: { origin: env.webOrigins, methods: ["GET", "POST"] },
    // Long-poll fallback for the transport itself, which is separate from the
    // application-level polling the client also does.
    transports: ["websocket", "polling"],
  });

  io.use(async (socket: AppSocket, next) => {
    try {
      socket.session = await resolveSocketSession(socket);
      next();
    } catch (error) {
      // Refuse the connection rather than letting an unauthenticated socket sit
      // in the server holding no rooms — a silent half-connection is harder to
      // diagnose than a refusal.
      next(error instanceof Error ? error : new Error("unauthorised"));
    }
  });

  io.on("connection", (socket: AppSocket) => {
    const session = socket.session!;

    socket.on("farmer:subscribe", (farmerId: string) => {
      // The only farmer room this socket may ever join is its own.
      if (!session.farmerId || session.farmerId !== farmerId) {
        socket.emit("subscribe:denied", { requested: room.farmer(farmerId) });
        return;
      }
      void socket.join(room.farmer(farmerId));
    });

    socket.on("centre:subscribe", (centreId: string) => {
      if (!canReachCentre(session, centreId)) {
        socket.emit("subscribe:denied", { requested: room.centre(centreId) });
        return;
      }
      void socket.join(room.centre(centreId));
    });

    socket.on("centre:unsubscribe", (centreId: string) => {
      void socket.leave(room.centre(centreId));
    });

    socket.on("admin:subscribe", () => {
      if (session.role !== "admin") {
        socket.emit("subscribe:denied", { requested: room.admin() });
        return;
      }
      void socket.join(room.admin());
    });
  });

  console.log(`  realtime      socket.io on ${SOCKET_PATH}`);
  return io;
}

function canReachCentre(session: SocketSession, centreId: string): boolean {
  if (session.role === "admin") return true;
  return session.role === "officer" && session.centreId === centreId;
}

/**
 * Verifies the handshake.
 *
 * In demo mode there is no token to verify, so the same persona the REST side
 * resolves is used — otherwise the panels would work over HTTP and silently
 * fail to subscribe.
 */
async function resolveSocketSession(socket: AppSocket): Promise<SocketSession> {
  if (env.demoMode) return demoSocketSession();

  const token =
    (socket.handshake.auth as { token?: string } | undefined)?.token ??
    socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!token) throw new Error("unauthenticated: no token on the handshake");

  const claims = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
  const userId = claims.sub;
  if (!userId) throw new Error("unauthenticated: token carries no subject");

  const claimed = (claims as { metadata?: { role?: unknown } }).metadata?.role;
  const role: Role | null = isRole(claimed) ? claimed : null;

  return hydrate(userId, role);
}

async function demoSocketSession(): Promise<SocketSession> {
  if (env.DEMO_ROLE === "farmer") {
    const farmer = await prisma.farmer.findFirst({
      where: { aadhaarVerified: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, clerkId: true },
    });
    return { userId: farmer?.clerkId ?? "demo-user", role: "farmer", farmerId: farmer?.id ?? null, centreId: null };
  }

  const officer = await prisma.officer.findFirst({
    where: { role: env.DEMO_ROLE },
    orderBy: { createdAt: "asc" },
    select: { clerkId: true, centreId: true },
  });
  return {
    userId: officer?.clerkId ?? "demo-user",
    role: env.DEMO_ROLE,
    farmerId: null,
    centreId: officer?.centreId ?? null,
  };
}

/**
 * Resolves which rooms this user owns, from the database rather than the token.
 *
 * The token says who they are; the database says what is theirs. Trusting a
 * client-supplied id for the second is exactly the bug being fixed.
 */
async function hydrate(userId: string, role: Role | null): Promise<SocketSession> {
  if (role === "farmer") {
    const farmer = await prisma.farmer.findUnique({ where: { clerkId: userId }, select: { id: true } });
    return { userId, role, farmerId: farmer?.id ?? null, centreId: null };
  }
  if (role === "officer" || role === "admin") {
    const officer = await prisma.officer.findUnique({ where: { clerkId: userId }, select: { centreId: true } });
    return { userId, role, farmerId: null, centreId: officer?.centreId ?? null };
  }
  return { userId, role, farmerId: null, centreId: null };
}

/* ------------------------------------------------------------------ emitters */

/**
 * Every emit is a no-op when realtime is not initialised.
 *
 * Routes are exercised by `curl` and by tests with no socket server attached,
 * and a broadcast must never be the reason a booking fails.
 */

export function emitQueueUpdate(payload: QueueUpdate): void {
  io?.to(room.centre(payload.centreId)).emit("queue:update", payload);
}

export function emitCapacityUpdate(payload: CapacityUpdate): void {
  io?.to(room.centre(payload.centreId)).emit("capacity:update", payload);
}

/**
 * To the farmer only — the one person who has to act on it, and before they
 * travel.
 *
 * It deliberately does NOT also emit `queue:update` to the centre. The first
 * version did, and running it showed why that was wrong twice over: a publish
 * that moved nine farmers fired nine identical queue updates, and each carried
 * invented figures (`waiting: 0`, `nowServingToken: null`) rather than the real
 * board, because there was nothing at that call site to compute them from.
 *
 * The centre already learns about the change from the single `capacity:update`
 * the publish emits. And a re-slot moves a FUTURE day, so today's queue board
 * has not changed at all.
 */
export function emitBookingReslotted(payload: BookingReslotted): void {
  io?.to(room.farmer(payload.farmerId)).emit("booking:reslotted", payload);
}

export function emitPaymentStage(payload: PaymentStageChanged): void {
  io?.to(room.farmer(payload.farmerId)).emit("payment:stage", payload);
}

export function emitAdminEscalation(payload: AdminEscalation): void {
  io?.to(room.admin()).emit("admin:escalation", payload);
}

export function realtimeReady(): boolean {
  return io !== null;
}
