# Recuperar contraseña + quitar login con Google — Design

**Fecha:** 2026-08-19
**Repo:** monorepo `wealth-os` (`wealth-navigator/`)

## Problema

`login.tsx` no tiene forma de recuperar una contraseña olvidada — solo
inicio de sesión y registro. Además, el botón "Continuar con Google" no
funciona actualmente y debe eliminarse junto con su dependencia
(`@lovable.dev/cloud-auth-js`, usada solo para ese flujo OAuth).

## Solución

### Decisiones (aprobadas)

1. **Quitar Google:** eliminar el botón "Continuar con Google", el
   divisor "o", `handleGoogle`, `GoogleIcon` y el import de `lovable` en
   `login.tsx`. Eliminar por completo `src/integrations/lovable/` (único
   consumidor era `login.tsx`) y la dependencia
   `@lovable.dev/cloud-auth-js` de `package.json` (no se toca
   `@lovable.dev/vite-tanstack-config`, que es tooling de build no
   relacionado con auth).
2. **Recuperación de contraseña, dos pasos, ambos como nuevo `mode` en la
   misma tarjeta de `login.tsx`** (mismo patrón que el toggle
   signin/signup existente):
   - **Modo `"forgot"`:** formulario solo con email. Enlace "¿Has
     olvidado tu contraseña?" visible bajo el botón "Entrar" en modo
     `signin`. Envía `supabase.auth.resetPasswordForEmail(email,
     { redirectTo: `${origin}/login` })`. Muestra siempre el mismo
     mensaje de éxito exista o no esa cuenta (no revela qué emails están
     registrados). Vuelve a modo `signin` tras el envío.
   - **Modo `"reset"`:** se activa automáticamente al detectar el evento
     `PASSWORD_RECOVERY` de `supabase.auth.onAuthStateChange` (Supabase
     ya parsea el token de recuperación de la URL por defecto —
     `detectSessionInUrl` está activo en `src/integrations/supabase/client.ts`,
     sin cambios necesarios ahí). Formulario con "Nueva contraseña" +
     "Confirmar contraseña" (mismo mínimo de 6 caracteres que ya usa
     `credSchema`). Llama a `supabase.auth.updateUser({ password })`. Al
     terminar, navega a `/` (la sesión de recuperación ya es válida tras
     `updateUser`).
3. **Alcance:** solo `wealth-navigator/src/routes/login.tsx`,
   `src/integrations/lovable/` (eliminado) y `package.json`/lockfile. No
   se toca `use-auth.tsx`, `client.ts`, ni el backend.

### Cambios

- **`src/routes/login.tsx`:**
  - `mode` pasa de `"signin" | "signup"` a `"signin" | "signup" | "forgot" | "reset"`.
  - Nuevo `useEffect` con un listener local de
    `supabase.auth.onAuthStateChange` que, al recibir `PASSWORD_RECOVERY`,
    hace `setMode("reset")`.
  - Nuevo estado para el formulario de "forgot" (`email` reutiliza el
    existente) y para "reset" (`newPassword`, `confirmPassword`).
  - Nuevas funciones `handleForgotSubmit` y `handleResetSubmit`.
  - Render condicional por `mode`: los modos `forgot`/`reset` reemplazan
    el formulario normal (no muestran el toggle signin/signup ni el botón
    de Google, que ya no existe).
  - Eliminados: `handleGoogle`, `GoogleIcon`, el botón y el divisor "o",
    el import de `lovable`.
- **Eliminado:** `src/integrations/lovable/` (directorio completo).
- **`package.json`:** eliminar `@lovable.dev/cloud-auth-js` de
  `dependencies`; regenerar lockfile.

## Testing

Componente de UI con llamadas directas a Supabase Auth, sin lógica de
negocio nueva que aislar en una función pura — no requiere test unitario
nuevo. Verificación manual real en el navegador con la cuenta del usuario:
1. Pedir reset desde modo `forgot`, confirmar que llega el email.
2. Pinchar el enlace, confirmar que `/login` cambia a modo `reset`
   automáticamente.
3. Establecer nueva contraseña, confirmar que redirige a `/` con sesión
   iniciada.
4. Cerrar sesión, volver a `/login`, confirmar que la nueva contraseña
   funciona en modo `signin`.
5. Confirmar que el botón de Google ya no aparece en ningún modo.

## Fuera de alcance

- Cambios en `use-auth.tsx` o en el cliente de Supabase.
- Otros proveedores OAuth (Apple, Microsoft) — no estaban activos y no se
  añaden.
- Políticas de complejidad de contraseña más allá del mínimo de 6
  caracteres ya existente.
