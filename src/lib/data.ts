import "server-only";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { AgreementRow, ExpenseRow, IncomeRow, Member, PaymentRow, Project, SettlementRow, ShareRow } from "@/lib/types";
import type { Basis, SettlementInput } from "@/lib/settlement";

export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
}

/** Loads the project and the caller's membership. RLS guarantees non-members get nothing → 404. */
export async function loadProject(projectId: string) {
  const { supabase, user } = await requireUser();
  const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle<Project>();
  if (!project) notFound();
  const { data: members } = await supabase.from("project_members").select("*").eq("project_id", projectId).order("joined_at").returns<Member[]>();
  const all = members ?? [];
  const me = all.find((m) => m.user_id === user.id && m.status === "active");
  if (!me) notFound();
  return { supabase, user, project, members: all, activeMembers: all.filter((m) => m.status === "active"), me };
}

export interface Ledger {
  expenses: ExpenseRow[];
  incomes: IncomeRow[];
  payments: PaymentRow[];
  approved: (AgreementRow & { shares: ShareRow[] }) | null;
  proposed: (AgreementRow & { shares: ShareRow[]; approvedBy: string[] }) | null;
  settlement: SettlementRow | null;
  confirmations: string[];
}

export async function loadLedger(supabase: SupabaseClient, projectId: string): Promise<Ledger> {
  const [exp, inc, pay, agr, sets] = await Promise.all([
    supabase.from("expenses").select("*").eq("project_id", projectId).order("expense_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("incomes").select("*").eq("project_id", projectId).order("income_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("payments").select("*").eq("project_id", projectId).order("paid_on", { ascending: false }),
    supabase.from("agreement_versions").select("*").eq("project_id", projectId).in("status", ["approved", "proposed"]).order("version", { ascending: false }),
    supabase.from("settlements").select("*").eq("project_id", projectId).in("status", ["pending_confirmation", "final"]).order("version", { ascending: false }).limit(1),
  ]);
  const agreements = (agr.data ?? []) as AgreementRow[];
  const ids = agreements.map((a) => a.id);
  const [shares, approvals] = ids.length
    ? await Promise.all([
        supabase.from("agreement_shares").select("*").in("agreement_id", ids),
        supabase.from("agreement_approvals").select("agreement_id,user_id").in("agreement_id", ids),
      ])
    : [{ data: [] as ShareRow[] }, { data: [] as { agreement_id: string; user_id: string }[] }];
  const sh = (shares.data ?? []) as ShareRow[];
  const ap = (approvals.data ?? []) as { agreement_id: string; user_id: string }[];
  const approvedRow = agreements.find((a) => a.status === "approved");
  const proposedRow = agreements.find((a) => a.status === "proposed");
  const settlement = ((sets.data ?? [])[0] as SettlementRow | undefined) ?? null;
  let confirmations: string[] = [];
  if (settlement) {
    const { data } = await supabase.from("settlement_confirmations").select("user_id").eq("settlement_id", settlement.id);
    confirmations = (data ?? []).map((r: { user_id: string }) => r.user_id);
  }
  return {
    expenses: (exp.data ?? []) as ExpenseRow[],
    incomes: (inc.data ?? []) as IncomeRow[],
    payments: (pay.data ?? []) as PaymentRow[],
    approved: approvedRow ? { ...approvedRow, shares: sh.filter((s) => s.agreement_id === approvedRow.id) } : null,
    proposed: proposedRow
      ? { ...proposedRow, shares: sh.filter((s) => s.agreement_id === proposedRow.id), approvedBy: ap.filter((a) => a.agreement_id === proposedRow.id).map((a) => a.user_id) }
      : null,
    settlement,
    confirmations,
  };
}

/** Converts database rows into the engine's input. Returns null until an approved agreement exists. */
export function buildSettlementInput(project: Project, members: Member[], ledger: Ledger, basis: Basis): SettlementInput | null {
  if (!ledger.approved) return null;
  const byId = new Map(members.map((m) => [m.id, m]));
  return {
    basis,
    approvalPolicy: project.approval_policy,
    agreementApproved: true,
    members: ledger.approved.shares.map((s) => ({
      memberId: s.member_id,
      name: byId.get(s.member_id)?.display_name ?? "?",
      expenseBps: s.expense_bps,
      profitBps: s.profit_bps,
      partyRole: byId.get(s.member_id)?.role === "farmer" ? "farmer" : "landowner",
    })),
    expenses: ledger.expenses.map((e) => ({
      id: e.id, paidBy: e.paid_by, amountPaise: Number(e.amount_paise), status: e.status, expenseFor: e.expense_for,
    })),
    incomes: ledger.incomes.map((i) => ({
      id: i.id, kind: i.kind, amountPaise: Number(i.amount_paise), paymentStatus: i.payment_status, receivedBy: i.received_by, status: i.status,
    })),
    payments: ledger.payments.map((p) => ({ id: p.id, fromMember: p.from_member, toMember: p.to_member, amountPaise: Number(p.amount_paise), status: p.status })),
  };
}
