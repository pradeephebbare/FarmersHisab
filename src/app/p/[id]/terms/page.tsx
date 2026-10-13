import { loadLedger, loadProject } from "@/lib/data";
import { getT } from "@/lib/i18n/server";
import { Notice, PageHeader } from "@/components/ui";
import { TermsEditor } from "@/components/actions-ui";

export default async function Terms({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, members, activeMembers, user } = await loadProject(id);
  const ledger = await loadLedger(supabase, id);
  const { t } = await getT();
  const locked = ledger.settlement !== null;
  const current = ledger.proposed ?? ledger.approved;
  const waiting = ledger.proposed ? activeMembers.filter((m) => !ledger.proposed!.approvedBy.includes(m.user_id)) : [];
  const iNeedToApprove = ledger.proposed ? !ledger.proposed.approvedBy.includes(user.id) : false;
  return (
    <>
      <PageHeader title={t("terms.title")} back={{ href: `/p/${id}/more`, label: t("nav.more") }} />
      <p className="mb-4">{t("terms.body")}</p>
      <div className="space-y-4">
        <p className="card">{t("terms.explain")}</p>
        {activeMembers.length < 2 && <Notice tone="info">{t("terms.needPartner")}</Notice>}
        {locked && <Notice tone="info">{t("terms.locked")}</Notice>}
        {ledger.approved && (
          <section className="card">
            <p className="mb-2 font-bold">{t("terms.approved")} · {t("terms.versionLabel", { n: ledger.approved.version })}</p>
            <p>{t("terms.fixedRule")}</p>
          </section>
        )}
        {ledger.proposed && (
          <section className="card border-2 border-turmeric-500">
            <p className="mb-2 font-bold">{t("terms.versionLabel", { n: ledger.proposed.version })}</p>
            <p>{t("terms.fixedRule")}</p>
          </section>
        )}
        {!ledger.approved && !ledger.proposed && <p className="text-ink-soft">{t("terms.none")}</p>}
        <TermsEditor
          key={`${ledger.proposed?.id ?? ""}${ledger.approved?.id ?? ""}`}
          projectId={id} members={activeMembers.map((m) => ({ id: m.id, name: m.display_name }))}
          proposedId={ledger.proposed?.id} canApprove={iNeedToApprove} waitingNames={waiting.map((m) => m.display_name).join(", ")} locked={locked}
        />
      </div>
    </>
  );
}
