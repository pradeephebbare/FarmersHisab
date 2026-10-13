import { formatINR } from "@/lib/money";
import type { TFn } from "@/lib/i18n";
import type { SettlementResult } from "@/lib/settlement";
import { Notice, Row } from "./ui";

/** Pure display of an engine result. No arithmetic on money happens here except choosing signs/labels. */
export function SettlementReport({ r, t }: { r: SettlementResult; t: TFn }) {
  const nameOfMember = (id: string | undefined) => r.members.find((m) => m.memberId === id)?.name ?? "";
  const nameOfParty = (party: "landowner" | "farmer") => t(`role.${party}`);
  const partyResults = r.parties ?? [];
  return (
    <div className="space-y-4">
      {r.provisional && (
        <Notice tone="warn">
          <p className="font-bold">{t("set.provisional")}</p>
          <p>{t("set.provisionalWhy")}</p>
          <ul className="list-disc pl-5">{r.reasons.map((k) => <li key={k}>{t(`set.reason.${k}`)}</li>)}</ul>
        </Notice>
      )}

      <section className="khata">
        <Row label={t("set.totalIncome")} value={formatINR(r.totalIncomePaise)} />
        <Row label={t("set.totalExpenses")} value={formatINR(r.totalExpensesPaise)} />
        <Row label={r.isLoss ? t("set.loss") : t("set.profit")} value={formatINR(r.netPaise)} strong tone={r.isLoss ? "neg" : undefined} />
        {r.pendingIncomePaise !== 0 && <p className="mt-2 text-sm font-semibold">{t("set.pendingFromBuyers", { amount: formatINR(r.pendingIncomePaise) })}</p>}
      </section>

      {partyResults.length > 0 ? partyResults.map((m) => (
        <section key={m.party} className="card">
          <h3 className="mb-1 text-lg font-bold">{nameOfParty(m.party)}</h3>
          <Row label={t("set.partyExpenses")} value={formatINR(m.expensesPaise)} />
          <Row label={t("set.expenseShare")} value={formatINR(m.expenseSharePaise)} />
          <Row label={m.contributionDiffPaise >= 0 ? t("set.diffMore") : t("set.diffLess")} value={formatINR(Math.abs(m.contributionDiffPaise))} />
          <Row label={m.profitSharePaise < 0 ? t("set.lossShare") : t("set.profitShare")} value={formatINR(m.profitSharePaise)} tone={m.profitSharePaise < 0 ? "neg" : undefined} />
          <div className="my-2 rounded-xl bg-field-100 p-3">
            <p className="text-sm font-semibold">{t("set.finalAmount", { name: nameOfParty(m.party) })}</p>
            <p className="text-2xl font-bold tabular-nums">{formatINR(m.distributionPaise)}</p>
          </div>
          <Row label={t("set.cashHeld")} value={formatINR(m.cashHeldPaise)} />
          {m.paymentsMadePaise > 0 && <Row label={t("set.paymentsMade")} value={formatINR(m.paymentsMadePaise)} />}
          {m.paymentsReceivedPaise > 0 && <Row label={t("set.paymentsReceived")} value={formatINR(m.paymentsReceivedPaise)} />}
          <Row
            label={m.remainingPaise === 0 ? t("set.settledUp") : m.remainingPaise > 0 ? t("set.remaining") : t("set.remainingOwes")}
            value={formatINR(Math.abs(m.remainingPaise))} strong
          />
        </section>
      )) : r.members.map((m) => (
        <section key={m.memberId} className="card">
          <h3 className="mb-1 text-lg font-bold">{m.name}</h3>
          <Row label={t("set.paid")} value={formatINR(m.expensesPaidPaise)} />
          <Row label={t("set.expenseShare")} value={formatINR(m.expenseSharePaise)} />
          <Row label={m.contributionDiffPaise >= 0 ? t("set.diffMore") : t("set.diffLess")} value={formatINR(Math.abs(m.contributionDiffPaise))} />
          <Row label={m.profitSharePaise < 0 ? t("set.lossShare") : t("set.profitShare")} value={formatINR(m.profitSharePaise)} tone={m.profitSharePaise < 0 ? "neg" : undefined} />
          <div className="my-2 rounded-xl bg-field-100 p-3">
            <p className="text-sm font-semibold">{t("set.finalAmount", { name: m.name })}</p>
            <p className="text-2xl font-bold tabular-nums">{formatINR(m.distributionPaise)}</p>
          </div>
          <Row label={t("set.cashHeld")} value={formatINR(m.cashHeldPaise)} />
          {m.paymentsMadePaise > 0 && <Row label={t("set.paymentsMade")} value={formatINR(m.paymentsMadePaise)} />}
          {m.paymentsReceivedPaise > 0 && <Row label={t("set.paymentsReceived")} value={formatINR(m.paymentsReceivedPaise)} />}
          <Row
            label={m.remainingPaise === 0 ? t("set.settledUp") : m.remainingPaise > 0 ? t("set.remaining") : t("set.remainingOwes")}
            value={formatINR(Math.abs(m.remainingPaise))} strong
          />
        </section>
      ))}

      <section className="card">
        <h3 className="mb-2 text-lg font-bold">{t("set.transfers")}</h3>
        {!r.transfersAvailable ? <p>{t("set.transfersUnavailable")}</p> : r.transfers.length === 0 ? <p>{t("set.noTransfers")}</p> : (
          <ul className="space-y-2">
            {r.transfers.map((x, i) => (
              <li key={i} className="rounded-xl bg-turmeric-400/20 p-3 font-bold">{t("set.pays", {
                from: x.fromParty ? nameOfParty(x.fromParty) : nameOfMember(x.fromMemberId),
                to: x.toParty ? nameOfParty(x.toParty) : nameOfMember(x.toMemberId),
                amount: formatINR(x.amountPaise),
              })}</li>
            ))}
          </ul>
        )}
      </section>

      {(r.excludedReversedExpenses + r.excludedReversedIncomes > 0 || r.disputedExpenseIds.length > 0) && (
        <section className="card text-sm">
          {r.excludedReversedExpenses + r.excludedReversedIncomes > 0 && <p>{t("set.excluded", { n: r.excludedReversedExpenses + r.excludedReversedIncomes })}</p>}
          {r.disputedExpenseIds.length > 0 && <p>{t("set.disputedItems")} ({r.disputedExpenseIds.length})</p>}
        </section>
      )}

      <section className="card">
        <h3 className="mb-2 text-lg font-bold">{t("set.explainTitle")}</h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>{t("set.explain1", { income: formatINR(r.totalIncomePaise), expenses: formatINR(r.totalExpensesPaise), net: formatINR(r.netPaise) })}</li>
          <li>{t(partyResults.length > 0 ? "set.explain2" : "set.legacyExplain2")}</li>
          <li>{t(partyResults.length > 0 ? "set.explain3" : "set.legacyExplain3", { net: formatINR(r.netPaise) })}</li>
          <li>{t(partyResults.length > 0 ? "set.explain4" : "set.legacyExplain4")}</li>
        </ol>
        <p className={`mt-3 font-semibold ${r.reconciles ? "" : "text-chili-700"}`}>{r.reconciles ? t("set.reconciled") : t("set.notReconciled")}</p>
      </section>
      <p className="text-sm text-ink-soft">{t("set.disclaimer")}</p>
    </div>
  );
}
