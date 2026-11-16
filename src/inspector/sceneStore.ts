import { App, Notice, TFile } from "obsidian";
import {
	ArrowheadType,
	CanvasToolId,
	ElementBinding,
	FillStyle,
	FontFamilyType,
	NodeImageItem,
	Scene,
	SceneAppState,
	SceneElement,
	SceneElementType,
	ScenePoint,
	StrokeStyle,
	TextAlignType,
	VerticalAlignType,
	cloneSceneElement,
	createDefaultAppState,
	createEmptyScene,
	generateElementId,
	hashStringSeed
} from "./sceneTypes";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);

export type ScenesByKey = Map<string, Scene>;

function isFiniteNum(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

function toNum(v: unknown, fallback = 0): number {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	const parsed = Number(v);
	return Number.isFinite(parsed) ? parsed : fallback;
}

export function extractImagesFromNote(app: App, file: TFile): NodeImageItem[] {
	const items: NodeImageItem[] = [];
	const seen = new Set<string>();
	const cache = app.metadataCache.getFileCache(file);
	const embeds = cache?.embeds || [];

	for (const em of embeds) {
		const raw = String(em.link || "");
		const linkPath = (raw.split("#")[0] ?? "").split("|")[0]?.trim();
		if (!linkPath) continue;

		const target = app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
		if (target instanceof TFile && IMAGE_EXTENSIONS.has(target.extension.toLowerCase())) {
			if (!seen.has(target.path)) {
				seen.add(target.path);
				items.push({
					file: target,
					path: target.path,
					name: target.name,
					resourcePath: app.vault.adapter.getResourcePath(target.path)
				});
			}
		}
	}
	return items;
}

function normalizePathBounds(el: SceneElement): void {
	if (!el.points || el.points.length === 0) return;
	const worldPts = el.points.map((p) => ({ x: el.x + p.x, y: el.y + p.y }));
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of worldPts) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
	el.x = minX;
	el.y = minY;
	el.width = Math.max(1, maxX - minX);
	el.height = Math.max(1, maxY - minY);
	el.points = worldPts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

function normalizeElement(
	raw: Record<string, unknown>,
	idx: number,
	accentColor: string
): SceneElement | null {
	const rawType = String(raw["type"] ?? "rectangle");
const validTypes: readonly SceneElementType[] = [
		"rectangle",
		"diamond",
		"ellipse",
		"arrow",
		"line",
		"text",
		"image"
	];

	let type: SceneElementType = "rectangle";
	if (rawType === "rect") type = "rectangle";
	else if ((validTypes as readonly string[]).includes(rawType)) type = rawType as SceneElementType;
	else return null;

	const id =
		typeof raw["id"] === "string" && raw["id"].trim().length > 0
			? raw["id"].trim()
			: generateElementId(type);

	// Миграция v1 стрелок с x1/y1/x2/y2
	if (
		(type === "arrow" || type === "line") &&
		!Array.isArray(raw["points"]) &&
		(isFiniteNum(raw["x1"]) || isFiniteNum(raw["x2"]))
	) {
		const x1 = toNum(raw["x1"], 0);
		const y1 = toNum(raw["y1"], 0);
		const x2 = toNum(raw["x2"], 100);
		const y2 = toNum(raw["y2"], 100);
		const routing = String(raw["routing"] ?? "straight");
		const pts: ScenePoint[] = [{ x: 0, y: 0 }];

		if (routing === "curved" && isFiniteNum(raw["cx1"]) && isFiniteNum(raw["cy1"])) {
			const cx1 = toNum(raw["cx1"], (x1 + x2) / 2);
			const cy1 = toNum(raw["cy1"], y1);
			const cx2 = toNum(raw["cx2"], (x1 + x2) / 2);
			const cy2 = toNum(raw["cy2"], y2);
			pts.push({ x: Math.round((cx1 + cx2) / 2 - x1), y: Math.round((cy1 + cy2) / 2 - y1) });
		} else if (routing === "orthogonal" && Math.abs(x2 - x1) > 8 && Math.abs(y2 - y1) > 8) {
			const midX = Math.round((x2 - x1) / 2);
			pts.push({ x: midX, y: 0 }, { x: midX, y: Math.round(y2 - y1) });
		}
		pts.push({ x: Math.round(x2 - x1), y: Math.round(y2 - y1) });

		const el: SceneElement = {
			id,
			type,
			x: Math.round(x1),
			y: Math.round(y1),
			width: Math.max(4, Math.abs(x2 - x1)),
			height: Math.max(4, Math.abs(y2 - y1)),
			angle: 0,
			strokeColor: String(raw["stroke"] || raw["strokeColor"] || accentColor),
			backgroundColor: "transparent",
			fillStyle: "none",
			strokeWidth: toNum(raw["strokeWidth"], 2),
			strokeStyle: "solid",
			roughness: toNum(raw["roughness"], 0),
			opacity: toNum(raw["opacity"], 100),
			roundness: routing === "curved" ? 16 : 0,
			points: pts,
			startBinding:
				typeof raw["startElementId"] === "string" && raw["startElementId"]
					? { elementId: String(raw["startElementId"]), focus: 0, gap: 4 }
					: null,
			endBinding:
				typeof raw["endElementId"] === "string" && raw["endElementId"]
					? { elementId: String(raw["endElementId"]), focus: 0, gap: 4 }
					: null,
			startArrowhead: raw["startHead"] === "arrow" ? "arrow" : "none",
			endArrowhead: raw["endHead"] === "none" ? "none" : "arrow",
			curved: routing === "curved",
			elbowed: routing === "orthogonal",
			fontFamily: "normal",
			fontSize: 16,
			textAlign: "center",
			verticalAlign: "middle",
			locked: false,
			isDeleted: false,
			zIndex: isFiniteNum(raw["zIndex"]) ? raw["zIndex"] : idx,
			updated: toNum(raw["updated"], Date.now()),
			seed: hashStringSeed(id)
		};
		normalizePathBounds(el);
		return el;
	}

	const textVal = typeof raw["text"] === "string" ? raw["text"] : undefined;
	if (type === "text" && !textVal?.trim()) return null;

	let points: ScenePoint[] | undefined;
	if (Array.isArray(raw["points"])) {
		points = raw["points"]
			.map((pt): ScenePoint | null => {
				if (pt && typeof pt === "object") {
					const r = pt as Record<string, unknown>;
					return { x: toNum(r["x"], 0), y: toNum(r["y"], 0) };
				}
				return null;
			})
			.filter((p): p is ScenePoint => p !== null);
	}

	const rawFill = String(raw["fillStyle"] ?? "solid") as FillStyle;
	const fillStyle: FillStyle = ["solid", "hachure", "cross-hatch", "none"].includes(rawFill)
		? rawFill
		: "solid";

	const rawStrokeStyle = String(raw["strokeStyle"] ?? "solid") as StrokeStyle;
	const strokeStyle: StrokeStyle = ["solid", "dashed", "dotted"].includes(rawStrokeStyle)
		? rawStrokeStyle
		: "solid";

	const rawFont = String(raw["fontFamily"] ?? "normal") as FontFamilyType;
	const fontFamily: FontFamilyType = ["hand", "normal", "mono"].includes(rawFont) ? rawFont : "normal";

	const rawTextAlign = String(raw["textAlign"] ?? (type === "text" ? "left" : "center")) as TextAlignType;
	const textAlign: TextAlignType = ["left", "center", "right"].includes(rawTextAlign)
		? rawTextAlign
		: "left";

	const rawVAlign = String(raw["verticalAlign"] ?? (type === "text" ? "top" : "middle")) as VerticalAlignType;
	const verticalAlign: VerticalAlignType = ["top", "middle", "bottom"].includes(rawVAlign)
		? rawVAlign
		: "middle";

	const el: SceneElement = {
		id,
		type,
		x: toNum(raw["x"], 0),
		y: toNum(raw["y"], 0),
		width: Math.max(4, toNum(raw["width"], type === "text" ? 160 : 120)),
		height: Math.max(4, toNum(raw["height"], type === "text" ? 40 : 80)),
		angle: toNum(raw["angle"], 0),
		strokeColor: String(
			raw["strokeColor"] ?? raw["stroke"] ?? raw["color"] ?? (type === "text" ? "#ffffff" : accentColor)
		),
		backgroundColor: String(raw["backgroundColor"] ?? raw["fill"] ?? "transparent"),
		fillStyle,
		strokeWidth: toNum(raw["strokeWidth"], 2),
		strokeStyle,
		roughness: toNum(raw["roughness"], 0),
		opacity: Math.max(10, Math.min(100, toNum(raw["opacity"], 100))),
		roundness: toNum(raw["roundness"] ?? raw["borderRadius"], type === "rectangle" ? 8 : 0),
		points,
		startBinding: (raw["startBinding"] as ElementBinding | null) ?? null,
		endBinding: (raw["endBinding"] as ElementBinding | null) ?? null,
		startArrowhead: (raw["startArrowhead"] as ArrowheadType) ?? "none",
		endArrowhead: (raw["endArrowhead"] as ArrowheadType) ?? (type === "arrow" ? "arrow" : "none"),
		curved: Boolean(raw["curved"]),
		elbowed: Boolean(raw["elbowed"]),
		text: textVal,
		fontFamily,
		fontSize: Math.max(8, toNum(raw["fontSize"], 18)),
		textAlign,
		verticalAlign,
		autoResize: typeof raw["autoResize"] === "boolean" ? raw["autoResize"] : undefined,
containerId: typeof raw["containerId"] === "string" ? raw["containerId"] : null,
		boundTextId: typeof raw["boundTextId"] === "string" ? raw["boundTextId"] : null,
		imagePath: typeof raw["imagePath"] === "string" ? raw["imagePath"] : undefined,
		aspectRatio: isFiniteNum(raw["aspectRatio"]) ? raw["aspectRatio"] : undefined,
		locked: Boolean(raw["locked"]),
		isDeleted: Boolean(raw["isDeleted"]),
		zIndex: isFiniteNum(raw["zIndex"]) ? raw["zIndex"] : idx,
		updated: toNum(raw["updated"], Date.now()),
		seed: isFiniteNum(raw["seed"]) ? raw["seed"] : hashStringSeed(id)
	};

	if (type === "arrow" || type === "line") normalizePathBounds(el);
	return el;
}

export function migrateBoardEntry(rawBoard: unknown, accentColor: string): Scene {
	if (!rawBoard) return createEmptyScene(accentColor);

	if (
		typeof rawBoard === "object" &&
		!Array.isArray(rawBoard) &&
		(rawBoard as { version?: unknown }).version === 2
	) {
		const rec = rawBoard as Record<string, unknown>;
		const rawElements = Array.isArray(rec["elements"]) ? rec["elements"] : [];
		const elements: SceneElement[] = [];

		rawElements.forEach((item, i) => {
			if (item && typeof item === "object") {
				const parsed = normalizeElement(item as Record<string, unknown>, i, accentColor);
				if (parsed && !parsed.isDeleted) elements.push(parsed);
			}
		});

		const baseState = createDefaultAppState(accentColor);
		if (rec["appState"] && typeof rec["appState"] === "object") {
			const st = rec["appState"] as Partial<SceneAppState>;
			if (isFiniteNum(st.scrollX)) baseState.scrollX = st.scrollX;
			if (isFiniteNum(st.scrollY)) baseState.scrollY = st.scrollY;
			if (isFiniteNum(st.zoom)) baseState.zoom = Math.max(0.1, Math.min(10, st.zoom));
			if (typeof st.grid === "boolean") baseState.grid = st.grid;
			if (isFiniteNum(st.gridSize)) baseState.gridSize = st.gridSize;
			if (typeof st.snapToObjects === "boolean") baseState.snapToObjects = st.snapToObjects;
			if (typeof st.keepToolActive === "boolean") baseState.keepToolActive = st.keepToolActive;
			if (typeof st.activeTool === "string") baseState.activeTool = st.activeTool as CanvasToolId;
			if (st.currentStyle && typeof st.currentStyle === "object") {
				baseState.currentStyle = { ...baseState.currentStyle, ...st.currentStyle };
			}
		}

return {
			version: 2,
			title: typeof rec["title"] === "string" ? rec["title"] : undefined,
			deleted: rec["deleted"] === true ? true : undefined,
			elements,
			appState: baseState
		};
	}

	const rawList = Array.isArray(rawBoard)
		? rawBoard
		: typeof rawBoard === "object" && Array.isArray((rawBoard as { elements?: unknown }).elements)
			? ((rawBoard as { elements: unknown[] }).elements)
			: [];

	const elements: SceneElement[] = [];
	rawList.forEach((item, i) => {
		if (item && typeof item === "object") {
			const parsed = normalizeElement(item as Record<string, unknown>, i, accentColor);
			if (parsed && !parsed.isDeleted) elements.push(parsed);
		}
	});

	return { version: 2, elements, appState: createDefaultAppState(accentColor) };
}

export class SceneStore {
	private app: App;
	private file: TFile;
	private accentColor: string;
	private win: Window & typeof globalThis;
	private debounceTimer: number | null = null;
	private pendingMap: ScenesByKey | null = null;
	private saveQueue: Promise<void> = Promise.resolve();

	constructor(app: App, file: TFile, accentColor: string, win: Window & typeof globalThis) {
		this.app = app;
		this.file = file;
		this.accentColor = accentColor;
		this.win = win;
	}

	public loadScenes(): ScenesByKey {
		const cache = this.app.metadataCache.getFileCache(this.file);
		const fm = cache?.frontmatter ?? {};
		const raw = fm["схемы_аннотации"];
		const map: ScenesByKey = new Map();

		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
				map.set(key, migrateBoardEntry(entry, this.accentColor));
			}
		}
		return map;
	}

	public scheduleSave(scenesMap: ScenesByKey, delayMs = 450): void {
		this.pendingMap = this.cloneMap(scenesMap);
		if (this.debounceTimer !== null) {
			this.win.clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = this.win.setTimeout(() => {
			this.debounceTimer = null;
			const toWrite = this.pendingMap;
			this.pendingMap = null;
			if (toWrite) {
				void this.writeScenes(toWrite).catch((e: unknown) => this.reportError(e));
			}
		}, delayMs);
	}

	public async flushSave(scenesMap?: ScenesByKey): Promise<void> {
		if (this.debounceTimer !== null) {
			this.win.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		const toWrite = scenesMap ? this.cloneMap(scenesMap) : this.pendingMap;
		this.pendingMap = null;
		if (toWrite) {
			await this.writeScenes(toWrite);
		} else {
			await this.saveQueue;
		}
	}

	private cloneMap(map: ScenesByKey): ScenesByKey {
		const out: ScenesByKey = new Map();
for (const [k, s] of map.entries()) {
			out.set(k, {
				version: 2,
				title: s.title,
				deleted: s.deleted,
				elements: s.elements.map((el) => cloneSceneElement(el)),
				appState: { ...s.appState, currentStyle: { ...s.appState.currentStyle } }
			});
		}
		return out;
	}

private serializeScene(scene: Scene): Record<string, unknown> {
		if (scene.deleted) {
			return { version: 2, deleted: true };
		}

		const activeElements = scene.elements
			.filter((el) => !el.isDeleted)
			.sort((a, b) => a.zIndex - b.zIndex)
			.map((el, idx) => {
				const clean: Record<string, unknown> = {
					id: el.id,
					type: el.type,
					x: Math.round(el.x * 100) / 100,
					y: Math.round(el.y * 100) / 100,
					width: Math.max(1, Math.round(el.width * 100) / 100),
					height: Math.max(1, Math.round(el.height * 100) / 100),
					angle: Math.round((el.angle || 0) * 10000) / 10000,
					strokeColor: el.strokeColor,
					backgroundColor: el.backgroundColor,
					fillStyle: el.fillStyle,
					strokeWidth: el.strokeWidth,
					strokeStyle: el.strokeStyle,
					roughness: el.roughness,
					opacity: el.opacity,
					roundness: el.roundness,
					fontFamily: el.fontFamily,
					fontSize: el.fontSize,
					textAlign: el.textAlign,
					verticalAlign: el.verticalAlign,
					locked: Boolean(el.locked),
					zIndex: idx,
					updated: el.updated || Date.now()
				};
				if (el.points && el.points.length > 0) {
					clean["points"] = el.points.map((p) => ({
						x: Math.round(p.x * 100) / 100,
						y: Math.round(p.y * 100) / 100
					}));
				}
				if (el.startBinding) clean["startBinding"] = el.startBinding;
				if (el.endBinding) clean["endBinding"] = el.endBinding;
				if (el.startArrowhead && el.startArrowhead !== "none") clean["startArrowhead"] = el.startArrowhead;
				if (el.endArrowhead && el.endArrowhead !== "none") clean["endArrowhead"] = el.endArrowhead;
				if (el.curved) clean["curved"] = true;
				if (el.elbowed) clean["elbowed"] = true;
				if (typeof el.text === "string" && el.text.length > 0) clean["text"] = el.text;
				if (typeof el.autoResize === "boolean") clean["autoResize"] = el.autoResize;
if (el.containerId) clean["containerId"] = el.containerId;
				if (el.boundTextId) clean["boundTextId"] = el.boundTextId;
				if (el.imagePath) clean["imagePath"] = el.imagePath;
				if (typeof el.aspectRatio === "number" && el.aspectRatio > 0) clean["aspectRatio"] = Number(el.aspectRatio.toFixed(4));
				return clean;
			});

		const out: Record<string, unknown> = {
			version: 2,
			elements: activeElements,
			appState: {
				scrollX: Math.round(scene.appState.scrollX),
				scrollY: Math.round(scene.appState.scrollY),
				zoom: Number(scene.appState.zoom.toFixed(3)),
				grid: scene.appState.grid,
				gridSize: scene.appState.gridSize,
				snapToObjects: scene.appState.snapToObjects,
				keepToolActive: scene.appState.keepToolActive,
				activeTool: scene.appState.activeTool,
currentStyle: { ...scene.appState.currentStyle }
			}
		};
		if (scene.title?.trim()) out["title"] = scene.title.trim();
		return out;
	}

	private async writeScenes(scenesMap: ScenesByKey): Promise<void> {
		const payload: Record<string, unknown> = {};
		for (const [key, scene] of scenesMap.entries()) {
			if (scene.deleted || key.startsWith("__board_") || scene.elements.some((el) => !el.isDeleted)) {
				payload[key] = this.serializeScene(scene);
			}
		}

		const op = this.saveQueue.then(async () => {
			await this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
				if (Object.keys(payload).length === 0) {
					delete fm["схемы_аннотации"];
				} else {
					fm["схемы_аннотации"] = payload;
				}
			});
		});
		this.saveQueue = op.catch(() => undefined);
		await op;
	}

	private reportError(e: unknown): void {
		new Notice("Ошибка сохранения схемы: " + (e instanceof Error ? e.message : String(e)));
	}
}