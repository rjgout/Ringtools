import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestUser, createCalling, resetDatabase } from "./setup";
import { assignTask, castVote, completeTask, releaseToHogeraad, releaseForExecution, notifyTaskAssignee, sendDue30DayReminders } from "@/lib/workflow";
import { dispatchExecutionNotifications, executionDeliveryHooks, queueExecutionNotifications } from "@/lib/executionNotifications";
import { notify } from "@/lib/notifications";
import { getCallingView, getDashboard, listCallingsFor, listNotificationsFor } from "@/lib/api/service";
import { createOpenLink, resolveOpenLink, sendOpenLinkPush } from "@/lib/openLinks";
import { functionalActionEmail, ACTION_PUSH } from "@/lib/notificationText";
const mocks = vi.hoisted(() => ({ mail: vi.fn(async (input: unknown) => { void input; }), push: vi.fn(async (ids: unknown, payload: unknown) => { void ids; void payload; }) }));
vi.mock("@/lib/mailer", async original => ({ ...(await original<typeof import("@/lib/mailer")>()), sendMail: mocks.mail }));
vi.mock("@/lib/push", async original => ({ ...(await original<typeof import("@/lib/push")>()), sendPushToUsers: mocks.push }));
beforeEach(async () => { await resetDatabase(); vi.clearAllMocks(); });
afterEach(() => { delete executionDeliveryHooks.beforeSend; vi.restoreAllMocks(); });
async function world() {
  const p = await createTestUser("RINGPRESIDIUM", "Fictieve presidiumbeoordelaar");
  const h = await createTestUser("HOGERAAD", "Fictieve raadsbeoordelaar");
  const u = await createTestUser("HOGERAAD", "Fictieve latere uitvoerder");
  const b = await createTestUser("HOGERAAD", "Fictieve vervanger");
  const c = await createCalling({ personName: "Vertrouwelijke Fictieve Kandidaat", functionTitle: "Vertrouwelijke Fictieve Functie", createdById: p.id, roepenAssigneeId: u.id });
  return { p, h, u, b, c };
}
type World = Awaited<ReturnType<typeof world>>;
async function presidency(w: World) { await castVote({ callingId: w.c.id, userId: w.p.id, support: true }); }
async function council(w: World) {
  await presidency(w); await releaseToHogeraad({ callingId: w.c.id, actorId: w.p.id });
  // Bestaande hogeraadsleden blijven zelfstandig bevoegd voor hun beoordelingsronde.
  for (const u of [w.u,w.b]) await castVote({ callingId: w.c.id, userId: u.id, support: true });
}
async function approved(w: World) { await council(w); await castVote({ callingId: w.c.id, userId: w.h.id, support: true }); }
const taskCount = (callingId: string) => prisma.notification.count({ where: { callingId, type: "TASK_ASSIGNED" } });

it("toewijzing in concept en bij indienen verstuurt geen uitvoeringsmelding", async () => {
  const w = await world();
  const { createDraft } = await import("@/lib/proposals");
  await createDraft(w.p.id, w.c.ringId, { roepenAssigneeId: w.u.id });
  expect(await taskCount(w.c.id)).toBe(0);
  expect(await prisma.taskNotification.count()).toBe(0);
  expect(mocks.mail.mock.calls.some(([m]) => (m as {to:string}).to === w.u.email)).toBe(false);
});
it.each(["presidium", "presidium-akkoord", "hogeraad", "negatief", "uitgesteld-akkoord"])("geen uitvoering bij %s, ook niet bij opnieuw opslaan of rechtstreekse notificatieaanroep", async state => {
  const w = await world();
  if (state === "presidium-akkoord") await presidency(w);
  if (["hogeraad","negatief","uitgesteld-akkoord"].includes(state)) await council(w);
  if (state === "negatief") await castVote({ callingId: w.c.id, userId: w.h.id, support: false });
  if (state === "uitgesteld-akkoord") await castVote({ callingId: w.c.id, userId: w.h.id, support: true });
  mocks.mail.mockClear(); mocks.push.mockClear();
  await assignTask({ callingId: w.c.id, task: "ROEPEN", assigneeId: w.u.id });
  await notifyTaskAssignee(w.c.id, "ROEPEN", w.u.id);
  expect(await taskCount(w.c.id)).toBe(0);
  expect(await prisma.taskNotification.count()).toBe(0);
  expect(mocks.mail).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
});
it("vooraf toegewezen uitvoerder krijgt geen detail, lijst, taken, badge, notificatie of oude deeplink", async () => {
  const w = await world();
  await prisma.notification.create({ data: { userId: w.u.id, ringId: w.c.ringId, callingId: w.c.id, type: "TASK_ASSIGNED", title: "Oude taakmelding", message: "Oude voortijdige melding", targetUrl: `/roepingen/${w.c.id}` } });
  await expect(getCallingView(w.u.id, w.c.id)).rejects.toMatchObject({ status: 403 });
  expect(await listCallingsFor(w.u.id, w.c.ringId, "alle")).toEqual([]);
  expect((await getDashboard(w.u.id, w.c.ringId)).myTasks).toEqual([]);
  expect(await listNotificationsFor(w.u.id, w.c.ringId)).toMatchObject({ unreadCount: 0, notifications: [] });
  const { getPendingActionCount } = await import("@/lib/queries");
  expect(await getPendingActionCount(w.u.id)).toBe(0);
  const link = await createOpenLink(w.u.id, w.c.id); const token = link.split("/").at(-1)!;
  expect(await resolveOpenLink(token)).toEqual({ valid: false }); expect(await sendOpenLinkPush(token)).toBe("invalid");
  await expect(completeTask({ callingId: w.c.id, task: "ROEPEN", doneById: w.u.id, doneAt: new Date() })).rejects.toBeTruthy();
  expect((await getCallingView(w.p.id, w.c.id)).personName).toBe(w.c.personName); // eigen rol blijft bevoegd
});
it("hogeraadsakkoord opent nog geen uitvoering; expliciete vrijgave wel", async () => {
  const w = await world(); await approved(w);
  expect((await getCallingView(w.u.id, w.c.id)).tasks).toEqual([]);
  expect((await getCallingView(w.p.id, w.c.id)).canReleaseExecution).toBe(true);
  mocks.mail.mockClear(); mocks.push.mockClear();
  await releaseForExecution({ callingId: w.c.id, actorId: w.p.id });
  expect(await taskCount(w.c.id)).toBe(1);
  expect(mocks.mail).toHaveBeenCalledExactlyOnceWith({ to: w.u.email, ...functionalActionEmail() });
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith([w.u.id], { ...ACTION_PUSH, url: `/roepingen/${w.c.id}`, tag: "ringtools-action" });
  expect((await getCallingView(w.u.id, w.c.id)).tasks.find(t => t.task === "ROEPEN")?.canComplete).toBe(true);
  expect((await getDashboard(w.u.id, w.c.ringId)).myTasks).toHaveLength(1);
});
it("gelijktijdige en herhaalde vrijgave, retries en ongewijzigd opslaan geven eenmaal per taak een melding", async () => {
  const w = await world(); await approved(w); mocks.mail.mockClear();
  const out = await Promise.all([1,2,3].map(() => releaseForExecution({ callingId: w.c.id, actorId: w.p.id })));
  expect(out.filter(r => r.released)).toHaveLength(1);
  await assignTask({ callingId: w.c.id, task: "ROEPEN", assigneeId: w.u.id });
  await dispatchExecutionNotifications(w.c.id);
  expect(await taskCount(w.c.id)).toBe(1); expect(mocks.mail).toHaveBeenCalledTimes(1);
});
it("nieuwe toewijzing na vrijgave meldt alleen aan nieuwe uitvoerder; afgeronde taak niet opnieuw", async () => {
  const w = await world(); await approved(w); await releaseForExecution({ callingId: w.c.id, actorId: w.p.id }); mocks.mail.mockClear();
  await assignTask({ callingId: w.c.id, task: "ROEPEN", assigneeId: w.b.id });
  expect(mocks.mail).toHaveBeenCalledExactlyOnceWith({ to: w.b.email, ...functionalActionEmail() });
  await expect(completeTask({ callingId: w.c.id, task: "ROEPEN", doneById: w.u.id, doneAt: new Date() })).rejects.toBeTruthy();
  await completeTask({ callingId: w.c.id, task: "ROEPEN", doneById: w.b.id, doneAt: new Date() }); mocks.mail.mockClear();
  await assignTask({ callingId: w.c.id, task: "ROEPEN", assigneeId: w.u.id }); expect(mocks.mail).not.toHaveBeenCalled();
});
it("blokkade tussen reservering en verzending annuleert alle kanalen, en opnieuw akkoord geeft niet automatisch vrij", async () => {
  const w = await world(); await approved(w); mocks.mail.mockClear(); mocks.push.mockClear();
  executionDeliveryHooks.beforeSend = async () => { await prisma.calling.update({ where: { id: w.c.id }, data: { status: "HOGERAAD_PAUSED" } }); };
  await releaseForExecution({ callingId: w.c.id, actorId: w.p.id });
  expect(mocks.mail).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  expect((await prisma.taskNotification.findFirstOrThrow()).state).toBe("CANCELLED");
  await prisma.calling.update({ where: { id: w.c.id }, data: { status: "APPROVED" } });
  expect((await prisma.calling.findUniqueOrThrow({ where: { id: w.c.id } })).executionReleasedAt).toBeNull();
  await dispatchExecutionNotifications(); expect(mocks.mail).not.toHaveBeenCalled();
  expect((await listNotificationsFor(w.u.id, w.c.ringId)).notifications.filter(n => n.type === "TASK_ASSIGNED")).toEqual([]);
});
it("duurzame wachtrij wordt één keer verwerkt bij gelijktijdige workers", async () => {
  const w = await world(); await approved(w); mocks.mail.mockClear();
  await prisma.$transaction(async tx => {
    const c = await tx.calling.update({ where: { id: w.c.id }, data: { executionReleasedAt: new Date(), executionGeneration: 1, executionRevision: 1 } });
    await queueExecutionNotifications(tx, c);
  });
  await Promise.all([dispatchExecutionNotifications(), dispatchExecutionNotifications()]);
  expect(mocks.mail).toHaveBeenCalledTimes(1); expect(await taskCount(w.c.id)).toBe(1);
});
it("onbekende externe afleverstatus leidt niet tot dubbele verzending; interne melding blijft", async () => {
  const w = await world(); await approved(w); mocks.mail.mockClear();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.mail.mockRejectedValueOnce(new Error(`Onzekere mail over ${w.c.personName}`));
  await releaseForExecution({ callingId: w.c.id, actorId: w.p.id });
  expect((await prisma.taskNotification.findFirstOrThrow()).state).toBe("UNKNOWN");
  await dispatchExecutionNotifications(); expect(mocks.mail).toHaveBeenCalledTimes(1);
  expect((await listNotificationsFor(w.u.id, w.c.ringId)).notifications.filter(n => n.type === "TASK_ASSIGNED")).toHaveLength(1);
  expect(JSON.stringify(log.mock.calls)).not.toContain(w.c.personName);
});
it("ringisolatie geldt voor toewijzen, notificeren en vrijgeven", async () => {
  const w = await world(); const outsider = await createTestUser("RINGPRESIDIUM", "Fictieve vreemde ring", { ringId: (await prisma.ring.create({ data: { name: "Fictieve andere ring" } })).id });
  await expect(assignTask({ callingId: w.c.id, task: "ROEPEN", assigneeId: outsider.id })).rejects.toBeTruthy();
  await approved(w); await expect(releaseForExecution({ callingId: w.c.id, actorId: outsider.id })).rejects.toBeTruthy();
  await expect(getCallingView(outsider.id, w.c.id)).rejects.toMatchObject({ status: 404 });
  const member = await prisma.ringMembership.findFirstOrThrow({ where: { userId: outsider.id } }); mocks.mail.mockClear();
  await notify({ userIds: [outsider.id], ringId: member.ringId, callingId: w.c.id, event: "NEW_PROPOSAL", url: "/" , email: true });
  expect(mocks.mail).not.toHaveBeenCalled();
});
it("alle functionele mails zijn exact generiek; callbacks, tokens, querystrings en vertrouwelijke velden worden genegeerd", async () => {
  const w = await world(); mocks.mail.mockClear(); mocks.push.mockClear();
  const builder = vi.fn(() => ({ subject: w.c.personName, text: `${w.c.functionTitle} geheim-token` }));
  await notify({ userIds: [w.p.id], ringId: w.c.ringId, callingId: w.c.id, event: "NEW_PROPOSAL", url: "/geheim?token=geheim-token", buildEmail: builder });
  expect(builder).not.toHaveBeenCalled();
  expect(mocks.mail).toHaveBeenCalledExactlyOnceWith({ to: w.p.email, ...functionalActionEmail() });
  const { supportInviteEmail, taskAssignedEmail, reminder30Email, supportReminderEmail } = await import("@/lib/mailer");
  const args = { name: "Geheime naam", taskLabel: "Geheime taak", personName: w.c.personName, functionTitle: w.c.functionTitle, phaseLabel: "Negatieve geheime reden", link: "https://example.invalid/open/geheim-token" };
  for (const build of [supportInviteEmail, taskAssignedEmail, reminder30Email, supportReminderEmail]) expect(build(args)).toEqual(functionalActionEmail());
  expect(JSON.stringify(mocks.push.mock.calls)).not.toMatch(/geheim|token=|Vertrouwelijke/);
});
it("beoordelingsmeldingen en herinneringen blijven werken voor bevoegde rollen zonder taakvrijgave", async () => {
  const w = await world();
  expect(mocks.mail.mock.calls.some(([m]) => (m as {to:string}).to === w.p.email)).toBe(true);
  await presidency(w); mocks.mail.mockClear();
  await releaseToHogeraad({ callingId: w.c.id, actorId: w.p.id });
  expect(mocks.mail.mock.calls.some(([m]) => (m as {to:string}).to === w.h.email)).toBe(true);
  await prisma.calling.update({ where: { id: w.c.id }, data: { createdAt: new Date(Date.now()-31*86400000) } }); mocks.mail.mockClear();
  await sendDue30DayReminders();
  expect(mocks.mail).toHaveBeenCalledExactlyOnceWith({ to: w.p.email, ...functionalActionEmail() });
  expect(await taskCount(w.c.id)).toBe(0);
});

it("een na de beoordelingsronde toegevoegde uitvoerder krijgt vóór vrijgave geen toegang op basis van toewijzing", async () => {
  const w = await world(); await approved(w);
  const u = await createTestUser("HOGERAAD", "Fictieve nieuwe uitvoerder", { ringId: w.c.ringId });
  await assignTask({ callingId: w.c.id, task: "ROEPEN", assigneeId: u.id });
  await expect(getCallingView(u.id, w.c.id)).rejects.toMatchObject({ status: 403 });
  expect((await getDashboard(u.id, w.c.ringId)).myTasks).toEqual([]);
  expect((await listNotificationsFor(u.id, w.c.ringId)).notifications).toEqual([]);
  await releaseForExecution({ callingId: w.c.id, actorId: w.p.id });
  expect((await getCallingView(u.id, w.c.id)).tasks.some(t => t.canComplete)).toBe(true);
});
it("vrijgave zonder akkoord en door een uitvoerder wordt afgewezen", async () => {
  const w = await world();
  await expect(releaseForExecution({ callingId: w.c.id, actorId: w.p.id })).rejects.toBeTruthy();
  await approved(w);
  await expect(releaseForExecution({ callingId: w.c.id, actorId: w.u.id })).rejects.toBeTruthy();
  expect(await prisma.taskNotification.count()).toBe(0);
});

it("een nog wachtende melding voor een eerdere toewijzing wordt bij hertoewijzen niet alsnog verstuurd", async () => {
  const w = await world(); await approved(w); mocks.mail.mockClear();
  await prisma.$transaction(async tx => {
    const c = await tx.calling.update({ where: { id: w.c.id }, data: { executionReleasedAt: new Date(), executionGeneration: 1, executionRevision: 1 } });
    await queueExecutionNotifications(tx, c);
  });
  await assignTask({ callingId: w.c.id, task: "ROEPEN", assigneeId: w.b.id });
  await dispatchExecutionNotifications();
  expect(mocks.mail).toHaveBeenCalledExactlyOnceWith({ to: w.b.email, ...functionalActionEmail() });
  expect((await prisma.taskNotification.findFirstOrThrow({ where: { userId: w.u.id } })).state).toBe("CANCELLED");
});
it("overzetten naar een externe uitvoerder en terug is een nieuwe toewijzing, geen ongewijzigd opslaan", async () => {
  const w = await world(); await approved(w); await releaseForExecution({ callingId: w.c.id, actorId: w.p.id }); mocks.mail.mockClear();
  const { assignTaskGuarded } = await import("@/lib/proposals");
  await assignTaskGuarded({ actorId: w.p.id, callingId: w.c.id, task: "ROEPEN", assigneeId: null, externalName: "Fictieve externe uitvoerder" });
  await assignTaskGuarded({ actorId: w.p.id, callingId: w.c.id, task: "ROEPEN", assigneeId: w.u.id });
  expect(mocks.mail).toHaveBeenCalledExactlyOnceWith({ to: w.u.email, ...functionalActionEmail() });
  expect((await prisma.calling.findUniqueOrThrow({ where: { id: w.c.id } })).roepenExternalName).toBeNull();
});
