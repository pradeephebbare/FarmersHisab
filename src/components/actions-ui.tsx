"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  amendSettlement, approveAgreement, confirmSettlement, createSettlement, markIncomeReceived, proposeAgreement, removeAttachment,
  removeMember, reverseExpense, reverseIncome, reversePayment, reviewExpense, setApprovalPolicy, setProjectStatus, type Result,
} from "@/app/actions";
import { useT } from "@/lib/i18n/provider";
import type { Key } from "@/lib/i18n";
import { clearAllDrafts } from "./hooks";
import { createClient } from "@/lib/supabase/client";

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);
  async function run(fn: () => Promise<Result>, after?: () => void): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) { setError(r.errorKey); return false; }
      after?.();
      router.refresh();
      return true;
    } catch {
      setError("common.networkError");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

/** A button that asks for a short written reason before doing something that changes the record. */
export function ReasonButton({ label, reasonLabel, required, variant = "quiet", onRun, confirmLabel }: {
  label: string; reasonLabel?: string; required?: boolean; variant?: "quiet" | "danger" | "green" | "primary";
  onRun: (note: string) => Promise<Result>; confirmLabel?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { busy, error, run } = useRun();
  const cls = { quiet: "btn-quiet", danger: "btn-danger", green: "btn-green", primary: "btn-primary" }[variant];
  if (!open) return <button type="button" className={`btn ${cls} w-full`} onClick={() => setOpen(true)}>{label}</button>;
  const tooShort = required && note.trim().length < 3;
  return (
    <div className="card space-y-3 border-2 border-field-200">
      <p className="font-bold">{label}</p>
      {reasonLabel && (
        <div>
          <label className="label" htmlFor="reason-box">{reasonLabel}</label>
          <textarea id="reason-box" rows={3} className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      {error && <p role="alert" className="field-error">{t(error)}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
        <button type="button" className={`btn ${cls}`} disabled={busy || tooShort} onClick={() => run(() => onRun(note), () => setOpen(false))}>
          {busy ? t("common.saving") : confirmLabel ?? t("common.confirm")}
        </button>
      </div>
    </div>
  );
}

export function ExpenseActions({ projectId, expenseId, status, canReview, canReverse, canAmend, locked, editHref }: {
  projectId: string; expenseId: string; status: string; canReview: boolean; canReverse: boolean; canAmend: boolean; locked: boolean; editHref: string;
}) {
  const t = useT();
  const { busy, error, run } = useRun();
  const router = useRouter();
  if (status === "reversed") return null;
  if (locked) return <p className="rounded-xl border-2 border-sky-700 bg-sky-50 p-3">{t("exp.locked")}</p>;
  return (
    <div className="space-y-3">
      {(status === "awaiting_review" || status === "confirmed" || status === "resolved") && canReview && (
        <>
          {status === "awaiting_review" && (
            <button type="button" className="btn btn-green w-full" disabled={busy} onClick={() => run(() => reviewExpense(projectId, expenseId, "confirm", ""))}>{t("exp.confirm")}</button>
          )}
          <ReasonButton label={t("exp.dispute")} reasonLabel={t("exp.disputeNote")} variant="danger" onRun={(n) => reviewExpense(projectId, expenseId, "dispute", n)} />
          {status === "awaiting_review" && <p className="hint">{t("exp.confirmNote")}</p>}
        </>
      )}
      {status === "disputed" && (
        <ReasonButton label={t("exp.resolve")} reasonLabel={t("exp.resolveNote")} required variant="green" onRun={(n) => reviewExpense(projectId, expenseId, "resolve", n)} />
      )}
      {error && <p role="alert" className="field-error">{t(error)}</p>}
      {canAmend && <button type="button" className="btn btn-quiet w-full" onClick={() => router.push(editHref)}>{t("exp.amend")}</button>}
      {canReverse && <ReasonButton label={t("exp.reverse")} reasonLabel={t("exp.reverseReason")} required variant="danger" onRun={(n) => reverseExpense(projectId, expenseId, n)} />}
    </div>
  );
}

export function RemoveAttachmentButton({ projectId, attachmentId }: { projectId: string; attachmentId: string }) {
  const t = useT();
  const { busy, run } = useRun();
  return <button type="button" className="btn btn-quiet px-3 py-2 text-sm" disabled={busy} onClick={() => run(() => removeAttachment(projectId, attachmentId))}>{t("exp.removePhoto")}</button>;
}

export function IncomeActions({ projectId, incomeId, pending, canReverse, members, meMemberId, locked }: {
  projectId: string; incomeId: string; pending: boolean; canReverse: boolean; members: { id: string; name: string }[]; meMemberId: string; locked: boolean;
}) {
  const t = useT();
  const { busy, error, run } = useRun();
  const [by, setBy] = useState(meMemberId);
  if (locked) return null;
  return (
    <div className="mt-3 space-y-2">
      {pending && (
        <div className="space-y-2">
          <label className="label" htmlFor={`by-${incomeId}`}>{t("inc.receivedBy")}</label>
          <select id={`by-${incomeId}`} className="input" value={by} onChange={(e) => setBy(e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button type="button" className="btn btn-green w-full" disabled={busy} onClick={() => run(() => markIncomeReceived(projectId, incomeId, by))}>{t("inc.markReceived")}</button>
        </div>
      )}
      {error && <p role="alert" className="field-error">{t(error)}</p>}
      {canReverse && <ReasonButton label={t("inc.reverse")} reasonLabel={t("inc.reverseReason")} required variant="danger" onRun={(n) => reverseIncome(projectId, incomeId, n)} />}
    </div>
  );
}

export function PaymentReverse({ projectId, paymentId }: { projectId: string; paymentId: string }) {
  const t = useT();
  return <ReasonButton label={t("pay.reverse")} reasonLabel={t("pay.reverseReason")} required variant="danger" onRun={(n) => reversePayment(projectId, paymentId, n)} />;
}

export function SettlementActions({ projectId, mode, basis, blocked, settlementId, iConfirmed, canAmend }: {
  projectId: string; mode: "preview" | "pending" | "final"; basis: "received" | "recorded"; blocked: boolean; settlementId?: string; iConfirmed?: boolean; canAmend?: boolean;
}) {
  const t = useT();
  const { busy, error, run } = useRun();
  return (
    <div className="space-y-3">
      {mode === "preview" && (
        <>
          <button type="button" className="btn btn-green w-full" disabled={busy || blocked} onClick={() => run(() => createSettlement(projectId, basis))}>{busy ? t("common.saving") : t("set.create")}</button>
          {blocked && <p className="hint">{t("set.blocked")}</p>}
        </>
      )}
      {mode === "pending" && settlementId && !iConfirmed && (
        <button type="button" className="btn btn-green w-full" disabled={busy} onClick={() => run(() => confirmSettlement(projectId, settlementId))}>{t("set.confirm")}</button>
      )}
      {error && <p role="alert" className="field-error">{t(error)}</p>}
      {(mode === "pending" || mode === "final") && settlementId && canAmend && (
        <>
          <p className="hint">{t("set.amendWarn")}</p>
          <ReasonButton label={t("set.amend")} reasonLabel={t("set.amendReason")} required variant="danger" onRun={(n) => amendSettlement(projectId, settlementId, n)} />
        </>
      )}
    </div>
  );
}

export function BasisToggle({ projectId, basis }: { projectId: string; basis: "received" | "recorded" }) {
  const t = useT();
  const router = useRouter();
  return (
    <fieldset>
      <legend className="label">{t("set.basis")}</legend>
      <div className="grid grid-cols-2 gap-2">
        {(["received", "recorded"] as const).map((b) => (
          <button key={b} type="button" aria-pressed={basis === b} onClick={() => router.replace(`/p/${projectId}/settlement?basis=${b}`)}
            className={`min-h-touch rounded-xl border-2 px-3 py-2 font-semibold ${basis === b ? "border-field-700 bg-field-700 text-white" : "border-field-200 bg-white"}`}>
            {b === "received" ? t("set.basisReceived") : t("set.basisRecorded")}
          </button>
        ))}
      </div>
      <p className="hint">{t("set.basisHelp")}</p>
    </fieldset>
  );
}

export function TermsEditor({ projectId, members, proposedId, canApprove, waitingNames, locked }: {
  projectId: string; members: { id: string; name: string }[];
  proposedId?: string; canApprove: boolean; waitingNames: string; locked: boolean;
}) {
  const t = useT();
  const equal = (n: number) => members.map((_, i) => Math.floor(10000 / n) + (i < 10000 % n ? 1 : 0));
  const eq = equal(members.length);
  const { busy, error, run } = useRun();
  const ok = members.length > 0;
  return (
    <div className="space-y-4">
      {proposedId && canApprove && !locked && (
        <div className="card space-y-2 border-2 border-turmeric-500">
          <p className="font-bold">{t("terms.approve")}</p>
          <button type="button" className="btn btn-green w-full" disabled={busy} onClick={() => run(() => approveAgreement(projectId, proposedId))}>{t("terms.approve")}</button>
        </div>
      )}
      {proposedId && waitingNames && <p className="rounded-xl border-2 border-sky-700 bg-sky-50 p-3">{t("terms.waiting", { names: waitingNames })}</p>}
      {!locked && (
        <div className="card space-y-3">
          <p className="font-bold">{t("terms.change")}</p>
          <p className="hint">{t("terms.changeNote")}</p>
          <p>{t("terms.fixedRule")}</p>
          <ul className="list-disc pl-5">{members.map((m) => <li key={m.id}>{m.name}</li>)}</ul>
          {error && <p role="alert" className="field-error">{t(error)}</p>}
          <button type="button" className="btn btn-primary w-full" disabled={!ok || busy}
            onClick={() => run(() => proposeAgreement(projectId, members.map((m, i) => ({ member_id: m.id, expense_bps: eq[i]!, profit_bps: eq[i]! }))))}>
            {busy ? t("common.saving") : t("terms.propose")}
          </button>
        </div>
      )}
    </div>
  );
}

export function MoreControls({ projectId, policy, status, isAdmin, locked }: { projectId: string; policy: string; status: string; isAdmin: boolean; locked: boolean }) {
  const t = useT();
  const { busy, error, run } = useRun();
  const [cleared, setCleared] = useState(false);
  return (
    <div className="space-y-5">
      {isAdmin && !locked && (
        <>
          <fieldset>
            <legend className="label">{t("more.policy")}</legend>
            <div className="grid gap-2">
              {(["notify_only", "require_confirmation"] as const).map((p) => (
                <label key={p} className={`flex min-h-touch cursor-pointer items-center rounded-xl border-2 px-4 py-2 font-semibold ${policy === p ? "border-field-700 bg-field-100" : "border-field-200 bg-white"}`}>
                  <input type="radio" className="sr-only" name="policy" checked={policy === p} disabled={busy} onChange={() => run(() => setApprovalPolicy(projectId, p))} />
                  {p === "notify_only" ? t("more.policyNotify") : t("more.policyRequire")}
                </label>
              ))}
            </div>
          </fieldset>
          {status !== "settled" && (
            <div>
              <label className="label" htmlFor="pstatus">{t("more.status")}</label>
              <select id="pstatus" className="input" value={status} disabled={busy} onChange={(e) => run(() => setProjectStatus(projectId, e.target.value))}>
                {(["active", "harvesting", "archived"] as const).map((s) => <option key={s} value={s}>{t(`ps.${s}`)}</option>)}
              </select>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="field-error">{t(error)}</p>}
      <div className="card">
        <p className="mb-2 text-sm">{t("more.sharedDevice")}</p>
        <button type="button" className="btn btn-quiet w-full" onClick={() => { clearAllDrafts(); setCleared(true); }}>{t("more.clearDrafts")}</button>
        {cleared && <p role="status" className="mt-2 font-semibold">{t("more.draftsCleared")}</p>}
      </div>
    </div>
  );
}

export function MemberRemove({ projectId, memberId, name, self }: { projectId: string; memberId: string; name: string; self: boolean }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useRun();
  const [ask, setAsk] = useState(false);
  if (!ask) return <button type="button" className="btn btn-danger px-3 py-2 text-sm" onClick={() => setAsk(true)}>{self ? t("more.leave") : t("more.removeMember")}</button>;
  return (
    <div className="mt-2 rounded-xl border-2 border-chili-700 bg-chili-50 p-3">
      <p className="mb-2">{self ? t("more.confirmLeave") : t("more.confirmRemove", { name })}</p>
      {error && <p role="alert" className="field-error">{t(error)}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-quiet" onClick={() => setAsk(false)}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => run(() => removeMember(projectId, memberId), () => { if (self) router.replace("/"); })}>{t("common.confirm")}</button>
      </div>
    </div>
  );
}

export function SignOutButton() {
  const t = useT();
  const router = useRouter();
  return (
    <button type="button" className="btn btn-quiet w-full" onClick={async () => {
      clearAllDrafts();
      await createClient().auth.signOut();
      router.replace("/login");
      router.refresh();
    }}>{t("common.signOut")}</button>
  );
}
