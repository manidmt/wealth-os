import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/app/BrandMark";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const credSchema = z.object({
  email: z.string().trim().email("Email no válido").max(255),
  password: z.string().min(6, "Mínimo 6 caracteres").max(72),
});

const emailOnlySchema = z.object({
  email: z.string().trim().email("Email no válido").max(255),
});

function LoginPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      navigate({ to: "/" });
    }
  }, [loading, session, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = credSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { display_name: displayName.trim() || undefined },
          },
        });
        if (error) throw error;
        toast.success("Cuenta creada. Revisa tu email para confirmarla.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        router.invalidate();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error inesperado";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = emailOnlySchema.safeParse({ email });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    try {
      await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: `${window.location.origin}/login`,
      });
    } finally {
      setSubmitting(false);
    }
    toast.success(
      "Si existe una cuenta con ese email, te hemos enviado un enlace para restablecer la contraseña.",
    );
    setMode("signin");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-md bg-primary text-primary-foreground">
            <BrandMark className="h-5 w-5" />
          </div>
          <div className="text-center">
            <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
              Wealth OS
            </h1>
            <p className="mt-1 text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
              {mode === "signin"
                ? "Inicia sesión"
                : mode === "signup"
                  ? "Crea tu cuenta"
                  : mode === "forgot"
                    ? "Recupera tu contraseña"
                    : "Nueva contraseña"}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          {mode === "forgot" ? (
            <form onSubmit={handleForgotSubmit} className="space-y-3">
              <p className="text-[12.5px] text-muted-foreground">
                Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "..." : "Enviar enlace"}
              </Button>
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="w-full text-center text-[12.5px] text-muted-foreground transition hover:text-foreground"
              >
                Volver a iniciar sesión
              </button>
            </form>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-3">
                {mode === "signup" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Nombre</Label>
                    <Input
                      id="name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Tu nombre"
                      maxLength={80}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "..." : mode === "signin" ? "Entrar" : "Crear cuenta"}
                </Button>
              </form>

              {mode === "signin" && (
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="mt-3 w-full text-center text-[12.5px] text-muted-foreground transition hover:text-foreground"
                >
                  ¿Has olvidado tu contraseña?
                </button>
              )}

              <button
                type="button"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="mt-4 w-full text-center text-[12.5px] text-muted-foreground transition hover:text-foreground"
              >
                {mode === "signin"
                  ? "¿No tienes cuenta? Regístrate"
                  : "¿Ya tienes cuenta? Inicia sesión"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
