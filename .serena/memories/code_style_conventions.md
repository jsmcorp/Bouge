# Code Style and Conventions - Confessr

## TypeScript Configuration
- Strict TypeScript configuration with `tsconfig.json`
- Base URL configured with `@` alias pointing to `./src`
- Modern ES2020+ target

## Styling Conventions
- **Dark theme first** design approach
- Tailwind CSS with custom design tokens
- shadcn/ui component library as base
- 8px spacing system throughout
- CSS variables for theming (HSL colors)
- Custom animations defined in tailwind.config.js

## Component Patterns
- Functional components with TypeScript
- Consistent file naming: PascalCase for components
- shadcn/ui components in `src/components/ui/`
- Feature-specific components organized in subdirectories
- Custom hooks in `src/hooks/`

## State Management
- Zustand for global state management
- Stores organized in `src/store/`
- Persistent state with browser storage
- Optimistic updates with rollback capability

## Code Organization
```
src/
├── components/          # Reusable UI components
│   ├── ui/             # shadcn/ui components
│   ├── chat/           # Chat-related components
│   └── dashboard/      # Dashboard components
├── pages/              # Route components
├── store/              # Zustand stores
├── lib/                # Utilities and services
└── hooks/              # Custom React hooks
```

## Linting and Formatting
- ESLint with TypeScript and React hooks rules
- Standard ESLint configuration
- No explicit prettier configuration (uses ESLint)

## Import Organization
- Absolute imports using `@/` alias
- Grouped imports: React, third-party, local components, utilities
- No trailing semicolons (based on observed code)

## Naming Conventions
- Components: PascalCase (e.g., `ChatInput.tsx`)
- Functions/hooks: camelCase (e.g., `useMediaQuery`)
- Constants: UPPER_CASE for environment variables
- Files: kebab-case for non-components, PascalCase for components