# Bouge Project Rules

## Tech Stack
- React + TypeScript (Vite)
- React Router for routing
- Tailwind CSS + Radix UI + Shadcn UI
- Zustand for state management
- Supabase (Postgres, Auth, Realtime, Edge Functions)
- Capacitor Android + local SQLite
- Netlify deployment

## Code Style and Structure
- Prefer functional and declarative programming; avoid classes in UI.
- Use the `function` keyword for pure functions.
- Structure files: exported component, subcomponents, helpers, static content, interfaces.
- Favor iteration and modularization over duplication.
- Use descriptive variable names with auxiliaries: `isLoading`, `hasError`, `shouldRender`.
- Prefer named exports for components and utilities.

### Component Skeleton
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface CardProps { title: string; description?: string; isLoading?: boolean }

export function InfoCard({ title, description, isLoading }: CardProps) {
  return (
    <section className={cn('rounded-lg border p-4', isLoading ? 'opacity-60' : '')} aria-busy={isLoading}>
      <h2 className="text-lg font-medium">{title}</h2>
      {description ? <p className="text-muted-foreground">{description}</p> : null}
    </section>
  )
}
```

## Directories and Naming
- Use lowercase with dashes for directories: `components/auth-wizard`, `components/contacts`, `lib/supabase`, `store/chat-store`.
- Recommended layout:
  - `src/components/**` UI building blocks (Shadcn/Radix wrappers)
  - `src/pages/**` route views
  - `src/store/**` Zustand slices
  - `src/lib/**` clients, helpers (Supabase, SQLite, utils)
  - `supabase/functions/**` Edge Functions (Deno)
  - `android/**` Capacitor Android

## TypeScript Usage
- Use interfaces for props and domain models; avoid enums, use maps or union literals.
- Strict typing; avoid `any`; use `readonly` when possible.
- Compose small typed hooks and helpers; do not place logic in components unnecessarily.

### Interfaces and Helpers
```ts
export interface Profile { id: string; display_name: string }

export function asRecord<T extends string, V>(entries: ReadonlyArray<readonly [T, V]>): Readonly<Record<T, V>> {
  return Object.fromEntries(entries) as Readonly<Record<T, V>>
}
```

## Syntax and Formatting
- Use declarative JSX and early returns for clarity.
- Keep conditions concise; use fragments instead of extraneous wrappers.
- Keys must be stable; avoid array index as key for dynamic lists.

## UI and Styling
- Use Shadcn UI + Radix primitives; style with Tailwind.
- Merge classes via `cn` from `@/lib/utils`.
- Mobile-first responsive design with Tailwind; define spacing and color scales.

### Shadcn/Radix Wrapper Example
```tsx
import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

export interface TooltipContentProps extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> { }

export function TooltipContent({ className, sideOffset = 4, ...props }: TooltipContentProps) {
  return (
    <TooltipPrimitive.Content
      sideOffset={sideOffset}
      className={cn('z-50 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground', className)}
      {...props}
    />
  )
}
```

## Performance Optimization
- Minimize `useEffect` and global state; derive data via selectors.
- Lazy-load non-critical components and wrap client UI in `Suspense` with a fallback.
- Optimize images: WebP format, include `width`/`height`, `loading="lazy"`.
- Split code by route; avoid heavy work on initial mount.

### Lazy and Suspense
```tsx
import * as React from 'react'

const InsightsPanel = React.lazy(() => import('@/components/insights/insights-panel'))

export function Dashboard() {
  return (
    <React.Suspense fallback={<div className="p-4">Loading…</div>}>
      <InsightsPanel />
    </React.Suspense>
  )
}
```

## Routing and URL State (React Router)
- Place route views under `src/pages`; keep data fetching in hooks/services.
- Manage URL search params via a typed helper built on `useSearchParams`.

### `useQueryParam` Helper
```tsx
import { useSearchParams } from 'react-router-dom'

export interface QueryParamOptions<T> { key: string; parse: (v: string | null) => T; serialize: (v: T) => string }

export function useQueryParam<T>({ key, parse, serialize }: QueryParamOptions<T>) {
  const [params, setParams] = useSearchParams()
  const value = parse(params.get(key))
  function setValue(next: T) {
    const copy = new URLSearchParams(params)
    copy.set(key, serialize(next))
    setParams(copy, { replace: true })
  }
  return [value, setValue] as const
}
```

## Data Layer (Supabase + SQLite)
- Supabase: use `@/lib/supabase-client` for all access; never instantiate clients in components.
- SQLite: use service modules; no raw queries in components; validate inputs and outputs.
- Offline-first: queue writes and reconcile when connectivity is restored.

### Supabase Query
```ts
import { supabase } from '@/lib/supabase-client'

export interface GroupSummary { id: string; name: string }

export async function fetchGroups(): Promise<readonly GroupSummary[]> {
  const { data, error } = await supabase.from('groups').select('id,name')
  if (error) throw error
  return data ?? []
}
```

### SQLite Service Pattern
```ts
export interface GroupJoinRequest { id: string; group_id: string; user_id: string; status: 'pending' | 'approved' }

export function listPending(db: { query: (sql: string, params?: unknown[]) => Promise<{ values?: unknown[] }> }): Promise<readonly GroupJoinRequest[]> {
  const sql = 'SELECT id, group_id, user_id, status FROM group_join_requests WHERE status = ?'
  return db.query(sql, ['pending']).then(r => (r.values ?? []) as GroupJoinRequest[])
}
```

## Edge Functions (Deno)
- Implement CORS: handle `OPTIONS`, restrict origins via env, allow auth/content-type headers.
- Use typed request/response shapes and consistent error handling.

### CORS Skeleton
```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const ALLOW = new Set((Deno.env.get('DEV_CORS_ORIGINS') ?? '').split(','))
function cors(origin: string | null) {
  const o = origin && ALLOW.has(origin) ? origin : '*'
  return { 'access-control-allow-origin': o, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' }
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req.headers.get('origin')) })
  return new Response('ok', { headers: cors(req.headers.get('origin')) })
})
```

## State Management (Zustand)
- Organize slices by domain; avoid a single monolithic store.
- Use selectors to scope component subscriptions and minimize re-renders.
- Keep optimistic updates and reconciliation logic in actions/helpers.

## Testing and Tooling
- Lint with ESLint via `eslint.config.js`; fix warnings proactively.
- Type checks via `tsc --noEmit` or `npm run typecheck`.
- Plan: add Vitest for unit tests and colocate `*.test.ts`/`*.test.tsx` near sources.

## Security and Secrets
- Never commit secrets; use `.env` and Netlify env for web, Android keystore for native.
- Validate all inputs; apply RLS/Policies on Supabase; avoid logging PII.

## Deployment
- Netlify builds web SPA (`dist`) via Vite; ensure SPA redirects configured.
- Android built via Gradle under `android/`; keep plugin versions consistent with Capacitor.
