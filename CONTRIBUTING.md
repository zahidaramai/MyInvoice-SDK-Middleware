# Contributing to MyInvois Middleware

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `pnpm install`
3. Run checks: `pnpm ci`

## Development Workflow

- Create a feature branch from `main`
- Make your changes with clear, atomic commits
- Use [Conventional Commits](https://www.conventionalcommits.org/) format:
  - `feat:` new features
  - `fix:` bug fixes
  - `docs:` documentation
  - `refactor:` code changes that neither fix bugs nor add features
  - `test:` adding or updating tests
  - `chore:` maintenance tasks

## Before Submitting a PR

Run all checks locally:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Code Standards

- TypeScript strict mode enabled
- All exports must have types
- Tests required for new functionality
- No secrets or credentials in code (see SECURITY.md)

## Pull Request Process

1. Ensure all CI checks pass
2. Update documentation if needed
3. Request review from maintainers
4. Squash commits on merge

## Questions?

Open a GitHub Discussion or Issue.
