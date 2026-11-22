import { BubbleLink, Note3D, NoteStyle, VirtualTopicEntry, getProgramColor, getTopicAccentColor, topicParts } from "./types";

export interface NavLevel {
	program: string | null;
	topicPath: string;
}

const JELLY_SEGMENTS = 24;
const CLUSTER_SEGMENTS = 36;

export interface BubbleNode {
	id: string;
	kind: "program" | "topic" | "folder" | "note";
	label: string;
	subLabel: string;
	detailLine: string;
	count: number;
	color: string;
	radius: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	anchorX: number;
	anchorY: number;
	phase: number;
	targetValue: string;
	note?: Note3D;
	// Радиальные смещения и скорости вершин для эффекта желе
	radialOffsets: Float32Array;
	radialVels: Float32Array;
	overlapGlow: number;
}

interface ClusterGroup {
	key: string;
	title: string;
	nodes: BubbleNode[];
	cx: number;
	cy: number;
	radii: Float32Array;
	radialVels: Float32Array;
	phase: number;
	headerX: number;
	headerY: number;
	headerW: number;
	headerH: number;
	color: string;
}

export interface DropTargetInfo {
	kind: "bubble" | "outside" | "crumb";
	topicPath: string; // Пустая строка "" = убрать темы (Outside)
	label: string;
}

export interface CanvasCallbacks {
	onNavigate: (level: NavLevel) => void;
	onOpenNote: (note: Note3D, newTab: boolean) => void;
	onInspectNote: (note: Note3D) => void;
	onSavePosition: (id: string, x: number, y: number) => void;
	onToggleLink: (fromId: string, toId: string) => void;
	onRenameCluster: (clusterKey: string, currentTitle: string) => void;
	onDragStateChange: (
		draggingNode: BubbleNode | null,
		overTrash: boolean,
		dropTarget: DropTargetInfo | null
	) => void;
onDropToTrash: (node: BubbleNode) => void;
	onMoveNoteToTopic: (note: Note3D, targetTopicPath: string) => void;
	onStyleNote: (note: Note3D, clientX: number, clientY: number) => void;
}

export class BubbleCanvasEngine {
	private host: HTMLElement;
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private overlayLayer: HTMLElement;
	private callbacks: CanvasCallbacks;

	private nodes: BubbleNode[] = [];
	private links: BubbleLink[] = [];
private clusterNames: Record<string, string> = {};
	private clusters: ClusterGroup[] = [];
	private savedPositions: Record<string, { x: number; y: number }> = {};
	private noteStyles: Record<string, NoteStyle> = {};
	private resolveResourcePath?: (vaultPath: string) => string;
	private iconImages = new Map<string, HTMLImageElement>();

	// Камера
	private camX = 0;
	private camY = 0;
	private camZoom = 1;
	private targetCamX = 0;
	private targetCamY = 0;
	private targetCamZoom = 1;

	// Взаимодействие
	private pointers = new Map<number, { x: number; y: number }>();
	private activePointerId: number | null = null;
	private dragMode: "none" | "pan" | "bubble" | "link" | "cluster" = "none";
	private draggedNode: BubbleNode | null = null;
	private draggedCluster: ClusterGroup | null = null;
	private linkSourceNode: BubbleNode | null = null;
	private linkPointerWorld = { x: 0, y: 0 };
	private hoveredNode: BubbleNode | null = null;
	private hoveredLinkIndex = -1;

	// Режим сцепления (для тач-экрана iPad или кнопки в панели)
	private linkModeActive = false;
	private pendingLinkFromId: string | null = null;

private pointerDownPos = { x: 0, y: 0 };
	private pointerDownTime = 0;
	private dragOffset = { x: 0, y: 0 };
	private lastPinchDist = 0;
private trashZoneEl: HTMLElement | null = null;
	private outsideZoneEl: HTMLElement | null = null;
	private topIslandEl: HTMLElement | null = null;
	private isOverTrash = false;
	private activeDropTarget: DropTargetInfo | null = null;
	private dropHoverBubble: BubbleNode | null = null;
	private noteHalfHeights = new Map<string, number>();

private rafId: number | null = null;
	private lastTime = 0;
	private animTimeSec = 0;
	private width = 0;
	private height = 0;
private dpr = 1;
	private uiFontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
	private themeColors = {
		surface: "#1f2128",
		surfaceHover: "#282b34",
		surfaceAlt: "#181a20",
		border: "rgba(160, 166, 184, 0.22)",
		borderStrong: "rgba(160, 166, 184, 0.45)",
		textNormal: "#e6e8ef",
		textMuted: "#9aa0b2",
		textFaint: "#6c7285",
		accent: "#7c859e",
		green: "#4aab80",
		red: "#d85b57"
	};
private resizeObserver: ResizeObserver;

	private actionBadges = new Map<string, HTMLElement>();
	private lastBadgeTransforms = new Map<string, string>();
	private bubbleTextCache = new Map<string, { fontSize: number; lines: string[]; lineHeight: number }>();
	private cardLayoutCache = new Map<string, { lines: string[]; h: number }>();
	private gridPattern: CanvasPattern | null = null;
	private gridPatternStep = 0;
	private paused = false;
	private lastRenderTime = 0;
	private focusWakeHandler = () => {
		this.lastTime = performance.now();
		this.lastRenderTime = 0;
	};

	constructor(host: HTMLElement, callbacks: CanvasCallbacks) {
		this.host = host;
		this.callbacks = callbacks;

		this.canvas = document.createElement("canvas");
		this.canvas.className = "hub3d-canvas";
		this.host.appendChild(this.canvas);

		const context = this.canvas.getContext("2d");
		if (!context) throw new Error("Не удалось инициализировать 2D-контекст");
		this.ctx = context;

		this.overlayLayer = document.createElement("div");
		this.overlayLayer.className = "hub3d-overlay-layer";
		this.host.appendChild(this.overlayLayer);

		this.resizeObserver = new ResizeObserver(() => this.handleResize());
		this.resizeObserver.observe(this.host);
		this.handleResize();

window.addEventListener("focus", this.focusWakeHandler);
		this.bindEvents();
		this.startLoop();
	}

	public setPaused(paused: boolean): void {
		this.paused = paused;
		if (!paused) {
			this.lastTime = performance.now();
			this.lastRenderTime = 0;
		}
	}

	public destroy(): void {
		window.removeEventListener("focus", this.focusWakeHandler);
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.resizeObserver.disconnect();
		this.overlayLayer.remove();
		this.canvas.remove();
	}

	public setLinkMode(active: boolean): void {
		this.linkModeActive = active;
		if (!active) {
			this.pendingLinkFromId = null;
		}
	}

	public isLinkMode(): boolean {
		return this.linkModeActive;
	}

public setDropZoneElements(
		trashEl: HTMLElement | null,
		outsideEl: HTMLElement | null,
		topIslandEl: HTMLElement | null
	): void {
		this.trashZoneEl = trashEl;
		this.outsideZoneEl = outsideEl;
		this.topIslandEl = topIslandEl;
	}

	private isPointInsideElement(el: HTMLElement | null, clientX: number, clientY: number, pad = 10): boolean {
		if (!el) return false;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return false;
		return (
			clientX >= rect.left - pad &&
			clientX <= rect.right + pad &&
			clientY >= rect.top - pad &&
			clientY <= rect.bottom + pad
		);
	}

	private findBubbleDropTarget(wx: number, wy: number, dragged: BubbleNode): BubbleNode | null {
		for (let i = this.nodes.length - 1; i >= 0; i--) {
			const candidate = this.nodes[i];
			if (!candidate || candidate === dragged) continue;
			if (candidate.kind !== "topic" && candidate.kind !== "folder") continue;
			const dx = wx - candidate.x;
			const dy = wy - candidate.y;
			const catchRadius = candidate.radius + 14;
			if (dx * dx + dy * dy <= catchRadius * catchRadius) {
				return candidate;
			}
		}
		return null;
	}

	private resolveNoteDropTarget(
		clientX: number,
		clientY: number,
		worldX: number,
		worldY: number,
		dragged: BubbleNode
	): { target: DropTargetInfo | null; bubble: BubbleNode | null } {
		// 1. Проверка попадания на плашку "Вне тем (Outside)"
		if (this.isPointInsideElement(this.outsideZoneEl, clientX, clientY, 12)) {
			return {
				target: { kind: "outside", topicPath: "", label: "Вне тем (Outside)" },
				bubble: null
			};
		}

		// 2. Проверка попадания на конкретную хлебную крошку в верхнем острове
		if (this.topIslandEl && this.isPointInsideElement(this.topIslandEl, clientX, clientY, 8)) {
			const crumbs = Array.from(this.topIslandEl.querySelectorAll<HTMLElement>("[data-drop-topic]"));
			for (const crumb of crumbs) {
				if (this.isPointInsideElement(crumb, clientX, clientY, 4)) {
					const tp = crumb.dataset.dropTopic ?? "";
					const lbl = crumb.dataset.dropLabel ?? (tp || "Вне тем");
					return {
						target: { kind: "crumb", topicPath: tp, label: lbl },
						bubble: null
					};
				}
			}
		}

		// 3. Проверка попадания на пузырь темы или папки на холсте
		const bubble = this.findBubbleDropTarget(worldX, worldY, dragged);
		if (bubble) {
			return {
				target: {
					kind: "bubble",
					topicPath: bubble.targetValue,
					label: bubble.label
				},
				bubble
			};
		}

		return { target: null, bubble: null };
	}

public setResourcePathResolver(resolver: (vaultPath: string) => string): void {
		this.resolveResourcePath = resolver;
	}

	public resetCamera(): void {
		this.targetCamX = 0;
		this.targetCamY = 0;
		this.targetCamZoom = 1;
	}

	public setData(
		notes: Note3D[],
		virtualTopics: VirtualTopicEntry[],
		level: NavLevel,
		savedPositions: Record<string, { x: number; y: number }>,
		links: BubbleLink[],
		clusterNames: Record<string, string>,
		noteStyles: Record<string, NoteStyle> = {}
	): void {
this.savedPositions = savedPositions;
		this.links = links;
		this.clusterNames = clusterNames;
		this.noteStyles = noteStyles;
		this.bubbleTextCache.clear();
		this.cardLayoutCache.clear();
		const nextNodes: BubbleNode[] = [];

		if (level.program === null) {
			// --- УРОВЕНЬ 0: ПРОГРАММЫ ---
			const progMap = new Map<string, Note3D[]>();
			const noProg: Note3D[] = [];

			for (const n of notes) {
				if (!n.programs.length) {
					noProg.push(n);
				} else {
					for (const p of n.programs) {
						const arr = progMap.get(p) || [];
						arr.push(n);
						progMap.set(p, arr);
					}
				}
			}

			for (const vt of virtualTopics) {
				if (vt.program && !progMap.has(vt.program)) {
					progMap.set(vt.program, []);
				}
			}

			const entries = Array.from(progMap.entries()).sort(
				(a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ru")
			);

			entries.forEach(([prog, pNotes], idx) => {
				const id = `prog::${prog}`;
				const radius = this.calcBubbleRadius(pNotes.length, 48, 78);
				const pos = this.getInitialPos(id, idx, entries.length + (noProg.length ? 1 : 0), 175);

				// Топ-2 темы внутри программы для информативности
				const tCount = new Map<string, number>();
				for (const n of pNotes) {
					for (const t of n.topics) tCount.set(t, (tCount.get(t) || 0) + 1);
				}
				const topTopics = Array.from(tCount.entries())
					.sort((a, b) => b[1] - a[1])
					.slice(0, 2)
					.map((x) => x[0]);

nextNodes.push(this.createNode({
					id,
					kind: "program",
					label: prog,
					subLabel: `${pNotes.length} зам.`,
					detailLine: topTopics.join(" · "),
					count: pNotes.length,
					color: getProgramColor(prog),
					radius,
					x: pos.x,
					y: pos.y,
					phase: idx * 1.37,
					targetValue: prog
				}));
			});

			if (noProg.length > 0) {
				const id = "prog::__none__";
				const idx = entries.length;
				const radius = this.calcBubbleRadius(noProg.length, 44, 68);
				const pos = this.getInitialPos(id, idx, entries.length + 1, 185);
				nextNodes.push(this.createNode({
					id,
					kind: "program",
					label: "Вне программ",
					subLabel: `${noProg.length} зам.`,
					detailLine: "без софта",
					count: noProg.length,
					color: "#7f849c",
					radius,
					x: pos.x,
					y: pos.y,
					phase: idx * 1.37,
					targetValue: "__none__"
				}));
			}
		} else if (!level.topicPath) {
			// --- УРОВЕНЬ 1: ТЕМЫ ВНУТРИ ПРОГРАММЫ ---
			const prog = level.program;
			const progColor = prog === "__none__" ? "#7f849c" : getProgramColor(prog);
			const progNotes = notes.filter((n) =>
				prog === "__none__" ? n.programs.length === 0 : n.programs.includes(prog)
			);

			const topicMap = new Map<string, Note3D[]>();
			const untaggedNotes: Note3D[] = [];

			for (const n of progNotes) {
				if (!n.topics.length) {
					untaggedNotes.push(n);
				} else {
					for (const t of n.topics) {
						const arr = topicMap.get(t) || [];
						arr.push(n);
						topicMap.set(t, arr);
					}
				}
			}

			for (const vt of virtualTopics) {
				if (vt.program === prog || vt.program === "") {
					const root = topicParts(vt.topicPath)[0];
					if (root && !topicMap.has(root)) {
						topicMap.set(root, []);
					}
				}
			}

			const topicEntries = Array.from(topicMap.entries()).sort(
				(a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ru")
			);

			topicEntries.forEach(([topicName, tNotes], idx) => {
				const id = `topic::${prog}::${topicName}`;
				const radius = this.calcBubbleRadius(tNotes.length, 46, 76);
				const pos = this.getInitialPos(id, idx, topicEntries.length, 165);

				const subFolders = new Set<string>();
				for (const n of tNotes) {
					for (const tp of n.topicPaths) {
						if (tp.startsWith(topicName + "/")) {
							const sub = topicParts(tp)[1];
							if (sub) subFolders.add(sub);
						}
					}
				}
				const subList = Array.from(subFolders).slice(0, 2);

nextNodes.push(this.createNode({
					id,
					kind: "topic",
					label: topicName,
					subLabel: `${tNotes.length} зам.`,
					detailLine: subList.length ? `📁 ${subList.join(", ")}` : "",
					count: tNotes.length,
					color: getTopicAccentColor(progColor, topicName),
					radius,
					x: pos.x,
					y: pos.y,
					phase: idx * 1.15,
					targetValue: topicName
				}));
			});

untaggedNotes.forEach((note, idx) => {
				const id = `note::${prog}::root::${note.path}`;
				const pos = this.getInitialPos(id, idx, untaggedNotes.length, 290);
				const customColor = this.noteStyles[note.path]?.color;
				nextNodes.push(this.createNode({
					id,
					kind: "note",
					label: note.title,
					subLabel: "без темы",
					detailLine: "",
					count: 1,
					color: customColor || "#d85b57",
					radius: 54,
					x: pos.x,
					y: pos.y,
					phase: idx * 0.9,
					targetValue: note.path,
					note
				}));
			});
		} else {
			// --- УРОВЕНЬ 2+: ПАПКИ И ЗАМЕТКИ ВНУТРИ ТЕМЫ ---
			const prog = level.program;
			const currentPrefix = level.topicPath;
			const prefixDepth = topicParts(currentPrefix).length;
			const progColor = prog === "__none__" ? "#7f849c" : getProgramColor(prog);

			const progNotes = notes.filter((n) =>
				prog === "__none__" ? n.programs.length === 0 : n.programs.includes(prog)
			);

			const subFolders = new Map<string, Set<Note3D>>();
			const directNotes = new Map<string, Note3D>();

			for (const n of progNotes) {
				for (const tp of n.topicPaths) {
					if (tp === currentPrefix) {
						directNotes.set(n.path, n);
					} else if (tp.startsWith(currentPrefix + "/")) {
						const parts = topicParts(tp);
						const childName = parts[prefixDepth];
						if (childName) {
							const set = subFolders.get(childName) || new Set<Note3D>();
							set.add(n);
							subFolders.set(childName, set);
						}
					}
				}
			}

			for (const vt of virtualTopics) {
				if (vt.program === prog || vt.program === "") {
					if (vt.topicPath.startsWith(currentPrefix + "/")) {
						const parts = topicParts(vt.topicPath);
						const childName = parts[prefixDepth];
						if (childName && !subFolders.has(childName)) {
							subFolders.set(childName, new Set<Note3D>());
						}
					}
				}
			}

			const folderEntries = Array.from(subFolders.entries()).sort(
				(a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0], "ru")
			);

			folderEntries.forEach(([folderName, fNotes], idx) => {
				const fullPath = `${currentPrefix}/${folderName}`;
				const id = `folder::${prog}::${fullPath}`;
				const radius = this.calcBubbleRadius(fNotes.size, 44, 70);
				const pos = this.getInitialPos(id, idx, folderEntries.length, 150);
nextNodes.push(this.createNode({
					id,
					kind: "folder",
					label: folderName,
					subLabel: `${fNotes.size} зам.`,
					detailLine: "папка",
					count: fNotes.size,
					color: getTopicAccentColor(progColor, fullPath),
					radius,
					x: pos.x,
					y: pos.y,
					phase: idx * 1.25,
					targetValue: fullPath
				}));
			});

const directList = Array.from(directNotes.values()).sort((a, b) => b.mtime - a.mtime);
			const noteRingRadius = folderEntries.length > 0 ? 275 : 175;

directList.forEach((note, idx) => {
				const id = `note::${prog}::${currentPrefix}::${note.path}`;
				const pos = this.getInitialPos(id, idx, directList.length, noteRingRadius);
				const customColor = this.noteStyles[note.path]?.color;
				nextNodes.push(this.createNode({
					id,
					kind: "note",
					label: note.title,
					subLabel: "",
					detailLine: "",
					count: 1,
					color: customColor || (note.pinned ? "#e5a158" : progColor),
					radius: 54,
					x: pos.x,
					y: pos.y,
					phase: idx * 0.85,
					targetValue: note.path,
					note
				}));
			});
		}

		const prevMap = new Map(this.nodes.map((n) => [n.id, n]));
		for (const node of nextNodes) {
			const existing = prevMap.get(node.id);
			if (existing) {
				node.x = existing.x;
				node.y = existing.y;
				node.vx = existing.vx;
				node.vy = existing.vy;
				node.radialOffsets = existing.radialOffsets;
				node.radialVels = existing.radialVels;
			}
		}

		this.nodes = nextNodes;
		this.resolveAllOverlaps();
		this.recomputeClusters();
		this.rebuildActionBadges();
	}

private createNode(
		base: Omit<BubbleNode, "vx" | "vy" | "anchorX" | "anchorY" | "radialOffsets" | "radialVels" | "overlapGlow">
	): BubbleNode {
		return {
			...base,
			vx: 0,
			vy: 0,
			anchorX: base.x,
			anchorY: base.y,
			radialOffsets: new Float32Array(JELLY_SEGMENTS),
			radialVels: new Float32Array(JELLY_SEGMENTS),
			overlapGlow: 0
		};
	}

	private calcBubbleRadius(count: number, minR: number, maxR: number): number {
		if (count <= 0) return minR;
		const scaled = minR + Math.sqrt(count) * 7.2;
		return Math.min(maxR, Math.max(minR, scaled));
	}

private getInitialPos(id: string, index: number, total: number, ringRadius: number): { x: number; y: number } {
		const saved = this.savedPositions[id];
		if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
			return { x: saved.x, y: saved.y };
		}
		if (total <= 1) return { x: 0, y: 0 };

		if (total > 7) {
			const innerCount = Math.min(6, Math.floor(total / 2));
			if (index < innerCount) {
				const angle = (index / innerCount) * Math.PI * 2 - Math.PI / 2;
				const r = Math.max(ringRadius, 175);
				return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
			}
			const outerIdx = index - innerCount;
			const outerCount = total - innerCount;
			const angle = (outerIdx / outerCount) * Math.PI * 2 - Math.PI / 2 + Math.PI / outerCount;
			const r = Math.max(ringRadius * 2.15, 340);
			return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
		}

		const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
		const r = Math.max(ringRadius, total * 28);
		return {
			x: Math.cos(angle) * r,
			y: Math.sin(angle) * r
		};
	}

	private getNodeBoundsHalf(node: BubbleNode): { hw: number; hh: number; isRect: boolean } {
		if (node.kind === "note") {
			let hh = this.noteHalfHeights.get(node.id);
			if (hh === undefined) {
				this.ctx.font = `500 13.5px ${this.uiFontFamily}`;
				const maxTextW = node.note?.hasImages ? 248 - 84 : 248 - 64;
				const lines = this.wrapLines(this.ctx, node.label, maxTextW);
				const h = Math.max(52, lines.length * 17 + 20);
				hh = h / 2;
				this.noteHalfHeights.set(node.id, hh);
			}
			return { hw: 124, hh, isRect: true };
		}
		return { hw: node.radius, hh: node.radius, isRect: false };
	}

	private computeSeparationVector(a: BubbleNode, b: BubbleNode, gap = 22): { dx: number; dy: number } | null {
		const ba = this.getNodeBoundsHalf(a);
		const bb = this.getNodeBoundsHalf(b);

		if (!ba.isRect && !bb.isRect) {
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const dist = Math.hypot(dx, dy);
			const minDist = a.radius + b.radius + gap;
			if (dist >= minDist) return null;
			const overlap = minDist - dist;
			if (dist < 0.001) return { dx: overlap, dy: 0 };
			return { dx: (dx / dist) * overlap, dy: (dy / dist) * overlap };
		}

		const ox = ba.hw + bb.hw + gap - Math.abs(b.x - a.x);
		const oy = ba.hh + bb.hh + gap - Math.abs(b.y - a.y);
		if (ox <= 0 || oy <= 0) return null;

		if (ox < oy) {
			const sign = b.x >= a.x ? 1 : -1;
			return { dx: sign * ox, dy: 0 };
		}
		const sign = b.y >= a.y ? 1 : -1;
		return { dx: 0, dy: sign * oy };
	}

	private resolveAllOverlaps(): void {
		const n = this.nodes.length;
		if (n < 2) return;

		for (let iter = 0; iter < 40; iter++) {
			let moved = false;
			for (let i = 0; i < n; i++) {
				const a = this.nodes[i]!;
				for (let j = i + 1; j < n; j++) {
					const b = this.nodes[j]!;
					const sep = this.computeSeparationVector(a, b, 22);
					if (!sep) continue;
					a.x -= sep.dx * 0.5;
					a.y -= sep.dy * 0.5;
					b.x += sep.dx * 0.5;
					b.y += sep.dy * 0.5;
					moved = true;
				}
			}
			if (!moved) break;
		}

		for (const node of this.nodes) {
			node.anchorX = node.x;
			node.anchorY = node.y;
		}
	}

	private snapNodeToSafeZone(target: BubbleNode): void {
		for (let iter = 0; iter < 24; iter++) {
			let moved = false;
			for (const other of this.nodes) {
				if (other === target) continue;
				const sep = this.computeSeparationVector(other, target, 22);
				if (!sep) continue;
				target.x += sep.dx;
				target.y += sep.dy;
				moved = true;
			}
			if (!moved) break;
		}
		target.anchorX = target.x;
		target.anchorY = target.y;
	}

	/**
	 * Вычисляет связные компоненты (кластеры) из сцепленных пузырей
	 */
	private recomputeClusters(): void {
		const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
		const adj = new Map<string, Set<string>>();

		for (const n of this.nodes) {
			adj.set(n.id, new Set<string>());
		}

		for (const link of this.links) {
			if (nodeMap.has(link.from) && nodeMap.has(link.to) && link.from !== link.to) {
				adj.get(link.from)!.add(link.to);
				adj.get(link.to)!.add(link.from);
			}
		}

const prevByKey = new Map(this.clusters.map((c) => [c.key, c]));
		const visited = new Set<string>();
		const nextClusters: ClusterGroup[] = [];
		let autoIdx = 1;

		for (const n of this.nodes) {
			if (visited.has(n.id)) continue;
			const neighbors = adj.get(n.id);
			if (!neighbors || neighbors.size === 0) continue;

			// BFS для поиска всех сцепленных пузырей
			const comp: BubbleNode[] = [];
			const queue: string[] = [n.id];
			visited.add(n.id);

			while (queue.length > 0) {
				const curId = queue.shift()!;
				const curNode = nodeMap.get(curId);
				if (curNode) comp.push(curNode);

				for (const nxt of adj.get(curId) || []) {
					if (!visited.has(nxt)) {
						visited.add(nxt);
						queue.push(nxt);
					}
				}
			}

			if (comp.length >= 2) {
				const sortedIds = comp.map((c) => c.id).sort();
				const key = sortedIds.join("|");
				const customTitle = this.clusterNames[key];
				const title = customTitle || `Блок ${autoIdx++}`;

const prev = prevByKey.get(key);
				nextClusters.push({
					key,
					title,
					nodes: comp,
					cx: prev?.cx ?? 0,
					cy: prev?.cy ?? 0,
					radii: prev?.radii ?? new Float32Array(CLUSTER_SEGMENTS),
					radialVels: prev?.radialVels ?? new Float32Array(CLUSTER_SEGMENTS),
					phase: prev?.phase ?? autoIdx * 1.17,
					headerX: prev?.headerX ?? 0,
					headerY: prev?.headerY ?? 0,
					headerW: prev?.headerW ?? 96,
					headerH: prev?.headerH ?? 24,
					color: comp[0]?.color || "#9c83e8"
				});
			}
		}

		this.clusters = nextClusters;
	}

	private rebuildActionBadges(): void {
		this.overlayLayer.empty();
		this.actionBadges.clear();

		for (const node of this.nodes) {
			if (node.kind === "note" && node.note && node.note.hasImages) {
				const noteRef = node.note;
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "hub3d-node-inspect-badge";
				btn.textContent = "☊";
				btn.title = "Открыть схему нод в инспекторе";
				btn.addEventListener("pointerdown", (e) => e.stopPropagation());
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					this.callbacks.onInspectNote(noteRef);
				});
				this.overlayLayer.appendChild(btn);
				this.actionBadges.set(node.id, btn);
			}
		}
	}

private handleResize(): void {
		const rect = this.host.getBoundingClientRect();
		this.width = Math.max(1, rect.width);
		this.height = Math.max(1, rect.height);
		this.dpr = Math.min(window.devicePixelRatio || 1, 2);

const cs = getComputedStyle(this.host);
		const computedFont = cs.fontFamily;
		if (computedFont && !computedFont.includes("var(") && computedFont !== this.uiFontFamily) {
			this.uiFontFamily = computedFont;
			this.bubbleTextCache.clear();
			this.cardLayoutCache.clear();
		}
		const pick = (v: string, fb: string) => cs.getPropertyValue(v).trim() || fb;
		this.themeColors = {
			surface: pick("--background-secondary", "#1f2128"),
			surfaceHover: pick("--background-modifier-hover", "#282b34"),
			surfaceAlt: pick("--background-primary", "#181a20"),
			border: pick("--background-modifier-border", "rgba(160, 166, 184, 0.22)"),
			borderStrong: pick("--background-modifier-border-hover", "rgba(160, 166, 184, 0.45)"),
			textNormal: pick("--text-normal", "#e6e8ef"),
			textMuted: pick("--text-muted", "#9aa0b2"),
			textFaint: pick("--text-faint", "#6c7285"),
			accent: pick("--interactive-accent", "#7c859e"),
			green: pick("--color-green", "#4aab80"),
			red: pick("--color-red", "#d85b57")
		};
		this.gridPattern = null;

		this.canvas.width = Math.round(this.width * this.dpr);
		this.canvas.height = Math.round(this.height * this.dpr);
	}

	private screenToWorld(sx: number, sy: number): { x: number; y: number } {
		return {
			x: (sx - this.width / 2) / this.camZoom + this.camX,
			y: (sy - this.height / 2) / this.camZoom + this.camY
		};
	}

	private worldToScreen(wx: number, wy: number): { x: number; y: number } {
		return {
			x: (wx - this.camX) * this.camZoom + this.width / 2,
			y: (wy - this.camY) * this.camZoom + this.height / 2
		};
	}

private hitTest(wx: number, wy: number): BubbleNode | null {
		for (let i = this.nodes.length - 1; i >= 0; i--) {
			const n = this.nodes[i];
			if (!n) continue;
			if (n.kind === "note") {
				const halfH = (this.noteHalfHeights.get(n.id) ?? 26) + 4;
				if (Math.abs(wx - n.x) <= 126 && Math.abs(wy - n.y) <= halfH) {
					return n;
				}
				continue;
			}
			const dx = wx - n.x;
			const dy = wy - n.y;
			if (dx * dx + dy * dy <= n.radius * n.radius) {
				return n;
			}
		}
		return null;
	}

private hitTestClusterHeader(wx: number, wy: number): ClusterGroup | null {
		for (let i = this.clusters.length - 1; i >= 0; i--) {
			const c = this.clusters[i];
			if (!c) continue;
			if (
				wx >= c.headerX &&
				wx <= c.headerX + c.headerW &&
				wy >= c.headerY &&
				wy <= c.headerY + c.headerH
			) {
				return c;
			}
		}
		return null;
	}

private getLinkPoints(a: BubbleNode, b: BubbleNode, _seed: number): Array<{ x: number; y: number }> {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const dist = Math.hypot(dx, dy) || 0.001;
		const tx = dx / dist;
		const ty = dy / dist;

		const startPad = a.kind === "note" ? 36 : a.radius;
		const endPad = b.kind === "note" ? 36 : b.radius;

		if (dist <= startPad + endPad + 8) {
			return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
		}
		return [
			{ x: a.x + tx * startPad, y: a.y + ty * startPad },
			{ x: b.x - tx * endPad, y: b.y - ty * endPad }
		];
	}

	private hitTestLink(wx: number, wy: number): number {
		const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
		for (let i = 0; i < this.links.length; i++) {
			const l = this.links[i];
			if (!l) continue;
			const a = nodeMap.get(l.from);
			const b = nodeMap.get(l.to);
			if (!a || !b) continue;

			const pts = this.getLinkPoints(a, b, i + 1);
			for (let p = 0; p < pts.length - 1; p++) {
				const p0 = pts[p]!;
				const p1 = pts[p + 1]!;
				if (this.pointToSegmentDist(wx, wy, p0.x, p0.y, p1.x, p1.y) <= 10) {
					return i;
				}
			}
		}
		return -1;
	}

	private pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
		const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
		if (l2 === 0) return Math.hypot(px - x1, py - y1);
		let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
		t = Math.max(0, Math.min(1, t));
		return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
	}

	private bindEvents(): void {
		// Блокируем контекстное меню при сцеплении правой кнопкой мыши
		this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

		this.canvas.addEventListener("pointerdown", (e: PointerEvent) => {
			this.canvas.setPointerCapture(e.pointerId);
			const rect = this.canvas.getBoundingClientRect();
			const sx = e.clientX - rect.left;
			const sy = e.clientY - rect.top;
			this.pointers.set(e.pointerId, { x: sx, y: sy });

			if (this.pointers.size === 2) {
				const pts = Array.from(this.pointers.values());
				const p0 = pts[0];
				const p1 = pts[1];
				if (p0 && p1) {
					this.lastPinchDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
				}
				this.dragMode = "none";
				this.draggedNode = null;
				return;
			}

			this.activePointerId = e.pointerId;
			this.pointerDownPos = { x: sx, y: sy };
			this.pointerDownTime = performance.now();

			const world = this.screenToWorld(sx, sy);
			const hit = this.hitTest(world.x, world.y);

			// 1. Сцепление пузырей через Shift+ЛКМ, ПКМ или активный режим связи (iPad)
			const isLinkGesture = e.button === 2 || e.shiftKey || this.linkModeActive;
			if (hit && isLinkGesture) {
				if (this.linkModeActive) {
					// Пошаговое сцепление тапами на iPad
					if (!this.pendingLinkFromId) {
						this.pendingLinkFromId = hit.id;
						return;
					} else if (this.pendingLinkFromId !== hit.id) {
						this.callbacks.onToggleLink(this.pendingLinkFromId, hit.id);
						this.pendingLinkFromId = null;
						return;
					}
				}
				this.dragMode = "link";
				this.linkSourceNode = hit;
				this.linkPointerWorld = { x: world.x, y: world.y };
				return;
			}

			if (e.button !== 0 && e.pointerType === "mouse") return;

			// 2. Проверка клика по заголовку смыслового блока (кластера)
			const hitCluster = this.hitTestClusterHeader(world.x, world.y);
			if (hitCluster) {
				this.dragMode = "cluster";
				this.draggedCluster = hitCluster;
				this.dragOffset = { x: world.x, y: world.y };
				return;
			}

			// 3. Проверка клика/перетаскивания пузыря
			if (hit) {
				this.dragMode = "bubble";
				this.draggedNode = hit;
				this.dragOffset = { x: world.x - hit.x, y: world.y - hit.y };
				return;
			}

			// 4. Клик по линии связи разрывает её
			const linkIdx = this.hitTestLink(world.x, world.y);
			if (linkIdx !== -1) {
				const l = this.links[linkIdx];
				if (l) {
					this.callbacks.onToggleLink(l.from, l.to);
					return;
				}
			}

			// 5. Панорамирование пустого холста
			this.dragMode = "pan";
			this.draggedNode = null;
		});

		this.canvas.addEventListener("pointermove", (e: PointerEvent) => {
			const rect = this.canvas.getBoundingClientRect();
			const sx = e.clientX - rect.left;
			const sy = e.clientY - rect.top;

			if (this.pointers.has(e.pointerId)) {
				const prev = this.pointers.get(e.pointerId)!;
				this.pointers.set(e.pointerId, { x: sx, y: sy });

				if (this.pointers.size === 2) {
					const pts = Array.from(this.pointers.values());
					const p0 = pts[0];
					const p1 = pts[1];
					if (p0 && p1) {
						const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
						if (this.lastPinchDist > 0 && dist > 0) {
							const factor = dist / this.lastPinchDist;
							this.targetCamZoom = Math.min(2.6, Math.max(0.4, this.targetCamZoom * factor));
						}
						this.lastPinchDist = dist;
					}
					return;
				}

				if (e.pointerId === this.activePointerId) {
					const world = this.screenToWorld(sx, sy);

					if (this.dragMode === "pan") {
						const dx = (sx - prev.x) / this.camZoom;
						const dy = (sy - prev.y) / this.camZoom;
						this.camX -= dx;
						this.camY -= dy;
						this.targetCamX = this.camX;
						this.targetCamY = this.camY;
					} else if (this.dragMode === "bubble" && this.draggedNode) {
						const world = this.screenToWorld(sx, sy);
						this.draggedNode.x = world.x - this.dragOffset.x;
						this.draggedNode.y = world.y - this.dragOffset.y;
						this.draggedNode.anchorX = this.draggedNode.x;
						this.draggedNode.anchorY = this.draggedNode.y;
						this.draggedNode.vx = 0;
						this.draggedNode.vy = 0;

const canTrash =
							this.draggedNode.kind === "topic" ||
							this.draggedNode.kind === "folder" ||
							this.draggedNode.kind === "note";
						const overTrash = canTrash && this.isPointInsideElement(this.trashZoneEl, e.clientX, e.clientY, 12);
						this.isOverTrash = overTrash;

						if (!overTrash && this.draggedNode.kind === "note") {
							const resolved = this.resolveNoteDropTarget(
								e.clientX,
								e.clientY,
								world.x,
								world.y,
								this.draggedNode
							);
							this.activeDropTarget = resolved.target;
							this.dropHoverBubble = resolved.bubble;
						} else {
							this.activeDropTarget = null;
							this.dropHoverBubble = null;
						}

						this.callbacks.onDragStateChange(
							canTrash ? this.draggedNode : null,
							overTrash,
							this.activeDropTarget
						);
					} else if (this.dragMode === "cluster" && this.draggedCluster) {
						const dx = world.x - this.dragOffset.x;
						const dy = world.y - this.dragOffset.y;
						this.dragOffset = { x: world.x, y: world.y };
						for (const member of this.draggedCluster.nodes) {
							member.x += dx;
							member.y += dy;
							member.anchorX += dx;
							member.anchorY += dy;
							member.vx = 0;
							member.vy = 0;
						}
					} else if (this.dragMode === "link") {
						this.linkPointerWorld = { x: world.x, y: world.y };
					}
				}
			}

			if (e.pointerType !== "touch") {
				const world = this.screenToWorld(sx, sy);
				this.hoveredNode = this.hitTest(world.x, world.y);
				this.hoveredLinkIndex = this.hoveredNode ? -1 : this.hitTestLink(world.x, world.y);
				const hitHeader = this.hitTestClusterHeader(world.x, world.y);

				if (this.dragMode === "link") {
					this.canvas.style.cursor = "crosshair";
				} else if (this.dragMode !== "none") {
					this.canvas.style.cursor = "grabbing";
				} else if (this.hoveredNode || hitHeader || this.hoveredLinkIndex !== -1) {
					this.canvas.style.cursor = "pointer";
				} else {
					this.canvas.style.cursor = "grab";
				}
			}
		});

		const endPointer = (e: PointerEvent) => {
			this.pointers.delete(e.pointerId);
			if (this.pointers.size < 2) this.lastPinchDist = 0;

			if (e.pointerId !== this.activePointerId) return;

			const rect = this.canvas.getBoundingClientRect();
			const sx = e.clientX - rect.left;
			const sy = e.clientY - rect.top;
			const movedDist = Math.hypot(sx - this.pointerDownPos.x, sy - this.pointerDownPos.y);
			const elapsed = performance.now() - this.pointerDownTime;
			const world = this.screenToWorld(sx, sy);

if (this.dragMode === "link" && this.linkSourceNode) {
				if (
					movedDist < 7 &&
					elapsed < 450 &&
					e.button === 2 &&
					this.linkSourceNode.kind === "note" &&
					this.linkSourceNode.note
				) {
					this.callbacks.onStyleNote(this.linkSourceNode.note, e.clientX, e.clientY);
				} else {
					const targetNode = this.hitTest(world.x, world.y);
					if (targetNode && targetNode.id !== this.linkSourceNode.id) {
						this.callbacks.onToggleLink(this.linkSourceNode.id, targetNode.id);
					}
				}
			} else if (this.dragMode === "cluster" && this.draggedCluster) {
				if (movedDist < 7 && elapsed < 450) {
					this.callbacks.onRenameCluster(this.draggedCluster.key, this.draggedCluster.title);
				} else if (movedDist >= 7) {
					for (const member of this.draggedCluster.nodes) {
						this.callbacks.onSavePosition(member.id, Math.round(member.anchorX), Math.round(member.anchorY));
					}
				}
} else if (this.dragMode === "bubble" && this.draggedNode) {
				const droppedNode = this.draggedNode;
				const wasOverTrash = this.isOverTrash;
				const dropTarget = this.activeDropTarget;

				this.isOverTrash = false;
				this.activeDropTarget = null;
				this.dropHoverBubble = null;
				this.callbacks.onDragStateChange(null, false, null);

				if (wasOverTrash && movedDist >= 7) {
					this.callbacks.onDropToTrash(droppedNode);
				} else if (dropTarget && droppedNode.kind === "note" && droppedNode.note && movedDist >= 7) {
					this.callbacks.onMoveNoteToTopic(droppedNode.note, dropTarget.topicPath);
				} else if (movedDist < 7 && elapsed < 450) {
					if (droppedNode.kind === "program") {
						this.callbacks.onNavigate({ program: droppedNode.targetValue, topicPath: "" });
					} else if (droppedNode.kind === "topic" || droppedNode.kind === "folder") {
						this.callbacks.onNavigate({ program: null, topicPath: droppedNode.targetValue });
					} else if (droppedNode.kind === "note" && droppedNode.note) {
						this.callbacks.onOpenNote(droppedNode.note, e.ctrlKey || e.metaKey);
					}
				} else if (movedDist >= 7) {
					this.snapNodeToSafeZone(droppedNode);
					this.callbacks.onSavePosition(
						droppedNode.id,
						Math.round(droppedNode.anchorX),
						Math.round(droppedNode.anchorY)
					);
				}
			}

			this.activePointerId = null;
			this.dragMode = "none";
			this.draggedNode = null;
			this.draggedCluster = null;
			this.linkSourceNode = null;
		};

		this.canvas.addEventListener("pointerup", endPointer);
		this.canvas.addEventListener("pointercancel", endPointer);

		this.canvas.addEventListener(
			"wheel",
			(e: WheelEvent) => {
				e.preventDefault();
				const rect = this.canvas.getBoundingClientRect();
				const sx = e.clientX - rect.left;
				const sy = e.clientY - rect.top;
				const before = this.screenToWorld(sx, sy);

				const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
				const nextZoom = Math.min(2.6, Math.max(0.4, this.targetCamZoom * zoomFactor));
				this.targetCamZoom = nextZoom;
				this.camZoom = nextZoom;

				const after = this.screenToWorld(sx, sy);
				this.camX += before.x - after.x;
				this.camY += before.y - after.y;
				this.targetCamX = this.camX;
				this.targetCamY = this.camY;
			},
			{ passive: false }
		);
	}

private startLoop(): void {
		this.lastTime = performance.now();
		const tick = (now: number) => {
			this.rafId = requestAnimationFrame(tick);
			if (this.paused || document.hidden || !document.hasFocus() || this.host.offsetParent === null) {
				this.lastTime = now;
				return;
			}

			const isActive =
				this.dragMode !== "none" ||
				this.hoveredNode !== null ||
				Math.abs(this.targetCamZoom - this.camZoom) > 0.002 ||
				Math.abs(this.targetCamX - this.camX) > 0.2 ||
				Math.abs(this.targetCamY - this.camY) > 0.2;

			if (!isActive && now - this.lastRenderTime < 32) {
				return;
			}

			const dt = Math.min(0.033, Math.max(0.001, (now - this.lastTime) / 1000));
			this.lastTime = now;
			this.lastRenderTime = now;
			this.stepPhysics(now / 1000, dt);
			this.render();
		};
		this.rafId = requestAnimationFrame(tick);
	}

private stepPhysics(timeSec: number, dt: number): void {
		this.animTimeSec = timeSec;
		const camLerp = 1 - Math.pow(0.001, dt);
		this.camX += (this.targetCamX - this.camX) * camLerp;
		this.camY += (this.targetCamY - this.camY) * camLerp;
		this.camZoom += (this.targetCamZoom - this.camZoom) * camLerp;
	}

	private render(): void {
		const ctx = this.ctx;
		ctx.save();
		ctx.scale(this.dpr, this.dpr);
		ctx.clearRect(0, 0, this.width, this.height);

		this.drawGrid(ctx);

		ctx.translate(this.width / 2, this.height / 2);
		ctx.scale(this.camZoom, this.camZoom);
		ctx.translate(-this.camX, -this.camY);

		// 1. Отрисовка смысловых блоков (облаков вокруг сцепленных пузырей)
		for (const cluster of this.clusters) {
			this.drawClusterBox(ctx, cluster);
		}

		// 2. Отрисовка линий связей между пузырями
		this.drawLinks(ctx);

		// 3. Отрисовка пузырей и карточек заметок
		for (const node of this.nodes) {
			if (node.kind === "note") {
				this.drawNoteCard(ctx, node);
			} else {
				this.drawBubble(ctx, node);
			}
		}

		ctx.restore();
		this.syncOverlayBadges();
	}

private drawGrid(ctx: CanvasRenderingContext2D): void {
		const step = 44 * this.camZoom;
		if (step < 12) return;

		const tileStep = Math.max(12, Math.round(step));
		if (!this.gridPattern || Math.abs(tileStep - this.gridPatternStep) >= 1) {
			const tile = document.createElement("canvas");
			tile.width = tileStep;
			tile.height = tileStep;
			const tCtx = tile.getContext("2d");
			if (tCtx) {
				tCtx.fillStyle = "rgba(155, 160, 180, 0.14)";
				tCtx.beginPath();
				tCtx.arc(1.5, 1.5, 1.2, 0, Math.PI * 2);
				tCtx.fill();
				this.gridPattern = ctx.createPattern(tile, "repeat");
				this.gridPatternStep = tileStep;
			}
		}

		if (!this.gridPattern) return;
		const offsetX = ((-this.camX * this.camZoom + this.width / 2) % tileStep + tileStep) % tileStep;
		const offsetY = ((-this.camY * this.camZoom + this.height / 2) % tileStep + tileStep) % tileStep;

		ctx.save();
		ctx.translate(offsetX - 1.5, offsetY - 1.5);
		ctx.fillStyle = this.gridPattern;
		ctx.fillRect(-tileStep, -tileStep, this.width + tileStep * 2, this.height + tileStep * 2);
		ctx.restore();
	}

private drawClusterBox(ctx: CanvasRenderingContext2D, cluster: ClusterGroup): void {
		if (cluster.nodes.length === 0) return;

		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const m of cluster.nodes) {
			const rx = m.kind === "note" ? 132 : m.radius + 12;
			const ry = m.kind === "note" ? (this.noteHalfHeights.get(m.id) ?? 28) + 12 : m.radius + 12;
			if (m.x - rx < minX) minX = m.x - rx;
			if (m.y - ry < minY) minY = m.y - ry;
			if (m.x + rx > maxX) maxX = m.x + rx;
			if (m.y + ry > maxY) maxY = m.y + ry;
		}

		const pad = 22;
		const bx = minX - pad;
		const by = minY - pad - 6;
		const bw = maxX - minX + pad * 2;
		const bh = maxY - minY + pad * 2 + 6;
		const cx = bx + bw / 2;

		ctx.save();
		ctx.beginPath();
		ctx.roundRect(bx, by, bw, bh, 18);
		ctx.globalAlpha = 0.45;
		ctx.fillStyle = this.themeColors.surface;
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.lineWidth = 1;
		ctx.strokeStyle = this.themeColors.border;
		ctx.stroke();

		ctx.font = `600 12px ${this.uiFontFamily}`;
		const labelW = Math.max(76, ctx.measureText(cluster.title).width + 24);
		const labelH = 24;
		const hx = cx - labelW / 2;
		const hy = by - labelH / 2;

		cluster.headerX = hx;
		cluster.headerY = hy;
		cluster.headerW = labelW;
		cluster.headerH = labelH;

		ctx.beginPath();
		ctx.roundRect(hx, hy, labelW, labelH, 12);
		ctx.fillStyle = this.themeColors.surface;
		ctx.fill();
		ctx.lineWidth = 1;
		ctx.strokeStyle = this.themeColors.borderStrong;
		ctx.stroke();

		ctx.fillStyle = this.themeColors.textNormal;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(cluster.title, cx, hy + labelH / 2);
		ctx.restore();
	}

private drawLinks(ctx: CanvasRenderingContext2D): void {
		const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));

		for (let i = 0; i < this.links.length; i++) {
			const l = this.links[i];
			if (!l) continue;
			const a = nodeMap.get(l.from);
			const b = nodeMap.get(l.to);
			if (!a || !b) continue;

			const pts = this.getLinkPoints(a, b, i + 1);
			if (pts.length < 2) continue;

			const isHovered = i === this.hoveredLinkIndex;
			const first = pts[0]!;
			const last = pts[pts.length - 1]!;

			ctx.save();
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(first.x, first.y);
			ctx.lineTo(last.x, last.y);

			if (isHovered) {
				ctx.lineWidth = 2.5;
				ctx.strokeStyle = this.themeColors.red;
			} else {
				ctx.lineWidth = 1.4;
				ctx.strokeStyle = this.themeColors.borderStrong;
			}
			ctx.stroke();
			ctx.restore();
		}

		if (this.dragMode === "link" && this.linkSourceNode) {
			ctx.save();
			ctx.beginPath();
			ctx.moveTo(this.linkSourceNode.x, this.linkSourceNode.y);
			ctx.lineTo(this.linkPointerWorld.x, this.linkPointerWorld.y);
			ctx.setLineDash([5, 5]);
			ctx.lineWidth = 1.6;
			ctx.strokeStyle = this.themeColors.accent;
			ctx.stroke();
			ctx.restore();
		}
	}

private applyJellyDent(deform: Float32Array | undefined, contactAngle: number, strength: number): void {
		if (!deform || strength <= 0.05) return;
		for (let k = 0; k < JELLY_SEGMENTS; k++) {
			const theta = (k / JELLY_SEGMENTS) * Math.PI * 2;
			let diff = theta - contactAngle;
			while (diff > Math.PI) diff -= Math.PI * 2;
			while (diff < -Math.PI) diff += Math.PI * 2;

			// Косинус удвоенного угла даёт вмятину в точке контакта (diff=0)
			// и естественное расширение пузыря по бокам (diff = ±PI/2) с сохранением объёма
			const cos1 = Math.cos(diff);
			const cos2 = Math.cos(diff * 2);
			if (cos1 > -0.25) {
				deform[k] = (deform[k] ?? 0) - cos2 * strength * Math.max(0.2, cos1 + 0.35);
			}
		}
	}

	private traceJellyPath(ctx: CanvasRenderingContext2D, node: BubbleNode, scale: number): void {
		const ptsX = new Float32Array(JELLY_SEGMENTS);
		const ptsY = new Float32Array(JELLY_SEGMENTS);

		for (let k = 0; k < JELLY_SEGMENTS; k++) {
			const theta = (k / JELLY_SEGMENTS) * Math.PI * 2;
			const r = Math.max(18, (node.radius + (node.radialOffsets[k] ?? 0)) * scale);
			ptsX[k] = node.x + Math.cos(theta) * r;
			ptsY[k] = node.y + Math.sin(theta) * r;
		}

		ctx.beginPath();
		const lastX = ptsX[JELLY_SEGMENTS - 1]!;
		const lastY = ptsY[JELLY_SEGMENTS - 1]!;
		const firstX = ptsX[0]!;
		const firstY = ptsY[0]!;
		ctx.moveTo((lastX + firstX) * 0.5, (lastY + firstY) * 0.5);

		for (let k = 0; k < JELLY_SEGMENTS; k++) {
			const nextIdx = (k + 1) % JELLY_SEGMENTS;
			const cx = ptsX[k]!;
			const cy = ptsY[k]!;
			const nx = ptsX[nextIdx]!;
			const ny = ptsY[nextIdx]!;
			ctx.quadraticCurveTo(cx, cy, (cx + nx) * 0.5, (cy + ny) * 0.5);
		}
		ctx.closePath();
	}

private drawBubble(ctx: CanvasRenderingContext2D, node: BubbleNode): void {
		const isPendingSource = this.pendingLinkFromId === node.id;
		const isDropCatch = this.dropHoverBubble === node;
		const isHover = this.hoveredNode === node || this.draggedNode === node || isPendingSource || isDropCatch;
		const r = node.radius;

		ctx.save();
		if (isHover || isDropCatch) {
			ctx.beginPath();
			ctx.arc(node.x, node.y, r + 3.5, 0, Math.PI * 2);
			ctx.strokeStyle = isDropCatch ? this.themeColors.green : this.themeColors.borderStrong;
			ctx.globalAlpha = 0.25;
			ctx.lineWidth = 3;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		ctx.beginPath();
		ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
		ctx.fillStyle = isHover ? this.themeColors.surfaceHover : this.themeColors.surface;
		ctx.fill();

		ctx.lineWidth = isDropCatch ? 2 : isPendingSource ? 2 : isHover ? 1.4 : 1;
		ctx.strokeStyle = isDropCatch
			? this.themeColors.green
			: isPendingSource
			? this.themeColors.accent
			: isHover
			? this.themeColors.textMuted
			: this.themeColors.border;
		ctx.stroke();
		ctx.restore();

		if (isDropCatch) {
			ctx.save();
			const pillText = "Переместить сюда";
			ctx.font = `600 11px ${this.uiFontFamily}`;
			const pw = ctx.measureText(pillText).width + 16;
			const py = node.y - r - 18;
			ctx.beginPath();
			ctx.roundRect(node.x - pw / 2, py - 10, pw, 20, 10);
			ctx.fillStyle = this.themeColors.green;
			ctx.fill();
			ctx.fillStyle = "#141619";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(pillText, node.x, py);
			ctx.restore();
		}

		const hasGlyph = this.drawBubbleGlyph(ctx, node, r, isHover);

		let layout = this.bubbleTextCache.get(node.id);
		if (!layout) {
			const maxTextW = node.radius * 1.62;
			let fontSize = node.kind === "program"
				? Math.max(15, Math.min(20, Math.round(node.radius * 0.29)))
				: Math.max(13.5, Math.min(18, Math.round(node.radius * 0.27)));

			const words = node.label.split(/\s+/).filter(Boolean);
			while (fontSize > 9.5) {
				ctx.font = `600 ${fontSize}px ${this.uiFontFamily}`;
				const widestWord = words.reduce((max, w) => Math.max(max, ctx.measureText(w).width), 0);
				if (widestWord <= maxTextW) break;
				fontSize -= 0.5;
			}
			ctx.font = `600 ${fontSize}px ${this.uiFontFamily}`;
			const rawLines = this.wrapLines(ctx, node.label, maxTextW);
			const visible = rawLines.slice(0, 3);
			if (rawLines.length > 3 && visible[2]) {
				visible[2] = this.clipText(ctx, visible[2], maxTextW);
			}
			layout = { fontSize, lines: visible, lineHeight: fontSize + 4 };
			this.bubbleTextCache.set(node.id, layout);
		}

		const textCenterY = hasGlyph ? node.y + Math.round(r * 0.1) : node.y - (node.subLabel ? 5 : 0);
		const startY = textCenterY - ((layout.lines.length - 1) * layout.lineHeight) / 2;

		ctx.save();
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.font = `600 ${layout.fontSize}px ${this.uiFontFamily}`;
		ctx.fillStyle = this.themeColors.textNormal;
		for (let i = 0; i < layout.lines.length; i++) {
			ctx.fillText(layout.lines[i]!, node.x, startY + i * layout.lineHeight);
		}

		if (node.subLabel && layout.lines.length <= 2) {
			ctx.font = `500 11px ${this.uiFontFamily}`;
			ctx.fillStyle = this.themeColors.textMuted;
			ctx.fillText(node.subLabel, node.x, startY + layout.lines.length * layout.lineHeight + 3);
		}
		ctx.restore();
	}

	private drawBubbleGlyph(
		ctx: CanvasRenderingContext2D,
		node: BubbleNode,
		r: number,
		isHover: boolean
	): boolean {
		if (node.kind === "program" || node.kind === "note") return false;

		const key = node.label.toLowerCase();
		const gx = node.x;
		const gy = node.y - Math.max(15, Math.round(r * 0.34));

		ctx.save();
		ctx.translate(gx, gy);
		ctx.strokeStyle = isHover ? this.themeColors.textNormal : this.themeColors.textMuted;
		ctx.fillStyle = isHover ? this.themeColors.textNormal : this.themeColors.textMuted;
		ctx.lineWidth = 1.55;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		if (node.kind === "folder") {
			ctx.beginPath();
			ctx.moveTo(-6.5, -4.5);
			ctx.lineTo(-1.5, -4.5);
			ctx.lineTo(0.5, -2.5);
			ctx.lineTo(6.5, -2.5);
			ctx.lineTo(6.5, 4.5);
			ctx.lineTo(-6.5, 4.5);
			ctx.closePath();
			ctx.stroke();
			ctx.restore();
			return true;
		}

		if (key.includes("нод") || key.includes("node")) {
			// Связанные ноды
			ctx.beginPath();
			ctx.moveTo(-4, -3);
			ctx.lineTo(4, 0);
			ctx.lineTo(-3, 4);
			ctx.stroke();
			for (const [cx, cy] of [[-5, -3], [4.5, 0], [-3.5, 4]] as const) {
				ctx.beginPath();
				ctx.arc(cx, cy, 2, 0, Math.PI * 2);
				ctx.fill();
			}
		} else if (key.includes("модел") || key.includes("скульпт") || key.includes("меш") || key.includes("ретопол")) {
			// Куб / грань
			ctx.beginPath();
			ctx.moveTo(0, -6.5);
			ctx.lineTo(5.8, -3.2);
			ctx.lineTo(5.8, 3.2);
			ctx.lineTo(0, 6.5);
			ctx.lineTo(-5.8, 3.2);
			ctx.lineTo(-5.8, -3.2);
			ctx.closePath();
			ctx.moveTo(-5.8, -3.2);
			ctx.lineTo(0, 0);
			ctx.lineTo(5.8, -3.2);
			ctx.moveTo(0, 0);
			ctx.lineTo(0, 6.5);
			ctx.stroke();
		} else if (key.includes("uv") || key.includes("развёрт") || key.includes("разверт")) {
			// Сетка 2x2
			ctx.strokeRect(-5.5, -5.5, 11, 11);
			ctx.beginPath();
			ctx.moveTo(0, -5.5);
			ctx.lineTo(0, 5.5);
			ctx.moveTo(-5.5, 0);
			ctx.lineTo(5.5, 0);
			ctx.stroke();
		} else if (key.includes("текстур") || key.includes("шейдер") || key.includes("материал") || key.includes("стекл")) {
			// Две пересекающиеся сферы
			ctx.beginPath();
			ctx.arc(-2.5, 0, 4.3, 0, Math.PI * 2);
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(2.5, 0, 4.3, 0, Math.PI * 2);
			ctx.stroke();
		} else if (
			key.includes("окруж") ||
			key.includes("ландшафт") ||
			key.includes("атмосфер") ||
			key.includes("луж") ||
			key.includes("вод") ||
			key.includes("дерев")
		) {
			// Горизонт и волна/гора
			ctx.beginPath();
			ctx.moveTo(-6.5, 3.5);
			ctx.lineTo(-2, -3.5);
			ctx.lineTo(2, 1.5);
			ctx.lineTo(4, -1.5);
			ctx.lineTo(6.5, 3.5);
			ctx.stroke();
		} else if (key.includes("свет") || key.includes("рендер") || key.includes("hdri") || key.includes("голограм")) {
			// Свечение / лучи
			ctx.beginPath();
			ctx.arc(0, 0, 2.8, 0, Math.PI * 2);
			ctx.stroke();
			for (let a = 0; a < 4; a++) {
				const ang = (a * Math.PI) / 2;
				ctx.beginPath();
				ctx.moveTo(Math.cos(ang) * 4.8, Math.sin(ang) * 4.8);
				ctx.lineTo(Math.cos(ang) * 6.8, Math.sin(ang) * 6.8);
				ctx.stroke();
			}
		} else if (key.includes("анимац")) {
			// Ромб ключевого кадра
			ctx.beginPath();
			ctx.moveTo(0, -5.5);
			ctx.lineTo(5.5, 0);
			ctx.lineTo(0, 5.5);
			ctx.lineTo(-5.5, 0);
			ctx.closePath();
			ctx.stroke();
		} else if (key.includes("декал") || key.includes("запек") || key.includes("пайплайн")) {
			// Слои
			ctx.beginPath();
			ctx.moveTo(-6, -1.5);
			ctx.lineTo(0, -5);
			ctx.lineTo(6, -1.5);
			ctx.lineTo(0, 2);
			ctx.closePath();
			ctx.moveTo(-6, 2);
			ctx.lineTo(0, 5.5);
			ctx.lineTo(6, 2);
			ctx.stroke();
		} else {
			// Минималистичная точка-маркер для прочих тем
			ctx.beginPath();
			ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
			ctx.stroke();
		}

		ctx.restore();
		return true;
	}

	private wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
		const words = text.split(/\s+/).filter(Boolean);
		const lines: string[] = [];
		let current = "";

		for (const word of words) {
			const test = current ? `${current} ${word}` : word;
			if (ctx.measureText(test).width <= maxWidth) {
				current = test;
			} else {
				if (current) {
					lines.push(current);
					current = "";
				}
				// Разбиваем слишком длинное слово, если оно шире карточки
				if (ctx.measureText(word).width > maxWidth) {
					let chunk = "";
					for (const ch of word) {
						if (ctx.measureText(chunk + ch).width <= maxWidth) {
							chunk += ch;
						} else {
							if (chunk) lines.push(chunk);
							chunk = ch;
						}
					}
					current = chunk;
				} else {
					current = word;
				}
			}
		}
		if (current) lines.push(current);
		return lines.length ? lines : [text];
	}

private getCachedIconImage(vaultPath: string): HTMLImageElement | null {
		const cached = this.iconImages.get(vaultPath);
		if (cached) return cached;
		if (!this.resolveResourcePath) return null;
		const img = new Image();
		img.src = this.resolveResourcePath(vaultPath);
		this.iconImages.set(vaultPath, img);
		return img;
	}

	private drawNoteCard(ctx: CanvasRenderingContext2D, node: BubbleNode): void {
		const isHover = this.hoveredNode === node || this.draggedNode === node;
		const style = node.note ? this.noteStyles[node.note.path] : undefined;
		const w = 248;
		const lineHeight = 17;
const maxTextW = node.note?.hasImages ? w - 84 : w - 64;

		ctx.save();
		ctx.font = `600 13.5px ${this.uiFontFamily}`;
		let cardLayout = this.cardLayoutCache.get(node.id);
		if (!cardLayout) {
			const lines = this.wrapLines(ctx, node.label, maxTextW);
			const h = Math.max(52, lines.length * lineHeight + 20);
			cardLayout = { lines, h };
			this.cardLayoutCache.set(node.id, cardLayout);
			this.noteHalfHeights.set(node.id, h / 2);
		}
		const { lines, h } = cardLayout;

		const x = node.x - w / 2;
		const y = node.y - h / 2;
		const rad = 14;

		if (isHover) {
			ctx.beginPath();
			ctx.roundRect(x - 3, y - 3, w + 6, h + 6, rad + 3);
			ctx.strokeStyle = this.themeColors.borderStrong;
			ctx.globalAlpha = 0.25;
			ctx.lineWidth = 3;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		ctx.beginPath();
		ctx.roundRect(x, y, w, h, rad);
		ctx.fillStyle = isHover ? this.themeColors.surfaceHover : this.themeColors.surface;
		ctx.fill();

		ctx.lineWidth = isHover ? 1.4 : 1;
		ctx.strokeStyle = isHover ? this.themeColors.textMuted : this.themeColors.border;
		ctx.stroke();

		// Скруглённый бейдж иконки слева (32x32)
		const iconSize = 32;
		const ix = x + 11;
		const iy = node.y - iconSize / 2;

		ctx.beginPath();
		ctx.roundRect(ix, iy, iconSize, iconSize, 8);
		ctx.fillStyle = this.themeColors.surfaceAlt;
		ctx.fill();
		ctx.lineWidth = 0.8;
		ctx.strokeStyle = this.themeColors.border;
		ctx.stroke();

		const iconImg = style?.iconImage ? this.getCachedIconImage(style.iconImage) : null;
		if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
			ctx.save();
			ctx.beginPath();
			ctx.roundRect(ix + 1, iy + 1, iconSize - 2, iconSize - 2, 7);
			ctx.clip();
			const iw = iconImg.naturalWidth;
			const ih = iconImg.naturalHeight;
			const side = Math.min(iw, ih);
			ctx.drawImage(iconImg, (iw - side) / 2, (ih - side) / 2, side, side, ix + 1, iy + 1, iconSize - 2, iconSize - 2);
			ctx.restore();
		} else if (style?.icon) {
			ctx.font = `16px ${this.uiFontFamily}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(style.icon, ix + iconSize / 2, node.y + 1);
		} else {
			ctx.beginPath();
			ctx.arc(ix + iconSize / 2, node.y, 3.5, 0, Math.PI * 2);
			ctx.fillStyle = style?.color || this.themeColors.textMuted;
			ctx.fill();
		}

		ctx.font = `500 13.5px ${this.uiFontFamily}`;
		ctx.fillStyle = this.themeColors.textNormal;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";

		const startY = node.y - ((lines.length - 1) * lineHeight) / 2;
		lines.forEach((line, idx) => {
			ctx.fillText(line, x + 52, startY + idx * lineHeight);
		});
		ctx.restore();
	}

private syncOverlayBadges(): void {
		const scaleStr = this.camZoom.toFixed(2);
		for (const node of this.nodes) {
			const badge = this.actionBadges.get(node.id);
			if (!badge) continue;
			const screen = this.worldToScreen(node.x + 104, node.y);
			const nextTransform = `translate3d(${Math.round(screen.x - 11)}px, ${Math.round(screen.y - 11)}px, 0) scale(${scaleStr})`;
			if (this.lastBadgeTransforms.get(node.id) !== nextTransform) {
				badge.style.transform = nextTransform;
				this.lastBadgeTransforms.set(node.id, nextTransform);
			}
		}
	}

	private drawWrappedText(
		ctx: CanvasRenderingContext2D,
		text: string,
		cx: number,
		cy: number,
		maxWidth: number,
		lineHeight: number,
		maxLines = 3
	): void {
		const lines = this.wrapLines(ctx, text, maxWidth);
		const visible = lines.slice(0, maxLines);
		const startY = cy - ((visible.length - 1) * lineHeight) / 2;
		visible.forEach((line, idx) => {
			const finalLine = idx === maxLines - 1 && lines.length > maxLines ? this.clipText(ctx, line, maxWidth) : line;
			ctx.fillText(finalLine, cx, startY + idx * lineHeight);
		});
	}

	private clipText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
		if (ctx.measureText(text).width <= maxWidth) return text;
		let clipped = text;
		while (clipped.length > 1 && ctx.measureText(clipped + "…").width > maxWidth) {
			clipped = clipped.slice(0, -1);
		}
		return clipped + "…";
	}

	private hexToRgba(hex: string, alpha: number): string {
		const clean = hex.replace("#", "");
		if (clean.length !== 6) return `rgba(156, 131, 232, ${alpha})`;
		const r = parseInt(clean.slice(0, 2), 16);
		const g = parseInt(clean.slice(2, 4), 16);
		const b = parseInt(clean.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
}