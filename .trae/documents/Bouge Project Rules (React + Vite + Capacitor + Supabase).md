## Scope
- Replace the existing project rules with concise, technical guidance tailored to our stack: React + TypeScript (Vite), React Router, Tailwind CSS, Radix UI/Shadcn, Zustand, Capacitor (Android), Supabase (Postgres + Edge Functions), local SQLite, Netlify.

## Target File
- Update `/.trae/rules/project_rules.md` with the new rules.

## Tech Stack Alignment
- Next.js-specific items (App Router, RSC, nuqs) are replaced with React + Vite equivalents.
- Performance guidance focuses on SPA + Capacitor: reduce bundle size, lazy-load non-critical UI, minimize `useEffect` and global re-renders, optimize images (WebP, sizes, lazy), avoid heavy work on the main thread.
- Routing uses React Router; URL state handled via a small typed helper built on `useSearchParams`.
- UI uses Shadcn/Radix with Tailwind; class merging via existing `cn` (`@/lib/utils`), follow `components.json` aliases.
- Data access centralized through `@/lib/supabase-client` and local `sqliteServices_Refactored`; avoid direct client creation or ad-hoc SQL.
- Edge Functions must implement CORS (OPTIONS + allow-list), structured errors, typed payloads.

## Rule Sections (to be written into the file)
1. Code Style & Structure
- Functional, declarative TS; avoid classes for UI/logic (services may use modules).
- File layout: exported component → subcomponents → helpers → static content → interfaces.
- Named exports; keep components small and composable.
- Descriptive names with auxiliaries (`isLoading`, `hasError`).

2. Directories & Naming
- Folders kebab-case: `components/auth-wizard`, `components/contacts`, `lib/supabase`, `store/chat-store`.
- Common layout:
  - `src/components/**` UI (Shadcn/Radix);
  - `src/pages/**` route views;
  - `src/store/**` (Zustand slices);
  - `src/lib/**` clients/helpers (Supabase, SQLite, utils);
  - `supabase/functions/**` Edge Functions;
  - `android/**` Capacitor Android.

3. TypeScript
- Use interfaces for props and data models; avoid enums (use maps or union literals).
- Pure functions with `function` keyword; no class-based components.
- Strict typing; prefer `readonly` where possible; narrow unions; no `any`.

4. Syntax & JSX
- Prefer conditional expressions and early returns for clarity.
- Keys stable; fragments over wrapper divs; small, typed hooks.

5. UI & Styling (Shadcn/Radix/Tailwind)
- Compose Shadcn and Radix primitives; style via Tailwind.
- Use `cn` for class merges; avoid inline styles.
- Mobile-first responsive classes; define density/spacing scale; prefer semantic colors.

6. State Management (Zustand)
- Co-locate slices by domain; avoid global monolith stores.
- Derive selectors to reduce re-renders; avoid storing derived state.
- Async actions return typed results; handle errors centrally.

7. Routing & URL State (React Router)
- Route modules under `src/pages`; keep data-fetch in hooks/services.
- Use a typed `useQueryParam` helper built on `useSearchParams` for URL state.

8. Data Access (Supabase + SQLite)
- Supabase: use `@/lib/supabase-client`; never hardcode keys; typed table access.
- SQLite: use service modules; no raw queries in components; validate inputs.
- Offline-first: queue writes, reconcile on connectivity.

9. Edge Functions (Deno)
- Enforce CORS (OPTIONS + allow-list) and typed request/response.
- Use clear modules per function; validate via schema; consistent error shape.

10. Performance
- Minimize `useEffect` and state; lazy-load non-critical components with `React.lazy` + `Suspense`.
- Optimize images: WebP, width/height attributes, `loading="lazy"`.
- Split code by route; prefetch critical assets; avoid blocking work on mount.

11. Testing & Tooling
- ESLint (`eslint.config.js`) for lint; add Vitest for unit tests (planned); colocate `*.test.tsx`.
- Type checks via `tsc --noEmit`; CI uses Netlify build.

12. Security
- No secrets in repo; env via `.env`/Netlify; validate inputs everywhere.
- Principle of least privilege for Supabase policies; no PII logging.

## Example Snippets (will be included in the rules)
- Typed component pattern with interfaces and named exports.
- `cn` usage with Shadcn/Radix component wrapper.
- Lazy + Suspense wrapper for non-critical UI.
- `useQueryParam` typed helper using `useSearchParams`.
- Supabase typed query through centralized client.

## Next Steps
- On approval, I will replace `/.trae/rules/project_rules.md` with the new rules, including the example code blocks and references to our existing paths and utilities (e.g., `@/lib/utils` for `cn`).