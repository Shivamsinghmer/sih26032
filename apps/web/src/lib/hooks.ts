/**
 * Typed data hooks. Every one of these goes through `lib/api.ts`, which is the
 * only module that calls fetch.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminOverview,
  CentreCapacityScreen,
  CentreListItem,
  CentreQueue,
  CentreToday,
  CreateBookingRequest,
  EscalationRow,
  FarmerDashboard,
  LotDto,
  PublishCapacityRequest,
  PublishCapacityResponse,
  QueueAction,
  QueueContext,
  RecordLotRequest,
  SlotsResponse,
} from "@mandi/shared";
import { apiGet, apiPatch, apiPost, type ApiRequestError } from "./api.js";
import type { Locale } from "@mandi/shared";

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

/* ------------------------------------------------------------ centre officer */

export function useCentreToday(centreId: string | null) {
  return useQuery<CentreToday, ApiRequestError>({
    queryKey: ["centre", centreId, "today"],
    queryFn: ({ signal }) => apiGet<CentreToday>(`/centres/${centreId}/today`, undefined, signal),
    enabled: Boolean(centreId),
  });
}

export function useCentreCapacity(centreId: string | null, date: string | null) {
  return useQuery<CentreCapacityScreen, ApiRequestError>({
    queryKey: ["centre", centreId, "capacity", date],
    queryFn: ({ signal }) =>
      apiGet<CentreCapacityScreen>(`/centres/${centreId}/capacity`, date ? { date } : undefined, signal),
    enabled: Boolean(centreId),
  });
}

export function usePublishCapacity(centreId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<PublishCapacityResponse, ApiRequestError, PublishCapacityRequest>({
    mutationFn: (body) => apiPost<PublishCapacityResponse>(`/centres/${centreId}/capacity`, body),
    onSuccess: () => {
      // Publishing may have re-slotted people, so the board and the day list
      // are both stale now.
      void queryClient.invalidateQueries({ queryKey: ["centre"] });
      void queryClient.invalidateQueries({ queryKey: ["slots"] });
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}

export function useCentreQueue(centreId: string | null) {
  return useQuery<CentreQueue, ApiRequestError>({
    queryKey: ["centre", centreId, "queue"],
    queryFn: ({ signal }) => apiGet<CentreQueue>(`/centres/${centreId}/queue`, undefined, signal),
    enabled: Boolean(centreId),
    // The officer works this screen all day; it must not go stale behind them.
    refetchInterval: 15_000,
  });
}

export function useAdvanceQueue() {
  const queryClient = useQueryClient();
  return useMutation<unknown, ApiRequestError, { bookingId: string; action: QueueAction }>({
    mutationFn: (body) => apiPost("/queue/advance", body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["centre"] }),
  });
}

export function useRecordLot() {
  const queryClient = useQueryClient();
  return useMutation<{ qualityPass: boolean; reslotted: boolean }, ApiRequestError, RecordLotRequest>({
    mutationFn: (body) => apiPost("/lots", body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["centre"] }),
  });
}

export function useAdvanceStage() {
  const queryClient = useQueryClient();
  return useMutation<unknown, ApiRequestError, { lotId: string; stage: string }>({
    mutationFn: ({ lotId, stage }) => apiPatch(`/lots/${lotId}/stage`, { stage }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["centre"] });
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}

/* ------------------------------------------------------------ district admin */

export function useAdminOverview() {
  return useQuery<AdminOverview, ApiRequestError>({
    queryKey: ["admin", "overview"],
    queryFn: ({ signal }) => apiGet<AdminOverview>("/admin/overview", undefined, signal),
  });
}

export function useEscalations() {
  return useQuery<EscalationRow[], ApiRequestError>({
    queryKey: ["admin", "escalations"],
    queryFn: ({ signal }) => apiGet<EscalationRow[]>("/admin/escalations", undefined, signal),
  });
}

/* ------------------------------------------------------------- onboarding */

export interface OnboardingInput {
  name: string;
  village: string;
  district: string;
  state: string;
  preferredLocale: Locale;
  email?: string;
  landAcres?: number;
}

export function useOnboard() {
  const queryClient = useQueryClient();
  return useMutation<{ farmer: unknown }, ApiRequestError, OnboardingInput>({
    mutationFn: (body) => apiPost("/onboarding", body),
    // /me now reports a role and a profile, and the guard reads /me.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
}

export interface AadhaarResult {
  signatureVerified: boolean;
  certificateFile: string | null;
  message: string;
  identity: {
    name: string; dateOfBirth: string; gender: string;
    district: string; state: string; pincode: string;
    aadhaarLast4: string; issuedAt: string | null;
  };
  checks: { mobileHashPresent: boolean; mobileMatchesRegisteredPhone: boolean | null };
}

export function useVerifyAadhaar() {
  const queryClient = useQueryClient();
  return useMutation<AadhaarResult, ApiRequestError, { qrPayload: string }>({
    mutationFn: (body) => apiPost("/verify/aadhaar", body),
    onSuccess: (result) => {
      // Only a verified signature changes the gate, so only then is /me stale.
      if (result.signatureVerified) void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

/** Changes which language notifications and the UI use. */
export function useSetLocale() {
  const queryClient = useQueryClient();
  return useMutation<{ preferredLocale: Locale }, ApiRequestError, Locale>({
    mutationFn: (locale) => apiPatch("/farmer/locale", { preferredLocale: locale }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
}
