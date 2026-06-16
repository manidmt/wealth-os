import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { useEffect } from "react";
import { LoadingScreen } from "@/components/app/LoadingScreen";
import appCss from "../styles.css?url";
import { useLiveDashboardData, data as seedDashboardData } from "@/lib/dashboard-data";
import { DashboardContext } from "@/hooks/use-dashboard";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AgentChatWidget } from "@/components/agent/AgentChatWidget";
import { ThemeProvider, themeBootScript } from "@/components/app/ThemeProvider";
import { CurrencyProvider } from "@/components/app/CurrencyProvider";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useRouterState } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Wealth OS" },
      {
        name: "description",
        content:
          "Dashboard personal de patrimonio: resumen, gastos, portfolio, evolución y cierres mensuales.",
      },
      { name: "author", content: "Manuel" },
      { property: "og:title", content: "Wealth OS" },
      {
        property: "og:description",
        content: "Dashboard personal de patrimonio, gastos e inversiones.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "theme-color", content: "#0f172a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "WealthOS" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/icons/icon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        {children}
        <Scripts />
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');` }} />
      </body>
    </html>
  );
}

function DashboardDataProvider({ children }: { children: React.ReactNode }) {
  const { data: dashboardData } = useLiveDashboardData();
  return (
    <DashboardContext.Provider value={dashboardData ?? seedDashboardData}>
      {children}
    </DashboardContext.Provider>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLoginRoute = pathname === "/login";

  useEffect(() => {
    if (!loading && !session && !isLoginRoute) {
      router.navigate({ to: "/login" });
    }
  }, [loading, session, isLoginRoute, router]);

  if (isLoginRoute) return <>{children}</>;
  if (loading || !session) {
    return <LoadingScreen />;
  }
  return <>{children}</>;
}

function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardDataProvider>
      <AssistantProvider>
        {children}
        <AgentChatWidget />
      </AssistantProvider>
    </DashboardDataProvider>
  );
}

function GatedOutlet() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/login") return <Outlet />;
  return (
    <AuthenticatedShell>
      <Outlet />
    </AuthenticatedShell>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CurrencyProvider>
          <AuthProvider>
            <AuthGate>
              <GatedOutlet />
            </AuthGate>
            <Toaster />
          </AuthProvider>
        </CurrencyProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
