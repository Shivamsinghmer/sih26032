/**
 * Panel shells. The screens themselves are step 5; what is real here is the
 * routing, the gates and the nav, which is what step 4 set out to prove.
 */

import { Outlet } from "react-router";
import { PanelNav, type NavItem } from "../components/panel-nav.js";
import { Page, PageHeader } from "../components/page.js";
import { useMe, RequireRole, RequireFarmerGates } from "../auth/session.js";

const FARMER_NAV: NavItem[] = [
  { to: "/farmer", label: "Dashboard" },
  { to: "/farmer/book", label: "Book a slot" },
  { to: "/farmer/queue", label: "Queue" },
  { to: "/farmer/payments", label: "Payments" },
];

const CENTRE_NAV: NavItem[] = [
  { to: "/centre", label: "Today" },
  { to: "/centre/capacity", label: "Capacity" },
  { to: "/centre/queue", label: "Queue board" },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Overview" },
  { to: "/admin/escalations", label: "Escalations" },
];

function Shell({ items }: { items: NavItem[] }) {
  const me = useMe();
  return (
    <>
      <PanelNav me={me} items={items} />
      <Outlet />
    </>
  );
}

export function FarmerLayout() {
  return (
    <RequireRole allow={["farmer"]}>
      <RequireFarmerGates>
        <Shell items={FARMER_NAV} />
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
