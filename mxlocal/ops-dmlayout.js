"use strict";
// Domain model diagram layout (R5): where new entities go and tidying a module's diagram. Mendix stores only each
// entity's top-left Location; Studio Pro sizes a box from its name and attributes, so boxes are estimated from those
// (header + one line per attribute, width from the longest line), with a margin.
//   place            a new entity: a free spot (no overlap) next to the entity it relates to (its parent, or the other
//                    end of its first association in the same plan), else right of the diagram
//   arrangeDomainModel  { module, mode: "compact" | "grid" }: every entity of the module on a new position, in a
//                    deterministic order (associated entities next to each other); nothing else changes
//   lint             after a plan: boxes of changed entities that overlap others (DOMAIN LAYOUT lines in the dry run)
const sdk = require("mendixmodelsdk");
const { fail } = require("./ops-util");

const { domainmodels: dm } = sdk;

const ANNOTATION = "R which annotation: a number (1 = the first) or the start of its text";
const DMLAYOUT_OPS = {
    arrangeDomainModel: {
        doc: "Tidy the domain model diagram of a module: every entity gets a new position, related entities next to each other (no box overlaps); only positions change (no semantic change). Annotations stay where they are.",
        fields: { module: "R module name", mode: "optional compact (rows, boxes at their own size; default) | grid (equal cells)" }
    },
    addDomainAnnotation: {
        doc: "Add an annotation (a yellow note) to a module's domain model, next to an entity or below the entities. (A note in a microflow: addAnnotation.)",
        fields: { module: "R module name", text: "R note text (\\n for a new line)", near: "optional Module.Entity of this module: put it next to that entity", width: "optional width in pixels (default 300)" }
    },
    changeDomainAnnotation: {
        doc: "Change an annotation of a module's domain model: its text, width, or move it next to an entity.",
        fields: { module: "R module name", annotation: ANNOTATION, text: "optional new text", width: "optional width in pixels", near: "optional Module.Entity: move it next to that entity" }
    },
    deleteDomainAnnotation: { doc: "Delete an annotation of a module's domain model.", fields: { module: "R module name", annotation: ANNOTATION } }
};

const GAP = 60, MARGIN = 20, LINE = 18, HEADER = 32, CHAR = 7;

function typeText(a) {
    const t = a.type;
    if (!t) return "";
    const n = t.structureTypeName.split("$")[1].replace("AttributeType", "");
    if (t instanceof dm.StringAttributeType) return `String (${t.length || "unlimited"})`;
    if (t instanceof dm.EnumerationAttributeType) return (t.enumerationQualifiedName || "").split(".").pop() || "Enum";
    return n;
}
// estimated box of an entity: { x, y, w, h }
function box(e) {
    const lines = [e.name, ...e.attributes.map(a => `${a.name} ${typeText(a)}`)];
    const w = Math.max(140, Math.round(Math.max(...lines.map(l => l.length)) * CHAR + 30));
    const h = HEADER + LINE * Math.max(1, e.attributes.length) + 10;
    return { x: e.location.x, y: e.location.y, w, h };
}
const overlap = (a, b, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

// associations (inside the domain model and cross-module) touching entity e of d
function related(d, e) {
    const out = [];
    for (const a of d.associations) {
        if (a.parent === e && a.child && a.child !== e) out.push(a.child);
        else if (a.child === e && a.parent && a.parent !== e) out.push(a.parent);
    }
    return out;
}

function makeDmLayout(h) {
    const { model, client } = h;
    const placed = new Map(); // entity -> { anchored } placed by this plan
    const touched = new Set(); // entities whose box changed (new, moved, attributes)

    // the first free spot for box b next to anchor (right, below, left, above, then further out), else right of all
    function freeSpot(b, others, anchor) {
        const free = c => others.every(o => !overlap(c, o, MARGIN));
        const tries = [];
        if (anchor) {
            for (let ring = 0; ring < 6; ring++) {
                const dx = ring * (b.w + GAP), dy = ring * (b.h + GAP);
                tries.push({ x: anchor.x + anchor.w + GAP + dx, y: anchor.y }, { x: anchor.x, y: anchor.y + anchor.h + GAP + dy },
                    { x: anchor.x - b.w - GAP - dx, y: anchor.y }, { x: anchor.x, y: anchor.y - b.h - GAP - dy },
                    { x: anchor.x + anchor.w + GAP + dx, y: anchor.y + anchor.h + GAP + dy });
            }
        }
        const right = others.length ? Math.max(...others.map(o => o.x + o.w)) + GAP : 100;
        const top = others.length ? Math.min(...others.map(o => o.y)) : 100;
        tries.push({ x: right, y: top });
        for (const t of tries) {
            const c = { x: Math.max(0, Math.round(t.x / 10) * 10), y: Math.max(0, Math.round(t.y / 10) * 10), w: b.w, h: b.h };
            if (free(c)) return c;
        }
        return { x: right, y: top, w: b.w, h: b.h };
    }

    // a new entity e of d (its attributes made): a free spot, next to near (an entity of the same diagram) if given
    function place(d, e, near) {
        const others = d.entities.filter(x => x !== e).map(box);
        const anchor = near && near.containerAsDomainModel === d ? box(near) : null;
        const c = freeSpot(box(e), others, anchor);
        e.location = { x: c.x, y: c.y };
        placed.set(e, { anchored: !!anchor });
        touched.add(e);
        return c;
    }
    // after an association from - to: a new entity of this plan that was put anywhere moves next to the other end
    function associated(from, to) {
        const d = from.containerAsDomainModel;
        for (const [mover, other] of [[from, to], [to, from]]) {
            const p = placed.get(mover);
            if (!p || p.anchored || mover.containerAsDomainModel !== other.containerAsDomainModel) continue;
            if (placed.has(other) && !placed.get(other).anchored && other !== to) continue; // both new: the owner follows the other end
            const others = mover.containerAsDomainModel.entities.filter(x => x !== mover).map(box);
            const c = freeSpot(box(mover), others, box(other));
            mover.location = { x: c.x, y: c.y };
            p.anchored = true;
            return `${mover.name} placed next to ${other.name}`;
        }
        void d;
        return "";
    }
    const touch = e => touched.add(e);

    // ------------------------------------------------ annotations (DomainModels$Annotation: Caption, Location, Width)

    // estimated box of an annotation: the text wrapped at its width
    const noteBox = n => {
        const w = n.width || 300;
        const perLine = Math.max(1, Math.floor((w - 20) / CHAR));
        const lines = String(n.caption || "").split(/\r?\n/).reduce((k, l) => k + Math.max(1, Math.ceil(l.length / perLine)), 0);
        return { x: n.location.x, y: n.location.y, w, h: lines * LINE + 20 };
    };
    // a free spot for annotation n of d: next to entity near, else below everything
    function placeNote(d, n, near) {
        const others = [...d.entities.map(box), ...d.annotations.filter(x => x !== n).map(noteBox)];
        let c;
        if (near) c = freeSpot(noteBox(n), others, box(near));
        else {
            const bottom = others.length ? Math.max(...others.map(o => o.y + o.h)) + GAP : 100;
            const left = others.length ? Math.min(...others.map(o => o.x)) : 100;
            c = { x: Math.max(0, left), y: bottom };
        }
        n.location = { x: c.x, y: c.y };
        return c;
    }
    async function nearEntity(d, qn, where) {
        if (qn === undefined) return null;
        const m = d.containerAsModule.name;
        const e = d.entities.find(x => `${m}.${x.name}` === String(qn));
        if (!e) {
            if (!String(qn).startsWith(m + ".")) throw new Error(`${where}: near must be an entity of ${m} (annotations belong to one domain model), not ${qn}`);
            fail(`${where}: ${m} has no entity '${String(qn).split(".").pop()}'`, String(qn), d.entities.map(x => `${m}.${x.name}`));
        }
        return e;
    }
    const noteText = t => String(t).replace(/\r?\n/g, "\r\n");
    const short = n => JSON.stringify(String(n.caption).replace(/\s+/g, " ").slice(0, 40));
    function noteOf(d, o, where) {
        const all = [...d.annotations];
        const m = d.containerAsModule.name;
        if (!all.length) throw new Error(`${where}: the domain model of ${m} has no annotations`);
        const list = all.map((n, i) => `${i + 1}: ${short(n)}`).join("; ");
        if (typeof o.annotation === "number" || /^\d+$/.test(String(o.annotation))) {
            const i = Number(o.annotation);
            if (i < 1 || i > all.length) throw new Error(`${where}: ${m} has ${all.length} annotation(s): ${list}`);
            return all[i - 1];
        }
        const start = String(o.annotation || "").trim().toLowerCase();
        const hits = start ? all.filter(n => String(n.caption).trim().toLowerCase().startsWith(start)) : [];
        if (hits.length !== 1) throw new Error(`${where}: ${hits.length ? `${hits.length} annotations start with` : "no annotation starts with"} ${JSON.stringify(o.annotation)}; give its number: ${list}`);
        return hits[0];
    }
    const validWidth = (w, where) => {
        const n = Number(w);
        if (!(Number.isInteger(n) && n >= 60 && n <= 2000)) throw new Error(`${where}: width is a whole number of pixels, 60..2000`);
        return n;
    };

    async function addDomainAnnotation(o) {
        const where = `addDomainAnnotation ${o.module}`;
        const d = await h.domainModel(o.module);
        if (!String(o.text || "").trim()) throw new Error(`${where}: text is empty`);
        const near = await nearEntity(d, o.near, where);
        const n = dm.Annotation.createIn(d);
        n.caption = noteText(o.text);
        n.width = o.width !== undefined ? validWidth(o.width, where) : 300;
        const c = placeNote(d, n, near);
        return `${o.module}: annotation ${d.annotations.length} ${short(n)} at ${c.x};${c.y}${near ? ` next to ${near.name}` : ""}`;
    }
    async function changeDomainAnnotation(o) {
        const where = `changeDomainAnnotation ${o.module}`;
        const d = await h.domainModel(o.module);
        const n = noteOf(d, o, where);
        if (o.text === undefined && o.width === undefined && o.near === undefined) throw new Error(`${where}: give text, width or near`);
        const done = [];
        if (o.text !== undefined) {
            if (!String(o.text).trim()) throw new Error(`${where}: text is empty (delete it with deleteDomainAnnotation)`);
            n.caption = noteText(o.text);
            done.push("text");
        }
        if (o.width !== undefined) {
            n.width = validWidth(o.width, where);
            done.push(`width ${n.width}`);
        }
        if (o.near !== undefined) {
            const near = await nearEntity(d, o.near, where);
            const c = placeNote(d, n, near);
            done.push(`moved to ${c.x};${c.y} next to ${near.name}`);
        }
        return `${o.module}: annotation ${short(n)}: ${done.join(", ")}`;
    }
    async function deleteDomainAnnotation(o) {
        const d = await h.domainModel(o.module);
        const n = noteOf(d, o, `deleteDomainAnnotation ${o.module}`);
        const t = short(n);
        n.delete();
        return `${o.module}: annotation ${t} deleted`;
    }

    async function arrangeDomainModel(o) {
        const where = `arrangeDomainModel ${o.module}`;
        const mode = String(o.mode || "compact").toLowerCase();
        if (!["compact", "grid"].includes(mode)) fail(`${where}: mode '${o.mode}' is not known (use compact | grid)`, String(o.mode), ["compact", "grid"]);
        const d = await h.domainModel(o.module);
        const ents = [...d.entities];
        if (!ents.length) return `${o.module}: no entities`;
        // order: connected groups (largest first), inside a group breadth first from its most connected entity; ties by name
        const deg = e => related(d, e).length + (ents.some(x => x.generalization instanceof dm.Generalization && x.generalization.generalizationQualifiedName === e.qualifiedName) ? 1 : 0);
        const neighbours = e => {
            const n = related(d, e);
            const g = e.generalization instanceof dm.Generalization ? ents.find(x => x.qualifiedName === e.generalization.generalizationQualifiedName) : null;
            if (g) n.push(g);
            for (const x of ents) if (x.generalization instanceof dm.Generalization && x.generalization.generalizationQualifiedName === e.qualifiedName) n.push(x);
            return [...new Set(n)].filter(x => ents.includes(x)).sort((a, b) => a.name.localeCompare(b.name));
        };
        const seen = new Set(), groups = [];
        const byDeg = [...ents].sort((a, b) => deg(b) - deg(a) || a.name.localeCompare(b.name));
        for (const s of byDeg) {
            if (seen.has(s)) continue;
            const g = [], q = [s];
            seen.add(s);
            while (q.length) {
                const e = q.shift();
                g.push(e);
                for (const n of neighbours(e)) if (!seen.has(n)) {
                    seen.add(n);
                    q.push(n);
                }
            }
            groups.push(g);
        }
        groups.sort((a, b) => b.length - a.length || a[0].name.localeCompare(b[0].name));
        const order = groups.flat();
        const boxes = order.map(box);
        const before = new Map(order.map(e => [e, `${e.location.x};${e.location.y}`]));
        const X0 = 50, Y0 = 50;
        if (mode === "grid") {
            const cw = Math.max(...boxes.map(b => b.w)) + GAP, ch = Math.max(...boxes.map(b => b.h)) + GAP;
            const cols = Math.max(1, Math.ceil(Math.sqrt(order.length)));
            order.forEach((e, i) => (e.location = { x: X0 + (i % cols) * cw, y: Y0 + Math.floor(i / cols) * ch }));
        } else {
            const area = boxes.reduce((s, b) => s + (b.w + GAP) * (b.h + GAP), 0);
            const maxW = Math.max(Math.max(...boxes.map(b => b.w)) + GAP, Math.round(Math.sqrt(area) * 1.6));
            let x = X0, y = Y0, rowH = 0;
            order.forEach((e, i) => {
                const b = boxes[i];
                if (x > X0 && x + b.w > X0 + maxW) {
                    x = X0;
                    y += rowH + GAP;
                    rowH = 0;
                }
                e.location = { x, y };
                x += b.w + GAP;
                rowH = Math.max(rowH, b.h);
            });
        }
        let moved = 0;
        for (const e of order) {
            touched.add(e);
            if (before.get(e) !== `${e.location.x};${e.location.y}`) moved++;
        }
        const ann = d.annotations ? d.annotations.length : 0;
        return `${o.module}: ${mode}, ${moved} of ${order.length} entities moved (${groups.length} group(s) of related entities)${ann ? `; ${ann} annotation(s) left where they are` : ""}`;
    }

    // DOMAIN LAYOUT lines: changed entities whose (estimated) box overlaps another
    function lint() {
        const out = [];
        const doms = new Set([...touched].map(e => e.containerAsDomainModel).filter(Boolean));
        for (const d of doms) {
            const all = d.entities.map(e => ({ e, b: box(e) }));
            for (const t of all.filter(x => touched.has(x.e))) {
                for (const o of all) if (o.e !== t.e && overlap(t.b, o.b) && (!touched.has(o.e) || o.e.name > t.e.name)) out.push(`${d.containerAsModule ? d.containerAsModule.name : "?"}: ${t.e.name} (${t.b.x};${t.b.y}) overlaps ${o.e.name} (${o.b.x};${o.b.y}) in the domain model diagram; arrangeDomainModel { "module": "${d.containerAsModule ? d.containerAsModule.name : "..."}" } tidies it`);
            }
        }
        return out;
    }

    const checks = {
        async addDomainAnnotation(o) {
            const d = await h.domainModel(o.module);
            return d.annotations.some(n => n.caption === noteText(o.text)) ? [] : [`${o.module} has no annotation ${JSON.stringify(o.text)}`];
        },
        async changeDomainAnnotation(o) {
            const d = await h.domainModel(o.module);
            if (o.text !== undefined) return d.annotations.some(n => n.caption === noteText(o.text) && (o.width === undefined || n.width === Number(o.width))) ? [] : [`${o.module} has no annotation ${JSON.stringify(o.text)}${o.width !== undefined ? ` of width ${o.width}` : ""}`];
            return [];
        },
        async deleteDomainAnnotation() {
            return []; // found by what it was
        },
        async arrangeDomainModel(o) {
            const d = await h.domainModel(o.module);
            const all = d.entities.map(box);
            const r = [];
            for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlap(all[i], all[j])) r.push(`${d.entities[i].name} overlaps ${d.entities[j].name}`);
            return r.slice(0, 5);
        }
    };
    return { impl: { arrangeDomainModel, addDomainAnnotation, changeDomainAnnotation, deleteDomainAnnotation }, checks, place, associated, touch, lint, box };
}

module.exports = { makeDmLayout, DMLAYOUT_OPS, box, overlap };
