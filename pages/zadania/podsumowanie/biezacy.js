import { useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import classNames from "classnames";
import { getActiveToken } from "../../../services/session";
import BaseLayout from "../../../components/baseLayout";
import EmployeeNotes from "../../../components/employeeNotes";
import { ButtonLink } from "../../../components/ui/button";
import Plate, { PlateHeader } from "../../../components/ui/plate";
import PageHeader from "../../../components/ui/pageHeader";
import EmptyState from "../../../components/ui/emptyState";
import Badge from "../../../components/ui/badge";
import getUsers from "../../../services/getUsers";
import { countNotesForMonth } from "../../../services/employeeNotes";
import { listSections } from "../../../services/sections";
import { canSeeMonthlyReports } from "../../../services/roles";
import { visibleSections } from "../../../services/scope";
import { workDay } from "../../../services/workday";

dayjs.locale("pl");

// Bieżący miesiąc nie ma jeszcze podsumowania (migawka powstaje po jego
// końcu), więc ten widok niczego nie liczy — służy wyłącznie notatkom, które
// kierownik zbiera na bieżąco, żeby mieć je pod ręką przy ocenie miesiąca.

export async function getServerSideProps(ctx) {
  const token = await getActiveToken(ctx.req);

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!canSeeMonthlyReports(token.role)) {
    return { notFound: true };
  }

  // Doba robocza liczona na serwerze — jak lastClosedMonth na liście.
  const today = workDay();
  const month = today.slice(0, 7);
  const counts = countNotesForMonth(month);
  const labels = Object.fromEntries(listSections({ includeInactive: true }).map((s) => [s.slug, s.label]));

  const sections = [];
  for (const section of visibleSections(token)) {
    const users = await getUsers(section);
    if (users.length === 0) continue;
    sections.push({
      section,
      label: labels[section] || section,
      people: users
        .map((u) => ({
          userID: u.id,
          name: u.name,
          surname: u.surname,
          count: counts.get(u.id)?.count ?? 0,
          lastDate: counts.get(u.id)?.lastDate ?? null,
        }))
        .sort((a, b) => `${a.surname} ${a.name}`.localeCompare(`${b.surname} ${b.name}`, "pl")),
    });
  }

  return { props: { today, month, viewerID: Number(token.userID), sections } };
}

const Person = ({ person, open, onToggle, today, month, viewerID, onCount }) => {
  const panelID = `notes-${person.userID}`;
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelID}
        className={classNames(
          "w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-raised",
          open && "bg-raised"
        )}
      >
        <span className="font-semibold">
          {person.surname} {person.name}
        </span>
        <span className="flex items-center gap-3 text-sm text-muted">
          {person.count > 0 ? (
            <>
              <span className="hidden sm:inline">ostatnia {dayjs(person.lastDate).format("D MMM")}</span>
              <Badge tone="accent">notatki: {person.count}</Badge>
            </>
          ) : (
            <span>brak notatek</span>
          )}
          <span aria-hidden="true" className={classNames("transition-transform", open && "rotate-90")}>
            ›
          </span>
        </span>
      </button>
      {open && (
        // Wcięcie i linia akcentu oddzielają notatki od nazwiska nad nimi
        // i od kolejnej osoby pod spodem.
        <div id={panelID} className="bg-raised px-3 pb-4 pt-1">
          <div className="ml-1 sm:ml-4 pl-3 sm:pl-4 border-l-2 border-accent">
          <EmployeeNotes
            userID={person.userID}
            month={month}
            today={today}
            viewerID={viewerID}
            onChange={(notes) => onCount(person.userID, notes)}
          />
          </div>
        </div>
      )}
    </li>
  );
};

export default function CurrentMonthNotes({ today, month, viewerID, sections: initial }) {
  const [sections, setSections] = useState(initial);
  const [open, setOpen] = useState(null);

  // Licznik przy nazwisku liczymy ze świeżej listy, zamiast pytać serwer o nowo.
  const onCount = (userID, notes) =>
    setSections((all) =>
      all.map((s) => ({
        ...s,
        people: s.people.map((p) =>
          p.userID === userID
            ? { ...p, count: notes.length, lastDate: notes.reduce((m, n) => (n.noteDate > (m || "") ? n.noteDate : m), null) }
            : p
        ),
      }))
    );

  return (
    <BaseLayout width="wide">
      <PageHeader
        title="Bieżący miesiąc — notatki"
        description={`${dayjs(`${month}-01`).format("MMMM YYYY")}. Zapisuj na bieżąco, co warto pamiętać przy ocenie miesiąca — notatki pojawią się w podsumowaniu obok formularza oceny. Widzą je kierownicy sekcji, pracownik nie.`}
        actions={
          <ButtonLink href="/zadania/podsumowanie" variant="secondary">
            Podsumowania miesięczne
          </ButtonLink>
        }
      />

      {sections.length === 0 ? (
        <Plate>
          <EmptyState title="Brak pracowników" description="W sekcjach przypisanych do Twojego konta nie ma aktywnych pracowników." />
        </Plate>
      ) : (
        <div className="space-y-6">
          {sections.map((s) => (
            <Plate key={s.section}>
              <PlateHeader title={s.label} aside={`osób: ${s.people.length}`} />
              <ul className="divide-y divide-line-subtle">
                {s.people.map((person) => (
                  <Person
                    key={person.userID}
                    person={person}
                    open={open === person.userID}
                    onToggle={() => setOpen((cur) => (cur === person.userID ? null : person.userID))}
                    today={today}
                    month={month}
                    viewerID={viewerID}
                    onCount={onCount}
                  />
                ))}
              </ul>
            </Plate>
          ))}
        </div>
      )}
    </BaseLayout>
  );
}
