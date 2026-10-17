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

const DMLAYOUT_OPS = {
    arrangeDomainModel: {
        doc: "Tidy the domain model diagram of a module: every entity gets a new position, related entities next to each other (no box overlaps); only positions change (no semantic change). Annotations stay where they are.",
        fields: { module: "R module name", mode: "optional compact (rows, boxes at their own size; default) | grid (equal cells)" }
    }
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
        async arrangeDomainModel(o) {
            const d = await h.domainModel(o.module);
            const all = d.entities.map(box);
            const r = [];
            for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlap(all[i], all[j])) r.push(`${d.entities[i].name} overlaps ${d.entities[j].name}`);
            return r.slice(0, 5);
        }
    };
    return { impl: { arrangeDomainModel }, checks, place, associated, touch, lint, box };
}

module.exports = { makeDmLayout, DMLAYOUT_OPS, box, overlap };
