import { App, CachedMetadata, TFile } from "obsidian";
import { AREA_NAME, Note3D, mapTopic, topicParts } from "./types";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
const DEFAULT_TEMPLATE_FOLDERS = ["шаблоны", "templates"];

export class Vault3DScanner {
private app: App;
private pendingPatches = new Map<string, Record<string, unknown>>();
private knownPaths = new Set<string>();

constructor(app: App) {
this.app = app;
}

public isKnownPath(path: string): boolean {
return this.knownPaths.has(path) || this.pendingPatches.has(path);
}

public isRelevantFile(file: TFile): boolean {
if (file.extension !== "md") return false;
if (this.isKnownPath(file.path)) return true;
const cache = this.app.metadataCache.getFileCache(file);
const fm = cache?.frontmatter;
if (!fm) return false;
return this.toList(fm["направление"]).includes(AREA_NAME);
}

public setPending(path: string, patch: Record<string, unknown>): void {
const prev = this.pendingPatches.get(path) || {};
this.pendingPatches.set(path, { ...prev, ...patch });
window.setTimeout(() => {
this.pendingPatches.delete(path);
}, 1500);
}

public scan(): Note3D[] {
const notes: Note3D[] = [];
const files = this.app.vault.getMarkdownFiles();

for (const file of files) {
const cache = this.app.metadataCache.getFileCache(file);
const fm: Record<string, unknown> = {
...(cache?.frontmatter || {}),
...(this.pendingPatches.get(file.path) || {})
};

if (!this.toList(fm["направление"]).includes(AREA_NAME)) continue;
if (this.isTemplate(file, fm)) continue;

const rawTopics = this.toList(fm["темы"]);
const topicPaths = Array.from(
new Set(rawTopics.map((v) => mapTopic(v)).filter(Boolean))
);
const topics = Array.from(
new Set(
topicPaths
.map((p) => topicParts(p)[0] ?? "")
.filter((t): t is string => t.length > 0)
)
);

notes.push({
file,
path: file.path,
title: file.basename,
programs: this.toList(fm["программы"]),
rawTopics,
topics,
topicPaths,
hasImages: this.checkHasImages(cache),
hasSchema: this.checkHasSchema(fm),
source: this.extractSource(fm["источник"]),
pinned: fm["закреплено"] === true,
mtime: file.stat.mtime
});
}

this.knownPaths = new Set(notes.map((n) => n.path));
return notes;
}

private toList(value: unknown): string[] {
if (value == null) return [];
const raw = Array.isArray(value) ? value : [value];
const cleaned = raw
.flat()
.map((v) => (typeof v === "string" ? v.trim() : ""))
.filter(Boolean);
return Array.from(new Set(cleaned));
}

private extractSource(value: unknown): string {
if (typeof value === "string") return value.trim();
if (value && typeof value === "object" && "path" in value) {
const p = (value as { path?: unknown }).path;
if (typeof p === "string") return `[[${p}]]`;
}
if (Array.isArray(value)) {
return value.map((v) => this.extractSource(v)).filter(Boolean).join("; ");
}
return "";
}

private checkHasImages(cache: CachedMetadata | null): boolean {
const embeds = cache?.embeds || [];
for (const em of embeds) {
const rawLink = String(em.link || "");
const beforeHash = rawLink.split("#")[0] ?? "";
const cleanLink = (beforeHash.split("|")[0] ?? "").trim();
const ext = (cleanLink.split(".").pop() ?? "").toLowerCase();
if (IMAGE_EXTENSIONS.has(ext)) return true;
}
return false;
}

private checkHasSchema(fm: Record<string, unknown>): boolean {
const raw = fm["схемы_аннотации"];
if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
return Object.values(raw as Record<string, unknown>).some(
(entry) => Boolean(entry && typeof entry === "object" && (entry as Record<string, unknown>)["deleted"] !== true)
);
}

private isTemplate(file: TFile, fm: Record<string, unknown>): boolean {
const lowerPath = file.path.toLowerCase();
for (const folder of DEFAULT_TEMPLATE_FOLDERS) {
if (lowerPath.startsWith(`${folder}/`) || lowerPath.includes(`/${folder}/`)) {
return true;
}
}
if (fm["шаблон"] === true) return true;
if (String(fm["тип"] || "").toLowerCase() === "шаблон") return true;

const tags = this.toList(fm["tags"]).map((t) => t.replace(/^#/, "").toLowerCase());
return tags.includes("template") || tags.includes("шаблон");
}
}