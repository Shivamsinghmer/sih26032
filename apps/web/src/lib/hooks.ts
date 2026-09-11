/**
 * Typed data hooks. Every one of these goes through `lib/api.ts`, which is the
 * only module that calls fetch.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CentreListItem,
  CreateBookingRequest,
  FarmerDashboard,
  LotDto,
  QueueContext,
  SlotsResponse,
} from "@mandi/shared";
import { apiGet, apiPost, type ApiRequestError } from "./api.js";

export function useFarmerDashboard() {
  return useQuery<FarmerDashboard, ApiRequestError>({
    queryKey: ["farmer", "dashboard"],
    queryFn: ({ signal }) => apiGet<FarmerDashboard>("/farmer/dashboard", undefined, signal),
  });
}

export function useFarmerLots() {
  return useQuery<LotDto[], ApiRequestError>({
    queryKey: ["farmer", "lots"],
    queryFn: ({ signal }) => apiGet<LotDto[]>("/farmer/lots", undefined, signal),
  });
}

/**
 * The live queue.
 *
 * Polled rather than pushed, for now. Socket.IO is step 6, and until the socket
 * has an authenticated handshake AND a fallback, polling is the honest option:
 * a queue board that silently freezes sends a farmer to the mandi at the wrong
 * hour, which is worse than a board that costs a request every 20 seconds.
 */
export function useQueueContext() {
  return useQuery<QueueContext, ApiRequestError>({
    queryKey: ["farmer", "queue"],
    queryFn: ({ signal }) => apiGet<QueueContext>("/farmer/queue-context", undefined, signal),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
}

export function useCentres() {
  return useQuery<CentreListItem[], ApiRequestError>({
    queryKey: ["centres"],
    queryFn: ({ signal }) => apiGet<CentreListItem[]>("/centres", undefined, signal),
    // Centres are physical buildings; they do not change during a session.
    staleTime: 10 * 60_000,
  });
}

export function useSlots(centreId: string | null) {
  return useQuery<SlotsResponse, ApiRequestError>({
    queryKey: ["slots", centreId],
    queryFn: ({ signal }) => apiGet<SlotsResponse>("/slots", { centreId: centreId! }, signal),
    enabled: Boolean(centreId),
    // Capacity moves. A stale day list is how a farmer books a slot that is gone.
    staleTime: 15_000,
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();

  return useMutation<{ booking: { id: string; gatePassCode: string } }, ApiRequestError, CreateBookingRequest>({
    mutationFn: (body) => apiPost("/bookings", body),
    onSuccess: () => {
      // The day just lost capacity and the dashboard just gained a booking.
      void queryClient.invalidateQueries({ queryKey: ["slots"] });
      void queryClient.invalidateQueries({ queryKey: ["farmer"] });
    },
  });
}
