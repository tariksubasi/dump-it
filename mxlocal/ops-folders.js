"use strict";
// Folders of a module (Projects$Folder units): rename, move inside the module, delete. Folders hold documents and
// other folders; qualified names do not contain folders, so renaming or moving one changes no reference.
//   renameFolder  a folder gets a new name (unique among its siblings)
//   moveFolder    a folder (with everything in it) into another folder of the same module, or to the module root
//   deleteFolder  an empty folder; a folder with contents is refused with the list, unless force (then its documents
//                 are deleted like the delete op does: what still uses them is listed)
const sdk = require("mendixmodelsdk");
const { fail, validName } = require("./ops-util");

const { projects } = sdk;

const FOLDER = "R folder path inside the module, e.g. Orders/Actions";
const FOLDER_OPS = {
    renameFolder: { doc: "Rename a folder of a module (no reference changes: qualified names do not contain folders).", fields: { module: "R module name", folder: FOLDER, newName: "R new folder name" } },
    moveFolder: {
        doc: "Move a folder with everything in it into another folder of the same module, or to the module root. (One document: moveDocument.)",
        fields: { module: "R module name", folder: FOLDER, to: "R target folder path, e.g. Archive (\"\" = the module root; missing folders are made)" }
    },
    deleteFolder: {
        doc: "Delete a folder of a module. A folder that is not empty is refused with its contents, unless force: then its documents are deleted too (what still uses them is listed).",
        fields: { module: "R module name", folder: FOLDER, force: "optional true: also delete every document and folder in it" }
    }
};

const FOLDER_SYNONYMS = {
    renameFolder: { name: "write the new name as \"newName\"", path: "write it as \"folder\"" },
    moveFolder: { target: "write it as \"to\"", into: "write it as \"to\"", path: "write it as \"folder\"" },
    deleteFolder: { recursive: "write it as \"force\": true", path: "write it as \"folder\"" }
};

const parts = p => String(p || "").split(/[/\\]/).map(s => s.trim()).filter(Boolean);

// h: { model, client, moduleNamed, folder, impl }
function makeFolders(h) {
    const { client } = h;

    // every folder path of a module (for "did you mean")
    function paths(m) {
        const out = [];
        const walk = (c, pre) => {
            for (const f of c.folders) {
                out.push(pre + f.name);
                walk(f, pre + f.name + "/");
            }
        };
        walk(m, "");
        return out;
    }
    function folderAt(moduleName, path, where) {
        const m = h.moduleNamed(moduleName);
        const ps = parts(path);
        if (!ps.length) throw new Error(`${where}: give the folder path, e.g. "Orders/Actions" (the module itself is not a folder)`);
        let cur = m;
        for (const p of ps) {
            const next = cur.folders.find(f => f.name === p);
            if (!next) fail(`${where}: ${moduleName} has no folder '${ps.join("/")}'`, ps.join("/"), paths(m));
            cur = next;
        }
        return { m, f: cur, path: ps.join("/") };
    }
    // documents and folders inside f (deepest first), as "path/Name" lines
    function contents(f, pre = "") {
        const docs = [];
        const folders = [];
        const walk = (c, p) => {
            for (const sub of c.folders) {
                walk(sub, `${p}${sub.name}/`);
                folders.push({ f: sub, path: `${p}${sub.name}` });
            }
            for (const d of c.documents) docs.push({ d, path: `${p}${d.name}` });
        };
        walk(f, pre);
        return { docs, folders };
    }

    async function renameFolder(o) {
        const where = `renameFolder ${o.module}/${o.folder}`;
        const { f, path } = folderAt(o.module, o.folder, where);
        validName(o.newName, "folder name");
        if (f.name === o.newName) return `${o.module}/${path}: already named ${o.newName}`;
        const parent = f.container;
        if (parent.folders.some(x => x !== f && x.name === o.newName)) throw new Error(`${where}: ${parent instanceof projects.Module ? o.module : parent.name} already has a folder ${o.newName}`);
        f.name = o.newName;
        return `${o.module}/${path} -> ${[...parts(o.folder).slice(0, -1), o.newName].join("/")}`;
    }

    async function moveFolder(o) {
        const where = `moveFolder ${o.module}/${o.folder}`;
        const { m, f, path } = folderAt(o.module, o.folder, where);
        const to = parts(o.to);
        if (o.to === undefined) throw new Error(`${where}: give "to" (a folder path, or "" for the module root)`);
        if (to.join("/") === path || to.join("/").startsWith(path + "/")) throw new Error(`${where}: a folder cannot move into itself (${to.join("/")})`);
        if (/[.]/.test(String(o.to))) throw new Error(`${where}: "to" is a folder path of ${o.module} (folders cannot move to another module: move its documents with moveEntity / copyDocument, or in Studio Pro)`);
        const target = to.length ? h.folder(o.module, to.join("/")) : m;
        if (target === f.container) return `${o.module}/${path}: already in ${to.join("/") || "the module root"}`;
        if (target.folders.some(x => x !== f && x.name === f.name)) throw new Error(`${where}: ${to.join("/") || o.module} already has a folder ${f.name}`);
        client.moveUnit(f.id, target.id, "Folders");
        const { docs } = contents(f);
        return `${o.module}/${path} -> ${[...to, f.name].join("/")} (${docs.length} document(s) in it)`;
    }

    async function deleteFolder(o) {
        const where = `deleteFolder ${o.module}/${o.folder}`;
        const { f, path } = folderAt(o.module, o.folder, where);
        const { docs, folders } = contents(f);
        const force = o.force === true || o.force === "true";
        if ((docs.length || folders.length) && !force) {
            const list = [...docs.map(x => x.path), ...folders.map(x => x.path + "/")];
            throw new Error(`REFUSED: ${o.module}/${path} is not empty (${docs.length} document(s), ${folders.length} folder(s)): ${list.slice(0, 15).join(", ")}${list.length > 15 ? `, and ${list.length - 15} more` : ""}. Move them out (moveDocument / moveFolder), or give "force": true to delete them too`);
        }
        const lines = [];
        for (const { d } of docs) {
            const qn = `${o.module}.${d.name}`;
            const r = await h.impl().delete({ target: qn });
            lines.push(`deleted ${r.replace(/\n/g, "\n  ")}`);
        }
        for (const { f: sub } of folders) sub.delete();
        f.delete();
        return `${o.module}/${path} deleted${lines.length ? `\n      ${lines.join("\n      ")}` : ""}`;
    }

    const exists = (moduleName, path) => {
        const m = h.model.allModules().find(x => x.name === moduleName);
        let cur = m;
        for (const p of parts(path)) cur = cur && cur.folders.find(f => f.name === p);
        return !!cur && cur !== m;
    };
    const checks = {
        async renameFolder(o) {
            const np = [...parts(o.folder).slice(0, -1), o.newName].join("/");
            return exists(o.module, np) ? [] : [`${o.module}/${np} missing`];
        },
        async moveFolder(o) {
            const np = [...parts(o.to), parts(o.folder).pop()].join("/");
            const r = exists(o.module, np) ? [] : [`${o.module}/${np} missing`];
            if (exists(o.module, o.folder)) r.push(`${o.module}/${o.folder} still exists`);
            return r;
        },
        async deleteFolder(o) {
            return exists(o.module, o.folder) ? [`${o.module}/${o.folder} still exists`] : [];
        }
    };
    return { impl: { renameFolder, moveFolder, deleteFolder }, checks };
}

module.exports = { makeFolders, FOLDER_OPS, FOLDER_SYNONYMS };
