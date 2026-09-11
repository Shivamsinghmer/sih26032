/**
 * The Socket.IO event contract, imported by both services so it cannot drift.
 *
 * Path: `/api/socket` on the API service.
 *
 * Two faults in the previous build that must not be reproduced:
 *   1. Rooms were unauthenticated — any connected socket could call
 *      `farmer:subscribe` with any id and receive another farmer's slot and
 *      payment events. The handshake must verify the Clerk token, and a
 *      subscribe to a room the caller does not own must be refused.
 *   2. There was no polling fallback despite a comment claiming one, so the
 *      queue board silently froze at first paint whenever the socket was down.
 *      Either poll or render a disconnected state — a stale queue position
 *      sends a farmer to the mandi at the wrong hour.
 */

import type { BookingStatus, Constraint, PaymentStage } from "./domain.js";

export const SOCKET_PATH = "/api/socket";

export const room = {
  centre: (centreId: string) => `centre:${centreId}` as const,
  farmer: (farmerId: string) => `farmer:${farmerId}` as const,
  admin: () => "admin" as const,
};

export interface QueueUpdate {
  centreId: string;
  nowServingToken: number | null;
  waiting: number;
  /** Computed from the centre's *observed* service rate today, so it self-corrects. */
  observedMinutesPerLot: number | null;
  at: string;
}

export interface CapacityUpdate {
  centreId: string;
  date: string;
  sellableQuintals: number;
  bindingConstraint: Constraint;
  at: string;
}

export interface BookingReslotted {
  bookingId: string;
  farmerId: string;
  centreId: string;
  previousSlotStart: string;
  slotStart: string;
  status: BookingStatus;
  /** Travels with the SMS. An unexplained delay is what sends farmers back to sleeping in the queue. */
  reslotReason: string;
  at: string;
}

export interface PaymentStageChanged {
  lotId: string;
  farmerId: string;
  stage: PaymentStage;
  slaBreached: boolean;
  at: string;
}

export interface AdminEscalation {
  lotId: string;
  centreId: string;
  stage: PaymentStage;
  /** From `ownerOf(stage)`. An escalation without a named office is just a complaint. */
  owner: string;
  hoursOverdue: number;
  at: string;
}

/** API -> client. */
export interface ServerToClientEvents {
  "queue:update": (payload: QueueUpdate) => void;
  "capacity:update": (payload: CapacityUpdate) => void;
  "booking:reslotted": (payload: BookingReslotted) => void;
  "payment:stage": (payload: PaymentStageChanged) => void;
  "admin:escalation": (payload: AdminEscalation) => void;
}

/**
 * Client -> API. Every subscribe is authorised against the session on the
 * server; the id in the payload is a request, never a grant.
 */
export interface ClientToServerEvents {
  "centre:subscribe": (centreId: string) => void;
  "centre:unsubscribe": (centreId: string) => void;
  "farmer:subscribe": (farmerId: string) => void;
  "admin:subscribe": () => void;
}
