/**
 * Panel shells. The screens themselves are step 5; what is real here is the
 * routing, the gates and the nav, which is what step 4 set out to prove.
 */

import { Outlet } from "react-router";
import { PanelNav, type NavItem } from "../components/panel-nav.js";
import { Page, PageHeader, NotBuiltYet, Card } from "../components/page.js";
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

export function FarmerHome() {
  const me = useMe();
  return (
    <Page>
      <PageHeader
        title={`Namaste, ${me.farmer?.name ?? "farmer"}`}
        lede={`${me.farmer?.village ?? ""}${me.farmer?.village ? ", " : ""}${me.farmer?.district ?? ""}`}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <NotBuiltYet what="Next booking" endpoint="GET /farmer/dashboard" />
        <NotBuiltYet what="Payment tracker" endpoint="GET /farmer/lots" />
      </div>
      <Card className="mt-4">
        <h2 className="text-heading-sm font-semibold">Verified to sell</h2>
        <p className="mt-2 text-body text-graphite">
          {me.farmer?.landVerified
            ? `${me.farmer.landAcres ?? "—"} acres verified. Your seasonal quantity is capped against this.`
            : "Your land record is not verified yet, so no quantity cap has been set. A centre officer can attest it."}
        </p>
      </Card>
    </Page>
  );
}

export function CentreHome() {
  const me = useMe();
  return (
    <Page>
      <PageHeader
        title={me.officer?.centreName ?? "Procurement centre"}
        lede="Today's capacity, the queue, and anything overdue at this centre."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <NotBuiltYet what="Today at this centre" endpoint="GET /centres/:id/today" />
        <NotBuiltYet what="Capacity for tomorrow" endpoint="POST /centres/:id/capacity" />
      </div>
    </Page>
  );
}

export function AdminHome() {
  return (
    <Page>
      <PageHeader title="District overview" lede="Every centre, and what is overdue across all of them." />
      <div className="grid gap-4 md:grid-cols-2">
        <NotBuiltYet what="Centre KPIs" endpoint="GET /admin/overview" />
        <NotBuiltYet what="Escalation queue" endpoint="GET /admin/escalations" />
      </div>
    </Page>
  );
}

export function NotFound() {
  return (
    <Page>
      <PageHeader title="That page does not exist" lede="The link may be out of date." />
    </Page>
  );
}
