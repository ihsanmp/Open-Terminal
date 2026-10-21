"use client";

import { useEffect, useState } from "react";
import { allLessons, MODULES, type Lesson } from "../../lib/academy";
import { useTerminal, useWidgetSetting } from "../../store/terminal";
import { usePairContext, type PairContext } from "../../lib/pair";

/** The lessons that matter most for a kind of market. */
const FOR_KIND: Record<PairContext["kind"], string[]> = {
  fx: ["fed", "fiscal", "cot"], dollar: ["fed", "fiscal", "cot"], rate: ["fed", "fiscal", "curves"], crypto: ["cot", "risk", "quant"],
  metal: ["curves", "cot", "geo"], energy: ["curves", "cot", "geo"], agri: ["curves", "cot", "regime"], stock: ["fundamentals", "breadth", "rotation"],
  etf: ["rotation", "breadth", "regime"], index: ["regime", "breadth", "risk"], volatility: ["risk", "curves", "geo"], other: ["regime", "plan", "journal"],
};

// Academy: short lessons along the menu's six groups, each ending with the tool to practise in
// and a question or two; lessons read are ticked (kept in this browser).

const DONE_KEY = "ot-academy-done";
const readDone = (): string[] => {
  try {
    const v = JSON.parse(window.localStorage.getItem(DONE_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export default function AcademyPage() {
  const [lessonId, setLessonId] = useWidgetSetting<string>("academyLesson", allLessons[0].id);
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => setDone(readDone()), []);
  const lesson = allLessons.find((l) => l.id === lessonId) ?? allLessons[0];
  const markDone = (id: string) =>
    setDone((d) => {
      if (d.includes(id)) return d;
      const next = [...d, id];
      try {
        window.localStorage.setItem(DONE_KEY, JSON.stringify(next));
      } catch {
        // not kept
      }
      return next;
    });
  const idx = allLessons.findIndex((l) => l.id === lesson.id);
  const { symbol, ctx } = usePairContext();
  const suggested = ctx ? FOR_KIND[ctx.kind].map((id) => allLessons.find((l) => l.id === id)).filter((l): l is (typeof allLessons)[number] => Boolean(l)) : [];

  return (
    <div className="h-full flex min-h-0 text-fs-11 portrait:flex-col">
      <aside className="w-[290px] shrink-0 border-r border-[var(--border)] overflow-auto portrait:w-full portrait:max-h-[35%] portrait:border-r-0 portrait:border-b">
        <div className="p-2 border-b border-[var(--border)]">
          <div className="font-bold">Academy</div>
          <div className="text-fs-10 dim">
            {done.length}/{allLessons.length} pelajaran selesai
          </div>
          <div className="h-1.5 bg-[#1a1a1a] rounded-sm mt-1">
            <div className="h-full bg-[var(--amber)] rounded-sm" style={{ width: `${(done.length / allLessons.length) * 100}%` }} />
          </div>
        </div>
        {suggested.length > 0 && (
          <div className="border-b border-[#161616] pb-1 bg-[#16130b]">
            <div className="px-2 pt-2 text-fs-9 font-bold uppercase tracking-wide amber">Untuk {symbol}</div>
            <div className="px-2 text-fs-9 dim mb-1">Pelajaran yang paling relevan untuk {ctx?.label}</div>
            {suggested.map((l) => (
              <button key={l.id} onClick={() => setLessonId(l.id)} className={`w-full text-left px-2 py-1 flex gap-2 ${l.id === lesson.id ? "bg-[#1a1a1a] text-[var(--amber)]" : "hover:bg-[#121212]"}`}>
                <span className={done.includes(l.id) ? "up" : "dim"}>{done.includes(l.id) ? "✓" : "○"}</span>
                <span className="flex-1">{l.title}</span>
              </button>
            ))}
          </div>
        )}
        {MODULES.map((m) => (
          <div key={m.id} className="border-b border-[#161616] pb-1">
            <div className="px-2 pt-2 text-fs-9 font-bold uppercase tracking-wide text-[#7f93b8]">{m.title}</div>
            <div className="px-2 text-fs-9 dim mb-1">{m.summary}</div>
            {m.lessons.map((l) => (
              <button key={l.id} onClick={() => setLessonId(l.id)} className={`w-full text-left px-2 py-1 flex gap-2 ${l.id === lesson.id ? "bg-[#1a1a1a] text-[var(--amber)]" : "hover:bg-[#121212]"}`}>
                <span className={done.includes(l.id) ? "up" : "dim"}>{done.includes(l.id) ? "✓" : "○"}</span>
                <span className="flex-1">{l.title}</span>
                <span className="dim text-fs-9">{l.minutes}′</span>
              </button>
            ))}
          </div>
        ))}
      </aside>
      <main className="flex-1 min-w-0 overflow-auto p-4">
        <LessonView key={lesson.id} lesson={lesson} done={done.includes(lesson.id)} onDone={() => markDone(lesson.id)} />
        <div className="flex gap-2 mt-6 max-w-[760px]">
          {idx > 0 && (
            <button className="term-btn" onClick={() => setLessonId(allLessons[idx - 1].id)}>
              ← {allLessons[idx - 1].title}
            </button>
          )}
          {idx < allLessons.length - 1 && (
            <button className="term-btn ml-auto" onClick={() => setLessonId(allLessons[idx + 1].id)}>
              {allLessons[idx + 1].title} →
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function LessonView({ lesson, done, onDone }: { lesson: Lesson; done: boolean; onDone: () => void }) {
  const setView = useTerminal((s) => s.setView);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const allRight = lesson.quiz.every((q, i) => picked[i] === q.answer);
  useEffect(() => {
    if (allRight && lesson.quiz.length) onDone();
  }, [allRight, lesson.quiz.length, onDone]);

  return (
    <article className="max-w-[760px]">
      <h2 className="text-fs-18 font-bold mb-1">{lesson.title}</h2>
      <div className="text-fs-10 dim mb-4">
        {lesson.minutes} menit baca {done && <span className="up ml-2">✓ selesai</span>}
      </div>
      <div className="grid gap-3 leading-relaxed text-fs-12">
        {lesson.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {lesson.practice && (
        <button className="term-btn active mt-4" onClick={() => setView(lesson.practice!.view)}>
          {lesson.practice.label} →
        </button>
      )}
      {lesson.quiz.length > 0 && (
        <div className="mt-6 grid gap-4">
          <div className="text-fs-11 font-bold uppercase tracking-wide text-[#a9b8d6]">Uji pemahaman</div>
          {lesson.quiz.map((q, i) => (
            <div key={i} className="border border-[var(--border)] rounded-sm p-3">
              <div className="font-bold mb-2">{q.q}</div>
              <div className="grid gap-1">
                {q.options.map((o, j) => {
                  const chosen = picked[i] === j;
                  const right = j === q.answer;
                  return (
                    <button
                      key={j}
                      onClick={() => setPicked((p) => ({ ...p, [i]: j }))}
                      className={`text-left px-2 py-1 rounded-sm border ${chosen ? (right ? "border-[var(--up)] text-[var(--up)]" : "border-[var(--down)] text-[var(--down)]") : "border-[#2a2a2a] hover:border-[#555]"}`}
                    >
                      {String.fromCharCode(65 + j)}. {o}
                    </button>
                  );
                })}
              </div>
              {picked[i] != null && <div className={`mt-2 text-fs-10 ${picked[i] === q.answer ? "up" : "down"}`}>{picked[i] === q.answer ? `Benar. ${q.why}` : "Belum tepat — coba lagi."}</div>}
            </div>
          ))}
        </div>
      )}
      {!lesson.quiz.length && !done && (
        <button className="term-btn mt-4" onClick={onDone}>
          Tandai selesai
        </button>
      )}
    </article>
  );
}
