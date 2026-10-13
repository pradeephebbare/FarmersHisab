import { describe, expect, it } from "vitest";
import { allocate, computeSettlement, computeTotals, TermsError, type SettlementInput } from "./settlement";
import { formatINR, parseRupeesToPaise } from "./money";

const R = (rupees: number) => rupees * 100;
const A = "a";
const B = "b";
const C = "c";

function base(overrides: Partial<SettlementInput> = {}): SettlementInput {
  return {
    members: [
      { memberId: A, name: "A", expenseBps: 5000, profitBps: 5000, partyRole: "landowner" },
      { memberId: B, name: "B", expenseBps: 5000, profitBps: 5000, partyRole: "farmer" },
    ],
    expenses: [
      { id: "e1", paidBy: A, amountPaise: R(49380), status: "confirmed", expenseFor: "landowner" },
      { id: "e2", paidBy: B, amountPaise: R(18300), status: "confirmed", expenseFor: "farmer" },
    ],
    incomes: [{ id: "i1", kind: "crop_sale", amountPaise: R(273310), paymentStatus: "received", receivedBy: A, status: "active" }],
    payments: [],
    basis: "received",
    approvalPolicy: "notify_only",
    agreementApproved: true,
    ...overrides,
  };
}
const find = (r: ReturnType<typeof computeSettlement>, id: string) => r.members.find((m) => m.memberId === id)!;

describe("illustrative example from the product brief", () => {
  const r = computeSettlement(base());
  it("totals", () => {
    expect(r.totalExpensesPaise).toBe(R(67680));
    expect(r.totalIncomePaise).toBe(R(273310));
    expect(r.netPaise).toBe(R(205630));
  });
  it("expense share and contribution difference", () => {
    expect(r.parties.map((p) => p.expensesPaise)).toEqual([R(49380), R(18300)]);
    expect(r.parties.map((p) => p.expenseSharePaise)).toEqual([R(33840), R(33840)]);
    expect(r.parties.map((p) => p.contributionDiffPaise)).toEqual([R(15540), -R(15540)]);
  });
  it("final distribution reimburses expenses once and splits profit", () => {
    expect(r.parties.map((p) => p.profitSharePaise)).toEqual([R(102815), R(102815)]);
    expect(r.parties.map((p) => p.distributionPaise)).toEqual([R(152195), R(121115)]);
    expect(r.parties.reduce((total, p) => total + p.distributionPaise, 0)).toBe(R(273310));
    expect(r.reconciles).toBe(true);
    expect(r.provisional).toBe(false);
  });
  it("A holds all cash, so A pays B the difference", () => {
    expect(r.transfers).toEqual([{ fromParty: "landowner", toParty: "farmer", amountPaise: R(121115) }]);
  });
  it("settles a farmer share without requiring a farmer login", () => {
    const r = computeSettlement(base({
      members: [{ memberId: A, name: "Owner", expenseBps: 10000, profitBps: 10000, partyRole: "landowner" }],
      expenses: [
        { id: "owner-expense", paidBy: A, amountPaise: R(49380), status: "confirmed", expenseFor: "landowner" },
        { id: "farmer-expense", paidBy: A, amountPaise: R(18300), status: "confirmed", expenseFor: "farmer" },
      ],
      incomes: [{ id: "income", kind: "crop_sale", amountPaise: R(273310), paymentStatus: "received", receivedBy: A, status: "active" }],
    }));

    expect(r.parties.map((p) => p.distributionPaise)).toEqual([R(152195), R(121115)]);
    expect(r.transfers).toEqual([{ fromParty: "landowner", toParty: "farmer", amountPaise: R(121115) }]);
    expect(r.reconciles).toBe(true);
  });
});

describe("rounding", () => {
  it("allocates odd paise without losing any", () => {
    const parts = allocate(100, [3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });
  it("is exact for three equal partners", () => {
    const r = computeSettlement(
      base({
        members: [
          { memberId: A, name: "A", expenseBps: 3334, profitBps: 3334 },
          { memberId: B, name: "B", expenseBps: 3333, profitBps: 3333 },
          { memberId: C, name: "C", expenseBps: 3333, profitBps: 3333 },
        ],
        expenses: [{ id: "e", paidBy: C, amountPaise: 10001, status: "confirmed" }],
        incomes: [{ id: "i", kind: "crop_sale", amountPaise: 50001, paymentStatus: "received", receivedBy: C, status: "active" }],
      }),
    );
    expect(r.reconciles).toBe(true);
    expect(r.members.reduce((a, m) => a + m.distributionPaise, 0)).toBe(50001);
  });
  it("handles negative totals symmetrically", () => {
    expect(allocate(-101, [5000, 5000])).toEqual([-51, -50]);
  });
});

describe("fixed landowner and farmer split", () => {
  it("ignores member percentage settings for party expense and profit shares", () => {
    const r = computeSettlement(
      base({
        members: [
          { memberId: A, name: "A", expenseBps: 7000, profitBps: 5000 },
          { memberId: B, name: "B", expenseBps: 3000, profitBps: 5000 },
        ],
      }),
    );
    expect(find(r, A).expenseSharePaise).toBe(R(47376));
    expect(find(r, A).profitSharePaise).toBe(R(102815));
    expect(r.parties.map((p) => p.expenseSharePaise)).toEqual([R(33840), R(33840)]);
    expect(r.parties.map((p) => p.profitSharePaise)).toEqual([R(102815), R(102815)]);
    expect(r.reconciles).toBe(true);
  });
});

describe("losses", () => {
  it("splits a loss by profit shares and still reconciles", () => {
    const r = computeSettlement(
      base({ incomes: [{ id: "i", kind: "crop_sale", amountPaise: R(50000), paymentStatus: "received", receivedBy: A, status: "active" }] }),
    );
    expect(r.isLoss).toBe(true);
    expect(r.netPaise).toBe(-R(17680));
    expect(find(r, A).profitSharePaise).toBe(-R(8840));
    expect(find(r, A).distributionPaise).toBe(R(49380) - R(8840));
    expect(r.reconciles).toBe(true);
  });
});

describe("pending income, disputes and provisional status", () => {
  it("does not count unpaid sales as received and marks provisional", () => {
    const r = computeSettlement(
      base({
        incomes: [
          { id: "i1", kind: "crop_sale", amountPaise: R(100000), paymentStatus: "received", receivedBy: A, status: "active" },
          { id: "i2", kind: "crop_sale", amountPaise: R(50000), paymentStatus: "pending", receivedBy: null, status: "active" },
        ],
      }),
    );
    expect(r.totalIncomePaise).toBe(R(100000));
    expect(r.pendingIncomePaise).toBe(R(50000));
    expect(r.provisional).toBe(true);
    expect(r.reasons).toContain("PENDING_INCOME");
  });
  it("counts pending sales on the recorded basis but never offers transfers", () => {
    const r = computeSettlement(
      base({
        basis: "recorded",
        incomes: [
          { id: "i1", kind: "crop_sale", amountPaise: R(100000), paymentStatus: "received", receivedBy: A, status: "active" },
          { id: "i2", kind: "crop_sale", amountPaise: R(50000), paymentStatus: "pending", receivedBy: null, status: "active" },
        ],
      }),
    );
    expect(r.totalIncomePaise).toBe(R(150000));
    expect(r.transfersAvailable).toBe(false);
    expect(r.provisional).toBe(true);
  });
  it("disputed expenses make it provisional", () => {
    const r = computeSettlement(base({ expenses: [{ id: "e1", paidBy: A, amountPaise: R(100), status: "disputed" }] }));
    expect(r.reasons).toContain("DISPUTED_EXPENSES");
  });
  it("awaiting review only blocks when the project requires confirmation", () => {
    const ex = [{ id: "e1", paidBy: A, amountPaise: R(100), status: "awaiting_review" as const }];
    expect(computeSettlement(base({ expenses: ex })).provisional).toBe(false);
    expect(computeSettlement(base({ expenses: ex, approvalPolicy: "require_confirmation" })).reasons).toContain("AWAITING_CONFIRMATION");
  });
  it("unapproved agreement and empty projects are provisional", () => {
    expect(computeSettlement(base({ agreementApproved: false })).reasons).toContain("AGREEMENT_NOT_APPROVED");
    expect(computeSettlement(base({ expenses: [], incomes: [] })).reasons).toContain("NO_RECORDS");
  });
  it("cash with no recorded holder is flagged", () => {
    const r = computeSettlement(base({ incomes: [{ id: "i", kind: "crop_sale", amountPaise: R(10), paymentStatus: "received", receivedBy: null, status: "active" }] }));
    expect(r.reasons).toContain("UNASSIGNED_CASH");
  });
});

describe("reversed records, payments and refunds", () => {
  it("excludes reversed records from every calculation", () => {
    const r = computeSettlement(
      base({
        expenses: [
          { id: "e1", paidBy: A, amountPaise: R(1000), status: "confirmed" },
          { id: "e2", paidBy: B, amountPaise: R(9999), status: "reversed" },
        ],
        incomes: [
          { id: "i1", kind: "crop_sale", amountPaise: R(5000), paymentStatus: "received", receivedBy: A, status: "active" },
          { id: "i2", kind: "crop_sale", amountPaise: R(7777), paymentStatus: "received", receivedBy: A, status: "reversed" },
        ],
      }),
    );
    expect(r.totalExpensesPaise).toBe(R(1000));
    expect(r.totalIncomePaise).toBe(R(5000));
    expect(r.excludedReversedExpenses).toBe(1);
    expect(r.excludedReversedIncomes).toBe(1);
  });
  it("partner payments reduce what is still due", () => {
    const r = computeSettlement(base({ payments: [{ id: "p", fromMember: A, toMember: B, amountPaise: R(100000), status: "active" }] }));
    expect(r.transfers).toEqual([{ fromParty: "landowner", toParty: "farmer", amountPaise: R(21115) }]);
  });
  it("adjustments can be negative (money returned)", () => {
    const r = computeSettlement(
      base({
        incomes: [
          { id: "i1", kind: "crop_sale", amountPaise: R(10000), paymentStatus: "received", receivedBy: A, status: "active" },
          { id: "i2", kind: "adjustment", amountPaise: -R(500), paymentStatus: "received", receivedBy: A, status: "active" },
        ],
      }),
    );
    expect(r.totalIncomePaise).toBe(R(9500));
  });
  it("three partners reconcile and need at most two transfers", () => {
    const r = computeSettlement(
      base({
        members: [
          { memberId: A, name: "A", expenseBps: 5000, profitBps: 5000 },
          { memberId: B, name: "B", expenseBps: 3000, profitBps: 3000 },
          { memberId: C, name: "C", expenseBps: 2000, profitBps: 2000 },
        ],
        expenses: [
          { id: "e1", paidBy: A, amountPaise: R(1000), status: "confirmed" },
          { id: "e2", paidBy: C, amountPaise: R(500), status: "confirmed" },
        ],
        incomes: [{ id: "i", kind: "crop_sale", amountPaise: R(4000), paymentStatus: "received", receivedBy: B, status: "active" }],
      }),
    );
    expect(r.reconciles).toBe(true);
    expect(r.transfers.length).toBeLessThanOrEqual(2);
    expect(r.transfers.reduce((a, t) => a + t.amountPaise, 0)).toBe(
      r.parties.filter((p) => p.remainingPaise > 0).reduce((a, p) => a + p.remainingPaise, 0),
    );
  });
});

describe("validation", () => {
  it("rejects shares that do not add up to 100%", () => {
    expect(() => computeSettlement(base({ members: [{ memberId: A, name: "A", expenseBps: 5000, profitBps: 5000 }, { memberId: B, name: "B", expenseBps: 4000, profitBps: 5000 }] }))).toThrow(TermsError);
    expect(() => computeSettlement(base({ members: [{ memberId: A, name: "A", expenseBps: 5000, profitBps: 6000 }, { memberId: B, name: "B", expenseBps: 5000, profitBps: 5000 }] }))).toThrow(TermsError);
  });
  it("rejects records that point to a member without shares", () => {
    expect(() => computeSettlement(base({ expenses: [{ id: "x", paidBy: "ghost", amountPaise: 1, status: "confirmed" }] }))).toThrow(TermsError);
  });
});

describe("totals and money helpers", () => {
  it("computeTotals separates received and pending", () => {
    const t = computeTotals({
      expenses: [{ id: "e", paidBy: A, amountPaise: 500, status: "confirmed" }],
      incomes: [
        { id: "1", kind: "crop_sale", amountPaise: 1000, paymentStatus: "received", receivedBy: A, status: "active" },
        { id: "2", kind: "crop_sale", amountPaise: 400, paymentStatus: "pending", receivedBy: null, status: "active" },
        { id: "3", kind: "other_income", amountPaise: 50, paymentStatus: "received", receivedBy: A, status: "active" },
      ],
    });
    expect(t).toMatchObject({ totalExpensesPaise: 500, receivedIncomePaise: 1050, pendingIncomePaise: 400, cropSalesRecordedPaise: 1400, otherIncomeRecordedPaise: 50 });
  });
  it("formats Indian grouping", () => {
    expect(formatINR(R(273310))).toBe("₹2,73,310");
    expect(formatINR(12345)).toBe("₹123.45");
    expect(formatINR(-R(500))).toBe("−₹500");
  });
  it("parses rupee input safely", () => {
    expect(parseRupeesToPaise("1,250.5")).toBe(125050);
    expect(parseRupeesToPaise("0.07")).toBe(7);
    expect(parseRupeesToPaise("abc")).toBeNull();
    expect(parseRupeesToPaise("12.345")).toBeNull();
    expect(parseRupeesToPaise("-5")).toBeNull();
  });
});
