import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Receipt,
  PieChart,
  TrendingUp,
  Settings,
  MessageSquareText,
  LogOut,
  CalendarRange,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { BrandMark } from "@/components/app/BrandMark";
import { useDashboard } from "@/hooks/use-dashboard";
import { useAuth } from "@/hooks/use-auth";

type NavItem = {
  title: string;
  url:
    | "/"
    | "/expenses"
    | "/portfolio"
    | "/net-worth"
    | "/settings"
    | "/assistant"
    | "/planning"
    | "/bank-callback";
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

const items: NavItem[] = [
  { title: "Resumen", url: "/", icon: LayoutDashboard, exact: true },
  { title: "Gastos mensuales", url: "/expenses", icon: Receipt },
  { title: "Portfolio", url: "/portfolio", icon: PieChart },
  { title: "Planificación", url: "/planning", icon: CalendarRange },
  { title: "Patrimonio", url: "/net-worth", icon: TrendingUp },
  { title: "Asistente", url: "/assistant", icon: MessageSquareText },
  { title: "Configuración", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const data = useDashboard();
  const { user, signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-[10px]">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <BrandMark className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-display text-sm font-semibold tracking-tight">Wealth OS</span>
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {data.owner}
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-1.5 py-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
            Espacios
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = item.exact
                  ? pathname === item.url
                  : pathname === item.url || pathname.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                      className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-medium"
                    >
                      <Link to={item.url} className="gap-3">
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="text-[13.5px]">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-3 py-3 group-data-[collapsible=icon]:hidden">
        {user ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-accent/60 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-foreground">{user.email}</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Sesión activa
              </div>
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              title="Cerrar sesión"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="rounded-md bg-accent/60 px-3 py-2.5 text-[11px] leading-snug text-muted-foreground">
            <div className="font-medium text-foreground">Modo demo</div>
            Lectura sobre datos semilla.
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
