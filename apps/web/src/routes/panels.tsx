/**
 * Panel shells. The screens themselves are step 5; what is real here is the
 * routing, the gates and the nav, which is what step 4 set out to prove.
 */

import { Outlet } from "react-router";
import { PanelNav, type NavItem } from "../components/panel-nav.js";
import { Page, PageHeader } from "../components/page.js";
import { useMe, RequireRole, RequireFarmerGates } from "../auth/session.js";
import { RealtimeProvider } from "../lib/realtime.js";
import { I18nProvider, useT } from "../lib/i18n.js";

/** Farmer nav labels are translated; the officer and admin panels stay English. */
function useFarmerNav(): NavItem[] {
  const { t } = useT();
  return [
    { to: "/farmer", label: t("nav.dashboard") },
    { to: "/farmer/book", label: t("nav.book") },
    { to: "/farmer/queue", label: t("nav.queue") },
    { to: "/farmer/payments", label: t("nav.payments") },
  ];
}

const CENTRE_NAV: NavItem[] = [
  { to: "/centre", label: "Today" },
  { to: "/centre/capacity", label: "Capacity" },
  { to: "/centre/queue", label: "Queue board" },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Overview" },
  { to: "/admin/escalations", label: "Escalations" },
];

function Shell({ items, showLanguage = false }: { items: NavItem[]; showLanguage?: boolean }) {
  const me = useMe();
  // Inside the session guard, so the socket only ever connects once we know who
  // the user is and which rooms are theirs to ask for.
  return (
    <RealtimeProvider>
      <PanelNav me={me} items={items} showLanguage={showLanguage} />
      <Outlet />
    </RealtimeProvider>
  );
}

function FarmerShell() {
  return <Shell items={useFarmerNav()} showLanguage />;
}

export function FarmerLayout() {
  return (
    <RequireRole allow={["farmer"]}>
      <RequireFarmerGates>
        <I18nProvider>
          <FarmerShell />
        </I18nProvider>
      </RequireFarmerGates>
    </RequireRole>
  );
}

export function CentreLayout() {
  return (
    <RequireRole allow={["officer", "admin"]}>
      <Shell items={CENTRE_NAV} />
    </RequireRole>
  );
}

export function AdminLayout() {
  return (
    <RequireRole allow={["admin"]}>
      <Shell items={ADMIN_NAV} />
    </RequireRole>
  );
}

export function NotFound() {
  return (
    <Page>
      <PageHeader title="That page does not exist" lede="The link may be out of date." />
    </Page>
  );
}
