# Troubleshooting Guide

This document explains the error codes returned by the MyInvois Middleware Gateway and how to handle them.

## Understanding MyInvois Validation

When you submit documents to MyInvois, they go through a validation pipeline with multiple steps. Each step validates specific aspects of your document:

```
Step03 → Step04 → Step05 → Step06 → Step07 → Result
  │         │        │        │        │
  ▼         ▼        ▼        ▼        ▼
Duplicate  Code   Taxpayer Document Totals
Check     Fields  Profile  Refs     Check
```

If any step fails, the document is marked `Invalid` and processing stops. The middleware normalizes these validation results into consistent error codes.

## How to Read Errors

All error responses follow a consistent structure called the **ErrorEnvelope**. When you receive a 4xx or 5xx response, the body will contain:

```json
{
  "error": {
    "code": "INVALID_TAXPAYER",
    "message": "Buyer TIN is invalid. Kindly use the Search TIN function to get the correct TIN",
    "httpStatus": 400,
    "retryable": false,
    "upstream": {
      "source": "MYINVOIS",
      "status": 200,
      "errorCode": "ERR406",
      "errorName": "Step05-Taxpayer Profile Validator"
    },
    "field": "CustomerTin",
    "propertyPath": "document.Invoice.AccountingCustomerParty.Party.PartyIdentification.ID",
    "correlationId": "req_abc123xyz"
  }
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `code` | Machine-readable error code. Use this for programmatic error handling. |
| `message` | Human-readable message in English. Safe to display to users. |
| `httpStatus` | HTTP status code returned. |
| `retryable` | `true` if the client should retry, `false` if the error is permanent. |
| `upstream` | Context about the original MyInvois error (if applicable). |
| `upstream.errorCode` | MyInvois error code (e.g., ERR406, ERR003). |
| `upstream.errorName` | MyInvois validation step name. |
| `field` | Field name that caused the error. |
| `propertyPath` | Full JSON path to the problematic field. |
| `correlationId` | Unique ID for tracking this request in logs. |

## MyInvois Validation Step Reference

| Step | Validator Name | Middleware Code | MyInvois Error |
|------|----------------|-----------------|----------------|
| Step03 | Duplicated Submission Validator | `DUPLICATE_SUBMISSION` | ERR003 |
| Step04 | Code Field Validator | `INVALID_DOCUMENT_STRUCTURE` | ERR044 |
| Step05 | Taxpayer Profile Validator | `INVALID_TAXPAYER` | ERR406 |
| Step06 | Document References Validator | `INVALID_DOCUMENT_RELATION` | ERR050 |
| Step07 | Amount/Totals Validator | `INVALID_TOTALS` | ERR045 |

## Error Code Reference

### Business Validation Errors

These errors indicate problems with the document data. They are **not retryable** - you must fix the data and resubmit.

#### DUPLICATE_SUBMISSION
- **HTTP Status**: 409 Conflict
- **Retryable**: No
- **MyInvois Step**: Step03-Duplicated Submission Validator
- **MyInvois Error Code**: ERR003
- **Description**: This document has already been submitted to MyInvois.
- **Action**: Each invoice can only be submitted once. If you need to correct an invoice, cancel the original and submit a new one.

#### INVALID_TAXPAYER
- **HTTP Status**: 400 Bad Request
- **Retryable**: No
- **MyInvois Step**: Step05-Taxpayer Profile Validator
- **MyInvois Error Codes**: ERR406, ERR045
- **Description**: The TIN (Tax Identification Number) is invalid or not found.
- **Common Messages**:
  - "Buyer TIN is invalid. Kindly use the Search TIN function to get the correct TIN"
  - "TIN pembeli tidak sah. Sila gunakan fungsi Carian TIN untuk mendapatkan TIN yang betul" (Malay)
- **Action**:
  1. Verify the TIN format is correct (e.g., C12345678901 for company, IG12345678901 for individual)
  2. Use the TIN validation endpoint (`GET /v1/tin/validate`) to check before submitting
  3. Ensure the buyer/seller TIN is registered with LHDN
  4. Check the `propertyPath` field to identify which TIN failed (e.g., `CustomerTin` for buyer)

#### INVALID_TOTALS
- **HTTP Status**: 400 Bad Request
- **Retryable**: No
- **MyInvois Step**: Step07-Amount/Totals Validator
- **MyInvois Error Code**: ERR045
- **Description**: Invoice totals don't match the sum of line items.
- **Action**: Recalculate line totals, taxes, and final amounts. Ensure all monetary values are consistent.

#### INVALID_DOCUMENT_RELATION
- **HTTP Status**: 400 Bad Request
- **Retryable**: No
- **MyInvois Step**: Step06-Document References Validator
- **MyInvois Error Code**: ERR050
- **Description**: Credit notes or debit notes must reference a valid original invoice.
- **Action**: Include the correct BillingReference pointing to an existing valid invoice.

#### INVALID_DOCUMENT_STRUCTURE
- **HTTP Status**: 400 Bad Request
- **Retryable**: No
- **MyInvois Step**: Step04-Code Field Validator
- **MyInvois Error Code**: ERR044
- **Description**: The document format is invalid or missing required fields.
- **Action**: Check the UBL 2.1 schema requirements. Common issues:
  - Missing InvoiceTypeCode
  - Invalid date formats
  - Missing mandatory fields

#### DOCUMENT_VALIDATION_FAILED
- **HTTP Status**: 400 Bad Request
- **Retryable**: No
- **Description**: Generic validation failure from MyInvois.
- **Action**: Check the `message` field for specific details. Review the document against MyInvois requirements.

### Infrastructure Errors

These are temporary errors. They **are retryable** - you should retry with exponential backoff.

#### UPSTREAM_TIMEOUT
- **HTTP Status**: 504 Gateway Timeout
- **Retryable**: Yes
- **Description**: The request to MyInvois timed out.
- **Action**: Retry after a short delay (5-30 seconds). If persistent, check MyInvois service status.

#### UPSTREAM_ERROR
- **HTTP Status**: 502 Bad Gateway
- **Retryable**: Yes
- **Description**: MyInvois returned a server error (5xx).
- **Action**: Retry with exponential backoff. If persistent (>5 minutes), contact support.

#### UPSTREAM_RATE_LIMITED
- **HTTP Status**: 429 Too Many Requests
- **Retryable**: Yes
- **Description**: You've exceeded MyInvois rate limits.
- **Action**:
  1. Check the `Retry-After` header for how long to wait
  2. Implement rate limiting on your side
  3. Spread requests over time

#### NETWORK_ERROR
- **HTTP Status**: 503 Service Unavailable
- **Retryable**: Yes
- **Description**: Could not reach MyInvois (network issue).
- **Action**: Check your network connection. Retry with backoff.

### Authentication Errors

#### AUTH_INVALID_CLIENT
- **HTTP Status**: 401 Unauthorized
- **Retryable**: No
- **Description**: Your client ID or client secret is invalid.
- **Action**: Verify your credentials in the LHDN portal. Create a new session with correct credentials.

#### AUTH_INVALID_CREDENTIALS
- **HTTP Status**: 401 Unauthorized
- **Retryable**: No
- **Description**: The provided credentials were rejected.
- **Action**: Check that you're using the correct environment (sandbox vs production).

#### AUTH_TOKEN_EXPIRED
- **HTTP Status**: 401 Unauthorized
- **Retryable**: Yes (automatic)
- **Description**: Your access token has expired.
- **Action**: The gateway automatically refreshes tokens. If this persists, create a new session.

#### AUTH_UNAVAILABLE
- **HTTP Status**: 503 Service Unavailable
- **Retryable**: Yes
- **Description**: The authentication service is temporarily unavailable.
- **Action**: Retry with backoff.

### Local Validation Errors

These errors are caught before sending to MyInvois. Fix the issue and resubmit.

#### PAYLOAD_TOO_LARGE
- **HTTP Status**: 413 Payload Too Large
- **Retryable**: No
- **Description**: The document or submission exceeds size limits.
- **Limits**:
  - Max 300KB per document
  - Max 5MB total submission
  - Max 100 documents per submission
- **Action**: Reduce document size or split into multiple submissions.

#### TOO_MANY_DOCUMENTS
- **HTTP Status**: 400 Bad Request
- **Retryable**: No
- **Description**: Too many documents in a single submission.
- **Action**: Split into batches of 100 or fewer documents.

#### VALIDATION_ERROR
- **HTTP Status**: 400 Bad Request
- **Retryable**: No
- **Description**: Required field is missing or invalid.
- **Action**: Check `propertyPath` for which field is invalid.

#### IDEMPOTENCY_CONFLICT
- **HTTP Status**: 409 Conflict
- **Retryable**: No
- **Description**: Duplicate submission within the 10-minute idempotency window.
- **Action**: This is usually safe - you'll receive the result of the original submission. Wait for the window to expire if you need to resubmit with the same content.

### Generic Errors

#### NOT_FOUND
- **HTTP Status**: 404 Not Found
- **Retryable**: No
- **Description**: The requested resource doesn't exist.

#### FORBIDDEN
- **HTTP Status**: 403 Forbidden
- **Retryable**: No
- **Description**: You don't have permission for this action.

#### BAD_REQUEST
- **HTTP Status**: 400 Bad Request
- **Retryable**: No
- **Description**: The request was malformed.

#### INTERNAL_ERROR
- **HTTP Status**: 500 Internal Server Error
- **Retryable**: Yes
- **Description**: An unexpected error occurred in the gateway.
- **Action**: Retry with backoff. If persistent, report the correlationId to support.

## Retry Strategy

For retryable errors, implement exponential backoff:

```typescript
async function retryWithBackoff(fn: () => Promise<Response>, maxRetries = 3) {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fn();

      if (response.ok) return response;

      const body = await response.json();
      if (!body.error?.retryable) {
        throw new Error(body.error?.message || 'Non-retryable error');
      }

      // Check Retry-After header
      const retryAfter = response.headers.get('Retry-After');
      const delay = retryAfter
        ? parseInt(retryAfter) * 1000
        : Math.pow(2, attempt) * 1000;

      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError!;
}
```

## Getting Help

When reporting issues, include:

1. **Correlation ID** - Found in response header `X-Correlation-Id` and error body
2. **Tracking ID** - For submission issues, include the tracking ID
3. **Timestamp** - When the error occurred
4. **Error code and message** - The full error envelope (excluding any sensitive data)
