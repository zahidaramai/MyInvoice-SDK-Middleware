# POS E-Invoice API Integration Guide

This guide explains how to integrate your POS system with the DuitLHDN E-Invoice API.

---

## Overview

When a sale is completed at your POS:
1. Your POS calls the API with invoice details
2. API returns a short invoice ID and QR URL
3. Print the QR code on the customer's receipt
4. Customer scans QR, fills their details, and receives their e-invoice

```
POS Sale Complete
       ↓
Call POST /api/v1/pos/invoice
       ↓
Receive invoiceId + qrUrl
       ↓
Print QR Code on Receipt
       ↓
Customer Scans QR → Fills Details → E-Invoice Submitted to LHDN
```

---

## Authentication

### API Token

You will be provided with a long-lived JWT token for authentication. Store this securely in your POS environment variables.

**Suggested variable names (use any name that doesn't conflict):**

```env
DUITLHDN_API_TOKEN=<your-token-here>
# or
LHDN_JWT_TOKEN=<your-token-here>
# or
MYINVOIS_POS_TOKEN=<your-token-here>
```

### Using the Token

Include the token in the `Authorization` header for all API requests:

```
Authorization: Bearer <your-token-here>
```

---

## API Endpoint

### Create POS Invoice

**URL:** `POST https://api.duitlhdn.com/api/v1/pos/invoice`

**Headers:**
```
Authorization: Bearer <YOUR_TOKEN>
Content-Type: application/json
```

---

## Request Format

### Full Example

```json
{
  "CompanyId": "<your-company-uuid>",
  "ConsolidatedInvoice": true,
  "invoices": [
    {
      "invoiceNumber": "INV-2026-001",
      "invoiceDate": "2026-01-26T17:30:00+08:00",
      "paymentType": "CASH",
      "amount": 37.00,
      "discount": 0.00,
      "rounding": 0.00,
      "taxAmount": 2.22,
      "total": 39.22,
      "items": [
        {
          "description": "Nasi Lemak Special",
          "quantity": 2,
          "unitPrice": 15.00,
          "discount": 0.00,
          "taxCode": "02",
          "taxRate": 6.0,
          "taxAmount": 1.80,
          "total": 31.80
        },
        {
          "description": "Teh Tarik",
          "quantity": 1,
          "unitPrice": 7.00,
          "discount": 0.00,
          "taxCode": "02",
          "taxRate": 6.0,
          "taxAmount": 0.42,
          "total": 7.42
        }
      ]
    }
  ]
}
```

### Field Reference

#### Root Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `CompanyId` | string (UUID) | Yes | Your company UUID (provided during setup) |
| `ConsolidatedInvoice` | boolean | Yes | Always set to `true` for POS transactions |
| `invoices` | array | Yes | Array containing one invoice object |

#### Invoice Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `invoiceNumber` | string | Yes | Unique invoice number from your POS (e.g., `INV-2026-001`) |
| `invoiceDate` | string | Yes | Invoice timestamp in ISO 8601 format with timezone (e.g., `2026-01-26T17:30:00+08:00`) |
| `paymentType` | string | No | Payment method: `CASH`, `CARD`, `MYDEBIT`, `EWALLET`, `CREDIT`, etc. |
| `amount` | number | Yes | Subtotal before tax (sum of all items before tax) |
| `discount` | number | No | Total discount amount (default: `0.00`) |
| `rounding` | number | No | Rounding adjustment (default: `0.00`) |
| `taxAmount` | number | Yes | Total tax amount |
| `total` | number | Yes | Final total amount (amount + taxAmount - discount + rounding) |
| `items` | array | Yes | Array of line items |

#### Item Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Item name/description |
| `quantity` | number | Yes | Quantity sold |
| `unitPrice` | number | Yes | Price per unit (before tax) |
| `discount` | number | No | Discount for this item (default: `0.00`) |
| `taxCode` | string | Yes | Tax code (see Tax Codes below) |
| `taxRate` | number | Yes | Tax rate percentage (e.g., `6.0` for 6%) |
| `taxAmount` | number | Yes | Tax amount for this item |
| `total` | number | Yes | Item total including tax |

### Tax Codes

| Code | Description |
|------|-------------|
| `01` | Sales Tax (SST) |
| `02` | Service Tax (most common for F&B) |
| `03` | Tourism Tax |
| `04` | High-Value Goods Tax |
| `05` | Sales Tax on Low Value Goods |
| `06` | Not Applicable |
| `E` | Tax Exemption |

---

## Response Format

### Success Response (HTTP 201)

```json
{
  "success": true,
  "invoiceId": "BP-7MsOV8LE",
  "qrUrl": "https://www.duitlhdn.com/e/BP-7MsOV8LE",
  "expiresAt": "2026-01-27T10:20:19.351Z"
}
```

| Field | Description |
|-------|-------------|
| `success` | `true` if invoice was created successfully |
| `invoiceId` | Short invoice ID (e.g., `BP-7MsOV8LE`) - print this on receipt |
| `qrUrl` | Full URL for the QR code - customer scans this to register |
| `expiresAt` | QR code expiration time (24 hours from creation) |

### Error Response (HTTP 4xx)

```json
{
  "success": false,
  "error": "Error message describing the issue",
  "code": "ERROR_CODE"
}
```

#### Common Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Invalid request body or missing required fields |
| `COMPANY_NOT_FOUND` | Company ID does not exist |
| `COMPANY_INACTIVE` | Company account is not active |
| `DUPLICATE_INVOICE_NUMBER` | Invoice number already exists for this company |
| `UNAUTHORIZED` | Invalid or expired token |

---

## Code Examples

### cURL

```bash
curl -X POST "https://api.duitlhdn.com/api/v1/pos/invoice" \
  -H "Authorization: Bearer $DUITLHDN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "CompanyId": "your-company-uuid",
    "ConsolidatedInvoice": true,
    "invoices": [{
      "invoiceNumber": "INV-2026-001",
      "invoiceDate": "2026-01-26T17:30:00+08:00",
      "paymentType": "CASH",
      "amount": 10.00,
      "taxAmount": 0.60,
      "total": 10.60,
      "items": [{
        "description": "Coffee",
        "quantity": 1,
        "unitPrice": 10.00,
        "discount": 0.00,
        "taxCode": "02",
        "taxRate": 6.0,
        "taxAmount": 0.60,
        "total": 10.60
      }]
    }]
  }'
```

### JavaScript/Node.js

```javascript
const response = await fetch('https://api.duitlhdn.com/api/v1/pos/invoice', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.DUITLHDN_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    CompanyId: 'your-company-uuid',
    ConsolidatedInvoice: true,
    invoices: [{
      invoiceNumber: 'INV-2026-001',
      invoiceDate: new Date().toISOString(),
      paymentType: 'CASH',
      amount: 10.00,
      taxAmount: 0.60,
      total: 10.60,
      items: [{
        description: 'Coffee',
        quantity: 1,
        unitPrice: 10.00,
        discount: 0.00,
        taxCode: '02',
        taxRate: 6.0,
        taxAmount: 0.60,
        total: 10.60,
      }],
    }],
  }),
});

const result = await response.json();

if (result.success) {
  console.log('Invoice ID:', result.invoiceId);
  console.log('QR URL:', result.qrUrl);
  // Generate QR code from result.qrUrl and print on receipt
} else {
  console.error('Error:', result.error);
}
```

### PHP

```php
<?php
$token = getenv('DUITLHDN_API_TOKEN');

$data = [
    'CompanyId' => 'your-company-uuid',
    'ConsolidatedInvoice' => true,
    'invoices' => [[
        'invoiceNumber' => 'INV-2026-001',
        'invoiceDate' => date('c'),
        'paymentType' => 'CASH',
        'amount' => 10.00,
        'taxAmount' => 0.60,
        'total' => 10.60,
        'items' => [[
            'description' => 'Coffee',
            'quantity' => 1,
            'unitPrice' => 10.00,
            'discount' => 0.00,
            'taxCode' => '02',
            'taxRate' => 6.0,
            'taxAmount' => 0.60,
            'total' => 10.60,
        ]],
    ]],
];

$ch = curl_init('https://api.duitlhdn.com/api/v1/pos/invoice');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer ' . $token,
    'Content-Type: application/json',
]);

$response = curl_exec($ch);
$result = json_decode($response, true);

if ($result['success']) {
    echo 'Invoice ID: ' . $result['invoiceId'] . "\n";
    echo 'QR URL: ' . $result['qrUrl'] . "\n";
    // Generate QR code from $result['qrUrl'] and print on receipt
} else {
    echo 'Error: ' . $result['error'] . "\n";
}
```

---

## Printing the QR Code

After receiving the response, generate a QR code from the `qrUrl` and print it on the customer's receipt.

**Recommended QR code libraries:**
- JavaScript: `qrcode` npm package
- PHP: `endroid/qr-code`
- Python: `qrcode`

**Receipt example:**
```
================================
        YOUR STORE NAME
================================
Date: 26/01/2026 17:30
Invoice: INV-2026-001

Nasi Lemak Special x2    RM31.80
Teh Tarik x1              RM7.42
--------------------------------
Subtotal                 RM37.00
Service Tax (6%)          RM2.22
--------------------------------
TOTAL                    RM39.22
Payment: CASH

================================
   Scan for E-Invoice

   [QR CODE HERE]

   ID: BP-7MsOV8LE
   Valid for 24 hours
================================
```

---

## Important Notes

1. **Invoice Number Must Be Unique** - Each invoice number must be unique per company. Duplicate invoice numbers will be rejected.

2. **Timestamp Format** - Use ISO 8601 format with timezone: `2026-01-26T17:30:00+08:00`

3. **QR Code Expiry** - The QR code expires after 24 hours. After expiry, customers cannot register for the e-invoice.

4. **Token Security** - Keep your API token secure. Do not expose it in client-side code or version control.

5. **Tax Calculations** - Ensure your tax calculations are accurate. LHDN validates all tax amounts.

---

## Support

For technical support or questions, contact your account manager.
