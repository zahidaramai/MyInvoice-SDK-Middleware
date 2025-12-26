This **OpenAPI v1 draft** is designed to make MyInvois integration “boring” for adopters by baking in the hard parts: **token reuse (~3600s), safe submission (100 RPM), submission monitoring via Get Submission polling (3–5s; 300 RPM), standard error shape + correlationId, duplicate submission Retry-After**, and intermediary “on behalf of” login semantics. ([MyInvois SDK][1])

```yaml
openapi: 3.0.3
info:
  title: MyInvois Open Middleware Gateway API
  version: 0.1.0
  description: >
    OpenAPI-first gateway that simplifies integration to Malaysia LHDN MyInvois (API v1.0).
    This gateway is intended to be self-hosted (Docker/K8s) and provides:
    - Session-based upstream auth (taxpayer or intermediary mode) with token caching/renewal
    - Document submission orchestration and safe polling workflow
    - Normalized error model (including correlationId and Retry-After)
    - Optional persistence (trackingId) and background polling worker

    NOTE: This API does NOT provide legal/tax advice. It is an unofficial OSS integration helper.
  contact:
    name: Maintainers
    url: https://github.com/<your-org>/<repo>
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT

servers:
  - url: http://localhost:8787
    description: Local dev
  - url: https://gateway.example.com
    description: Production (self-hosted)

tags:
  - name: Sessions
    description: Create and manage gateway sessions (upstream auth contexts)
  - name: Submissions
    description: Submit documents and track submission status
  - name: Documents
    description: Document state actions (cancel/reject) and optional details retrieval
  - name: Taxpayer
    description: Buyer/TIN utilities
  - name: Health
    description: Health and version endpoints

paths:
  /healthz:
    get:
      tags: [Health]
      summary: Liveness probe
      operationId: getHealthz
      responses:
        "200":
          description: Service is alive
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/HealthResponse"

  /readyz:
    get:
      tags: [Health]
      summary: Readiness probe
      operationId: getReadyz
      responses:
        "200":
          description: Service is ready
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ReadyResponse"
        "503":
          description: Service not ready
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /version:
    get:
      tags: [Health]
      summary: Build/version info
      operationId: getVersion
      responses:
        "200":
          description: Version info
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/VersionResponse"

  /v1/sessions:
    post:
      tags: [Sessions]
      summary: Create a gateway session (upstream auth context)
      description: >
        Creates a session that holds the upstream credential context (env + mode),
        and primes token caching/renewal for MyInvois Identity Service.
        Session secrets should never be logged by the gateway.
      operationId: createSession
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SessionCreateRequest"
            examples:
              taxpayerSandbox:
                summary: Taxpayer mode (Sandbox)
                value:
                  env: SANDBOX
                  mode: TAXPAYER
                  clientId: "your-client-id"
                  clientSecret: "your-client-secret"
              intermediarySandbox:
                summary: Intermediary mode (Sandbox)
                value:
                  env: SANDBOX
                  mode: INTERMEDIARY
                  clientId: "your-client-id"
                  clientSecret: "your-client-secret"
                  onBehalfOf: "IG12345678912:201901234567"
      responses:
        "201":
          description: Session created
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SessionResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "429":
          $ref: "#/components/responses/TooManyRequests"
        "500":
          $ref: "#/components/responses/InternalError"

  /v1/sessions/{sessionId}:
    get:
      tags: [Sessions]
      summary: Get session metadata
      operationId: getSession
      parameters:
        - $ref: "#/components/parameters/SessionId"
      responses:
        "200":
          description: Session metadata
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SessionResponse"
        "404":
          $ref: "#/components/responses/NotFound"
        "500":
          $ref: "#/components/responses/InternalError"
    delete:
      tags: [Sessions]
      summary: Delete a session (clears cached token & metadata)
      operationId: deleteSession
      parameters:
        - $ref: "#/components/parameters/SessionId"
      responses:
        "204":
          description: Session deleted
        "404":
          $ref: "#/components/responses/NotFound"
        "500":
          $ref: "#/components/responses/InternalError"

  /v1/submissions:
    post:
      tags: [Submissions]
      summary: Submit one or more e-Invoice documents (gateway orchestrated)
      description: >
        Submits documents to MyInvois and returns:
        - trackingId (gateway)
        - submissionUid (MyInvois)
        - accepted/rejected docs for immediate sync validation results

        The gateway can accept raw XML/JSON (it will compute base64 + sha256 hash),
        or accept already-prepared (documentBase64 + documentHashSha256).
      operationId: createSubmission
      parameters:
        - name: Idempotency-Key
          in: header
          required: false
          description: Optional idempotency key for gateway-side dedupe.
          schema:
            type: string
            maxLength: 128
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SubmissionCreateRequest"
            examples:
              submitRawJson:
                summary: Submit one JSON doc (raw)
                value:
                  sessionId: "sess_abc123"
                  documents:
                    - format: JSON
                      codeNumber: "INV-10001"
                      rawDocument: "{\"Invoice\": {\"...\": \"...\"}}"
                  autoMinify: true
                  asyncPolling: true
              submitPrepared:
                summary: Submit one doc (prepared fields)
                value:
                  sessionId: "sess_abc123"
                  documents:
                    - format: XML
                      codeNumber: "INV-10002"
                      documentBase64: "PD94bWwgdmVyc2lvbj0iMS4wIj8+..."
                      documentHashSha256: "a4c31c..."
      responses:
        "202":
          description: Accepted (async validation continues upstream)
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
            Retry-After:
              $ref: "#/components/headers/RetryAfter"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SubmissionCreateResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "422":
          description: Unprocessable Entity (e.g., duplicate submission)
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
            Retry-After:
              $ref: "#/components/headers/RetryAfter"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "429":
          $ref: "#/components/responses/TooManyRequests"
        "500":
          $ref: "#/components/responses/InternalError"

  /v1/submissions/{trackingId}:
    get:
      tags: [Submissions]
      summary: Get submission status by trackingId
      description: >
        Returns normalized submission status from gateway storage. Implementations may:
        - return cached status, or
        - optionally poll upstream if staleness threshold exceeded (still enforcing safe polling)
      operationId: getSubmissionStatus
      parameters:
        - $ref: "#/components/parameters/TrackingId"
        - name: refresh
          in: query
          required: false
          description: If true, gateway may attempt a safe upstream refresh (rate-limit aware).
          schema:
            type: boolean
            default: false
      responses:
        "200":
          description: Submission status
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SubmissionStatusResponse"
        "404":
          $ref: "#/components/responses/NotFound"
        "429":
          $ref: "#/components/responses/TooManyRequests"
        "500":
          $ref: "#/components/responses/InternalError"

  /v1/submissions/{trackingId}/poll:
    post:
      tags: [Submissions]
      summary: Trigger an immediate poll cycle (rate-limit aware)
      description: >
        Triggers a poll of the upstream "Get Submission" for the linked submissionUid.
        Gateway should enforce a safe polling interval (e.g., 3–5 seconds) and a max RPM policy.
      operationId: pollSubmission
      parameters:
        - $ref: "#/components/parameters/TrackingId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PollRequest"
      responses:
        "200":
          description: Updated submission status
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SubmissionStatusResponse"
        "409":
          description: Poll skipped due to enforced minimum interval (try later)
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
            Retry-After:
              $ref: "#/components/headers/RetryAfter"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "404":
          $ref: "#/components/responses/NotFound"
        "429":
          $ref: "#/components/responses/TooManyRequests"
        "500":
          $ref: "#/components/responses/InternalError"

  /v1/documents/{uuid}/cancel:
    post:
      tags: [Documents]
      summary: Cancel a document by UUID
      description: >
        Requests cancel of a previously issued document.
        Gateway maps to upstream document state change API and returns normalized status.
      operationId: cancelDocument
      parameters:
        - $ref: "#/components/parameters/DocumentUuid"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/DocumentStateChangeRequest"
            examples:
              cancel:
                value:
                  sessionId: "sess_abc123"
                  reason: "Wrong buyer details"
      responses:
        "200":
          description: State change requested
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DocumentStateChangeResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "429":
          $ref: "#/components/responses/TooManyRequests"
        "500":
          $ref: "#/components/responses/InternalError"

  /v1/documents/{uuid}/reject:
    post:
      tags: [Documents]
      summary: Reject a document by UUID
      description: >
        Requests rejection of a document (buyer-initiated rejection workflow),
        gateway maps to upstream document state change API.
      operationId: rejectDocument
      parameters:
        - $ref: "#/components/parameters/DocumentUuid"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/DocumentStateChangeRequest"
            examples:
              reject:
                value:
                  sessionId: "sess_abc123"
                  reason: "Wrong invoice details"
      responses:
        "200":
          description: State change requested
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DocumentStateChangeResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "429":
          $ref: "#/components/responses/TooManyRequests"
        "500":
          $ref: "#/components/responses/InternalError"

  /v1/documents/{uuid}/details:
    get:
      tags: [Documents]
      summary: Get document details (optional proxy)
      description: >
        Optional proxy for upstream "Get Document Details".
        Intended for retrieving error details for invalid docs, not for monitoring status.
      operationId: getDocumentDetails
      parameters:
        - $ref: "#/components/parameters/DocumentUuid"
        - $ref: "#/components/parameters/SessionIdQuery"
      responses:
        "200":
          description: Document details (normalized minimal view)
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DocumentDetailsResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "429":
          $ref: "#/components/responses/TooManyRequests"
        "500":
          $ref: "#/components/responses/InternalError"

  /v1/tin/validate:
    get:
      tags: [Taxpayer]
      summary: Validate buyer TIN with ID type/value
      description: >
        Validates a TIN + ID combination.
        Gateway should cache positive validations to reduce upstream load.
        Upstream semantics typically: 200 = valid, 404 = invalid.
      operationId: validateTin
      parameters:
        - $ref: "#/components/parameters/SessionIdQuery"
        - name: tin
          in: query
          required: true
          schema:
            type: string
            minLength: 3
            maxLength: 20
          description: Tax Identification Number (TIN)
        - name: idType
          in: query
          required: true
          schema:
            $ref: "#/components/schemas/IdType"
        - name: idValue
          in: query
          required: true
          schema:
            type: string
            minLength: 1
            maxLength: 64
      responses:
        "200":
          description: Valid TIN + ID combination
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/TinValidateResponse"
              examples:
                valid:
                  value:
                    tin: "C25845632020"
                    idType: "BRN"
                    idValue: "201901234567"
                    valid: true
                    cached: true
        "404":
          description: Invalid TIN + ID combination
          headers:
            correlationId:
              $ref: "#/components/headers/CorrelationId"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/TinValidateResponse"
              examples:
                invalid:
                  value:
                    tin: "C25845632020"
                    idType: "BRN"
                    idValue: "201901234567"
                    valid: false
                    cached: false
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "429":
          $ref: "#/components/responses/TooManyRequests"
        "500":
          $ref: "#/components/responses/InternalError"

components:
  headers:
    CorrelationId:
      description: Correlation identifier from upstream or gateway (useful for support/debug)
      schema:
        type: string
        maxLength: 128
    RetryAfter:
      description: Seconds to wait before retrying (rate-limit or duplicate submission guidance)
      schema:
        type: integer
        minimum: 0

  parameters:
    SessionId:
      name: sessionId
      in: path
      required: true
      schema:
        type: string
        pattern: "^sess_[A-Za-z0-9_-]{8,64}$"
    SessionIdQuery:
      name: sessionId
      in: query
      required: true
      schema:
        type: string
        pattern: "^sess_[A-Za-z0-9_-]{8,64}$"
      description: Gateway session ID
    TrackingId:
      name: trackingId
      in: path
      required: true
      schema:
        type: string
        pattern: "^trk_[A-Za-z0-9_-]{8,64}$"
    DocumentUuid:
      name: uuid
      in: path
      required: true
      schema:
        type: string
        description: MyInvois document UUID (26 alphanumeric)
        pattern: "^[A-Za-z0-9]{26}$"

  responses:
    BadRequest:
      description: Bad request (validation error)
      headers:
        correlationId:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorEnvelope"
    Unauthorized:
      description: Unauthorized (invalid/expired upstream token or session)
      headers:
        correlationId:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorEnvelope"
    Forbidden:
      description: Forbidden (not permitted for this session context)
      headers:
        correlationId:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorEnvelope"
    NotFound:
      description: Not found
      headers:
        correlationId:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorEnvelope"
    TooManyRequests:
      description: Too many requests (rate limited)
      headers:
        correlationId:
          $ref: "#/components/headers/CorrelationId"
        Retry-After:
          $ref: "#/components/headers/RetryAfter"
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorEnvelope"
    InternalError:
      description: Internal server error
      headers:
        correlationId:
          $ref: "#/components/headers/CorrelationId"
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorEnvelope"

  schemas:
    Environment:
      type: string
      enum: [PROD, SANDBOX]

    Mode:
      type: string
      enum: [TAXPAYER, INTERMEDIARY]

    IdType:
      type: string
      enum: [NRIC, PASSPORT, BRN, ARMY]

    HealthResponse:
      type: object
      required: [ok]
      properties:
        ok:
          type: boolean
          example: true

    ReadyResponse:
      type: object
      required: [ready]
      properties:
        ready:
          type: boolean
          example: true
        checks:
          type: object
          additionalProperties: true
          example:
            db: true
            redis: true
            worker: true

    VersionResponse:
      type: object
      required: [name, version]
      properties:
        name:
          type: string
          example: myinvois-middleware
        version:
          type: string
          example: 0.1.0
        commitSha:
          type: string
          nullable: true
          example: "a1b2c3d4"
        buildTime:
          type: string
          format: date-time
          nullable: true

    SessionCreateRequest:
      type: object
      required: [env, mode, clientId, clientSecret]
      properties:
        env:
          $ref: "#/components/schemas/Environment"
        mode:
          $ref: "#/components/schemas/Mode"
        clientId:
          type: string
          minLength: 3
          maxLength: 200
        clientSecret:
          type: string
          minLength: 3
          maxLength: 500
        onBehalfOf:
          type: string
          minLength: 3
          maxLength: 64
          description: >
            Required when mode=INTERMEDIARY. Either TIN, or TIN:ROB format.
      allOf:
        - if:
            properties:
              mode:
                const: INTERMEDIARY
          then:
            required: [onBehalfOf]

    SessionResponse:
      type: object
      required: [id, env, mode, createdAt]
      properties:
        id:
          type: string
          pattern: "^sess_[A-Za-z0-9_-]{8,64}$"
        env:
          $ref: "#/components/schemas/Environment"
        mode:
          $ref: "#/components/schemas/Mode"
        onBehalfOf:
          type: string
          nullable: true
        createdAt:
          type: string
          format: date-time
        expiresAt:
          type: string
          format: date-time
          nullable: true
          description: Optional gateway-managed session expiration

    SubmissionCreateRequest:
      type: object
      required: [sessionId, documents]
      properties:
        sessionId:
          type: string
          pattern: "^sess_[A-Za-z0-9_-]{8,64}$"
        documents:
          type: array
          minItems: 1
          maxItems: 100
          items:
            $ref: "#/components/schemas/SubmitDocumentInput"
        autoMinify:
          type: boolean
          default: true
          description: Remove whitespace/minify raw XML/JSON before hashing/base64
        asyncPolling:
          type: boolean
          default: true
          description: If true, schedules background polling worker for submission status
        desiredPollingIntervalSeconds:
          type: integer
          minimum: 3
          maximum: 30
          default: 5
          description: Desired polling interval; gateway enforces safe minimums
        metadata:
          type: object
          additionalProperties: true
          description: Optional caller metadata (tenantId, outletId, etc.)

    SubmitDocumentInput:
      description: One document in a submission (raw OR prepared fields).
      oneOf:
        - $ref: "#/components/schemas/SubmitDocumentRaw"
        - $ref: "#/components/schemas/SubmitDocumentPrepared"
      discriminator:
        propertyName: payloadMode
        mapping:
          RAW: "#/components/schemas/SubmitDocumentRaw"
          PREPARED: "#/components/schemas/SubmitDocumentPrepared"

    SubmitDocumentCommon:
      type: object
      required: [format, codeNumber]
      properties:
        format:
          type: string
          enum: [XML, JSON]
        codeNumber:
          type: string
          minLength: 1
          maxLength: 50
          description: Supplier internal document reference (max 50 chars recommended)
        payloadMode:
          type: string
          enum: [RAW, PREPARED]

    SubmitDocumentRaw:
      allOf:
        - $ref: "#/components/schemas/SubmitDocumentCommon"
        - type: object
          required: [payloadMode, rawDocument]
          properties:
            payloadMode:
              type: string
              enum: [RAW]
            rawDocument:
              type: string
              minLength: 1
              maxLength: 2000000
              description: Raw XML/JSON document string

    SubmitDocumentPrepared:
      allOf:
        - $ref: "#/components/schemas/SubmitDocumentCommon"
        - type: object
          required: [payloadMode, documentBase64, documentHashSha256]
          properties:
            payloadMode:
              type: string
              enum: [PREPARED]
            documentBase64:
              type: string
              minLength: 1
              description: Base64-encoded XML/JSON payload
            documentHashSha256:
              type: string
              minLength: 32
              maxLength: 128
              description: SHA-256 hash (hex or base64) of original document

    SubmissionCreateResponse:
      type: object
      required: [trackingId, submissionUid, acceptedDocuments, rejectedDocuments]
      properties:
        trackingId:
          type: string
          pattern: "^trk_[A-Za-z0-9_-]{8,64}$"
        submissionUid:
          type: string
          pattern: "^[A-Za-z0-9]{26}$"
          description: MyInvois submission UID (26 alphanumeric)
        acceptedDocuments:
          type: array
          items:
            $ref: "#/components/schemas/AcceptedDocument"
        rejectedDocuments:
          type: array
          items:
            $ref: "#/components/schemas/RejectedDocument"
        queuedPolling:
          type: boolean
          example: true
        createdAt:
          type: string
          format: date-time

    AcceptedDocument:
      type: object
      required: [codeNumber, uuid]
      properties:
        codeNumber:
          type: string
          maxLength: 50
        uuid:
          type: string
          pattern: "^[A-Za-z0-9]{26}$"
        initialStatus:
          type: string
          nullable: true
          description: Optional initial sync status

    RejectedDocument:
      type: object
      required: [codeNumber, error]
      properties:
        codeNumber:
          type: string
          maxLength: 50
        error:
          $ref: "#/components/schemas/GatewayError"

    SubmissionStatusResponse:
      type: object
      required: [trackingId, submissionUid, status, documents, updatedAt]
      properties:
        trackingId:
          type: string
          pattern: "^trk_[A-Za-z0-9_-]{8,64}$"
        submissionUid:
          type: string
          pattern: "^[A-Za-z0-9]{26}$"
        status:
          type: string
          description: Normalized submission status (gateway-defined)
          example: PROCESSING
        upstreamStatus:
          type: string
          nullable: true
          description: Optional raw upstream status (if stored)
        documents:
          type: array
          items:
            $ref: "#/components/schemas/SubmissionDocumentStatus"
        lastPolledAt:
          type: string
          format: date-time
          nullable: true
        updatedAt:
          type: string
          format: date-time
        lastError:
          $ref: "#/components/schemas/GatewayError"
          nullable: true

    SubmissionDocumentStatus:
      type: object
      required: [codeNumber]
      properties:
        codeNumber:
          type: string
          maxLength: 50
        uuid:
          type: string
          nullable: true
          pattern: "^[A-Za-z0-9]{26}$"
        status:
          type: string
          nullable: true
          description: Document status (gateway-defined or upstream)
        statusReason:
          type: string
          nullable: true
        validatedAt:
          type: string
          format: date-time
          nullable: true
        errors:
          type: array
          items:
            $ref: "#/components/schemas/GatewayError"

    PollRequest:
      type: object
      required: [sessionId]
      properties:
        sessionId:
          type: string
          pattern: "^sess_[A-Za-z0-9_-]{8,64}$"
        force:
          type: boolean
          default: false
          description: If true, bypass staleness checks (still enforces hard rate limits)

    DocumentStateChangeRequest:
      type: object
      required: [sessionId, reason]
      properties:
        sessionId:
          type: string
          pattern: "^sess_[A-Za-z0-9_-]{8,64}$"
        reason:
          type: string
          minLength: 1
          maxLength: 500

    DocumentStateChangeResponse:
      type: object
      required: [uuid, requestedState, updatedAt]
      properties:
        uuid:
          type: string
          pattern: "^[A-Za-z0-9]{26}$"
        requestedState:
          type: string
          enum: [CANCELLED, REJECTED]
        upstreamState:
          type: string
          nullable: true
        updatedAt:
          type: string
          format: date-time

    DocumentDetailsResponse:
      type: object
      required: [uuid]
      properties:
        uuid:
          type: string
          pattern: "^[A-Za-z0-9]{26}$"
        status:
          type: string
          nullable: true
        validationResults:
          type: object
          nullable: true
          additionalProperties: true
        raw:
          type: object
          nullable: true
          additionalProperties: true
          description: Optional raw upstream payload (may be disabled for privacy/perf)

    TinValidateResponse:
      type: object
      required: [tin, idType, idValue, valid, cached]
      properties:
        tin:
          type: string
        idType:
          $ref: "#/components/schemas/IdType"
        idValue:
          type: string
        valid:
          type: boolean
        cached:
          type: boolean
        checkedAt:
          type: string
          format: date-time
          nullable: true

    ErrorEnvelope:
      type: object
      required: [error]
      properties:
        error:
          $ref: "#/components/schemas/GatewayError"

    GatewayError:
      type: object
      required: [httpStatus, messageEN]
      properties:
        correlationId:
          type: string
          nullable: true
          description: Correlation ID from upstream or gateway
        httpStatus:
          type: integer
          minimum: 100
          maximum: 599
        errorCode:
          type: string
          nullable: true
        propertyName:
          type: string
          nullable: true
        propertyPath:
          type: string
          nullable: true
        target:
          type: string
          nullable: true
        messageEN:
          type: string
        messageMS:
          type: string
          nullable: true
        inner:
          type: array
          nullable: true
          items:
            $ref: "#/components/schemas/GatewayError"
        retryAfterSeconds:
          type: integer
          nullable: true
          minimum: 0
        upstream:
          type: object
          nullable: true
          properties:
            service:
              type: string
              enum: [MYINVOIS]
            path:
              type: string
            method:
              type: string
            status:
              type: integer
              nullable: true


[1]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/02-submit-documents/ "Submit Documents"
