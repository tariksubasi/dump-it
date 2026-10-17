"use strict";
// Layout of microflows, nanoflows and rules (one engine for all three): object rectangles, the flow graph, make room
// and close gap for only the part of a flow downstream of an edit, loops sized to their contents, collision
// resolution, annotations that follow their step, connection sides and Bezier vectors of touched flows.
//
// Coordinates are those Studio Pro stores: the middle point of an object relative to its collection (the flow, or the
// top left corner of a loop). Measured on the Studio Pro samples of the test projects (2,100+ objects, 1,900 flows):
//   sizes      activity 120x60, decision 90x60 (older: 130x80), object type decision 60x40, merge 20x20 (older:
//              90x60), start/end/break/continue/error 20x20, parameter 30x30, annotation 230x50
//   loops      padding around the content: left 90, top 70, right 35, bottom 70
//   sides      0 top, 1 right, 2 bottom, 3 left. Main line 1 -> 3; a branch leaves a decision at the bottom (2) or top
//              (0) and enters the first step below it at the top (0) / bottom (2); a branch that comes back up enters
//              the merge at the bottom (1 -> 2), one coming down enters it at the top (1 -> 0 or 2 -> 0); an error
//              handler leaves the activity at the bottom (2 -> 0)
//   vectors    Bezier control vector = the side's direction times 30 at an activity or loop, 15 at any other object
//              (an older project: 0, a straight line); annotation flows start with 0
const { microflows: mf } = require("mendixmodelsdk");

const X_STEP = 190; // centre to centre of two activities on a line
const LANE = 150; // centre to centre of two lanes
const GAP = 70; // edge to edge on a line (X_STEP - activity width)
const CLEAR = 20; // clearance when an object is pushed out of the way
const LOOP_PAD = { left: 90, top: 70, right: 35, bottom: 70 };
const SIZES = {
    ActionActivity: [120, 60], ExclusiveSplit: [90, 60], InheritanceSplit: [60, 40], ExclusiveMerge: [20, 20], StartEvent: [20, 20], EndEvent: [20, 20],
    BreakEvent: [20, 20], ContinueEvent: [20, 20], ErrorEvent: [20, 20], MicroflowParameterObject: [30, 30], Annotation: [230, 50], LoopedActivity: [300, 200]
};
const MAIN_WIDTH = 3800; // a main line wider than this (about 20 steps) is hard to read: LAYOUT CHECK suggests extractMicroflow

const typeOf = o => o.structureTypeName.split("$")[1];
const P = o => o.relativeMiddlePoint;
function S(o) {
    const s = o.size;
    if (s && s.width > 0 && s.height > 0) return s;
    const d = SIZES[typeOf(o)] || [120, 60];
    return { width: d[0], height: d[1] };
}
function rect(o) {
    const p = P(o);
    const s = S(o);
    return { l: p.x - s.width / 2, t: p.y - s.height / 2, r: p.x + s.width / 2, b: p.y + s.height / 2 };
}
const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const isSplit = o => o instanceof mf.ExclusiveSplit || o instanceof mf.InheritanceSplit;
const isMerge = o => o instanceof mf.ExclusiveMerge;
const isLoop = o => o instanceof mf.LoopedActivity;
const isNote = o => o instanceof mf.Annotation;
const isParam = o => o instanceof mf.MicroflowParameterObject;
const setPoint = (o, x, y) => (o.relativeMiddlePoint = { x: Math.round(x), y: Math.round(y) });
const depth = coll => {
    let d = 0;
    for (let c = coll; c && c.container && isLoop(c.container); c = c.container.container) d++;
    return d;
};

// ------------------------------------------------ flow sides and Bezier vectors

function lineOf(fl) {
    try {
        const l = fl.line; // Mendix 10.16+
        return l && l.originControlVector !== undefined ? l : null;
    } catch (e) {
        return null;
    }
}
const vec = (idx, v) => [{ width: 0, height: -v }, { width: v, height: 0 }, { width: 0, height: v }, { width: -v, height: 0 }][idx] || { width: 0, height: 0 };
const mag = o => (o instanceof mf.ActionActivity || isLoop(o) ? 30 : 15);

function setOriginSide(fl, idx) {
    fl.originConnectionIndex = idx;
    const l = lineOf(fl);
    if (l) l.originControlVector = fl instanceof mf.AnnotationFlow ? { width: 0, height: 0 } : vec(idx, mag(fl.origin));
}
function setDestSide(fl, idx) {
    fl.destinationConnectionIndex = idx;
    const l = lineOf(fl);
    if (l) l.destinationControlVector = vec(idx, mag(fl.destination));
}
// Studio Pro's vectors for the sides a new flow has
function defaultLine(fl) {
    const l = lineOf(fl);
    if (!l || !fl.origin || !fl.destination) return;
    l.originControlVector = fl instanceof mf.AnnotationFlow ? { width: 0, height: 0 } : vec(fl.originConnectionIndex, mag(fl.origin));
    l.destinationControlVector = vec(fl.destinationConnectionIndex, mag(fl.destination));
}
const sideOf = (fl, end) => {
    const l = lineOf(fl);
    return end === "origin" ? { idx: fl.originConnectionIndex, v: l && l.originControlVector } : { idx: fl.destinationConnectionIndex, v: l && l.destinationControlVector };
};
function putSide(fl, end, side) {
    const l = lineOf(fl);
    if (end === "origin") {
        fl.originConnectionIndex = side.idx;
        if (l && side.v) l.originControlVector = { width: side.v.width, height: side.v.height };
    } else {
        fl.destinationConnectionIndex = side.idx;
        if (l && side.v) l.destinationControlVector = { width: side.v.width, height: side.v.height };
    }
}

const VERT = 1; // |dx| below this: one object right above the other
function rel(fl) {
    const a = P(fl.origin);
    const b = P(fl.destination);
    return { dx: b.x - a.x, dy: b.y - a.y };
}
function originValid(i, { dx, dy }) {
    if (Math.abs(dx) < VERT) return dy > 0 ? i === 2 : dy < 0 ? i === 0 : true;
    return i === 1 ? dx > 0 : i === 3 ? dx < 0 : i === 2 ? dy > 0 : dy < 0;
}
function destValid(i, { dx, dy }) {
    if (Math.abs(dx) < VERT) return dy > 0 ? i === 0 : dy < 0 ? i === 2 : true;
    return i === 3 ? dx > 0 : i === 1 ? dx < 0 : i === 0 ? dy > 0 : dy < 0;
}
// The sides Studio Pro uses for this geometry
function bestOrigin(fl, d = rel(fl)) {
    if (Math.abs(d.dx) < VERT) return d.dy >= 0 ? 2 : 0;
    if (isSplit(fl.origin) && d.dx > 0 && Math.abs(d.dy) >= VERT) return d.dy > 0 ? 2 : 0; // a branch to a lower/upper lane
    return d.dx > 0 ? 1 : 3;
}
function bestDest(fl, d = rel(fl)) {
    if (Math.abs(d.dx) < VERT) return d.dy >= 0 ? 0 : 2;
    if (isMerge(fl.destination) && Math.abs(d.dy) >= VERT) return d.dy < 0 ? 2 : 0; // back up into / down into a merge
    if (isSplit(fl.origin) && fl.originConnectionIndex !== 1 && d.dx > 0 && Math.abs(d.dy) >= VERT) return 3;
    return d.dx > 0 ? 3 : 1;
}
// Keeps the sides of fl that still fit its geometry; the others get Studio Pro's side and vector.
function fixSides(fl) {
    if (!fl.origin || !fl.destination || fl.origin.container !== fl.destination.container) return false;
    if (fl instanceof mf.AnnotationFlow) return false;
    const d = rel(fl);
    let changed = false;
    if (!originValid(fl.originConnectionIndex, d)) {
        setOriginSide(fl, fl.isErrorHandler && d.dy > 0 ? 2 : bestOrigin(fl, d));
        changed = true;
    }
    if (!destValid(fl.destinationConnectionIndex, d)) {
        setDestSide(fl, bestDest(fl, d));
        changed = true;
    }
    return changed;
}
// Both sides as Studio Pro draws this geometry (formatMicroflow)
function normaliseFlow(fl) {
    if (!fl.origin || !fl.destination || fl.origin.container !== fl.destination.container || fl instanceof mf.AnnotationFlow) return;
    const d = rel(fl);
    const oi = fl.isErrorHandler ? (d.dy > 0 ? 2 : bestOrigin(fl, d)) : bestOrigin(fl, d);
    fl.originConnectionIndex = oi;
    const di = bestDest(fl, d);
    fl.destinationConnectionIndex = di;
    defaultLine(fl);
}

// ------------------------------------------------ the flow graph

function graph(m) {
    const out = new Map();
    const inc = new Map();
    const notes = new Map(); // object id -> annotations attached to it
    const targets = new Map(); // annotation id -> objects it is attached to
    const push = (map, k, v) => (map.has(k) ? map.get(k).push(v) : map.set(k, [v]));
    for (const fl of m.flows) {
        const o = fl.origin;
        const d = fl.destination;
        if (!o || !d) continue;
        if (fl instanceof mf.AnnotationFlow) {
            const [n, t] = isNote(o) ? [o, d] : [d, o];
            push(notes, t.id, n);
            push(targets, n.id, t);
            continue;
        }
        push(out, o.id, fl);
        push(inc, d.id, fl);
    }
    return { out, inc, notes, targets };
}

function walk(coll, fn) {
    for (const o of coll.objects) {
        fn(o, coll);
        if (isLoop(o)) walk(o.objectCollection, fn);
    }
}

// bounding box of a loop's content, relative to the loop
function contentBox(loop) {
    const objs = [...loop.objectCollection.objects];
    if (!objs.length) return null;
    const rs = objs.map(rect);
    return { l: Math.min(...rs.map(r => r.l)), t: Math.min(...rs.map(r => r.t)), r: Math.max(...rs.map(r => r.r)), b: Math.max(...rs.map(r => r.b)) };
}
function padsOf(loop) {
    const bb = contentBox(loop);
    const s = S(loop);
    if (!bb) return { ...LOOP_PAD };
    return { left: bb.l, top: bb.t, right: s.width - bb.r, bottom: s.height - bb.b };
}

// ------------------------------------------------ an edit session on one flow document

class Session {
    constructor(m) {
        this.m = m;
        this.g = null;
        this.placed = new Map(); // collection -> Set of ids that were placed or moved by this edit
        this.dirty = new Set(); // collections to settle
        this.moved = new Set(); // ids of every object moved
        this.touched = new Set(); // flows whose sides to check
        this.pending = []; // re-pointed flows: { fl, donor, own } destination sides
        this.pads = new Map();
        walk(m.objectCollection, o => isLoop(o) && this.pads.set(o.id, padsOf(o)));
        this.geo0 = new Map(); // flow -> its geometry before the edit (sides are only checked where it changed)
        for (const fl of m.flows) if (fl.origin && fl.destination) this.geo0.set(fl, rel(fl));
    }
    graph() {
        return this.g || (this.g = graph(this.m));
    }
    invalidate() {
        this.g = null;
    }
    mark(coll, objs) {
        if (!this.placed.has(coll)) this.placed.set(coll, new Set());
        for (const o of objs) this.placed.get(coll).add(o.id);
        this.dirty.add(coll);
    }
    // Objects of coll reachable from starts along the flows (normal and error), right of bound (side -1: left of
    // it, a lane that runs right to left); not through stop.
    downstream(coll, starts, bound, stop = new Set(), side = 1) {
        const g = this.graph();
        const seen = new Set();
        const res = [];
        const todo = [...starts];
        while (todo.length) {
            const o = todo.pop();
            if (!o || seen.has(o.id) || stop.has(o.id)) continue;
            seen.add(o.id);
            if (o.container !== coll || (side > 0 ? P(o).x <= bound : P(o).x >= bound)) continue;
            res.push(o);
            for (const fl of g.out.get(o.id) || []) todo.push(fl.destination);
        }
        return res;
    }
    // The connected run of objects on one lane (same y) that o is on.
    lane(o) {
        const g = this.graph();
        const coll = o.container;
        const y = P(o).y;
        const seen = new Set([o.id]);
        const res = [o];
        for (let i = 0; i < res.length; i++) {
            const x = res[i];
            const near = [...(g.out.get(x.id) || []).map(f => f.destination), ...(g.inc.get(x.id) || []).map(f => f.origin)];
            for (const n of near) {
                if (!n || seen.has(n.id) || n.container !== coll || Math.abs(P(n).y - y) >= VERT) continue;
                seen.add(n.id);
                res.push(n);
            }
        }
        return res;
    }
    // Moves objs (and the annotations attached to them) by dx, dy.
    shift(coll, objs, dx, dy) {
        if (!objs.length || (!dx && !dy)) return [];
        const g = this.graph();
        const done = new Set();
        const all = [];
        const move = o => {
            if (done.has(o.id)) return;
            done.add(o.id);
            all.push(o);
            const p = P(o);
            setPoint(o, p.x + dx, p.y + dy);
            this.moved.add(o.id);
        };
        objs.forEach(move);
        for (const o of objs) for (const n of g.notes.get(o.id) || []) if (n.container === coll) move(n);
        this.mark(coll, all);
        return all;
    }
    makeRoomH(coll, starts, bound, dx, stop, side = 1) {
        return this.shift(coll, this.downstream(coll, starts, bound, stop, side), dx, 0);
    }
    // +1 when the lane of o runs left to right at o, -1 when it runs right to left (a serpentine layout)
    laneDir(o, via = "out") {
        const g = this.graph();
        const y = P(o).y;
        const list = via === "out" ? (g.out.get(o.id) || []).map(f => f.destination) : (g.inc.get(o.id) || []).map(f => f.origin);
        const n = list.find(x => x && x.container === o.container && Math.abs(P(x).y - y) < VERT && P(x).x !== P(o).x);
        if (!n) return 1;
        return (P(n).x > P(o).x) === (via === "out") ? 1 : -1;
    }

    // Where new steps go on anchorFlow (origin -> destination), before it is changed:
    //   "h"    on the origin's lane, right of the origin (its right edge + GAP); downstream objects right of the
    //          origin move right by the width of the new steps
    //   "t"    on the destination's lane, in its place (it was right below/above, or diagonally on another lane);
    //          the destination and what follows it move right
    //   "lane" an empty branch (a decision's bottom/top side straight to a merge on another lane): a new lane next to
    //          the decision, the first free one; the merge moves right when the steps reach it
    insertGeometry(anchorFlow) {
        const from = anchorFlow.origin;
        const to = anchorFlow.destination;
        const coll = from.container;
        const pf = P(from);
        const pt = P(to);
        const rf = rect(from);
        const rt = rect(to);
        const g = { from, to, coll, flow: anchorFlow };
        // x0: the middle of the first new step as if the lane ran left to right; side -1 mirrors the new steps
        // around axis afterwards
        if (to.container !== coll) return { ...g, mode: "h", side: 1, x0: rf.r + GAP + 60, y0: pf.y, bound: pf.x, starts: [] };
        const sameLane = Math.abs(pt.y - pf.y) < VERT;
        if (sameLane) {
            const side = pt.x < pf.x ? -1 : 1;
            return { ...g, mode: "h", side, axis: pf.x, x0: pf.x + S(from).width / 2 + GAP + 60, y0: pf.y, bound: pf.x, starts: [to] };
        }
        if (Math.abs(pt.x - pf.x) < VERT || !isMerge(to)) {
            const side = this.laneDir(to);
            return { ...g, mode: "t", side, axis: pt.x, x0: pt.x - S(to).width / 2 + 60, y0: pt.y, bound: pt.x - 0.5 * side, starts: [to] };
        }
        if (isSplit(from) && anchorFlow.originConnectionIndex !== 1) {
            const down = anchorFlow.originConnectionIndex !== 0;
            return { ...g, mode: "lane", side: 1, x0: pf.x, y0: pf.y + (down ? LANE : -LANE), vdir: down ? 1 : -1, bound: pf.x, starts: [to] };
        }
        const side = this.laneDir(from, "in");
        return { ...g, mode: "h", side, axis: pf.x, x0: pf.x + S(from).width / 2 + GAP + 60, y0: pf.y, bound: pf.x, starts: [to] };
    }
    // Before inserting: the objects that make room (computed while the anchor flow still runs from -> to)
    prepare(geo, stop = new Set()) {
        stop.add(geo.from.id);
        geo.stop = stop;
        geo.room = this.downstream(geo.coll, geo.starts, geo.bound, stop, geo.side);
        return geo;
    }
    // After the new objects are built at (x0, y0): width = their width on the line (buildSeq's width).
    inserted(geo, newObjs, width) {
        if (geo.side < 0) for (const n of newObjs) setPoint(n, 2 * geo.axis - P(n).x, P(n).y);
        if (geo.mode === "lane") {
            // the first free lane next to the decision
            const roomIds = new Set(geo.room.map(o => o.id));
            const others = [...geo.coll.objects].filter(o => !newObjs.includes(o) && !roomIds.has(o.id) && !isNote(o));
            for (let k = 0; k < 20; k++) {
                const hit = newObjs.some(n => others.some(o => overlaps(grow(rect(n), CLEAR / 2), rect(o))));
                if (!hit) break;
                this.shift(geo.coll, newObjs, 0, geo.vdir * LANE);
            }
            const right = Math.max(...newObjs.map(n => rect(n).r));
            const dx = Math.max(0, right + GAP - rect(geo.to).l);
            this.shift(geo.coll, geo.room, dx, 0);
        } else {
            if (geo.mode === "t" && this.blocked(geo, newObjs, geo.room)) {
                // the lane is taken there (another branch): run the other way along it, else one lane further out
                const side = -geo.side;
                const mirror = () => newObjs.forEach(n => setPoint(n, 2 * P(geo.to).x - P(n).x, P(n).y));
                mirror();
                const room = this.downstream(geo.coll, geo.starts, P(geo.to).x - 0.5 * side, geo.stop, side);
                if (!this.blocked(geo, newObjs, room)) Object.assign(geo, { side, room });
                else {
                    mirror();
                    const laneIds = new Set(this.lane(geo.to).map(o => o.id));
                    const vdir = Math.sign(P(geo.to).y - P(geo.from).y) || 1;
                    const along = geo.room.every(o => laneIds.has(o.id)); // a dead end: the lane goes along
                    for (let k = 0; k < 10 && this.blocked(geo, newObjs, geo.room); k++) {
                        this.shift(geo.coll, newObjs, 0, vdir * LANE);
                        if (along) this.shift(geo.coll, geo.room, 0, vdir * LANE);
                    }
                }
            }
            this.shift(geo.coll, geo.room, geo.side * width, 0);
        }
        this.mark(geo.coll, newObjs);
    }
    // new objects that would cover an object that is neither theirs nor making room
    blocked(geo, newObjs, room) {
        const skip = new Set([...room, ...newObjs, geo.from].map(o => o.id));
        const others = [...geo.coll.objects].filter(o => !skip.has(o.id) && !isNote(o));
        return newObjs.some(n => others.some(o => overlaps(grow(rect(n), CLEAR / 2), rect(o))));
    }

    // Before deleting / moving away step: the gap it leaves on its line. Its right edge minus the right edge of the
    // step before it on the same lane (or: the next step's left edge minus its left edge), so a deleted step takes
    // the space before it with it and add + delete gives the old positions back.
    gapOf(step, last = step) {
        const g = this.graph();
        const coll = step.container;
        const y = P(step).y;
        const same = o => o && o.container === coll && Math.abs(P(o).y - y) < VERT && P(o).x !== P(step).x;
        const prev = (g.inc.get(step.id) || []).filter(f => !f.isErrorHandler).map(f => f.origin).filter(same);
        const next = (g.out.get(last.id) || []).filter(f => !f.isErrorHandler).map(f => f.destination).filter(same);
        let dx = 0;
        let side = 1;
        if (prev.length) {
            side = P(prev[0]).x < P(step).x ? 1 : -1;
            dx = side > 0 ? rect(last).r - rect(prev[0]).r : rect(prev[0]).l - rect(last).l;
        } else if (next.length) {
            side = P(next[0]).x > P(last).x ? 1 : -1;
            dx = side > 0 ? rect(next[0]).l - rect(step).l : rect(step).r - rect(next[0]).r;
        }
        const starts = (g.out.get(last.id) || []).filter(f => !f.isErrorHandler).map(f => f.destination);
        return { coll, dx: Math.max(0, dx), side, bound: P(step).x, starts, ids: new Set([step.id, last.id]) };
    }
    closeGap(gap, stop = new Set()) {
        if (!gap.dx) return [];
        for (const id of gap.ids) stop.add(id);
        return this.makeRoomH(gap.coll, gap.starts, gap.bound, -gap.side * gap.dx, stop, gap.side);
    }

    // Re-points fl to a new destination: takes the destination side of the donor (the flow it replaces, which ran
    // into that object) when it fits the geometry, else keeps its own, else Studio Pro's.
    // The side is chosen in finish(), on the final geometry.
    redirect(fl, to, donor) {
        const own = sideOf(fl, "dest");
        fl.destination = to;
        this.touched.add(fl);
        this.pending.push({ fl, donor, own });
    }
    // A new flow (from connect()) into an old object: the destination side of the flow it continues.
    adopt(fl, donor) {
        this.touched.add(fl);
        this.pending.push({ fl, donor, own: null });
    }

    // Loop rectangle from its content: the padding it had before the edit (Studio Pro's when new); the left/top edge
    // stays, so the middle point moves by half the change.
    fit(loop) {
        const bb = contentBox(loop);
        if (!bb) return { dw: 0, dh: 0 };
        // (content that stuck out of the loop before is taken in: no side below 0)
        const was = this.pads.get(loop.id) || padsOf(loop);
        const pad = { left: Math.max(0, was.left), top: Math.max(0, was.top), right: Math.max(0, was.right), bottom: Math.max(0, was.bottom) };
        const s = S(loop);
        const coll = loop.objectCollection;
        // the content keeps the padding it had: grows or shrinks on every side
        const dl = Math.round(pad.left - bb.l);
        const dt = Math.round(pad.top - bb.t);
        if (dl || dt) this.shift(coll, [...coll.objects], dl, dt);
        const w = Math.max(60, Math.round(bb.r + dl + pad.right));
        const hgt = Math.max(60, Math.round(bb.b + dt + pad.bottom));
        const dw = w - s.width;
        const dh = hgt - s.height;
        if (!dw && !dh) return { dw: 0, dh: 0 };
        const p = P(loop);
        const left = p.x - Math.floor(s.width / 2);
        const top = p.y - Math.floor(s.height / 2);
        const oldX = p.x;
        loop.size = { width: w, height: hgt };
        setPoint(loop, left + Math.floor(w / 2), top + Math.floor(hgt / 2));
        this.moved.add(loop.id);
        return { dw, dh, oldX };
    }

    // Pushes objects that overlap what this edit placed: on the same row to the right (with what follows them), else
    // down (or up, when above) with their whole lane. A placed annotation that collides moves up instead of pushing;
    // free annotations stay where they are.
    resolve(coll) {
        const placed = this.placed.get(coll) || new Set();
        for (let iter = 0; iter < 400; iter++) {
            const objs = [...coll.objects];
            const mine = objs.filter(o => placed.has(o.id));
            let hit = null;
            for (const a of mine) {
                const ra = rect(a);
                const b = objs.find(o => o !== a && !placed.has(o.id) && !(o instanceof mf.StartEvent) && !isNote(o) && overlaps(ra, rect(o)));
                if (b) {
                    hit = [a, b];
                    break;
                }
            }
            if (!hit) return;
            const [a, b] = hit;
            const ra = rect(a);
            const rb = rect(b);
            if (isNote(a) && !isNote(b)) {
                this.shift(coll, [a], 0, rb.t - CLEAR - ra.b);
                continue;
            }
            const pa = P(a);
            const pb = P(b);
            const sameRow = Math.abs(pb.y - pa.y) < (S(a).height + S(b).height) / 2 && pb.x >= pa.x && !isNote(b);
            if (sameRow) {
                const g = this.graph();
                const after = this.downstream(coll, (g.out.get(b.id) || []).map(f => f.destination), pb.x, new Set(placed));
                this.shift(coll, [b, ...after.filter(o => !placed.has(o.id))], Math.ceil(ra.r + CLEAR - rb.l), 0);
            } else {
                const group = isNote(b) ? [b] : this.lane(b).filter(o => !placed.has(o.id));
                const dy = pb.y >= pa.y ? Math.ceil(ra.b + CLEAR - rb.t) : Math.floor(ra.t - CLEAR - rb.b);
                this.shift(coll, group, 0, dy);
            }
        }
    }

    // Collisions, loop sizes (innermost first) and the parents of loops that changed.
    settle() {
        for (let guard = 0; this.dirty.size && guard < 200; guard++) {
            const coll = [...this.dirty].sort((a, b) => depth(b) - depth(a))[0];
            this.dirty.delete(coll);
            this.resolve(coll);
            const loop = coll.container;
            if (!isLoop(loop)) continue;
            const { dw, dh, oldX } = this.fit(loop);
            if (!dw && !dh) continue;
            const parent = loop.container;
            this.mark(parent, [loop]);
            if (dw) {
                const g = this.graph();
                const side = this.laneDir(loop);
                // the left edge stays: what follows on the right moves by the change; on a right-to-left lane the
                // loop moves back instead
                if (side > 0) this.makeRoomH(parent, (g.out.get(loop.id) || []).map(f => f.destination), oldX, dw, new Set([loop.id]));
                else {
                    setPoint(loop, P(loop).x - dw, P(loop).y);
                    this.makeRoomH(parent, (g.out.get(loop.id) || []).map(f => f.destination), oldX, -dw, new Set([loop.id]), -1);
                }
            }
        }
    }

    finish() {
        this.invalidate();
        this.settle();
        for (const { fl, donor, own } of this.pending) {
            if (fl.isDeleted || !fl.origin || !fl.destination) continue;
            const d = rel(fl);
            if (donor && destValid(donor.idx, d)) putSide(fl, "dest", donor);
            else if (own && destValid(own.idx, d)) putSide(fl, "dest", own);
            else setDestSide(fl, bestDest(fl, d));
        }
        // flows that were re-pointed, are new or run between objects that moved: keep the sides that still fit
        for (const fl of this.m.flows) {
            if (!fl.origin || !fl.destination) continue;
            const was = this.geo0.get(fl);
            const now = rel(fl);
            if (this.touched.has(fl) || !was || was.dx !== now.dx || was.dy !== now.dy) fixSides(fl);
        }
    }
}

// ------------------------------------------------ LAYOUT CHECK and the SVG preview (on plain snapshots)

function captionOf(o) {
    if (o instanceof mf.ActionActivity) {
        if (o.caption && !o.autoGenerateCaption) return o.caption;
        return o.action ? typeOf(o.action).replace(/Action$/, "").replace(/([a-z])([A-Z])/g, "$1 $2") : "Activity";
    }
    if (o instanceof mf.ExclusiveSplit) {
        const c = o.splitCondition;
        return (o.caption || (c && c.expression) || "decision").replace(/\s+/g, " ");
    }
    if (o instanceof mf.InheritanceSplit) return `type of $${o.splitVariableName}`;
    if (isLoop(o)) {
        const src = o.loopSource;
        return src && src.listVariableName ? `for each $${src.variableName} in $${src.listVariableName}` : src && src.whileExpression ? `while ${src.whileExpression}` : "loop";
    }
    if (isParam(o)) return `$${o.name}`;
    if (isNote(o)) return String(o.caption || "").replace(/\r?\n/g, " ");
    return typeOf(o).replace(/Event$/, "").toLowerCase();
}

// Positions, sizes and flows of a flow document as plain data (before/after an edit; LAYOUT CHECK and SVG work on it).
function snapshot(m) {
    const objects = [];
    const rec = (coll, loop, ox, oy) => {
        for (const o of coll.objects) {
            const p = P(o);
            const s = S(o);
            const ax = ox + p.x;
            const ay = oy + p.y;
            objects.push({ id: o.id, type: typeOf(o), loop, x: p.x, y: p.y, w: s.width, h: s.height, ax, ay, caption: captionOf(o) });
            if (isLoop(o)) rec(o.objectCollection, o.id, ax - s.width / 2, ay - s.height / 2);
        }
    };
    rec(m.objectCollection, "", 0, 0);
    const flows = [];
    for (const fl of m.flows) {
        if (!fl.origin || !fl.destination) continue;
        const l = lineOf(fl);
        const z = { width: 0, height: 0 };
        let label = "";
        if (fl instanceof mf.SequenceFlow) {
            const list = fl.caseValues ? [...fl.caseValues] : fl.caseValue ? [fl.caseValue] : [];
            label = list.map(c => (c instanceof mf.EnumerationCase ? c.value : c instanceof mf.InheritanceCase ? (c.valueQualifiedName || "empty").split(".").pop() : "")).filter(Boolean).join(", ");
        }
        flows.push({ from: fl.origin.id, to: fl.destination.id, oi: fl.originConnectionIndex, di: fl.destinationConnectionIndex, ov: (l && l.originControlVector) || z, dv: (l && l.destinationControlVector) || z,
            kind: fl instanceof mf.AnnotationFlow ? "note" : fl.isErrorHandler ? "error" : "flow", label });
    }
    return { qn: m.qualifiedName, objects, flows };
}

const srect = o => ({ l: o.x - o.w / 2, t: o.y - o.h / 2, r: o.x + o.w / 2, b: o.y + o.h / 2 });
const port = (o, i) => {
    const r = srect(o);
    return [{ x: o.x, y: r.t }, { x: r.r, y: o.y }, { x: o.x, y: r.b }, { x: r.l, y: o.y }][i] || { x: o.x, y: o.y };
};
const ACTIVE = o => o.type !== "Annotation";
const short = id => id.slice(0, 8);
const label = o => `[${short(o.id)}] ${o.type === "ActionActivity" ? "" : o.type + " "}${String(o.caption).slice(0, 40)}`.trim();

// Issues: { level: "error" | "warning", kind, key, text }. Errors: objects that overlap, objects outside their loop.
// Warnings: flows that run through an object, objects too close on a line, a note that covers a step, a main line
// wider than MAIN_WIDTH.
function lint(snap) {
    const out = [];
    const byId = new Map(snap.objects.map(o => [o.id, o]));
    const colls = new Map();
    for (const o of snap.objects) (colls.get(o.loop) || colls.set(o.loop, []).get(o.loop)).push(o);
    for (const [loop, objs] of colls) {
        for (let i = 0; i < objs.length; i++) {
            for (let j = i + 1; j < objs.length; j++) {
                const a = objs[i];
                const b = objs[j];
                if (!ACTIVE(a) && !ACTIVE(b)) continue;
                if (!overlaps(srect(a), srect(b))) continue;
                const [x, y] = a.id < b.id ? [a, b] : [b, a];
                if (ACTIVE(a) && ACTIVE(b)) out.push({ level: "error", kind: "overlap", key: `overlap ${x.id} ${y.id}`, text: `${label(x)} overlaps ${label(y)}` });
                else out.push({ level: "warning", kind: "note", key: `note ${x.id} ${y.id}`, text: `note ${label(ACTIVE(x) ? y : x)} covers ${label(ACTIVE(x) ? x : y)}` });
            }
        }
        if (loop) {
            const lp = byId.get(loop);
            for (const o of objs) {
                const r = srect(o);
                if (r.l < 0 || r.t < 0 || r.r > lp.w || r.b > lp.h) out.push({ level: "error", kind: "outside", key: `outside ${o.id}`, text: `${label(o)} is outside its loop ${label(lp)}` });
            }
        }
    }
    for (const f of snap.flows) {
        if (f.kind === "note") continue;
        const a = byId.get(f.from);
        const b = byId.get(f.to);
        if (!a || !b || a.loop !== b.loop) continue;
        const p0 = port(a, f.oi);
        const p3 = port(b, f.di);
        const p1 = { x: p0.x + f.ov.width, y: p0.y + f.ov.height };
        const p2 = { x: p3.x + f.dv.width, y: p3.y + f.dv.height };
        const pts = [];
        for (let k = 1; k < 24; k++) {
            const t = k / 24;
            const u = 1 - t;
            pts.push({ x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y });
        }
        for (const o of colls.get(a.loop)) {
            if (o === a || o === b || !ACTIVE(o) || o.type === "MicroflowParameterObject") continue;
            const r = srect(o);
            if (pts.some(p => p.x > r.l + 3 && p.x < r.r - 3 && p.y > r.t + 3 && p.y < r.b - 3)) out.push({ level: "warning", kind: "cross", key: `cross ${f.from} ${f.to} ${o.id}`, text: `the flow ${label(a)} -> ${label(b)} runs through ${label(o)}` });
        }
        if (Math.abs(a.y - b.y) < VERT && b.x > a.x && f.kind === "flow") {
            const gap = srect(b).l - srect(a).r;
            if (gap < 15) out.push({ level: "warning", kind: "tight", key: `tight ${f.from} ${f.to}`, text: `${label(a)} and ${label(b)} are ${Math.round(gap)} px apart on the line (unreadable; Studio Pro: ${GAP})` });
        }
    }
    const start = snap.objects.find(o => o.type === "StartEvent" && !o.loop);
    if (start) {
        const main = snap.objects.filter(o => !o.loop && ACTIVE(o) && Math.abs(o.y - start.y) < VERT);
        const width = Math.max(...main.map(o => srect(o).r)) - Math.min(...main.map(o => srect(o).l));
        if (width > MAIN_WIDTH) out.push({ level: "warning", kind: "wide", key: "wide", text: `the main line is ${Math.round(width)} px wide (${main.length} objects); hard to read: move a run of steps into a sub-microflow with extractMicroflow` });
    }
    return out;
}

// Issues of after that before did not have (by key)
function newIssues(before, after) {
    const had = new Set((before || []).map(i => i.key));
    return after.filter(i => !had.has(i.key));
}

// A readable picture of a snapshot: boxes, diamonds and circles with captions, the flows as Studio Pro's Bezier
// curves (error handler flows red and dashed, notes dotted), loops as frames. issues: LAYOUT CHECK issues to mark.
function svg(snap, title = snap.qn, issues = []) {
    const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const objs = snap.objects;
    const byId = new Map(objs.map(o => [o.id, o]));
    const bad = new Set();
    for (const i of issues) if (i.level === "error") i.key.split(" ").slice(1).forEach(id => bad.add(id));
    const ab = o => ({ l: o.ax - o.w / 2, t: o.ay - o.h / 2, r: o.ax + o.w / 2, b: o.ay + o.h / 2 });
    const all = objs.map(ab);
    const minX = Math.min(0, ...all.map(r => r.l)) - 40;
    const minY = Math.min(0, ...all.map(r => r.t)) - 70;
    const maxX = Math.max(400, ...all.map(r => r.r)) + 40;
    const maxY = Math.max(200, ...all.map(r => r.b)) + 40;
    const X = x => Math.round(x - minX);
    const Y = y => Math.round(y - minY);
    const lines = (text, width) => {
        const words = String(text).split(/\s+/).filter(Boolean);
        const max = Math.max(6, Math.floor(width / 6.5));
        const out = [];
        let cur = "";
        for (const w of words) {
            if ((cur + " " + w).trim().length > max && cur) {
                out.push(cur);
                cur = w;
            } else cur = (cur + " " + w).trim();
        }
        if (cur) out.push(cur);
        if (out.length > 3) out.splice(2, out.length - 2, out.slice(2).join(" ").slice(0, max - 1) + "…");
        return out.map(l => (l.length > max ? l.slice(0, max - 1) + "…" : l));
    };
    const text = (x, y, t, width, size = 11, anchor = "middle") => {
        const ls = lines(t, width);
        return ls.map((l, i) => `<text x="${X(x)}" y="${Y(y + (i - (ls.length - 1) / 2) * (size + 2)) + 4}" font-size="${size}" text-anchor="${anchor}">${esc(l)}</text>`).join("");
    };
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${X(maxX)}" height="${Y(maxY)}" viewBox="0 0 ${X(maxX)} ${Y(maxY)}" font-family="Segoe UI, Arial, sans-serif">`);
    out.push(`<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker>` +
        `<marker id="e" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c0392b"/></marker></defs>`);
    out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
    out.push(`<text x="12" y="22" font-size="14" font-weight="bold">${esc(title)}</text>`);
    // loops (outer first: they come first in the snapshot)
    for (const o of objs.filter(o => o.type === "LoopedActivity")) {
        const r = ab(o);
        out.push(`<rect x="${X(r.l)}" y="${Y(r.t)}" width="${o.w}" height="${o.h}" rx="8" fill="#f7f9fc" stroke="${bad.has(o.id) ? "#c0392b" : "#7f8c8d"}" stroke-width="1.5" stroke-dasharray="6 3"/>`);
        out.push(`<text x="${X(r.l + 8)}" y="${Y(r.t + 16)}" font-size="11" fill="#555">${esc(String(o.caption).slice(0, 60))}</text>`);
    }
    // flows
    const portAbs = (o, i) => {
        const r = ab(o);
        return [{ x: o.ax, y: r.t }, { x: r.r, y: o.ay }, { x: o.ax, y: r.b }, { x: r.l, y: o.ay }][i] || { x: o.ax, y: o.ay };
    };
    for (const f of snap.flows) {
        const a = byId.get(f.from);
        const b = byId.get(f.to);
        if (!a || !b) continue;
        const p0 = portAbs(a, f.oi);
        const p3 = portAbs(b, f.di);
        // a straight line when the vectors are 0 (older projects); else the stored curve, a bit stronger to read
        const k = 2;
        const c1 = { x: p0.x + f.ov.width * k, y: p0.y + f.ov.height * k };
        const c2 = { x: p3.x + f.dv.width * k, y: p3.y + f.dv.height * k };
        const style = f.kind === "error" ? `stroke="#c0392b" stroke-dasharray="5 3" marker-end="url(#e)"` : f.kind === "note" ? `stroke="#aaa" stroke-dasharray="2 3"` : `stroke="#555" marker-end="url(#a)"`;
        out.push(`<path d="M${X(p0.x)},${Y(p0.y)} C${X(c1.x)},${Y(c1.y)} ${X(c2.x)},${Y(c2.y)} ${X(p3.x)},${Y(p3.y)}" fill="none" stroke-width="1.3" ${style}/>`);
        if (f.label) out.push(`<text x="${X(p0.x + (f.oi === 1 ? 8 : 6))}" y="${Y(p0.y + (f.oi === 2 ? 14 : f.oi === 0 ? -6 : -5))}" font-size="10" fill="#2c3e50">${esc(f.label.slice(0, 24))}</text>`);
    }
    // objects
    for (const o of objs) {
        const r = ab(o);
        const stroke = bad.has(o.id) ? "#c0392b" : "#4a6fa5";
        const sw = bad.has(o.id) ? 2.5 : 1.2;
        switch (o.type) {
            case "LoopedActivity":
                break;
            case "ExclusiveSplit":
            case "InheritanceSplit":
            case "ExclusiveMerge": {
                const pts = [[o.ax, r.t], [r.r, o.ay], [o.ax, r.b], [r.l, o.ay]].map(([x, y]) => `${X(x)},${Y(y)}`).join(" ");
                out.push(`<polygon points="${pts}" fill="${o.type === "ExclusiveMerge" ? "#eeeeee" : "#fff4d6"}" stroke="${bad.has(o.id) ? "#c0392b" : "#b9770e"}" stroke-width="${sw}"/>`);
                if (o.type !== "ExclusiveMerge") out.push(text(o.ax, r.t - 14, o.caption, Math.max(140, o.w + 40), 10));
                break;
            }
            case "StartEvent":
            case "EndEvent":
            case "BreakEvent":
            case "ContinueEvent":
            case "ErrorEvent": {
                const fill = { StartEvent: "#2ecc71", EndEvent: "#e74c3c", ErrorEvent: "#8e44ad" }[o.type] || "#95a5a6";
                out.push(`<circle cx="${X(o.ax)}" cy="${Y(o.ay)}" r="${Math.max(6, Math.min(o.w, o.h) / 2)}" fill="${fill}" stroke="${bad.has(o.id) ? "#c0392b" : "#333"}" stroke-width="${sw}"/>`);
                if (o.type !== "StartEvent" && o.type !== "EndEvent") out.push(text(o.ax, r.b + 10, o.caption, 80, 9));
                break;
            }
            case "Annotation":
                out.push(`<rect x="${X(r.l)}" y="${Y(r.t)}" width="${o.w}" height="${o.h}" fill="#fffbe6" stroke="#d4ac0d" stroke-dasharray="3 2"/>`);
                out.push(text(o.ax, o.ay, o.caption, o.w - 8, 10));
                break;
            case "MicroflowParameterObject":
                out.push(`<rect x="${X(r.l)}" y="${Y(r.t)}" width="${o.w}" height="${o.h}" rx="4" fill="#e8f8f5" stroke="#16a085" stroke-width="${sw}"/>`);
                out.push(text(o.ax, r.b + 10, o.caption, 120, 10));
                break;
            default:
                out.push(`<rect x="${X(r.l)}" y="${Y(r.t)}" width="${o.w}" height="${o.h}" rx="6" fill="#eef4ff" stroke="${stroke}" stroke-width="${sw}"/>`);
                out.push(text(o.ax, o.ay, o.caption, o.w - 8, 11));
        }
        if (o.type !== "LoopedActivity") out.push(`<title>${esc(o.id.slice(0, 8))}</title>`);
    }
    out.push("</svg>");
    return out.join("\n");
}

// ------------------------------------------------ formatMicroflow: a full, deterministic re-layout

// Order of a node's outgoing flows: normal before error handler, "true" first, then as stored (not by position, so a
// second format gives the same result).
function caseKey(fl) {
    const list = fl.caseValues ? [...fl.caseValues] : fl.caseValue ? [fl.caseValue] : [];
    const c = list[0];
    return c instanceof mf.EnumerationCase ? String(c.value) : "";
}
function orderedOut(g, o) {
    const out = (g.out.get(o.id) || []).filter(f => f.destination && f.destination.container === o.container);
    return out.map((f, i) => ({ f, k: (f.isErrorHandler ? 2 : 0) + (caseKey(f) === "true" ? 0 : 1), i })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.f);
}

// Lays out one collection (a loop's first): returns nothing; positions are set. origin: { x, y } of the first root's
// middle point.
function formatColl(m, g, coll, origin, opts) {
    for (const o of coll.objects) if (isLoop(o)) formatLoop(m, g, o, opts);
    const nodes = [...coll.objects].filter(o => !isNote(o) && !isParam(o));
    if (!nodes.length) return;
    const ids = new Set(nodes.map(o => o.id));
    const hasIn = new Set();
    for (const o of nodes) for (const f of orderedOut(g, o)) if (ids.has(f.destination.id)) hasIn.add(f.destination.id);
    const start = nodes.find(o => o instanceof mf.StartEvent);
    const roots = start ? [start] : nodes.filter(o => !hasIn.has(o.id)).slice(0, 1);
    if (!roots.length) roots.push(nodes[0]);
    // lanes in discovery order (depth first), back edges ignored for the order
    const lane = new Map();
    const laneParent = [];
    const pre = new Map();
    const back = new Set();
    const onStack = new Set();
    const newLane = parent => (laneParent.push(parent), laneParent.length - 1);
    const visit = n => {
        pre.set(n.id, pre.size);
        onStack.add(n.id);
        let first = true;
        for (const f of orderedOut(g, n)) {
            const c = f.destination;
            if (!ids.has(c.id)) continue;
            if (onStack.has(c.id)) {
                back.add(f);
                continue;
            }
            if (!lane.has(c.id)) {
                lane.set(c.id, first && !f.isErrorHandler ? lane.get(n.id) : newLane(lane.get(n.id)));
                first = false;
                visit(c);
            } else if (!f.isErrorHandler) first = false;
        }
        onStack.delete(n.id);
    };
    for (const r of roots) {
        lane.set(r.id, newLane(null));
        visit(r);
    }
    for (const n of nodes) {
        if (lane.has(n.id)) continue; // not reachable: its own lanes below the rest
        lane.set(n.id, newLane(null));
        visit(n);
    }
    // x: left to right in topological order; an error handler path and a branch to another lane start right below
    const indeg = new Map(nodes.map(o => [o.id, 0]));
    const preds = new Map(nodes.map(o => [o.id, []]));
    for (const n of nodes) {
        for (const f of orderedOut(g, n)) {
            if (back.has(f) || !ids.has(f.destination.id)) continue;
            indeg.set(f.destination.id, indeg.get(f.destination.id) + 1);
            preds.get(f.destination.id).push(f);
        }
    }
    const ready = nodes.filter(o => !indeg.get(o.id)).sort((a, b) => pre.get(a.id) - pre.get(b.id));
    const cx = new Map();
    const w = o => S(o).width;
    while (ready.length) {
        const n = ready.shift();
        let c = null;
        for (const f of preds.get(n.id)) {
            const p = f.origin;
            const below = lane.get(p.id) !== lane.get(n.id) && (f.isErrorHandler || isSplit(p)) && laneParent[lane.get(n.id)] === lane.get(p.id) && preds.get(n.id).length === 1;
            const want = below ? cx.get(p.id) : cx.get(p.id) + w(p) / 2 + GAP + w(n) / 2;
            c = c === null ? want : Math.max(c, want);
        }
        if (c === null) c = origin.x - w(roots[0]) / 2 + w(n) / 2;
        cx.set(n.id, Math.round(c));
        for (const f of orderedOut(g, n)) {
            if (back.has(f) || !ids.has(f.destination.id)) continue;
            const d = f.destination.id;
            indeg.set(d, indeg.get(d) - 1);
            if (!indeg.get(d)) {
                ready.push(f.destination);
                ready.sort((a, b) => pre.get(a.id) - pre.get(b.id));
            }
        }
    }
    // rows: each lane in the first row below its parent's where its stretch is free
    const lanes = laneParent.map(() => ({ l: Infinity, r: -Infinity, h: 0 }));
    for (const n of nodes) {
        const L1 = lanes[lane.get(n.id)];
        L1.l = Math.min(L1.l, cx.get(n.id) - w(n) / 2);
        L1.r = Math.max(L1.r, cx.get(n.id) + w(n) / 2);
        L1.h = Math.max(L1.h, S(n).height);
    }
    const row = [];
    const rows = [];
    for (let k = 0; k < lanes.length; k++) {
        const L1 = lanes[k];
        if (L1.l === Infinity) continue;
        let r = laneParent[k] === null ? (k === 0 ? 0 : rows.length) : row[laneParent[k]] + 1;
        while (rows[r] && rows[r].some(x => x.l < L1.r + 40 && L1.l < x.r + 40)) r++;
        row[k] = r;
        (rows[r] = rows[r] || []).push(L1);
    }
    const ys = [];
    for (let r = 0; r < rows.length; r++) {
        const h = Math.max(20, ...(rows[r] || []).map(x => x.h));
        if (r === 0) ys.push(origin.y);
        else {
            const ph = Math.max(20, ...(rows[r - 1] || []).map(x => x.h));
            ys.push(ys[r - 1] + Math.max(LANE, ph / 2 + h / 2 + 70));
        }
    }
    const old = new Map(nodes.map(o => [o.id, { ...P(o) }]));
    for (const n of nodes) setPoint(n, cx.get(n.id), ys[row[lane.get(n.id)]]);
    // annotations: attached ones keep their offset to their (first) step; free ones stay
    if (!opts.keepAnnotations) {
        for (const note of [...coll.objects].filter(isNote)) {
            const t = (g.targets.get(note.id) || []).find(x => old.has(x.id));
            if (!t) continue;
            const was = old.get(t.id);
            setPoint(note, P(note).x + P(t).x - was.x, P(note).y + P(t).y - was.y);
        }
    }
    // parameters stay unless they cover a step: then in a row above the flow
    const params = [...coll.objects].filter(isParam);
    if (params.length) {
        const top = Math.min(...nodes.map(n => rect(n).t));
        let x = P(roots[0]).x;
        for (const p of params) {
            if (!nodes.some(n => overlaps(grow(rect(p), 10), rect(n)))) continue;
            setPoint(p, x, top - 60);
            x += 120;
        }
    }
}

function formatLoop(m, g, loop, opts) {
    const coll = loop.objectCollection;
    formatColl(m, g, coll, { x: LOOP_PAD.left + 60, y: LOOP_PAD.top + 30 }, opts);
    const objs = [...coll.objects];
    if (!objs.length) return;
    // first root at the padding (whatever its size), annotations kept inside
    const nodes = objs.filter(o => !isNote(o));
    const rs = (nodes.length ? nodes : objs).map(rect);
    const dx = LOOP_PAD.left - Math.min(...rs.map(r => r.l));
    const dy = LOOP_PAD.top - Math.min(...rs.map(r => r.t));
    for (const o of nodes) setPoint(o, P(o).x + dx, P(o).y + dy);
    for (const o of objs.filter(isNote)) {
        const r = rect(o);
        setPoint(o, P(o).x - Math.min(0, r.l - 10), P(o).y - Math.min(0, r.t - 10));
    }
    const all = objs.map(rect);
    const width = Math.round(Math.max(...all.map(r => r.r)) + LOOP_PAD.right);
    const height = Math.round(Math.max(...all.map(r => r.b)) + LOOP_PAD.bottom);
    loop.size = { width, height };
}

// Full re-layout of a microflow / nanoflow / rule: the main path on one horizontal line at the start event's height,
// branches and error handlers as lanes below (first free row), merges right of their last incoming step, loops sized
// to their content with Studio Pro's padding, every flow with Studio Pro's sides and vectors. Idempotent.
function format(m, opts = {}) {
    const g = graph(m);
    const start = [...m.objectCollection.objects].find(o => o instanceof mf.StartEvent);
    const origin = start ? { ...P(start) } : { x: 100, y: 200 };
    formatColl(m, g, m.objectCollection, origin, opts);
    for (const fl of m.flows) {
        if (fl instanceof mf.AnnotationFlow) defaultLine(fl);
        else normaliseFlow(fl);
    }
}

const grow = (r, d) => ({ l: r.l - d, t: r.t - d, r: r.r + d, b: r.b + d });

module.exports = {
    X_STEP, LANE, GAP, CLEAR, LOOP_PAD, SIZES, MAIN_WIDTH,
    typeOf, rect, overlaps, isSplit, isMerge, isLoop, isNote, isParam, graph, walk, contentBox, padsOf,
    lineOf, vec, mag, defaultLine, setOriginSide, setDestSide, sideOf, putSide, fixSides, normaliseFlow, bestOrigin, bestDest, originValid, destValid,
    snapshot, lint, newIssues, captionOf, svg, format,
    begin: m => new Session(m), Session
};
