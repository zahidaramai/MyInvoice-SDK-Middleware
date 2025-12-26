Phase 09 focuses on **release engineering + distribution automation**:

* **Deterministic SDK generation** via OpenAPI Generator (Docker) ([OpenAPI Generator][1]), with `hideGenerationTimestamp=true` to avoid “diff churn” in generated clients ([OpenAPI Generator][2])
* **Auto PR for regenerated SDKs** using `peter-evans/create-pull-request` (latest v7.x) ([GitHub][3])
* **Versioning + changelog workflow** using Changesets (pnpm-friendly) ([pnpm][4])
* **Tag-based releases** with GitHub Releases and optional GHCR Docker image publishing ([GitHub][5])
* Note: to let GitHub Actions create PRs/releases reliably, you’ll need correct `GITHUB_TOKEN` permissions and repo settings ([GitHub Docs][6])

```text
PHASE 09 — EXECUTION PROMPT (Claude Code Opus 4.5)
Project: MyInvois Middleware Gateway (OpenAPI-first, Node/TS, OSS)

MISSION
Ship release & distribution automation:
1) Deterministic SDK generation (OpenAPI -> TS/Python/.NET/Java) committed via auto PR
2) Versioning + changelog flow (Changesets) for OSS friendliness
3) Tag-based GitHub Release (attach spec + SDK artifacts)
4) Optional: build/push gateway & worker Docker images to GHCR on tags

SCOPE (WHAT YOU MUST SHIP)
A) SDK Generation (deterministic)
- Generate SDKs from the canonical OpenAPI spec into repo folders:
  /sdks/typescript
  /sdks/python
  /sdks/dotnet
  /sdks/java
- Use OpenAPI Generator via Docker for reproducibility
- Ensure stable output by setting hideGenerationTimestamp=true for all generators
- Add an internal config per generator (json/yaml) so we can tune output later without rewriting workflows
- Add a root script to generate all SDKs locally: pnpm gen:sdk

B) GitHub Action: OpenAPI -> SDK PR
- Workflow triggers:
  - workflow_dispatch (manual)
  - push to main only when OpenAPI spec path changes (paths filter)
- Steps:
  1) checkout
  2) generate SDKs (docker openapi-generator)
  3) run formatting (where appropriate) and ensure no timestamps/churn
  4) create PR with changes (peter-evans/create-pull-request)
- Must avoid infinite loops:
  - Only trigger on spec changes (paths)
  - Generated PR should not modify spec itself

C) Changesets versioning + changelog
- Add changesets tool and initialize config
- Add conventional scripts:
  - pnpm changeset
  - pnpm version-packages (changeset version)
  - pnpm ci:publish (optional; no registry publishing unless tokens exist)
- Add workflow:
  - On push to main: run changesets/action
  - It should open/update a “Version Packages” PR when changesets exist
- This repo can remain OSS-first:
  - If publish secrets are not configured, just create the version PR + changelog
  - If later configured, publish can be enabled

D) Tag-based GitHub Release (+ optional GHCR images)
- Workflow triggers on tags: v*.*.*
- Create GitHub Release and upload assets:
  - OpenAPI spec file(s)
  - zipped SDK folders (or upload as artifacts + attach)
  - optional: checksums file
- Optional GHCR push:
  - Build and push:
    ghcr.io/<owner>/<repo>-gateway:<tag>
    ghcr.io/<owner>/<repo>-worker:<tag>
  - Only if Dockerfiles exist and apps are buildable

E) Docs
- /docs/releasing.md
  - how to create a changeset
  - how version PR works
  - how to cut a release tag
  - how SDK generation PR works
  - required repo settings (GITHUB_TOKEN permissions, allow PR creation)

NON-GOALS
- Publishing SDKs to npm/pypi/nuget/maven in Phase 09 (leave as documented “optional future”)
- Grafana dashboards and deployment manifests (later)

HARD RULES
1) Do NOT change the OpenAPI spec structure unless it is currently invalid.
2) SDK generation must be deterministic: hideGenerationTimestamp=true everywhere.
3) No secrets in repo. Any tokens must be GitHub secrets, not files.
4) No high-cardinality labels in metrics (already Phase 08) — do not introduce in this phase.
5) Workflows must run on GitHub-hosted runners (ubuntu-latest) only.

DEFINITION OF DONE (DoD)
[ ] pnpm -r lint/typecheck/test/build still passes
[ ] pnpm gen:sdk works locally and regenerates all 4 SDKs
[ ] SDK generation workflow opens PR when spec changes (and NO-OPs when no diff)
[ ] Changesets workflow opens/updates version PR when changesets exist
[ ] Tag workflow creates GitHub Release and uploads OpenAPI + SDK artifacts
[ ] (Optional) Tag workflow builds & pushes GHCR images if enabled
[ ] docs/releasing.md is clear and complete

DELIVERABLES (FILES TO CREATE/UPDATE)
1) SDK generation config & scripts
- /openapi/ (or existing folder): locate canonical spec path and standardize it
- /scripts/gen-sdks.sh (or .mjs) — docker-based generator runner
- /openapi-generator/
  - typescript-axios.config.json
  - python.config.json
  - csharp.config.json
  - java.config.json
- /sdks/* generated outputs committed
- package.json scripts:
  - "gen:sdk": "bash ./scripts/gen-sdks.sh"
  - optional: "gen:sdk:clean"

2) GitHub Actions workflows
- /.github/workflows/gen-sdks.yml
  - on: workflow_dispatch + push(main) with paths filter to spec
  - uses: peter-evans/create-pull-request@v7 (pin to latest stable v7.x)
  - ensure permissions: contents: write, pull-requests: write
- /.github/workflows/release.yml
  - on: push tags: v*.*.*
  - uses: softprops/action-gh-release@v2 (pin to v2.x)
  - optional steps for GHCR:
    - docker/login-action@v3 registry ghcr.io
    - docker/build-push-action@v6
  - permissions: contents: write, packages: write

- /.github/workflows/changesets.yml
  - on: push to main
  - uses: changesets/action@v1
  - creates/updates version PR
  - publishing disabled by default unless NODE_AUTH_TOKEN configured

3) Docs
- /docs/releasing.md (new)
- update /README.md:
  - add “SDKs” section
  - add “Release” section
  - add “Automation” section (what runs when)

IMPLEMENTATION DETAILS (YOU MUST FOLLOW)
A) Find canonical OpenAPI spec path
- Search repo for the spec used by gateway (likely /openapi/v1.yaml or similar)
- Define it as OPENAPI_SPEC in scripts and workflows
- Use a single source of truth (no duplicate specs)

B) Docker OpenAPI Generator commands
- Use docker run pattern:
  docker run --rm -v "${PWD}:/local" openapitools/openapi-generator-cli:<PINNED_TAG> generate -i /local/<SPEC> -g <GEN> -o /local/<OUT> --additional-properties=hideGenerationTimestamp=true
- Pin generator tag (avoid floating “latest”):
  - choose a stable v7.x tag present on Docker Hub tags page
- For each SDK, pass generator-specific config via -c /local/openapi-generator/<cfg>

C) Generated SDK hygiene
- Add .gitignore only for transient build artifacts inside SDK folders (e.g., dist, __pycache__)
- Ensure codegen doesn’t embed absolute paths or timestamps
- For TS: prefer typescript-axios generator output as a package with build instructions
- For Python: generate as a pip-installable package skeleton (no publishing)
- For .NET: generate as a project with csproj
- For Java: generate as a gradle/maven project (no publishing)

D) GitHub Action PR creation requirements
- Make sure workflows set permissions explicitly
- Document repo setting: “Allow GitHub Actions to create and approve pull requests”
- If actions cannot create PR, document fallback: use PAT secret (NOT required by default)

EXECUTION ORDER
1) Implement scripts + openapi-generator configs
2) Generate SDKs and commit baseline outputs
3) Add gen-sdks GitHub workflow + verify it would NO-OP on unchanged spec
4) Add Changesets setup + workflow
5) Add tag-based release workflow (+ optional GHCR)
6) Update docs + README

ACCEPTANCE COMMANDS
- pnpm -r lint
- pnpm -r typecheck
- pnpm -r test
- pnpm -r build
- pnpm gen:sdk
- (manual check) git diff should be empty after running pnpm gen:sdk twice

OUTPUT REQUIRED FROM YOU
1) List the discovered canonical OpenAPI spec path
2) List all new/updated files
3) Show key workflow YAMLs and scripts
4) End report: how to cut a release + how SDK PR automation works

Start now.
```

[1]: https://openapi-generator.tech/docs/installation/?utm_source=chatgpt.com "CLI Installation"
[2]: https://openapi-generator.tech/docs/generators/python/?utm_source=chatgpt.com "Documentation for the python Generator"
[3]: https://github.com/peter-evans/create-pull-request/releases?utm_source=chatgpt.com "Releases · peter-evans/create-pull-request"
[4]: https://pnpm.io/next/using-changesets?utm_source=chatgpt.com "Using Changesets with pnpm"
[5]: https://github.com/softprops/action-gh-release?utm_source=chatgpt.com "softprops/action-gh-release"
[6]: https://docs.github.com/actions/security-guides/automatic-token-authentication?utm_source=chatgpt.com "Use GITHUB_TOKEN for authentication in workflows"
