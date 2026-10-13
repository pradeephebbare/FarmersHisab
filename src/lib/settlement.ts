/**
 * FarmHisab settlement engine — the ONLY place financial totals are calculated.
 *
 * Model (documented assumptions, shown to users on the settlement screen):
 *  1. Expenses tagged for the landowner or farmer count toward that party's spending.
 *  2. Total expenses are shared equally; the difference shows who spent above or below
 *     that share.
 *  3. Net profit (income − expenses), or a loss, is split equally between both parties.
 *  4. Final distribution = tagged expenses + equal profit share. Distributions add up
 *     to counted income exactly.
 *  5. Remaining due compares each party's distribution with cash received by its
 *     project members and payments already recorded between those members.
 *
 * All values are integer paise. Percentages are integer basis points (10000 = 100%).
 */

export type ExpenseStatus = "awaiting_review" | "confirmed" | "disputed" | "resolved" | "reversed";
export type IncomeKind = "crop_sale" | "other_income" | "refund_received" | "adjustment";
export type Basis = "received" | "recorded";
export type ApprovalPolicy = "notify_only" | "require_confirmation";
export type PartyRole = "landowner" | "farmer";

export interface MemberTerms {
  memberId: string;
  name: string;
  expenseBps: number;
  profitBps: number;
  partyRole?: PartyRole;
}
export interface ExpenseIn {
  id: string;
  paidBy: string;
  amountPaise: number;
  status: ExpenseStatus;
  expenseFor?: PartyRole;
}
export interface IncomeIn {
  id: string;
  kind: IncomeKind;
  /** Signed. Only `adjustment` may be negative. */
  amountPaise: number;
  paymentStatus: "received" | "pending";
  receivedBy: string | null;
  status: "active" | "reversed";
}
export interface PaymentIn {
  id: string;
  fromMember: string;
  toMember: string;
  amountPaise: number;
  status: "active" | "reversed";
}
export interface SettlementInput {
  members: MemberTerms[];
  expenses: ExpenseIn[];
  incomes: IncomeIn[];
  payments: PaymentIn[];
  basis: Basis;
  approvalPolicy: ApprovalPolicy;
  agreementApproved: boolean;
}

export type ProvisionalReason =
  | "DISPUTED_EXPENSES"
  | "AWAITING_CONFIRMATION"
  | "PENDING_INCOME"
  | "UNASSIGNED_CASH"
  | "AGREEMENT_NOT_APPROVED"
  | "NO_RECORDS";

export interface MemberResult {
  memberId: string;
  name: string;
  expensesPaidPaise: number;
  expenseSharePaise: number;
  /** paid − agreed share. Positive = paid more than their share. */
  contributionDiffPaise: number;
  /** Signed: negative when the season made a loss. */
  profitSharePaise: number;
  distributionPaise: number;
  cashHeldPaise: number;
  paymentsMadePaise: number;
  paymentsReceivedPaise: number;
  /** Positive = this partner is still owed money. Negative = this partner owes money. */
  remainingPaise: number;
}
export interface Transfer {
  fromParty?: PartyRole;
  toParty?: PartyRole;
  fromMemberId?: string;
  toMemberId?: string;
  amountPaise: number;
}
export interface PartyResult {
  party: PartyRole;
  expensesPaise: number;
  expenseSharePaise: number;
  contributionDiffPaise: number;
  profitSharePaise: number;
  distributionPaise: number;
  cashHeldPaise: number;
  paymentsMadePaise: number;
  paymentsReceivedPaise: number;
  remainingPaise: number;
}
export interface SettlementResult {
  basis: Basis;
  totalIncomePaise: number;
  totalExpensesPaise: number;
  netPaise: number;
  isLoss: boolean;
  /** Pending (unpaid) income, signed. Counted only when basis = "recorded". */
  pendingIncomePaise: number;
  receivedIncomePaise: number;
  unassignedCashPaise: number;
  parties: PartyResult[];
  members: MemberResult[];
  transfers: Transfer[];
  transfersAvailable: boolean;
  provisional: boolean;
  reasons: ProvisionalReason[];
  disputedExpenseIds: string[];
  awaitingExpenseIds: string[];
  excludedReversedExpenses: number;
  excludedReversedIncomes: number;
  /** Self-check: party distributions add up to income and equal profit shares add up to net. */
  reconciles: boolean;
}

export type TermsErrorCode = "NO_MEMBERS" | "EXPENSE_BPS" | "PROFIT_BPS" | "MISSING_MEMBER";
export class TermsError extends Error {
  constructor(public code: TermsErrorCode, message: string) {
    super(message);
    this.name = "TermsError";
  }
}

/** Splits `total` paise by basis points using the largest-remainder method. Exact; no float math. */
export function allocate(total: number, bps: number[]): number[] {
  const negative = total < 0;
  const abs = BigInt(Math.abs(total));
  const parts = bps.map((b) => abs * BigInt(b));
  const floors = parts.map((p) => p / 10000n);
  const rems = parts.map((p) => p % 10000n);
  let left = abs - floors.reduce((a, b) => a + b, 0n);
  const order = bps
    .map((_, i) => i)
    .sort((i, j) => {
      const ri = rems[i] as bigint;
      const rj = rems[j] as bigint;
      return ri === rj ? i - j : ri > rj ? -1 : 1;
    });
  const out = [...floors];
  for (const idx of order) {
    if (left <= 0n) break;
    out[idx] = (out[idx] as bigint) + 1n;
    left -= 1n;
  }
  return out.map((v) => Number(negative ? -v : v));
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function validateTerms(input: Pick<SettlementInput, "members" | "expenses" | "incomes" | "payments">): void {
  const { members } = input;
  if (members.length === 0) throw new TermsError("NO_MEMBERS", "No members");
  if (sum(members.map((m) => m.expenseBps)) !== 10000 || members.some((m) => !Number.isInteger(m.expenseBps) || m.expenseBps < 0))
    throw new TermsError("EXPENSE_BPS", "Expense shares must add up to 100%");
  if (sum(members.map((m) => m.profitBps)) !== 10000 || members.some((m) => !Number.isInteger(m.profitBps) || m.profitBps < 0))
    throw new TermsError("PROFIT_BPS", "Profit shares must add up to 100%");
  const ids = new Set(members.map((m) => m.memberId));
  const referenced = [
    ...input.expenses.filter((e) => e.status !== "reversed").map((e) => e.paidBy),
    ...input.incomes.filter((i) => i.status === "active" && i.receivedBy).map((i) => i.receivedBy as string),
    ...input.payments.filter((p) => p.status === "active").flatMap((p) => [p.fromMember, p.toMember]),
  ];
  if (referenced.some((id) => !ids.has(id))) throw new TermsError("MISSING_MEMBER", "A record refers to a member without agreed shares");
}

/** Plain totals used by the dashboard and income/expense lists. */
export function computeTotals(args: { expenses: ExpenseIn[]; incomes: IncomeIn[] }) {
  const liveExpenses = args.expenses.filter((e) => e.status !== "reversed");
  const liveIncomes = args.incomes.filter((i) => i.status === "active");
  return {
    totalExpensesPaise: sum(liveExpenses.map((e) => e.amountPaise)),
    receivedIncomePaise: sum(liveIncomes.filter((i) => i.paymentStatus === "received").map((i) => i.amountPaise)),
    pendingIncomePaise: sum(liveIncomes.filter((i) => i.paymentStatus === "pending").map((i) => i.amountPaise)),
    cropSalesRecordedPaise: sum(liveIncomes.filter((i) => i.kind === "crop_sale").map((i) => i.amountPaise)),
    otherIncomeRecordedPaise: sum(liveIncomes.filter((i) => i.kind !== "crop_sale").map((i) => i.amountPaise)),
  };
}

export function computeSettlement(input: SettlementInput): SettlementResult {
  validateTerms(input);
  const { members, basis } = input;

  const expenses = input.expenses.filter((e) => e.status !== "reversed");
  const incomes = input.incomes.filter((i) => i.status === "active");
  const payments = input.payments.filter((p) => p.status === "active");

  const totalExpensesPaise = sum(expenses.map((e) => e.amountPaise));
  const received = incomes.filter((i) => i.paymentStatus === "received");
  const pending = incomes.filter((i) => i.paymentStatus === "pending");
  const receivedIncomePaise = sum(received.map((i) => i.amountPaise));
  const pendingIncomePaise = sum(pending.map((i) => i.amountPaise));
  const totalIncomePaise = basis === "recorded" ? receivedIncomePaise + pendingIncomePaise : receivedIncomePaise;
  const netPaise = totalIncomePaise - totalExpensesPaise;

  const profitShares = allocate(netPaise, members.map((m) => m.profitBps));
  const expenseShares = allocate(totalExpensesPaise, members.map((m) => m.expenseBps));

  const partyForMember = new Map(members.map((m, idx) => [m.memberId, m.partyRole ?? (idx === 0 ? "landowner" : "farmer")]));
  const roles: PartyRole[] = ["landowner", "farmer"];
  const partyExpenses = roles.map((party) => sum(expenses
    .filter((e) => (e.expenseFor ?? partyForMember.get(e.paidBy) ?? "landowner") === party)
    .map((e) => e.amountPaise)));
  const partyExpenseShares = allocate(totalExpensesPaise, [5000, 5000]);
  const partyProfitShares = allocate(netPaise, [5000, 5000]);

  const assignedCash = new Map<string, number>();
  let unassignedCashPaise = 0;
  for (const i of received) {
    if (i.receivedBy) assignedCash.set(i.receivedBy, (assignedCash.get(i.receivedBy) ?? 0) + i.amountPaise);
    else unassignedCashPaise += i.amountPaise;
  }

  const memberResults: MemberResult[] = members.map((m, idx) => {
    const paid = sum(expenses.filter((e) => e.paidBy === m.memberId).map((e) => e.amountPaise));
    const made = sum(payments.filter((p) => p.fromMember === m.memberId).map((p) => p.amountPaise));
    const got = sum(payments.filter((p) => p.toMember === m.memberId).map((p) => p.amountPaise));
    const held = assignedCash.get(m.memberId) ?? 0;
    const profitShare = profitShares[idx] as number;
    const expenseShare = expenseShares[idx] as number;
    const distribution = paid + profitShare;
    return {
      memberId: m.memberId,
      name: m.name,
      expensesPaidPaise: paid,
      expenseSharePaise: expenseShare,
      contributionDiffPaise: paid - expenseShare,
      profitSharePaise: profitShare,
      distributionPaise: distribution,
      cashHeldPaise: held,
      paymentsMadePaise: made,
      paymentsReceivedPaise: got,
      // cash now in hand = held + payments received − payments made
      remainingPaise: distribution - (held + got - made),
    };
  });

  const parties: PartyResult[] = roles.map((party, idx) => {
    const held = sum(received.filter((i) => i.receivedBy && partyForMember.get(i.receivedBy) === party).map((i) => i.amountPaise));
    const made = sum(payments.filter((p) => partyForMember.get(p.fromMember) === party).map((p) => p.amountPaise));
    const got = sum(payments.filter((p) => partyForMember.get(p.toMember) === party).map((p) => p.amountPaise));
    const expensesPaid = partyExpenses[idx] as number;
    const expenseShare = partyExpenseShares[idx] as number;
    const profitShare = partyProfitShares[idx] as number;
    const distribution = expensesPaid + profitShare;
    return {
      party,
      expensesPaise: expensesPaid,
      expenseSharePaise: expenseShare,
      contributionDiffPaise: expensesPaid - expenseShare,
      profitSharePaise: profitShare,
      distributionPaise: distribution,
      cashHeldPaise: held,
      paymentsMadePaise: made,
      paymentsReceivedPaise: got,
      remainingPaise: distribution - (held + got - made),
    };
  });

  const positionsTotal = sum(parties.map((p) => p.remainingPaise));
  const transfersAvailable = positionsTotal === 0;
  const transfers: Transfer[] = [];
  if (transfersAvailable) {
    const debtors: { id: PartyRole; amt: number }[] = parties.filter((p) => p.remainingPaise < 0).map((p) => ({ id: p.party, amt: -p.remainingPaise })).sort((a, b) => b.amt - a.amt);
    const creditors: { id: PartyRole; amt: number }[] = parties.filter((p) => p.remainingPaise > 0).map((p) => ({ id: p.party, amt: p.remainingPaise })).sort((a, b) => b.amt - a.amt);
    let d = 0;
    let c = 0;
    while (d < debtors.length && c < creditors.length) {
      const debtor = debtors[d] as { id: PartyRole; amt: number };
      const creditor = creditors[c] as { id: PartyRole; amt: number };
      const pay = Math.min(debtor.amt, creditor.amt);
      if (pay > 0) transfers.push({ fromParty: debtor.id, toParty: creditor.id, amountPaise: pay });
      debtor.amt -= pay;
      creditor.amt -= pay;
      if (debtor.amt === 0) d++;
      if (creditor.amt === 0) c++;
    }
  }

  const disputedExpenseIds = expenses.filter((e) => e.status === "disputed").map((e) => e.id);
  const awaitingExpenseIds = expenses.filter((e) => e.status === "awaiting_review").map((e) => e.id);
  const reasons: ProvisionalReason[] = [];
  if (!input.agreementApproved) reasons.push("AGREEMENT_NOT_APPROVED");
  if (disputedExpenseIds.length > 0) reasons.push("DISPUTED_EXPENSES");
  if (input.approvalPolicy === "require_confirmation" && awaitingExpenseIds.length > 0) reasons.push("AWAITING_CONFIRMATION");
  if (pending.length > 0) reasons.push("PENDING_INCOME");
  if (unassignedCashPaise !== 0) reasons.push("UNASSIGNED_CASH");
  if (expenses.length === 0 && incomes.length === 0) reasons.push("NO_RECORDS");

  return {
    basis,
    totalIncomePaise,
    totalExpensesPaise,
    netPaise,
    isLoss: netPaise < 0,
    pendingIncomePaise,
    receivedIncomePaise,
    unassignedCashPaise,
    parties,
    members: memberResults,
    transfers,
    transfersAvailable,
    provisional: reasons.length > 0,
    reasons,
    disputedExpenseIds,
    awaitingExpenseIds,
    excludedReversedExpenses: input.expenses.length - expenses.length,
    excludedReversedIncomes: input.incomes.length - incomes.length,
    reconciles:
      sum(parties.map((p) => p.distributionPaise)) === totalIncomePaise &&
      sum(partyProfitShares) === netPaise &&
      sum(partyExpenses) === totalExpensesPaise,
  };
}
