PROMPT FILE: /prompts/promptPhase00_Bootstrap.md
TARGET MODEL: Claude Code Opus 4.5
PHASE: 00 — Bootstrap & Governance (FILTER-PROOF)

========================
0) SHORT PRD (PHASE 00)
========================
Goal:
- Create a clean pnpm monorepo skeleton + OSS governance + CI baseline.
- IMPORTANT: Do NOT generate or print standardized template text (LICENSE/Code of Conduct). Create them via commands instead.

Reason:
- Claude Code can be blocked when asked to reproduce standard legal templates like LICENSE or Contributor Covenant.
- We will fetch those templates via trusted sources (GitHub Licenses API / Contributor Covenant official formats).

Success criteria:
- pnpm workspace boots; lint/typecheck/test/build scripts all pass
- governance files exist (MIT license + contributor covenant), but created via commands (no model-generated template blocks)
- docker compose skeleton includes postgres + redis
- CI workflow runs pnpm ci
- README has getting started

========================
1) AGENT RULES
========================
- Assume fresh repo unless files exist.
- Keep dependencies minimal.
- Do NOT generate or print large standardized documents (LICENSE, Code of Conduct, etc.). Use commands to fetch/create them.
- Do NOT add secrets.
- Ensure pnpm scripts succeed on clean clone.

========================
2) DoD
========================
[ ] pnpm install works
[ ] pnpm -r lint passes
[ ] pnpm -r typecheck passes
[ ] pnpm -r test passes (at least one trivial test in each workspace)
[ ] pnpm -r build passes
[ ] docker compose up for postgres+redis works
[ ] LICENSE exists (MIT) created via command, with placeholders replaced
[ ] CODE_OF_CONDUCT.md exists created via command, with INSERT CONTACT METHOD replaced
[ ] CONTRIBUTING.md, SECURITY.md, DISCLAIMER.md written (original text, not copied templates)
[ ] CI workflow runs pnpm ci

========================
3) REQUIRED STRUCTURE
========================
Create:
- pnpm-workspace.yaml (packages: apps/*, packages/*)
- apps/gateway, apps/worker
- packages/core, packages/myinvois-client, packages/storage, packages/contracts (placeholders)
- openapi/.gitkeep, docs/, docker/, .github/workflows/

Root tooling:
- tsconfig.base.json
- eslint + prettier
- vitest
- README.md
- .env.example (no secrets)

========================
4) GOVERNANCE FILES (FILTER-PROOF CREATION)
========================
A) MIT LICENSE
- Use GitHub Licenses API to fetch MIT text, then replace placeholders (year/fullname).
  GitHub provides license retrieval endpoints. (No model output of license text.)

Commands:
1) Fetch MIT license body -> LICENSE
   curl -fsSL https://api.github.com/licenses/mit | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);process.stdout.write(j.body);});" > LICENSE

2) Replace placeholders in LICENSE:
   node -e "const fs=require('fs');let t=fs.readFileSync('LICENSE','utf8');const year=String(new Date().getFullYear());const name='YOUR_NAME_OR_ORG';t=t.replace(/\[year\]|\<year\>/g,year).replace(/\[fullname\]|\<copyright holders\>/g,name);fs.writeFileSync('LICENSE',t);"

Note: ChooseALicense notes you should replace [year] and [fullname]. (Do not print license text in output.)

B) CODE_OF_CONDUCT.md
- Fetch Contributor Covenant 2.1 text/plain and store as CODE_OF_CONDUCT.md (no model output of full text).
Commands:
1) curl -fsSL https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.txt -o CODE_OF_CONDUCT.md
2) Replace [INSERT CONTACT METHOD] with a repo-appropriate contact line:
   node -e "const fs=require('fs');let t=fs.readFileSync('CODE_OF_CONDUCT.md','utf8');t=t.replace('[INSERT CONTACT METHOD]','Open a GitHub Security Advisory or email the maintainers (see SECURITY.md).');fs.writeFileSync('CODE_OF_CONDUCT.md',t);"

C) Other governance docs
- Write original, short docs (not copied templates):
  - CONTRIBUTING.md
  - SECURITY.md
  - DISCLAIMER.md

========================
5) IMPLEMENTATION TASKS
========================
Step A — pnpm monorepo
- Create pnpm-workspace.yaml
- Root package.json (private: true) with scripts:
  - lint, typecheck, test, build, format, ci
- engines node >=20 (recommend Node 22 in README)

Step B — tooling
- typescript base config + per package tsconfig
- eslint + prettier + vitest
- ensure scripts work recursively

Step C — workspaces placeholders
- Each app/package must have:
  - package.json with lint/typecheck/test/build
  - src/index.ts exporting a trivial function
  - a trivial vitest test

Step D — docker skeleton
- docker/docker-compose.yml with postgres + redis + volumes

Step E — CI
- .github/workflows/ci.yml runs:
  - checkout
  - setup-node
  - enable pnpm
  - pnpm install
  - pnpm ci

Step F — README
- Getting Started commands
- Repo structure overview

========================
6) ACCEPTANCE COMMANDS
========================
- pnpm install
- pnpm ci
- docker compose -f docker/docker-compose.yml up -d
- docker compose -f docker/docker-compose.yml ps

========================
7) FINAL REPORT (MANDATORY)
========================
At the end, output:
- Created/updated files (grouped)
- Exact commands to run
- What to do next in Phase 01

========================
NOW EXECUTE PHASE 00
========================
Proceed to implement everything. Do not print the full LICENSE or CODE_OF_CONDUCT contents in the output—only confirm creation and edits.
