/**
 * Tests for core observability metrics
 */

import { describe, it, expect } from "vitest";

describe("metrics", () => {
  describe("counter metrics", () => {
    it("tracks request counts", () => {
      const counter = {
        name: "http_requests_total",
        value: 0,
        labels: { method: "GET", path: "/api/v1/documents" },
        inc: function () {
          this.value++;
        },
      };

      counter.inc();
      counter.inc();
      counter.inc();

      expect(counter.value).toBe(3);
    });

    it("tracks error counts by type", () => {
      const errorCounter: Record<string, number> = {};

      const incError = (type: string) => {
        errorCounter[type] = (errorCounter[type] || 0) + 1;
      };

      incError("VALIDATION_ERROR");
      incError("NETWORK_ERROR");
      incError("VALIDATION_ERROR");

      expect(errorCounter["VALIDATION_ERROR"]).toBe(2);
      expect(errorCounter["NETWORK_ERROR"]).toBe(1);
    });

    it("tracks submission counts", () => {
      const submissionCounter = {
        total: 0,
        accepted: 0,
        rejected: 0,
        inc: function (type: "total" | "accepted" | "rejected") {
          this[type]++;
        },
      };

      submissionCounter.inc("total");
      submissionCounter.inc("total");
      submissionCounter.inc("accepted");
      submissionCounter.inc("rejected");

      expect(submissionCounter.total).toBe(2);
      expect(submissionCounter.accepted).toBe(1);
      expect(submissionCounter.rejected).toBe(1);
    });
  });

  describe("gauge metrics", () => {
    it("tracks active connections", () => {
      const gauge = {
        name: "active_connections",
        value: 0,
        inc: function () {
          this.value++;
        },
        dec: function () {
          this.value--;
        },
        set: function (val: number) {
          this.value = val;
        },
      };

      gauge.inc();
      gauge.inc();
      expect(gauge.value).toBe(2);

      gauge.dec();
      expect(gauge.value).toBe(1);

      gauge.set(10);
      expect(gauge.value).toBe(10);
    });

    it("tracks queue depth", () => {
      const queueGauge = {
        value: 0,
        set: function (val: number) {
          this.value = val;
        },
      };

      queueGauge.set(50);
      expect(queueGauge.value).toBe(50);

      queueGauge.set(25);
      expect(queueGauge.value).toBe(25);
    });
  });

  describe("histogram metrics", () => {
    it("tracks request duration", () => {
      const histogram = {
        name: "http_request_duration_seconds",
        observations: [] as number[],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
        observe: function (value: number) {
          this.observations.push(value);
        },
        count: function () {
          return this.observations.length;
        },
        sum: function () {
          return this.observations.reduce((a, b) => a + b, 0);
        },
        percentile: function (p: number) {
          const sorted = [...this.observations].sort((a, b) => a - b);
          const idx = Math.ceil((p / 100) * sorted.length) - 1;
          return sorted[idx];
        },
      };

      histogram.observe(0.05);
      histogram.observe(0.12);
      histogram.observe(0.03);
      histogram.observe(0.08);
      histogram.observe(0.25);

      expect(histogram.count()).toBe(5);
      expect(histogram.sum()).toBeCloseTo(0.53, 2);
    });

    it("tracks response sizes", () => {
      const sizeHistogram = {
        observations: [] as number[],
        observe: function (bytes: number) {
          this.observations.push(bytes);
        },
        avg: function () {
          return this.observations.reduce((a, b) => a + b, 0) / this.observations.length;
        },
      };

      sizeHistogram.observe(1024);
      sizeHistogram.observe(2048);
      sizeHistogram.observe(512);

      expect(sizeHistogram.avg()).toBeCloseTo(1194.67, 0);
    });
  });

  describe("metric labels", () => {
    it("supports labeled metrics", () => {
      const labeledMetric: Record<string, number> = {};

      const getKey = (labels: Record<string, string>) =>
        Object.entries(labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");

      const inc = (labels: Record<string, string>) => {
        const key = getKey(labels);
        labeledMetric[key] = (labeledMetric[key] || 0) + 1;
      };

      inc({ method: "GET", status: "200" });
      inc({ method: "GET", status: "200" });
      inc({ method: "POST", status: "201" });
      inc({ method: "GET", status: "404" });

      expect(labeledMetric['method="GET",status="200"']).toBe(2);
      expect(labeledMetric['method="POST",status="201"']).toBe(1);
    });

    it("validates label values", () => {
      const isValidLabel = (value: string) => /^[a-zA-Z0-9_-]+$/.test(value);

      expect(isValidLabel("success")).toBe(true);
      expect(isValidLabel("error-code")).toBe(true);
      expect(isValidLabel("status_code")).toBe(true);
      expect(isValidLabel("invalid value")).toBe(false);
    });
  });

  describe("rate metrics", () => {
    it("calculates request rate", () => {
      const requests = [
        { timestamp: 1000 },
        { timestamp: 1500 },
        { timestamp: 2000 },
        { timestamp: 2500 },
        { timestamp: 3000 },
      ];

      const windowMs = 2000;
      const now = 3000;
      const inWindow = requests.filter((r) => r.timestamp >= now - windowMs);
      const rate = inWindow.length / (windowMs / 1000);

      expect(rate).toBe(2.5); // 5 requests in 2 seconds = 2.5 per second
    });

    it("calculates error rate", () => {
      const counts = {
        total: 100,
        errors: 5,
      };

      const errorRate = counts.errors / counts.total;
      expect(errorRate).toBe(0.05); // 5%
    });
  });

  describe("MyInvois specific metrics", () => {
    it("tracks token refresh counts", () => {
      const tokenMetrics = {
        refreshes: 0,
        failures: 0,
        incRefresh: function () {
          this.refreshes++;
        },
        incFailure: function () {
          this.failures++;
        },
      };

      tokenMetrics.incRefresh();
      tokenMetrics.incRefresh();
      tokenMetrics.incFailure();

      expect(tokenMetrics.refreshes).toBe(2);
      expect(tokenMetrics.failures).toBe(1);
    });

    it("tracks document status distribution", () => {
      const statusCounts: Record<string, number> = {
        Submitted: 0,
        Valid: 0,
        Invalid: 0,
        Cancelled: 0,
        Rejected: 0,
      };

      const incStatus = (status: string) => {
        if (status in statusCounts) {
          statusCounts[status]++;
        }
      };

      incStatus("Valid");
      incStatus("Valid");
      incStatus("Invalid");
      incStatus("Submitted");
      incStatus("Valid");

      expect(statusCounts.Valid).toBe(3);
      expect(statusCounts.Invalid).toBe(1);
      expect(statusCounts.Submitted).toBe(1);
    });

    it("tracks API latency by endpoint", () => {
      const latencies: Record<string, number[]> = {};

      const recordLatency = (endpoint: string, ms: number) => {
        if (!latencies[endpoint]) latencies[endpoint] = [];
        latencies[endpoint].push(ms);
      };

      recordLatency("/submit", 150);
      recordLatency("/submit", 200);
      recordLatency("/poll", 50);
      recordLatency("/submit", 180);

      const avgSubmit =
        latencies["/submit"].reduce((a, b) => a + b, 0) / latencies["/submit"].length;
      expect(avgSubmit).toBeCloseTo(176.67, 0);
    });
  });

  describe("metric naming conventions", () => {
    it("follows prometheus naming", () => {
      const metricNames = [
        "myinvois_http_requests_total",
        "myinvois_request_duration_seconds",
        "myinvois_documents_submitted_total",
        "myinvois_active_sessions",
      ];

      metricNames.forEach((name) => {
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      });
    });

    it("uses appropriate suffixes", () => {
      const metrics = {
        counter: "requests_total",
        gauge: "active_connections",
        histogram: "request_duration_seconds",
        summary: "response_size_bytes",
      };

      expect(metrics.counter).toMatch(/_total$/);
      expect(metrics.histogram).toMatch(/_seconds$/);
      expect(metrics.summary).toMatch(/_bytes$/);
    });
  });

  describe("metric aggregation", () => {
    it("aggregates by time window", () => {
      const dataPoints = [
        { timestamp: 1000, value: 10 },
        { timestamp: 1001, value: 15 },
        { timestamp: 2000, value: 20 },
        { timestamp: 2001, value: 25 },
      ];

      const bucketSize = 1000;
      const buckets: Record<number, number[]> = {};

      dataPoints.forEach((dp) => {
        const bucket = Math.floor(dp.timestamp / bucketSize) * bucketSize;
        if (!buckets[bucket]) buckets[bucket] = [];
        buckets[bucket].push(dp.value);
      });

      expect(buckets[1000]).toEqual([10, 15]);
      expect(buckets[2000]).toEqual([20, 25]);
    });

    it("calculates moving average", () => {
      const values = [10, 20, 30, 40, 50];
      const windowSize = 3;

      const movingAvg = (arr: number[], window: number) => {
        const result: number[] = [];
        for (let i = window - 1; i < arr.length; i++) {
          const slice = arr.slice(i - window + 1, i + 1);
          result.push(slice.reduce((a, b) => a + b, 0) / window);
        }
        return result;
      };

      const avg = movingAvg(values, windowSize);
      expect(avg).toEqual([20, 30, 40]);
    });
  });
});
