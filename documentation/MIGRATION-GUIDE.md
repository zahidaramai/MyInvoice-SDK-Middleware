# HashLHDN API Migration Guide

## From Original Collection → v1.1.2

This guide documents the changes between the original client Postman collection and the updated HashLHDN API v1.1.2.

---

## Summary of Breaking Changes

| Change | Original | New (v1.1.2) |
|--------|----------|--------------|
| **Endpoints** | Single `/api/v1/documents/submit` with flags | Separate `/api/v1/hashlhdn/submit-*` endpoints |
| **Request Body Key** | Always `invoices` (array) | `invoices` for consolidate, `invoice` (singular) for others |
| **Company ID Field** | `CompanyId` (PascalCase) | `companyId` (camelCase) |
| **Customer Object** | `customer` with PascalCase | `buyer` with camelCase |
| **Create Company** | `POST /api/v1/companies/create` | `POST /api/v1/companies` |
| **Document Signing** | Not supported | `documentVersion: "1.1"` for X.509 signing |

---

## 1. Endpoint Changes

### Original (Flag-Based Routing)

All submissions went to a single endpoint with flags to control behavior:

```
POST /api/v1/documents/submit
```

| Flag | Purpose |
|------|---------|
| `ConsolidatedInvoice: true` | Consolidate multiple items into one e-invoice |
| `SaveInvoice: true` | Save to database without LHDN submission |
| (no flag + `customer` object) | B2B or B2C invoice |

### New (Dedicated Endpoints)

```
POST /api/v1/hashlhdn/submit-consolidate  → Consolidated invoice
POST /api/v1/hashlhdn/submit-justsave     → Save draft only
POST /api/v1/hashlhdn/submit-buyer        → B2B with TIN + BRN
POST /api/v1/hashlhdn/submit-personal     → B2C with NRIC
```

**Why?** Separate endpoints provide:
- Clearer API contract
- Endpoint-specific validation
- Better error messages
- Easier documentation

---

## 2. Request Body Schema Changes

### CRITICAL: Request Body Key

| Endpoint | Body Key | Format |
|----------|----------|--------|
| `submit-consolidate` | `invoices` | **Array** of invoice objects |
| `submit-buyer` | `invoice` | **Single** invoice object |
| `submit-personal` | `invoice` | **Single** invoice object |
| `submit-justsave` | `invoice` | **Single** invoice object |

### Original Schema (All Endpoints)

```json
{
  "CompanyId": "{{companyId}}",
  "ConsolidatedInvoice": true,
  "invoices": [
    {
      "invoiceNumber": "...",
      "customer": {
        "Tin": "...",
        "Name": "...",
        "Address1": "...",
        "PostalCode": "...",
        "StateCode": "...",
        "IdType": "...",
        "IdValue": "..."
      }
    }
  ]
}
```

### New Schema: Submit-Consolidate

```json
{
  "companyId": "{{companyId}}",
  "documentVersion": "1.1",
  "invoices": [
    {
      "invoiceNumber": "CONS-001",
      "invoiceDate": "2026-01-20T10:00:00Z",
      "amount": 1000.00,
      "discount": 0,
      "rounding": 0,
      "taxAmount": 80.00,
      "total": 1080.00,
      "buyer": {
        "tin": "EI00000000010",
        "name": "General Public",
        "idType": "BRN",
        "idValue": "NA",
        "address": "NA",
        "city": "NA",
        "state": "17",
        "postalCode": "00000"
      },
      "items": [...]
    }
  ]
}
```

### New Schema: Submit-Buyer / Submit-Personal / Submit-JustSave

```json
{
  "companyId": "{{companyId}}",
  "documentVersion": "1.1",
  "invoice": {
    "invoiceNumber": "INV-001",
    "invoiceDate": "2026-01-20T10:00:00Z",
    "amount": 1000.00,
    "discount": 0,
    "rounding": 0,
    "taxAmount": 80.00,
    "total": 1080.00,
    "buyer": {
      "tin": "C25235029040",
      "name": "ABC Corp Sdn Bhd",
      "idType": "BRN",
      "idValue": "201901012345",
      "address": "123 Business St",
      "city": "Kuala Lumpur",
      "state": "14",
      "postalCode": "50000"
    },
    "items": [...]
  }
}
```

---

## 3. Field Name Changes

### Company ID
```diff
- "CompanyId": "..."
+ "companyId": "..."
```

### Customer → Buyer Object

```diff
- "customer": {
-   "Tin": "...",
-   "Name": "...",
-   "Address1": "...",
-   "PostalCode": "...",
-   "City": "...",
-   "StateCode": "...",
-   "Telephone": "...",
-   "IdType": "...",
-   "IdValue": "..."
- }

+ "buyer": {
+   "tin": "...",
+   "name": "...",
+   "address": "...",
+   "postalCode": "...",
+   "city": "...",
+   "state": "...",
+   "phone": "...",
+   "email": "...",
+   "idType": "...",
+   "idValue": "..."
+ }
```

### Key Field Mapping

| Original Field | New Field | Notes |
|----------------|-----------|-------|
| `customer` | `buyer` | Object renamed |
| `Tin` | `tin` | camelCase |
| `Name` | `name` | camelCase |
| `Address1` | `address` | Single address field |
| `PostalCode` | `postalCode` | camelCase |
| `City` | `city` | camelCase |
| `StateCode` | `state` | Uses same codes (01-17) |
| `Telephone` | `phone` | Renamed |
| `IdType` | `idType` | camelCase |
| `IdValue` | `idValue` | camelCase |
| `customerIcNo` | (removed) | Use `idValue` with `idType: "NRIC"` |

---

## 4. Required Fields

### Invoice Level (ALL endpoints)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `invoiceNumber` | string | Yes | Unique invoice identifier |
| `invoiceDate` | ISO 8601 | Yes | `2026-01-20T10:00:00Z` |
| `amount` | number | Yes | Subtotal before tax |
| `discount` | number | Yes | Total discount (can be 0) |
| `rounding` | number | Yes | Rounding adjustment (can be 0) |
| `taxAmount` | number | Yes | Total tax amount |
| `total` | number | Yes | Final payable amount |
| `items` | array | Yes | At least one item |

### Buyer Object (Required for buyer/personal)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | Yes | Buyer full name |
| `idType` | string | Yes | `BRN`, `NRIC`, `PASSPORT`, `ARMY` |
| `idValue` | string | Yes | ID number |
| `address` | string | Yes | Street address |
| `city` | string | Yes | City name |
| `state` | string | Yes | State code (01-17) |
| `postalCode` | string | Yes | 5-digit postal code |
| `tin` | string | No | TIN (system auto-fills for personal) |
| `phone` | string | No | Contact number |
| `email` | string | No | Email address |

### Item Object (Each item)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `description` | string | Yes | Item description |
| `quantity` | number | Yes | Quantity |
| `unitPrice` | number | Yes | Price per unit |
| `discount` | number | Yes | Item discount (can be 0) |
| `taxCode` | string | Yes | `01`-`06` or `E` |
| `taxRate` | number | Yes | Tax percentage |
| `taxAmount` | number | Yes | Calculated tax |
| `total` | number | Yes | Line total |

---

## 5. New Features in v1.1.2

### Digital Signing (Document Version 1.1)

Add `documentVersion: "1.1"` to enable X.509/XAdES digital signatures:

```json
{
  "companyId": "...",
  "documentVersion": "1.1",
  "invoice": {...}
}
```

**Note:** Requires P12 certificate from LHDN configured on the server.

### Switch Company Endpoint

New endpoint for multi-company users:

```
POST /api/v1/auth/switch-company
```

```json
{
  "companyId": "target-company-uuid"
}
```

---

## 6. Company API Changes

### Create Company

```diff
- POST /api/v1/companies/create
+ POST /api/v1/companies
```

### Request Body

```diff
- {
-   "tin": "...",
-   "companyName": "...",
-   "address1": "...",
-   "email": "...",
-   "telephone": "...",
-   "city": "...",
-   "postalCode": "...",
-   "stateCode": "...",
-   "industry1": "...",
-   "industryCode1": "...",
-   "country": "..."
- }

+ {
+   "name": "...",
+   "tin": "...",
+   "brn": "..."
+ }
```

---

## 7. Tax Codes Reference

| Code | Description | When to Use |
|------|-------------|-------------|
| `01` | Sales Tax (SST) | Standard goods |
| `02` | Service Tax | Services |
| `03` | Tourism Tax | Tourism services |
| `04` | High-Value Goods Tax | Luxury items |
| `05` | Sales Tax on Low Value Goods | Imports < RM500 |
| `06` | Not Applicable | B2C / No tax items |
| `E` | Tax Exemption | Exempt categories |

**Important for B2C (Personal):** Use `taxCode: "06"` to avoid strict LHDN buyer validation on v1.1 documents.

---

## 8. State Codes Reference

| Code | State |
|------|-------|
| 01 | Johor |
| 02 | Kedah |
| 03 | Kelantan |
| 04 | Melaka |
| 05 | Negeri Sembilan |
| 06 | Pahang |
| 07 | Pulau Pinang |
| 08 | Perak |
| 09 | Perlis |
| 10 | Selangor |
| 11 | Terengganu |
| 12 | Sabah |
| 13 | Sarawak |
| 14 | WP Kuala Lumpur |
| 15 | WP Labuan |
| 16 | WP Putrajaya |
| 17 | Not Applicable |

---

## 9. Migration Checklist

### Code Changes

- [ ] Update endpoint URLs from `/api/v1/documents/submit` to specific `/api/v1/hashlhdn/submit-*` endpoints
- [ ] Change `CompanyId` to `companyId` (camelCase)
- [ ] Rename `customer` object to `buyer`
- [ ] Convert all buyer fields to camelCase
- [ ] For submit-buyer/personal/justsave: change `invoices` array to `invoice` singular object
- [ ] Add required fields: `taxRate`, `taxAmount`, `total` on each item
- [ ] Add `documentVersion: "1.1"` for digitally signed documents
- [ ] Update company creation endpoint from `/companies/create` to `/companies`

### Testing

- [ ] Test submit-consolidate with array of invoices
- [ ] Test submit-buyer with B2B customer (TIN + BRN)
- [ ] Test submit-personal with B2C customer (NRIC)
- [ ] Test submit-justsave for draft saving
- [ ] Verify all documents return VALID status from LHDN

---

## 10. Example Migrations

### Consolidated Invoice

**Before:**
```json
{
  "CompanyId": "abc123",
  "ConsolidatedInvoice": true,
  "invoices": [{
    "invoiceNumber": "CONSO-001",
    "amount": 100,
    "taxAmount": 8,
    "total": 108,
    "items": [{
      "description": "Product",
      "quantity": 1,
      "unitPrice": 100,
      "taxCode": "01"
    }]
  }]
}
```

**After:**
```json
{
  "companyId": "abc123",
  "documentVersion": "1.1",
  "invoices": [{
    "invoiceNumber": "CONSO-001",
    "invoiceDate": "2026-01-20T10:00:00Z",
    "amount": 100,
    "discount": 0,
    "rounding": 0,
    "taxAmount": 8,
    "total": 108,
    "buyer": {
      "tin": "EI00000000010",
      "name": "General Public",
      "idType": "BRN",
      "idValue": "NA",
      "address": "NA",
      "city": "NA",
      "state": "17",
      "postalCode": "00000"
    },
    "items": [{
      "description": "Product",
      "quantity": 1,
      "unitPrice": 100,
      "discount": 0,
      "taxCode": "01",
      "taxRate": 8,
      "taxAmount": 8,
      "total": 108
    }]
  }]
}
```

### B2B Buyer Invoice

**Before:**
```json
{
  "CompanyId": "abc123",
  "invoices": [{
    "invoiceNumber": "INV-001",
    "amount": 100,
    "taxAmount": 8,
    "total": 108,
    "customer": {
      "Tin": "C25235029040",
      "Name": "Buyer Co",
      "Address1": "123 Main St",
      "PostalCode": "50000",
      "City": "KL",
      "StateCode": "14",
      "IdType": "BRN",
      "IdValue": "201901012345"
    },
    "items": [...]
  }]
}
```

**After:**
```json
{
  "companyId": "abc123",
  "documentVersion": "1.1",
  "invoice": {
    "invoiceNumber": "INV-001",
    "invoiceDate": "2026-01-20T10:00:00Z",
    "amount": 100,
    "discount": 0,
    "rounding": 0,
    "taxAmount": 8,
    "total": 108,
    "buyer": {
      "tin": "C25235029040",
      "name": "Buyer Co",
      "address": "123 Main St",
      "postalCode": "50000",
      "city": "KL",
      "state": "14",
      "idType": "BRN",
      "idValue": "201901012345"
    },
    "items": [...]
  }
}
```

### B2C Personal Invoice

**Before:**
```json
{
  "CompanyId": "abc123",
  "invoices": [{
    "invoiceNumber": "INV-002",
    "customer": {
      "tin": "801025145127",
      "name": "John Doe",
      "customerIcNo": "801025145127",
      "address1": "123 Home St",
      "postalCode": "50000",
      "stateCode": "14",
      "city": "KL",
      "idType": "NRIC",
      "IdValue": "801025145127"
    },
    "items": [...]
  }]
}
```

**After:**
```json
{
  "companyId": "abc123",
  "documentVersion": "1.1",
  "invoice": {
    "invoiceNumber": "INV-002",
    "invoiceDate": "2026-01-20T10:00:00Z",
    "amount": 100,
    "discount": 0,
    "rounding": 0,
    "taxAmount": 0,
    "total": 100,
    "buyer": {
      "name": "John Doe",
      "address": "123 Home St",
      "postalCode": "50000",
      "state": "14",
      "city": "KL",
      "idType": "NRIC",
      "idValue": "801025145127"
    },
    "items": [{
      "description": "Product",
      "quantity": 1,
      "unitPrice": 100,
      "discount": 0,
      "taxCode": "06",
      "taxRate": 0,
      "taxAmount": 0,
      "total": 100
    }]
  }
}
```

---

## Support

For questions about this migration, contact the development team.

**API Version:** v1.1.2
**Last Updated:** 2026-01-20
