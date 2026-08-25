import assert from "node:assert/strict";
import test from "node:test";
import { repeatTypes } from "@scheduler/shared";
import { nextRecurringScheduledAt } from "./announcementRules.js";

test("supports an every-two-weeks repeat type", () => {
  assert.ok(repeatTypes.includes("every_two_weeks"));
});

test("advances every-two-weeks reminders by exactly 14 days", () => {
  assert.equal(
    nextRecurringScheduledAt(
      "2026-08-25T10:00:00.000Z",
      "UTC",
      "every_two_weeks",
      new Date("2026-08-25T10:00:00.000Z")
    ),
    "2026-09-08T10:00:00.000Z"
  );
});
