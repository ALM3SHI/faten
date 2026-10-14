/**
 * UQU study-plan capture — run in a browser tab already open on https://uqu.edu.sa
 * (the site sits behind a Cloudflare browser challenge, so plain HTTP clients
 * are refused; a real browser session is the only reliable access path).
 *
 * Usage (DevTools console on any uqu.edu.sa page):
 *     const raw = await captureDegree(478, {statedTotalHours: 137});
 *     const { sha256, text } = await exportPsv(raw);
 *     copy(text);   // save as raw/degree-478.psv, then check `sha256sum` matches
 *
 * statedTotalHours is the «الساعات» column of the program in /App/Degrees search.
 *
 * It reads only public pages:
 *   /App/Degrees/{id}            — Arabic study plan (levels, courses, hours)
 *   /en/App/Degrees/{id}/{cid}   — English course page (prerequisites tab)
 * and returns the text exactly as shown. Normalisation, validation and
 * conflict detection happen afterwards in Python (backend/catalog/ingest.py),
 * so this file stays a dumb, auditable scraper.
 */
async function captureDegree(degreeId, opts = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const parse = async (url) => {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  };
  const codeOf = (root) => clean(root.querySelector("[data-tooltip-trigger]")?.textContent);

  const planUrl = `https://uqu.edu.sa/App/Degrees/${degreeId}`;
  const doc = await parse(planUrl);
  const bodyText = doc.body.innerText;
  const out = {
    university: "UQU",
    degree_id: degreeId,
    source_url: planUrl,
    retrieved_at: new Date().toISOString(),
    title_ar: clean(doc.querySelector("h1")?.textContent),
    page_meta: {
      department: clean((bodyText.match(/القسم:\s*([^\n]+)/) || [])[1]),
      college: clean((bodyText.match(/الكلية:\s*([^\n]+)/) || [])[1]),
      degree_type: ["بكالوريوس", "برنامج السنة التأهيلية", "دبلوم متوسط", "ماجستير", "دكتوراه"].find((t) => bodyText.includes(t)) || null,
    },
    stated_total_hours: opts.statedTotalHours ?? null,
    levels: [],
    warnings: [],
  };

  // Each level is an <h3>المستوى N</h3> followed by a list of course cards.
  for (const h3 of doc.querySelectorAll("h3")) {
    const m = clean(h3.textContent).match(/^المستوى\s+(\d+)$/);
    if (!m) continue;
    const level = { level: Number(m[1]), heading: clean(h3.textContent), courses: [] };
    const list = h3.nextElementSibling;
    for (const link of list ? list.querySelectorAll("a[data-fake-link]") : []) {
      const card = link.parentElement;
      const spans = [...card.querySelectorAll("span")].map((s) => clean(s.textContent)).filter(Boolean);
      const code = codeOf(card);
      const nameAr = clean(card.querySelector(".text-primary-800")?.textContent);
      const hoursText = spans.find((s) => /ساع|لا توجد ساعات/.test(s)) || null;
      const prereqBadge = spans.find((s) => /متطلب/.test(s)) || null;
      level.courses.push({ code, name_ar: nameAr, hours_text: hoursText, prereq_badge: prereqBadge, detail_url: link.href });
    }
    out.levels.push(level);
  }

  // English course pages carry the prerequisite list.
  for (const level of out.levels) {
    for (const c of level.courses) {
      const url = c.detail_url.replace("https://uqu.edu.sa/App/", "https://uqu.edu.sa/en/App/");
      try {
        const d = await parse(url);
        const panel = d.querySelector(`[x-show="currentTabValue === 'requisites'"]`);
        const tabs = [...d.querySelectorAll('[role="tab"]')].map((t) => clean(t.textContent));
        const prereqs = panel
          ? [...panel.querySelectorAll("a[data-fake-link]")].map((a) => {
              const card = a.parentElement;
              const labels = [...card.querySelectorAll('[data-slot="label"]')].map((s) => clean(s.textContent));
              return { code: codeOf(card), name_en: clean([...card.querySelectorAll("span")].find((s) => !s.attributes.length || (s.attributes.length === 1 && s.hasAttribute("class") && !s.closest("[data-slot],[wrapper]")))?.textContent), labels, detail_url: a.href };
            })
          : [];
        const labels = [...d.querySelectorAll('[data-slot="label"]')].slice(0, 2).map((s) => clean(s.textContent));
        c.detail = { url, name_en: clean(d.querySelector("h1")?.textContent), header_labels: labels, tabs, prerequisites: prereqs, has_prereq_tab: !!panel };
      } catch (err) {
        c.detail = null;
        out.warnings.push(`${c.code}: ${err.message}`);
      }
      await sleep(opts.delayMs ?? 400); // be gentle with the university server
    }
  }
  return out;
}

/** Prerequisite-count badges as the plan page shows them («متطلب واحد», «متطلبين»). */
async function prereqBadges(degreeId) {
  const res = await fetch(`https://uqu.edu.sa/App/Degrees/${degreeId}`, { credentials: "same-origin" });
  const d = new DOMParser().parseFromString(await res.text(), "text/html");
  const out = {};
  for (const a of d.querySelectorAll("a[data-fake-link]")) {
    const card = a.parentElement;
    const code = (card.querySelector("[data-tooltip-trigger]")?.textContent || "").trim();
    const m = card.textContent.replace(/\s+/g, " ").match(/(لا يوجد متطلبات?|متطلب واحد|متطلبين|\d+ متطلبات)/);
    out[code] = m ? m[1] : null;
  }
  return out;
}

/** One line per course, pipe-separated — the format ingest_uqu.py reads. Returns the text and its SHA-256. */
async function exportPsv(c) {
  const badges = await prereqBadges(c.degree_id);
  const m = c.page_meta;
  const lines = [`#degree|${c.degree_id}|${c.title_ar}|${m.degree_type}|${m.college}|${m.department}|${c.stated_total_hours}|${c.retrieved_at}|${c.source_url}`];
  for (const l of c.levels)
    for (const x of l.courses) {
      const d = x.detail || {};
      const pid = (x.detail_url.match(/\/(\d+)$/) || [])[1];
      const pre = (d.prerequisites || []).map((p) => `${p.code}~${p.name_en}~${p.labels.join("/")}`).join(";");
      lines.push([l.level, x.code, x.name_ar, x.hours_text, badges[x.code] ?? "", pid, d.name_en ?? "", (d.header_labels || []).join("/"), d.has_prereq_tab ? 1 : 0, pre].join("|"));
    }
  if (c.warnings.length) lines.push("#warnings|" + c.warnings.join(";"));
  const text = lines.join("\n") + "\n";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { sha256, text };
}
