## 1) `.spectral.yaml` (linting policy)

Extends Spectral’s built-in OpenAPI ruleset and adds **gateway-specific** governance rules (v1 path prefix, required `operationId`, required tags, enforced 2xx response, error response consistency, etc.). Spectral supports `extends: spectral:oas` and key-targeting via `field: "@key"`. ([docs.stoplight.io][1])

```yaml
# .spectral.yaml
extends:
  - spectral:oas

rules:
  # --- Tighten a few important defaults ---
  operation-2xx-response:
    description: Every operation MUST define at least one 2xx response.
    severity: error

  operation-operationId:
    description: Every operation MUST have an operationId (client generation + stable contracts).
    severity: error

  operation-tags:
    description: Every operation MUST have at least one tag.
    severity: error

  # --- Gateway conventions (aligned to your spec) ---

  gateway-paths-must-be-versioned:
    description: All API paths MUST be versioned under /v1 (except /healthz, /readyz, /version).
    message: "Path '{{path}}' must start with /v1/ (or be /healthz, /readyz, /version)."
    severity: error
    given: $.paths
    then:
      field: "@key"
      function: pattern
      functionOptions:
        match: "^(/v1/.*|/healthz|/readyz|/version)$"

  gateway-top-level-tags-must-have-descriptions:
    description: All top-level tags MUST have a description.
    severity: error
    given: $.tags[*]
    then:
      field: description
      function: truthy

  gateway-operations-must-define-429:
    description: Every operation MUST define a 429 response (rate limiting is part of gateway contract).
    severity: error
    given: $.paths[*][*].responses
    then:
      field: "429"
      function: truthy

  gateway-components-must-include-correlationid-header:
    description: components.headers MUST define CorrelationId header used across responses.
    severity: error
    given: $.components.headers.CorrelationId
    then:
      field: description
      function: truthy

  gateway-components-must-include-retryafter-header:
    description: components.headers MUST define RetryAfter header used for 429/duplicate/poll throttling.
    severity: error
    given: $.components.headers.RetryAfter
    then:
      field: description
      function: truthy

  gateway-too-many-requests-must-have-retry-after:
    description: TooManyRequests response MUST include Retry-After.
    severity: error
    given: $.components.responses.TooManyRequests.headers
    then:
      field: Retry-After
      function: truthy

  gateway-standard-error-responses-must-reference-components:
    description: Standard error responses SHOULD use component response refs (keeps contract consistent).
    severity: warn
    given:
      - $.paths[*][*].responses.400
      - $.paths[*][*].responses.401
      - $.paths[*][*].responses.403
      - $.paths[*][*].responses.404
      - $.paths[*][*].responses.429
      - $.paths[*][*].responses.500
    then:
      field: "$ref"
      function: pattern
      functionOptions:
        match: "^#/components/responses/"

  gateway-error-envelope-shape-is-stable:
    description: ErrorEnvelope must keep { error: GatewayError } shape.
    severity: error
    given: $.components.schemas.ErrorEnvelope
    then:
      function: schema
      functionOptions:
        schema:
          type: object
          required: [type, properties, required]
          properties:
            type:
              const: object
            required:
              type: array
              contains:
                const: error
            properties:
              type: object
              required: [error]
              properties:
                error:
                  type: object
                  required: [$ref]
                  properties:
                    $ref:
                      const: "#/components/schemas/GatewayError"

  gateway-gatewayerror-required-fields:
    description: GatewayError MUST require httpStatus and messageEN.
    severity: error
    given: $.components.schemas.GatewayError
    then:
      function: schema
      functionOptions:
        schema:
          type: object
          required: [type, required]
          properties:
            type:
              const: object
            required:
              type: array
              allOf:
                - contains: { const: httpStatus }
                - contains: { const: messageEN }
```

---

## 2) `.github/workflows/generate-clients.yml` (lint + SDK generation + PR)

This workflow:

* lints your spec with Spectral CLI (supports custom rulesets) ([docs.stoplight.io][2])
* generates SDKs via **OpenAPI Generator** (client generation from OpenAPI spec) ([GitHub][3])
* uses `actions/setup-node@v4` for the lint step ([GitHub][4])
* opens a PR with regenerated clients (so you don’t get commit-loops)

```yaml
# .github/workflows/generate-clients.yml
name: Lint OpenAPI + Generate Clients

on:
  pull_request:
    paths:
      - "openapi/**"
      - ".spectral.yaml"
      - ".github/workflows/generate-clients.yml"
  push:
    branches: ["main"]
    paths:
      - "openapi/**"
      - ".spectral.yaml"
      - ".github/workflows/generate-clients.yml"

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: sdk-generate-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Spectral lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Lint OpenAPI with Spectral
        run: |
          npx --yes @stoplight/spectral-cli lint openapi/openapi.yaml --ruleset .spectral.yaml

  generate:
    name: Generate SDKs (TS/Python/.NET/Java)
    needs: [lint]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Clean previous generated clients
        run: |
          rm -rf clients/typescript-axios clients/python clients/csharp clients/java
          mkdir -p clients

      - name: Generate TypeScript (axios)
        run: |
          docker run --rm \
            -u "$(id -u)":"$(id -g)" \
            -v "${{ github.workspace }}:/local" \
            openapitools/openapi-generator-cli:v7.18.0 \
            generate \
            -i /local/openapi/openapi.yaml \
            -g typescript-axios \
            -o /local/clients/typescript-axios \
            --global-property apiDocs=false,modelDocs=false,apiTests=false,modelTests=false \
            --additional-properties=\
npmName=@myinvois/gateway-client,\
npmVersion=0.1.0,\
supportsES6=true,\
withSeparateModelsAndApi=true,\
apiPackage=api,\
modelPackage=models

      - name: Generate Python
        run: |
          docker run --rm \
            -u "$(id -u)":"$(id -g)" \
            -v "${{ github.workspace }}:/local" \
            openapitools/openapi-generator-cli:v7.18.0 \
            generate \
            -i /local/openapi/openapi.yaml \
            -g python \
            -o /local/clients/python \
            --global-property apiDocs=false,modelDocs=false,apiTests=false,modelTests=false \
            --additional-properties=\
packageName=myinvois_gateway_client,\
projectName=myinvois-gateway-client,\
packageVersion=0.1.0

      - name: Generate .NET (C#)
        run: |
          docker run --rm \
            -u "$(id -u)":"$(id -g)" \
            -v "${{ github.workspace }}:/local" \
            openapitools/openapi-generator-cli:v7.18.0 \
            generate \
            -i /local/openapi/openapi.yaml \
            -g csharp \
            -o /local/clients/csharp \
            --global-property apiDocs=false,modelDocs=false,apiTests=false,modelTests=false \
            --additional-properties=\
packageName=MyInvois.Gateway.Client,\
targetFramework=net8.0,\
nullableReferenceTypes=true

      - name: Generate Java
        run: |
          docker run --rm \
            -u "$(id -u)":"$(id -g)" \
            -v "${{ github.workspace }}:/local" \
            openapitools/openapi-generator-cli:v7.18.0 \
            generate \
            -i /local/openapi/openapi.yaml \
            -g java \
            --library okhttp-gson \
            -o /local/clients/java \
            --global-property apiDocs=false,modelDocs=false,apiTests=false,modelTests=false \
            --additional-properties=\
groupId=dev.myinvois,\
artifactId=myinvois-gateway-client,\
artifactVersion=0.1.0,\
apiPackage=dev.myinvois.gateway.api,\
modelPackage=dev.myinvois.gateway.model,\
dateLibrary=java8

      - name: Create Pull Request with generated SDKs
        uses: peter-evans/create-pull-request@v6
        with:
          commit-message: "chore(sdk): regenerate clients from OpenAPI"
          title: "chore(sdk): regenerate clients"
          body: |
            Auto-generated SDK updates from openapi/openapi.yaml.
            - TypeScript (axios)
            - Python
            - C# (.NET)
            - Java (okhttp-gson)
          branch: "chore/sdk-regenerate"
          delete-branch: true
          add-paths: |
            clients/**


[1]: https://docs.stoplight.io/docs/spectral/4dec24461f3af-open-api-rules?utm_source=chatgpt.com "OpenAPI Rules | Spectral"
[2]: https://docs.stoplight.io/docs/spectral/9ffa04e052cc1-spectral-cli?utm_source=chatgpt.com "Spectral CLI"
[3]: https://github.com/OpenAPITools/openapi-generator/releases?utm_source=chatgpt.com "Releases · OpenAPITools/openapi-generator"
[4]: https://github.com/actions/setup-node?utm_source=chatgpt.com "actions/setup-node"
