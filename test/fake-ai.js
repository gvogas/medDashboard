// A stand-in for the Workers AI binding, for running the app locally with no Cloudflare
// login (`npm run dev:fake-ai`). The AI binding is remote-only, so without it every Import
// with AI fails; with this, the whole path (the browser's PDF reading, the upload, the
// Worker's cleaning, the preview and the save) runs against answers shaped exactly like the
// real models' (test/fixtures/schedule-*-reply.json were captured from them):
//   gpt-oss-120b (outlines, calendars, timetable PDFs): {choices: [{message: {content}}], usage}
//   Llama 4 Scout (screenshots, JSON mode):           {response: {...}, usage}
// FAKE_AI picks how it answers: "1" or "ok" answers well, "quota" is the spent daily
// allowance (error 4006), "garbage" is text that is not JSON, "fail" is a model error.

const DELAY_MS = 1500;   /* long enough to see the reading card and press Cancel */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* a course code in the text, as an outline or a timetable writes one: "PHARM 101", "CHEM-271" */
const codeIn = (text) => (String(text).match(/\b[A-Z]{3,5}[ -]?\d{3}[A-Z]?\b/) || ['DEMO 101'])[0];

const firstMonday = (today) => {
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d;
};
const plus = (d, days) => new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);

function outline(text, today) {
  const mon = firstMonday(today);
  return {
    code: codeIn(text), name: 'Course read by the fake AI', instructor: 'Dr. Fake', term: '', termStart: plus(mon, -7),
    classes: [
      { kind: 'Lecture', day: 'Mon', start: '09:00', end: '10:30', room: 'LT2' },
      { kind: 'Lab', day: 'Thu', start: '13:00', end: '16:00', room: 'SP-265' },
    ],
    officeHours: [{ day: 'Wed', start: '15:00', end: '16:00', room: 'B-210' }],
    assessments: [
      { title: 'Quiz 1', type: 'quiz', date: plus(mon, 9), weight: 10 },
      { title: 'Assignment 1', type: 'assignment', date: '', week: 6, weight: 20 },
      { title: 'Midterm exam', type: 'exam', date: plus(mon, 30), weight: 30 },
      { title: 'Final exam', type: 'exam', date: 'TBA', weight: 40 },
    ],
  };
}

function calendar(today) {
  const y = Number(today.slice(0, 4));
  return {
    name: 'Fake College ' + y + '–' + String(y + 1).slice(2),
    terms: [{ name: 'Autumn ' + y, start: y + '-08-24', end: y + '-12-11' }, { name: 'Winter ' + (y + 1), start: (y + 1) + '-01-19', end: (y + 1) + '-05-12' }],
    days: [
      { from: y + '-10-12', to: y + '-10-12', kind: 'off', label: 'Thanksgiving' },
      { from: y + '-10-19', to: y + '-10-23', kind: 'break', label: 'Study break' },
      { from: y + '-11-17', to: y + '-11-17', kind: 'swap', label: 'Monday schedule', follows: 'Mon' },
      { from: y + '-12-14', to: y + '-12-21', kind: 'exams', label: 'Final exams' },
    ],
  };
}

function schedule(text) {
  return {
    term: '',
    courses: [
      { code: codeIn(text), name: 'Organic Chemistry I', classes: [
        { kind: 'Lecture', day: 'Tue', start: '08:30', end: '10:00', room: 'H-110' },
        { kind: 'Lecture', day: 'Thu', start: '08:30', end: '10:00', room: 'H-110' },
      ] },
      { code: 'PHYS 101', name: 'Mechanics', classes: [{ kind: 'Lab', day: 'Fri', start: '13:00', end: '16:00', room: 'Classroom SP-265 L' }] },
    ],
  };
}

const usage = { prompt_tokens: 1200, completion_tokens: 900, total_tokens: 2100 };
const chat = (o) => ({ id: 'fake', object: 'chat.completion', model: 'fake', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(o, null, 2) } }], usage });

export function fakeAi(mode = 'ok') {
  return {
    async toMarkdown(doc) {
      const blob = Array.isArray(doc) ? doc[0].blob : doc.blob;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      /* the real converter reads Word and the like; here any printable text in the file stands in */
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/[^\x20-\x7e\n]+/g, ' ');
      return [{ name: doc.name, mimeType: blob.type, format: 'markdown', tokens: 0, data: '# ' + doc.name + '\n\n' + text + '\n\nCourse outline, PHARM 101. Lectures Monday 9:00. Midterm exam worth 30%.' }];
    },
    async run(model, input) {
      await wait(DELAY_MS);
      if (mode === 'quota') throw new Error('AiError: 4006: you have used up your daily free allocation of 10,000 neurons');
      if (mode === 'fail') throw new Error('AiError: 3043: Internal server error');
      const messages = input?.messages || [];
      const system = String(messages[0]?.content || '');
      const user = messages[messages.length - 1]?.content;
      const text = typeof user === 'string' ? user : '';
      const today = (text.match(/Today is (\d{4}-\d{2}-\d{2})/) || [])[1]
        || (Array.isArray(user) ? (user[0]?.text?.match(/Today is (\d{4}-\d{2}-\d{2})/) || [])[1] : null)
        || new Date().toISOString().slice(0, 10);
      if (mode === 'garbage') return chat('Sorry, I cannot read that.');
      /* a screenshot whose grid the browser found: words for each numbered block (it cannot read
         the picture, so a made-up course a block; the times come from the grid either way) */
      const blocks = (text || (Array.isArray(user) ? user[0]?.text : '') || '').match(/block \d+:/g);
      if (/llama-4-scout/.test(model) && blocks) {
        return { response: { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], firstTime: '08:00', lastTime: '18:00', term: '',
          blocks: blocks.map((_, i) => ({ n: i + 1, code: 'TST ' + (100 + i), name: 'Block ' + (i + 1), room: 'Classroom R-' + (i + 1), kind: '' })) }, usage };
      }
      if (/llama-4-scout/.test(model)) return { response: schedule(''), usage, tool_calls: [] };
      if (/academic calendar/i.test(system)) return chat(calendar(today));
      if (/class schedule/i.test(system)) return chat(schedule(text));
      return chat(outline(text, today));
    },
  };
}
