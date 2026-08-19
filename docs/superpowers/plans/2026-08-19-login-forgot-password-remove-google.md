# Password Reset + Remove Google Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user recover a forgotten password via email (request + set-new-password flow) in `login.tsx`, and remove the currently-broken "Continuar con Google" button along with its unused dependency.

**Architecture:** Single-file UI change to `login.tsx` (adds two new `mode` states: `"forgot"` and `"reset"`, reusing the existing mode-toggle pattern already used for signin/signup). Password recovery uses Supabase Auth's built-in `resetPasswordForEmail`/`updateUser` + the `PASSWORD_RECOVERY` auth event — no new backend code, no new Supabase table. Google removal deletes the now-dead `src/integrations/lovable/` module and its `package.json` dependency entry.

**Tech Stack:** React + TypeScript (Vite), TanStack Router, `@supabase/supabase-js` (already used), Zod (already used for `credSchema`), `sonner` toast (already used).

## Global Constraints

- Scope is limited to `wealth-navigator/src/routes/login.tsx`, deleting `wealth-navigator/src/integrations/lovable/`, and `wealth-navigator/package.json` + its lockfile. Do not modify `use-auth.tsx`, `src/integrations/supabase/client.ts`, or any backend code (spec decision 3).
- Do not remove `@lovable.dev/vite-tanstack-config` from `package.json` — it is unrelated build tooling, not part of the auth feature being removed.
- Password minimum length stays 6 characters, matching the existing `credSchema` (`z.string().min(6, "Mínimo 6 caracteres").max(72)`) — reuse this constraint for the new-password field rather than inventing a new one.
- The "forgot" flow must show the same success message regardless of whether the email exists in the system (no account-enumeration leak) (spec decision 2).
- This is a pure UI change with no new pure/testable business logic — per spec, no new unit test is required; verification is manual, in-browser, with a real account.

---

### Task 1: Remove Google login and the `lovable` integration

**Files:**
- Modify: `wealth-navigator/src/routes/login.tsx`
- Delete: `wealth-navigator/src/integrations/lovable/index.ts` (and the now-empty `wealth-navigator/src/integrations/lovable/` directory)
- Modify: `wealth-navigator/package.json`

**Interfaces:**
- Produces: `login.tsx` with no `lovable` import and no Google button — consumed by Task 2, which adds the `forgot`/`reset` modes to the same file's remaining structure (the signin/signup form and its surrounding card).

- [ ] **Step 1: Remove the Google button, its handler, and the `lovable` import from `login.tsx`**

In `wealth-navigator/src/routes/login.tsx`:

1. Remove this import line:
```typescript
import { lovable } from "@/integrations/lovable";
```

2. Remove the `handleGoogle` function:
```typescript
  async function handleGoogle() {
    setSubmitting(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error(result.error.message ?? "No se pudo iniciar sesión con Google");
      setSubmitting(false);
      return;
    }
    if (result.redirected) return;
    router.invalidate();
    setSubmitting(false);
  }
```

3. Remove the Google button and the "o" divider from the JSX (everything between the closing `</div>` of the header block and the `<form onSubmit={handleSubmit}...>` line):
```tsx
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogle}
            disabled={submitting}
          >
            <GoogleIcon className="mr-2 h-4 w-4" />
            Continuar con Google
          </Button>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">o</span>
            <div className="h-px flex-1 bg-border" />
          </div>

```
So the `<div className="rounded-lg border border-border bg-card p-5 shadow-sm">` wrapper now goes straight to the `<form onSubmit={handleSubmit} className="space-y-3">` (in Task 2 this form's container gets a mode-conditional wrapper — for this task, just confirm it typechecks with the form as the first child).

4. Remove the `GoogleIcon` function at the bottom of the file:
```tsx
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z"/>
    </svg>
  );
}
```

- [ ] **Step 2: Delete the `lovable` integration module**

```bash
cd wealth-navigator
rm -rf src/integrations/lovable
```

- [ ] **Step 3: Remove the `@lovable.dev/cloud-auth-js` dependency**

In `wealth-navigator/package.json`, remove this line from `"dependencies"` (keep `@lovable.dev/vite-tanstack-config`, which is unrelated build tooling):
```json
    "@lovable.dev/cloud-auth-js": "^1.1.2",
```

Then run:
```bash
cd wealth-navigator
npm install
```
Expected: `package-lock.json` updates to drop `@lovable.dev/cloud-auth-js`; no other dependency versions change.

- [ ] **Step 4: Typecheck and lint**

Run: `cd wealth-navigator && npx tsc --noEmit && npx eslint src/routes/login.tsx`
Expected: no new errors from `login.tsx` (no references to `lovable`, `handleGoogle`, or `GoogleIcon` remain — confirm with `grep -n "lovable\|handleGoogle\|GoogleIcon" src/routes/login.tsx` returning nothing).

- [ ] **Step 5: Commit**

```bash
cd wealth-navigator
git add src/routes/login.tsx package.json package-lock.json
git rm -r src/integrations/lovable
git commit -m "$(cat <<'EOF'
fix(auth): remove broken Google sign-in and lovable integration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```

---

### Task 2: Add "forgot password" (request) mode

**Files:**
- Modify: `wealth-navigator/src/routes/login.tsx`

**Interfaces:**
- Consumes: `supabase.auth.resetPasswordForEmail(email, options)` from `@supabase/supabase-js` (already imported as `supabase` from `@/integrations/supabase/client`), `toast` from `sonner` (already imported), the existing `email` state and `credSchema`-adjacent email validation pattern.
- Produces: `mode` type widened to `"signin" | "signup" | "forgot" | "reset"` — Task 3 adds the `"reset"` branch alongside this one, using the same `mode` state variable.

- [ ] **Step 1: Widen the `mode` state type and add a forgot-email validation schema**

In `wealth-navigator/src/routes/login.tsx`, change:
```typescript
  const [mode, setMode] = useState<"signin" | "signup">("signin");
```
to:
```typescript
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">("signin");
```

Add a new schema near `credSchema` (right after it):
```typescript
const emailOnlySchema = z.object({
  email: z.string().trim().email("Email no válido").max(255),
});
```

- [ ] **Step 2: Add `handleForgotSubmit`**

Add this function right after `handleSubmit` in `login.tsx`:
```typescript
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
    toast.success("Si existe una cuenta con ese email, te hemos enviado un enlace para restablecer la contraseña.");
    setMode("signin");
  }
```
Note: the success toast and `setMode("signin")` run unconditionally after the call (not inside a `.then`/try success branch, and not gated on `error` from the response) — this is intentional per spec decision 2 (never reveal whether the email exists). The `finally` only resets `submitting`; it does not branch on success/failure for the user-facing message.

- [ ] **Step 3: Add the "¿Has olvidado tu contraseña?" link and the `forgot` mode JSX**

In `login.tsx`, inside the `signin`-mode area of the JSX, find the closing `</form>` tag of the main `handleSubmit` form and the `<button>` below it that toggles signin/signup:
```tsx
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-center text-[12.5px] text-muted-foreground transition hover:text-foreground"
          >
            {mode === "signin"
              ? "¿No tienes cuenta? Regístrate"
              : "¿Ya tienes cuenta? Inicia sesión"}
          </button>
```

Restructure the card body so it renders one of three blocks based on `mode` (`forgot`/`reset` replace the signin/signup form entirely; Task 3 adds the `reset` branch). Replace the card's inner content — everything inside `<div className="rounded-lg border border-border bg-card p-5 shadow-sm">...</div>` — with:

```tsx
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
```

Also update the header subtitle (the `<p className="mt-1 text-[12px] uppercase ...">` line near the top) to account for the new modes:
```tsx
            <p className="mt-1 text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
              {mode === "signin"
                ? "Inicia sesión"
                : mode === "signup"
                  ? "Crea tu cuenta"
                  : mode === "forgot"
                    ? "Recupera tu contraseña"
                    : "Nueva contraseña"}
            </p>
```
(the `mode === "reset"` case — the trailing `"Nueva contraseña"` — is handled here now even though Task 3 builds that mode's form; this line covers all four modes at once so it doesn't need a second edit in Task 3).

- [ ] **Step 4: Typecheck and lint**

Run: `cd wealth-navigator && npx tsc --noEmit && npx eslint src/routes/login.tsx`
Expected: no new errors. (There is no `reset`-mode form yet, so `mode === "reset"` currently falls into the `else` branch showing the signin/signup form — this is expected and gets fixed in Task 3, not a bug to chase in this task.)

- [ ] **Step 5: Manual verification**

Run: `cd wealth-navigator && npm run dev`, open `/login`.
Check:
- Signin mode shows "¿Has olvidado tu contraseña?" below the "Entrar" button.
- Signup mode does NOT show that link.
- Clicking it switches to a form with only an email field and "Enviar enlace" / "Volver a iniciar sesión".
- Submitting with a valid-looking email shows the success toast and returns to signin mode (do not need real email delivery yet — that's covered end-to-end in Task 4's manual verification once Task 3 is also in place).

- [ ] **Step 6: Commit**

```bash
cd wealth-navigator
git add src/routes/login.tsx
git commit -m "$(cat <<'EOF'
feat(auth): add forgot-password request form to login page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```

---

### Task 3: Add "reset password" (set new password) mode

**Files:**
- Modify: `wealth-navigator/src/routes/login.tsx`

**Interfaces:**
- Consumes: `mode` state and `emailOnlySchema`-adjacent pattern from Task 2 (same file); `supabase.auth.onAuthStateChange` and `supabase.auth.updateUser` from `@supabase/supabase-js`.
- Produces: full `mode === "reset"` branch — no other file depends on this; it's the last piece of the login page's mode switch.

- [ ] **Step 1: Detect the `PASSWORD_RECOVERY` event and switch to `reset` mode**

In `login.tsx`, add a new `useEffect` right after the existing one that redirects on session (the one with `if (!loading && session) { navigate({ to: "/" }); }`):

```typescript
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("reset");
      }
    });
    return () => subscription.unsubscribe();
  }, []);
```

Note: this listener is intentionally local to `login.tsx` (not added to the global `AuthProvider` in `use-auth.tsx`, per the plan's Global Constraints — no other page needs to know about password-recovery mode).

Also guard the existing session-redirect effect so it does not immediately bounce a user with a fresh recovery session back to `/` before they can set their password. Change:
```typescript
  useEffect(() => {
    if (!loading && session) {
      navigate({ to: "/" });
    }
  }, [loading, session, navigate]);
```
to:
```typescript
  useEffect(() => {
    if (!loading && session && mode !== "reset") {
      navigate({ to: "/" });
    }
  }, [loading, session, navigate, mode]);
```
(A `PASSWORD_RECOVERY` event establishes a session, which would otherwise immediately trigger this redirect before the user sees the reset form.)

- [ ] **Step 2: Add reset-password state and validation schema**

Add new state near the other `useState` calls:
```typescript
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
```

Add a new schema near `emailOnlySchema`:
```typescript
const newPasswordSchema = z
  .object({
    newPassword: z.string().min(6, "Mínimo 6 caracteres").max(72),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  });
```

- [ ] **Step 3: Add `handleResetSubmit`**

Add this function right after `handleForgotSubmit`:
```typescript
  async function handleResetSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = newPasswordSchema.safeParse({ newPassword, confirmPassword });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
      if (error) throw error;
      toast.success("Contraseña actualizada.");
      navigate({ to: "/" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error inesperado";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }
```

- [ ] **Step 4: Add the `reset` mode JSX branch**

In the card body from Task 2, change the top-level conditional from `mode === "forgot" ? (...) : (...)` to a three-way branch. Replace:
```tsx
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          {mode === "forgot" ? (
```
with:
```tsx
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          {mode === "reset" ? (
            <form onSubmit={handleResetSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">Nueva contraseña</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirmar contraseña</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "..." : "Guardar nueva contraseña"}
              </Button>
            </form>
          ) : mode === "forgot" ? (
```
(leave the rest of the `forgot`/else-branch structure from Task 2 exactly as it is — this only changes the ternary's entry condition from a 2-way to a 3-way branch, adding one new leading case).

- [ ] **Step 5: Typecheck and lint**

Run: `cd wealth-navigator && npx tsc --noEmit && npx eslint src/routes/login.tsx`
Expected: no new errors.

- [ ] **Step 6: Full regression — run the existing test suite and build**

Run: `cd wealth-navigator && npm test && npm run build`
Expected: all existing tests still pass (this task adds no test files, so the count should be unchanged from before Task 1); build succeeds with no TypeScript errors.

- [ ] **Step 7: Manual end-to-end verification with a real account**

Run: `cd wealth-navigator && npm run dev`, open `/login` in a browser.
Check, using the actual user account (not a throwaway):
1. From signin mode, click "¿Has olvidado tu contraseña?", enter the real account email, submit — confirm the success toast appears and mode returns to `signin`.
2. Check the email inbox for that account — confirm a password-reset email arrives (Supabase's default template, sent via the project's configured SMTP).
3. Click the link in the email — confirm it opens `/login` and the page automatically switches to the "Nueva contraseña" / reset form (no manual navigation needed).
4. Enter a new password and a mismatched confirmation — confirm the "Las contraseñas no coinciden" error toast appears and the form does not submit.
5. Enter a new password and a matching confirmation — confirm the success toast appears and the page navigates to `/` while signed in.
6. Sign out, return to `/login`, sign in with the new password — confirm it works.
7. Confirm the "Continuar con Google" button no longer appears in any mode.

- [ ] **Step 8: Commit**

```bash
cd wealth-navigator
git add src/routes/login.tsx
git commit -m "$(cat <<'EOF'
feat(auth): add set-new-password form for the recovery flow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```
