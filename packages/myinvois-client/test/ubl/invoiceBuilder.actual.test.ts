/**
 * Actual tests for invoiceBuilder that import and test the real class
 */

import { describe, it, expect } from "vitest";
import {
  InvoiceBuilder,
  createInvoiceBuilder,
  buildInvoice,
  type SupplierPartyInput,
  type CustomerPartyInput,
  type InvoiceLineInput,
  type InvoiceInput,
} from "../../src/ubl/invoiceBuilder.js";

describe("invoiceBuilder (actual)", () => {
  // Test data factories
  const createSupplier = (): SupplierPartyInput => ({
    tin: "C12345678901",
    idType: "BRN",
    idValue: "202001234567",
    registrationName: "Test Supplier Sdn Bhd",
    address: {
      addressLines: ["123 Test Street", "Test Building"],
      cityName: "Kuala Lumpur",
      postalZone: "50000",
      stateCode: "14",
    },
    contact: {
      telephone: "0312345678",
      email: "supplier@test.com",
    },
  });

  const createCustomer = (): CustomerPartyInput => ({
    tin: "C98765432100",
    idType: "BRN",
    idValue: "202009876543",
    registrationName: "Test Customer Sdn Bhd",
    address: {
      addressLines: ["456 Customer Road"],
      cityName: "Petaling Jaya",
      postalZone: "47301",
      stateCode: "10",
    },
    contact: {
      telephone: "0398765432",
      email: "customer@test.com",
    },
  });

  const createLine = (id = "1"): InvoiceLineInput => ({
    id,
    description: "Test Product",
    quantity: 2,
    unitCode: "C62",
    unitPrice: 50.0,
    lineTotal: 100.0,
    classificationCode: "001",
    tax: {
      taxType: "01",
      taxableAmount: 100.0,
      taxAmount: 8.0,
    },
  });

  describe("InvoiceBuilder", () => {
    describe("fluent API", () => {
      it("setId returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setId("INV001");
        expect(result).toBe(builder);
      });

      it("setIssueDate returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setIssueDate(new Date());
        expect(result).toBe(builder);
      });

      it("setInvoiceTypeCode returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setInvoiceTypeCode("01");
        expect(result).toBe(builder);
      });

      it("setCurrencyCode returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setCurrencyCode("MYR");
        expect(result).toBe(builder);
      });

      it("setSupplier returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setSupplier(createSupplier());
        expect(result).toBe(builder);
      });

      it("setCustomer returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setCustomer(createCustomer());
        expect(result).toBe(builder);
      });

      it("setLines returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setLines([createLine()]);
        expect(result).toBe(builder);
      });

      it("addLine returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.addLine(createLine());
        expect(result).toBe(builder);
      });

      it("setPaymentMode returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setPaymentMode("01");
        expect(result).toBe(builder);
      });

      it("setPaymentTerms returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setPaymentTerms("Net 30");
        expect(result).toBe(builder);
      });

      it("setBillingReferenceId returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setBillingReferenceId("REF001");
        expect(result).toBe(builder);
      });

      it("setPeriod returns this for chaining", () => {
        const builder = new InvoiceBuilder();
        const result = builder.setPeriod(new Date(), new Date());
        expect(result).toBe(builder);
      });
    });

    describe("addLine", () => {
      it("initializes lines array if not exists", () => {
        const builder = new InvoiceBuilder();
        builder.addLine(createLine("1"));
        builder.addLine(createLine("2"));

        const invoice = builder
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .buildV1_0();

        expect(invoice.Invoice[0].InvoiceLine).toHaveLength(2);
      });
    });

    describe("buildV1_0", () => {
      it("builds a complete invoice with required fields", () => {
        const issueDate = new Date("2024-01-15T10:00:00Z");
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(issueDate)
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .buildV1_0();

        expect(invoice._D).toBe("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2");
        expect(invoice._A).toBe("urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2");
        expect(invoice._B).toBe("urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2");

        const content = invoice.Invoice[0];
        expect(content.ID[0]._).toBe("INV001");
        expect(content.IssueDate[0]._).toBe("2024-01-15");
        expect(content.IssueTime[0]._).toBe("10:00:00Z");
        expect(content.InvoiceTypeCode[0]._).toBe("01");
        expect(content.DocumentCurrencyCode[0]._).toBe("MYR");
      });

      it("uses default invoice type code 01 if not set", () => {
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .buildV1_0();

        expect(invoice.Invoice[0].InvoiceTypeCode[0]._).toBe("01");
      });

      it("uses default currency code MYR if not set", () => {
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .buildV1_0();

        expect(invoice.Invoice[0].DocumentCurrencyCode[0]._).toBe("MYR");
      });

      it("uses custom invoice type code when set", () => {
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setInvoiceTypeCode("02") // Credit note
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .buildV1_0();

        expect(invoice.Invoice[0].InvoiceTypeCode[0]._).toBe("02");
      });

      it("uses custom currency code when set", () => {
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setCurrencyCode("USD")
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .buildV1_0();

        expect(invoice.Invoice[0].DocumentCurrencyCode[0]._).toBe("USD");
      });

      it("builds supplier party correctly", () => {
        const supplier = createSupplier();
        supplier.industryCode = "47111";
        supplier.industryName = "Retail sale in non-specialized stores";
        supplier.sstRegistration = "SST123";
        supplier.ttxRegistration = "TTX456";
        supplier.additionalAccountId = "CERTEX001";

        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(supplier)
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .buildV1_0();

        const supplierParty = invoice.Invoice[0].AccountingSupplierParty[0];
        expect(supplierParty.AdditionalAccountID?.[0]._).toBe("CERTEX001");

        const party = supplierParty.Party[0];
        expect(party.PartyIdentification).toHaveLength(4); // TIN, BRN, SST, TTX
        expect(party.IndustryClassificationCode?.[0]._).toBe("47111");
        expect(party.IndustryClassificationCode?.[0].name).toBe("Retail sale in non-specialized stores");
      });

      it("builds customer party correctly", () => {
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .buildV1_0();

        const customerParty = invoice.Invoice[0].AccountingCustomerParty[0];
        const party = customerParty.Party[0];
        expect(party.PartyIdentification).toHaveLength(2); // TIN, BRN
        expect(party.PartyLegalEntity[0].RegistrationName[0]._).toBe("Test Customer Sdn Bhd");
      });

      it("builds invoice lines correctly", () => {
        const line = createLine();
        line.discount = 10;
        line.discountReason = "Volume discount";

        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([line])
          .buildV1_0();

        const invoiceLine = invoice.Invoice[0].InvoiceLine[0];
        expect(invoiceLine.ID[0]._).toBe("1");
        expect(invoiceLine.InvoicedQuantity[0]._).toBe(2);
        expect(invoiceLine.InvoicedQuantity[0].unitCode).toBe("C62");
        expect(invoiceLine.LineExtensionAmount[0]._).toBe(100);
        expect(invoiceLine.AllowanceCharge?.[0].Amount[0]._).toBe(10);
        expect(invoiceLine.AllowanceCharge?.[0].AllowanceChargeReason[0]._).toBe("Volume discount");
      });

      it("builds line with default unit code C62 if not specified", () => {
        const line: InvoiceLineInput = {
          id: "1",
          description: "Test",
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
          classificationCode: "001",
          tax: { taxType: "01", taxableAmount: 100, taxAmount: 8 },
        };

        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([line])
          .buildV1_0();

        expect(invoice.Invoice[0].InvoiceLine[0].InvoicedQuantity[0].unitCode).toBe("C62");
      });

      it("builds line with default discount reason if not specified", () => {
        const line = createLine();
        line.discount = 5;

        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([line])
          .buildV1_0();

        expect(invoice.Invoice[0].InvoiceLine[0].AllowanceCharge?.[0].AllowanceChargeReason[0]._).toBe("Discount");
      });

      it("does not add allowance charge when discount is 0", () => {
        const line = createLine();
        line.discount = 0;

        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([line])
          .buildV1_0();

        expect(invoice.Invoice[0].InvoiceLine[0].AllowanceCharge).toBeUndefined();
      });

      it("calculates totals correctly", () => {
        const lines: InvoiceLineInput[] = [
          {
            id: "1",
            description: "Product A",
            quantity: 2,
            unitPrice: 50,
            lineTotal: 100,
            classificationCode: "001",
            tax: { taxType: "01", taxableAmount: 100, taxAmount: 8 },
            discount: 10,
          },
          {
            id: "2",
            description: "Product B",
            quantity: 1,
            unitPrice: 200,
            lineTotal: 200,
            classificationCode: "001",
            tax: { taxType: "01", taxableAmount: 200, taxAmount: 16 },
          },
        ];

        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines(lines)
          .buildV1_0();

        const monetary = invoice.Invoice[0].LegalMonetaryTotal[0];
        expect(monetary.LineExtensionAmount[0]._).toBe(300); // 100 + 200
        expect(monetary.AllowanceTotalAmount[0]._).toBe(10); // only line 1 discount
        expect(monetary.TaxExclusiveAmount[0]._).toBe(290); // 300 - 10
        expect(monetary.TaxInclusiveAmount[0]._).toBe(314); // 290 + 24
        expect(monetary.PayableAmount[0]._).toBe(314);
      });

      it("aggregates tax subtotals by tax type", () => {
        const lines: InvoiceLineInput[] = [
          {
            id: "1",
            description: "Product A",
            quantity: 1,
            unitPrice: 100,
            lineTotal: 100,
            classificationCode: "001",
            tax: { taxType: "01", taxableAmount: 100, taxAmount: 8 },
          },
          {
            id: "2",
            description: "Product B",
            quantity: 1,
            unitPrice: 100,
            lineTotal: 100,
            classificationCode: "001",
            tax: { taxType: "01", taxableAmount: 100, taxAmount: 8 },
          },
          {
            id: "3",
            description: "Product C (exempt)",
            quantity: 1,
            unitPrice: 50,
            lineTotal: 50,
            classificationCode: "001",
            tax: { taxType: "E", taxableAmount: 50, taxAmount: 0, exemptionReason: "Exempt item" },
          },
        ];

        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines(lines)
          .buildV1_0();

        const taxTotal = invoice.Invoice[0].TaxTotal[0];
        expect(taxTotal.TaxAmount[0]._).toBe(16); // 8 + 8 + 0
        expect(taxTotal.TaxSubtotal).toHaveLength(2); // 01 and E

        const subtotal01 = taxTotal.TaxSubtotal.find(s => s.TaxCategory[0].ID[0]._ === "01");
        expect(subtotal01?.TaxableAmount[0]._).toBe(200);
        expect(subtotal01?.TaxAmount[0]._).toBe(16);

        const subtotalE = taxTotal.TaxSubtotal.find(s => s.TaxCategory[0].ID[0]._ === "E");
        expect(subtotalE?.TaxableAmount[0]._).toBe(50);
        expect(subtotalE?.TaxCategory[0].TaxExemptionReason?.[0]._).toBe("Exempt item");
      });

      it("includes invoice period when set", () => {
        const startDate = new Date("2024-01-01");
        const endDate = new Date("2024-01-31");

        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .setPeriod(startDate, endDate)
          .buildV1_0();

        expect(invoice.Invoice[0].InvoicePeriod?.[0].StartDate[0]._).toBe("2024-01-01");
        expect(invoice.Invoice[0].InvoicePeriod?.[0].EndDate[0]._).toBe("2024-01-31");
      });

      it("includes billing reference when set", () => {
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .setBillingReferenceId("REF001")
          .buildV1_0();

        expect(invoice.Invoice[0].BillingReference?.[0].AdditionalDocumentReference[0].ID[0]._).toBe("REF001");
      });

      it("includes payment means when set", () => {
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .setPaymentMode("01")
          .buildV1_0();

        expect(invoice.Invoice[0].PaymentMeans?.[0].PaymentMeansCode[0]._).toBe("01");
      });

      it("includes payment terms when set", () => {
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .setPaymentTerms("Net 30 days")
          .buildV1_0();

        expect(invoice.Invoice[0].PaymentTerms?.[0].Note[0]._).toBe("Net 30 days");
      });

      it("builds address with country code MYS by default", () => {
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .buildV1_0();

        const address = invoice.Invoice[0].AccountingSupplierParty[0].Party[0].PostalAddress[0];
        expect(address.Country[0].IdentificationCode[0]._).toBe("MYS");
      });

      it("builds address with custom country code", () => {
        const supplier = createSupplier();
        supplier.address.countryCode = "SGP";

        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(supplier)
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .buildV1_0();

        const address = invoice.Invoice[0].AccountingSupplierParty[0].Party[0].PostalAddress[0];
        expect(address.Country[0].IdentificationCode[0]._).toBe("SGP");
      });
    });

    describe("buildV1_1", () => {
      it("builds a v1.1 invoice (extends v1.0)", () => {
        const invoice = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()])
          .buildV1_1();

        expect(invoice._D).toBe("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2");
        expect(invoice.Invoice[0].ID[0]._).toBe("INV001");
      });
    });

    describe("validation", () => {
      it("throws error when ID is missing", () => {
        const builder = new InvoiceBuilder()
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()]);

        expect(() => builder.buildV1_0()).toThrow("Invoice ID is required");
      });

      it("throws error when issue date is missing", () => {
        const builder = new InvoiceBuilder()
          .setId("INV001")
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([createLine()]);

        expect(() => builder.buildV1_0()).toThrow("Issue date is required");
      });

      it("throws error when supplier is missing", () => {
        const builder = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setCustomer(createCustomer())
          .setLines([createLine()]);

        expect(() => builder.buildV1_0()).toThrow("Supplier is required");
      });

      it("throws error when customer is missing", () => {
        const builder = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setLines([createLine()]);

        expect(() => builder.buildV1_0()).toThrow("Customer is required");
      });

      it("throws error when lines are missing", () => {
        const builder = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer());

        expect(() => builder.buildV1_0()).toThrow("At least one invoice line is required");
      });

      it("throws error when lines are empty", () => {
        const builder = new InvoiceBuilder()
          .setId("INV001")
          .setIssueDate(new Date())
          .setSupplier(createSupplier())
          .setCustomer(createCustomer())
          .setLines([]);

        expect(() => builder.buildV1_0()).toThrow("At least one invoice line is required");
      });
    });
  });

  describe("createInvoiceBuilder", () => {
    it("creates a new InvoiceBuilder instance", () => {
      const builder = createInvoiceBuilder();
      expect(builder).toBeInstanceOf(InvoiceBuilder);
    });
  });

  describe("buildInvoice", () => {
    it("builds invoice from input object", () => {
      const input: InvoiceInput = {
        id: "INV001",
        issueDate: new Date("2024-01-15"),
        invoiceTypeCode: "01",
        currencyCode: "MYR",
        supplier: createSupplier(),
        customer: createCustomer(),
        lines: [createLine()],
        paymentMode: "01",
        paymentTerms: "Net 30",
        billingReferenceId: "REF001",
      };

      const invoice = buildInvoice(input);

      expect(invoice.Invoice[0].ID[0]._).toBe("INV001");
      expect(invoice.Invoice[0].InvoiceTypeCode[0]._).toBe("01");
      expect(invoice.Invoice[0].PaymentMeans?.[0].PaymentMeansCode[0]._).toBe("01");
      expect(invoice.Invoice[0].PaymentTerms?.[0].Note[0]._).toBe("Net 30");
    });

    it("uses defaults for optional fields", () => {
      const input: InvoiceInput = {
        id: "INV001",
        issueDate: new Date("2024-01-15"),
        supplier: createSupplier(),
        customer: createCustomer(),
        lines: [createLine()],
      };

      const invoice = buildInvoice(input);

      expect(invoice.Invoice[0].InvoiceTypeCode[0]._).toBe("01");
      expect(invoice.Invoice[0].DocumentCurrencyCode[0]._).toBe("MYR");
      expect(invoice.Invoice[0].PaymentMeans?.[0].PaymentMeansCode[0]._).toBe("01");
    });
  });

  describe("date formatting", () => {
    it("formats date correctly", () => {
      const invoice = new InvoiceBuilder()
        .setId("INV001")
        .setIssueDate(new Date("2024-06-15T14:30:45Z"))
        .setSupplier(createSupplier())
        .setCustomer(createCustomer())
        .setLines([createLine()])
        .buildV1_0();

      expect(invoice.Invoice[0].IssueDate[0]._).toBe("2024-06-15");
      expect(invoice.Invoice[0].IssueTime[0]._).toBe("14:30:45Z");
    });

    it("pads single digit time values", () => {
      const invoice = new InvoiceBuilder()
        .setId("INV001")
        .setIssueDate(new Date("2024-01-05T05:05:05Z"))
        .setSupplier(createSupplier())
        .setCustomer(createCustomer())
        .setLines([createLine()])
        .buildV1_0();

      expect(invoice.Invoice[0].IssueTime[0]._).toBe("05:05:05Z");
    });
  });
});
