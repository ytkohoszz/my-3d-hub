import { App, TFile, setIcon } from "obsidian";
import { getProgramColor, getTopicAccentColor, mapTopic, topicParts } from "../types";
import {
	ROTATE_HANDLE_OFFSET_PX,
	computeSnapOffset,
	createSceneElement,
	finalizeElementSize,
	findNearestBindingTarget,
	getElementAABB,
	getElementAtPoint,
	getElementTypeForTool,
	getSelectionAABB,
	getSelectionFrameElements,
	getTransformHandles,
	hitTestHandles,
	isPathElement,
	isResizeHandle,
	normalizeElementBounds,
	resizeBoxFromHandle,
	resizeTextFromHandle,
	rotatePoint,
	updateBoundElements,
	updateElementFromDrag
} from "./geometry";
import { SceneHistory } from "./history";
import { InspectorPropertiesController } from "./propertiesPanel";
import { SceneStore, ScenesByKey, extractImagesFromNote } from "./sceneStore";
import {
	AABB,
	CanvasToolId,
	ElementStyleDefaults,
	HandleDescriptor,
	NodeImageItem,
	Scene,
	SceneElement,
	ScenePoint,
	SnapGuideLine,
	cloneSceneElement,
	createEmptyScene,
	generateElementId
} from "./sceneTypes";
import { renderSceneElement } from "./shapes";
import {
	CanvasTextEditor,
	TextAnchor,
	TextEditorCloseReason,
	TextEditorLayout,
	fitTextElementToContent,
	getAnchoredTextX,
	getContainerTextBox,
	getMeasureContext,
	getTextAnchor,
	getTextWrapWidth,
	measureTextBlock
} from "./text";

type Interaction =
	| { kind: "pan"; pointerId: number; lastX: number; lastY: number }
	| { kind: "create"; pointerId: number; startWorld: ScenePoint; elementId: string; didMove: boolean }
	| {
			kind: "move";
			pointerId: number;
			startWorld: ScenePoint;
			startElements: Map<string, SceneElement>;
			movingIds: Set<string>;
			didMove: boolean;
			started: boolean;
	  }
	| {
			kind: "resize";
			pointerId: number;
			startWorld: ScenePoint;
			startElements: Map<string, SceneElement>;
			startBounds: AABB;
			handle: HandleDescriptor;
	  }
	| {
			kind: "rotate";
			pointerId: number;
			startElements: Map<string, SceneElement>;
			center: ScenePoint;
			startAngle: number;
	  }
	| { kind: "point"; pointerId: number; elementId: string; pointIndex: number }
	| { kind: "marquee"; pointerId: number; startWorld: ScenePoint; additive: boolean; prevSel: Set<string> }
	| { kind: "erase"; pointerId: number; didErase: boolean };

function clamp(v: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, v));
}

function isTextContainer(el: SceneElement): boolean {
	return el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse";
}

export class NoteSchemaOverlay {
	protected app: App;
	protected parentEl: HTMLElement;
	protected file: TFile;
	protected win: Window & typeof globalThis;
	protected doc: Document;
	private onCloseCallback: () => void;

	protected rootEl!: HTMLElement;
	protected viewportEl!: HTMLElement;
	protected canvasEl!: HTMLCanvasElement;
	private ctx!: CanvasRenderingContext2D;
	private dockEl!: HTMLElement;
	private undoBtn!: HTMLButtonElement;
	private redoBtn!: HTMLButtonElement;
	private toolBtns = new Map<CanvasToolId, HTMLButtonElement>();

	protected images: NodeImageItem[] = [];
	protected activeIndex = 0;
	protected accentColor = "#9c83e8";
	private store: SceneStore;
	private scenes: ScenesByKey = new Map();
	private bgImages = new Map<string, HTMLImageElement>();

	protected scene!: Scene;
	protected selectedIds = new Set<string>();
	private history = new SceneHistory();
	private textEditor!: CanvasTextEditor;
	protected editingElementId: string | null = null;
	private textSession: { elementId: string; isNew: boolean; anchor: TextAnchor } | null = null;

	private activeTool: CanvasToolId = "hand";
	protected interaction: Interaction | null = null;
	private marqueeBox: AABB | null = null;
	private snapGuides: SnapGuideLine[] = [];
	private bindingHighlight: SceneElement | null = null;
	private eraserTrail: ScenePoint[] = [];

	private rafId: number | null = null;
	private floatRafId: number | null = null;
	private floatOffsetY = 0;
	private vpWidth = 1;
	private vpHeight = 1;
	private dpr = 1;
	private spacePressed = false;
	private keyHandler?: (e: KeyboardEvent) => void;
private keyUpHandler?: (e: KeyboardEvent) => void;
	private resizeObserver: ResizeObserver | null = null;
	private propsCtrl: InspectorPropertiesController | null = null;

	constructor(app: App, parentEl: HTMLElement, file: TFile, onClose: () => void) {
		this.app = app;
		this.parentEl = parentEl;
		this.file = file;
		this.onCloseCallback = onClose;
		this.doc = parentEl.ownerDocument;
		const win = this.doc.defaultView;
		if (!win) throw new Error("Нет окна для инспектора");
		this.win = win;
		this.accentColor = this.resolveAccentColor();
		this.images = extractImagesFromNote(app, file);
		this.store = new SceneStore(app, file, this.accentColor, win);
	}

	public open(): void {
		this.rootEl = this.parentEl.createDiv({ cls: "hub3d-insp-overlay" });
		this.rootEl.style.setProperty("--hub3d-accent", this.accentColor);

		this.renderTopIsland();

		this.viewportEl = this.rootEl.createDiv({ cls: "hub3d-insp-viewport" });
		if (this.images.length === 0) {
			this.rootEl.createDiv({ cls: "hub3d-insp-empty", text: "В этой заметке пока нет скриншотов" });
			return;
		}

		this.canvasEl = this.viewportEl.createEl("canvas", { cls: "hub3d-insp-canvas" });
		const context = this.canvasEl.getContext("2d");
		if (!context) throw new Error("Не удалось создать 2D контекст");
		this.ctx = context;

		this.textEditor = new CanvasTextEditor(this.viewportEl);
		this.scenes = this.store.loadScenes();

		this.renderBottomDock();
		this.initSubPanels();
		this.bindCanvasEvents();
		this.bindKeyboardEvents();

		this.resizeObserver = new ResizeObserver(() => this.handleResize());
		this.resizeObserver.observe(this.viewportEl);
		this.handleResize();

		void this.loadActiveSlide();
	}

protected initSubPanels(): void {
		this.propsCtrl = new InspectorPropertiesController({
			rootEl: this.rootEl,
			viewportEl: this.viewportEl,
			accentColor: this.accentColor,
			getScene: () => this.scene,
			getSelected: () => this.getSelectedElements(),
			isBusy: () => this.editingElementId !== null || this.interaction !== null,
			updateSelected: (mEl, mSt) => this.updateSelected(mEl, mSt),
			onOpacityInput: (val) => {
				if (!this.history.hasPendingTransaction()) {
					this.history.beginTransaction(this.scene.elements, this.selectedIds);
				}
				for (const el of this.getSelectedElements()) {
					el.opacity = val;
					el.updated = Date.now();
				}
				this.scene.appState.currentStyle.opacity = val;
				this.scheduleRender();
			},
			onOpacityCommit: () => this.commitScene(),
			onDuplicate: () => this.duplicateSelection(),
			onLayer: (dir) => this.changeLayerOrder(dir),
			onDelete: () => this.deleteSelection()
		});
	}

	protected onSelectionOrSceneUpdated(): void {
		this.updateHistoryButtons();
		this.propsCtrl?.refresh();
	}

	public destroy(): void {
		this.propsCtrl?.destroy();
		this.propsCtrl = null;
		if (this.keyHandler) this.win.removeEventListener("keydown", this.keyHandler);
		if (this.keyUpHandler) this.win.removeEventListener("keyup", this.keyUpHandler);
		if (this.rafId !== null) this.win.cancelAnimationFrame(this.rafId);
		if (this.floatRafId !== null) this.win.cancelAnimationFrame(this.floatRafId);
		this.resizeObserver?.disconnect();
		if (this.textEditor?.isOpen()) this.textEditor.close(true);
		void this.store.flushSave(this.scenes);
		this.rootEl?.remove();
	}

	public close(): void {
		this.destroy();
		this.onCloseCallback();
	}

	private resolveAccentColor(): string {
		const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
		const progs = Array.isArray(fm["программы"]) ? fm["программы"] : fm["программы"] ? [fm["программы"]] : [];
		const firstProg = typeof progs[0] === "string" ? progs[0].trim() : "";
		const baseColor = firstProg ? getProgramColor(firstProg) : "#9c83e8";
		const topics = Array.isArray(fm["темы"]) ? fm["темы"] : fm["темы"] ? [fm["темы"]] : [];
		const rawTopic = typeof topics[0] === "string" ? mapTopic(topics[0]) : "";
		const rootTopic = topicParts(rawTopic)[0] ?? "";
		return rootTopic ? getTopicAccentColor(baseColor, rootTopic) : baseColor;
	}

	private renderTopIsland(): void {
		const top = this.rootEl.createDiv({ cls: "hub3d-insp-top-island" });
		const backBtn = top.createEl("button", { cls: "hub3d-crumb-btn hub3d-back-btn", text: "← Назад" });
		backBtn.title = "Вернуться на холст (Esc)";
		backBtn.addEventListener("click", () => this.close());

		top.createSpan({ cls: "hub3d-crumb-sep", text: "/" });
		top.createSpan({ cls: "hub3d-insp-title", text: this.file.basename });

		if (this.images.length > 1) {
			const switcher = top.createDiv({ cls: "hub3d-insp-switcher" });
			this.images.forEach((_, idx) => {
				const btn = switcher.createEl("button", {
					cls: "hub3d-crumb-btn" + (idx === this.activeIndex ? " is-current" : ""),
					text: String(idx + 1)
				});
				btn.title = `Схема ${idx + 1}`;
				btn.addEventListener("click", () => {
					if (this.activeIndex === idx) return;
					this.activeIndex = idx;
					switcher.querySelectorAll(".hub3d-crumb-btn").forEach((el, i) => el.toggleClass("is-current", i === idx));
					void this.loadActiveSlide();
				});
			});
		}

		const fitBtn = top.createEl("button", { cls: "hub3d-crumb-btn", text: "⌖" });
		fitBtn.title = "Вписать схему в экран";
		fitBtn.addEventListener("click", () => this.fitToScreen());
	}

	private renderBottomDock(): void {
		this.dockEl = this.rootEl.createDiv({ cls: "hub3d-insp-bottom-dock" });
		const tools: Array<{ id: CanvasToolId; icon: string; title: string }> = [
			{ id: "hand", icon: "hand", title: "Рука (H)" },
			{ id: "select", icon: "mouse-pointer-2", title: "Выбор (V)" },
			{ id: "rectangle", icon: "square", title: "Прямоугольник (R)" },
			{ id: "diamond", icon: "diamond", title: "Ромб (D)" },
			{ id: "ellipse", icon: "circle", title: "Эллипс (O)" },
			{ id: "arrow", icon: "arrow-right", title: "Стрелка (A)" },
			{ id: "line", icon: "minus", title: "Линия (L)" },
			{ id: "text", icon: "type", title: "Текст (T)" },
			{ id: "eraser", icon: "eraser", title: "Ластик (E)" }
		];

		for (const t of tools) {
			const btn = this.dockEl.createEl("button", { cls: "hub3d-dock-btn hub3d-insp-tool-btn" });
			btn.title = t.title;
			setIcon(btn, t.icon);
			btn.addEventListener("click", () => this.setTool(t.id));
			this.toolBtns.set(t.id, btn);
		}

		this.dockEl.createSpan({ cls: "hub3d-insp-dock-sep" });

		this.undoBtn = this.dockEl.createEl("button", { cls: "hub3d-dock-btn hub3d-insp-tool-btn" });
		this.undoBtn.title = "Отменить (Ctrl+Z)";
		setIcon(this.undoBtn, "undo-2");
		this.undoBtn.addEventListener("click", () => this.undo());

		this.redoBtn = this.dockEl.createEl("button", { cls: "hub3d-dock-btn hub3d-insp-tool-btn" });
		this.redoBtn.title = "Повторить (Ctrl+Y)";
		setIcon(this.redoBtn, "redo-2");
		this.redoBtn.addEventListener("click", () => this.redo());

		this.dockEl.createSpan({ cls: "hub3d-insp-dock-sep" });

		const openBtn = this.dockEl.createEl("button", { cls: "hub3d-dock-btn", text: "Заметка" });
		openBtn.addEventListener("click", () => {
			this.close();
			void this.app.workspace.openLinkText(this.file.path, "", false);
		});
	}

	private async loadActiveSlide(): Promise<void> {
		const item = this.images[this.activeIndex];
		if (!item) return;

		if (this.textEditor.isOpen()) this.textEditor.close(true);
		this.selectedIds.clear();
		this.history.clear();

		let existing = this.scenes.get(item.name);
		if (!existing) {
			existing = createEmptyScene(this.accentColor);
			this.scenes.set(item.name, existing);
		}
		this.scene = existing;

		if (!this.bgImages.has(item.name)) {
			const img = new this.win.Image();
			await new Promise<void>((resolve) => {
				img.onload = () => resolve();
				img.onerror = () => resolve();
				img.src = item.resourcePath;
			});
			this.bgImages.set(item.name, img);
		}

		this.setTool(this.scene.appState.activeTool || "hand", false);
		this.fitToScreen();
		this.onSelectionOrSceneUpdated();
		this.scheduleRender();
	}

	private fitToScreen(): void {
		const item = this.images[this.activeIndex];
		const img = item ? this.bgImages.get(item.name) : undefined;
		const imgW = img?.naturalWidth || 900;
		const imgH = img?.naturalHeight || 600;
		const pad = 76;
		const zoom = clamp(Math.min((this.vpWidth - pad * 2) / imgW, (this.vpHeight - pad * 2) / imgH, 1.35), 0.12, 6);
		this.scene.appState.zoom = zoom;
		this.scene.appState.scrollX = (this.vpWidth / zoom - imgW) / 2;
		this.scene.appState.scrollY = (this.vpHeight / zoom - imgH) / 2;
		this.textEditor.reposition();
		this.scheduleRender();
	}

	private setTool(tool: CanvasToolId, persist = true): void {
		this.activeTool = tool;
		if (this.scene) {
			this.scene.appState.activeTool = tool;
			if (persist) this.store.scheduleSave(this.scenes);
		}
		for (const [id, btn] of this.toolBtns.entries()) {
			btn.toggleClass("is-active", id === tool);
		}
		this.updateCursor();
		this.syncFloatAnimation();
	}

	private syncFloatAnimation(): void {
		const shouldFloat = this.activeTool === "hand" && !this.interaction;
		if (shouldFloat && this.floatRafId === null) {
			const step = (now: number) => {
				if (this.activeTool !== "hand" || this.interaction) {
					this.floatRafId = null;
					this.floatOffsetY = 0;
					this.scheduleRender();
					return;
				}
				this.floatOffsetY = Math.sin(now * 0.0014) * 5;
				this.renderNow();
				this.floatRafId = this.win.requestAnimationFrame(step);
			};
			this.floatRafId = this.win.requestAnimationFrame(step);
		} else if (!shouldFloat && this.floatRafId !== null) {
			this.win.cancelAnimationFrame(this.floatRafId);
			this.floatRafId = null;
			this.floatOffsetY = 0;
			this.scheduleRender();
		}
	}

	private updateCursor(): void {
		if (!this.canvasEl) return;
		if (this.interaction?.kind === "pan") {
			this.canvasEl.style.cursor = "grabbing";
			return;
		}
		const map: Record<CanvasToolId, string> = {
			hand: "grab",
			select: "default",
			text: "text",
			rectangle: "crosshair",
			diamond: "crosshair",
			ellipse: "crosshair",
			arrow: "crosshair",
			line: "crosshair",
			eraser: "crosshair"
		};
		this.canvasEl.style.cursor = this.spacePressed ? "grab" : map[this.activeTool];
	}

	private handleResize(): void {
		const rect = this.viewportEl.getBoundingClientRect();
		this.vpWidth = Math.max(1, rect.width);
		this.vpHeight = Math.max(1, rect.height);
		this.dpr = Math.min(this.win.devicePixelRatio || 1, 2);
		this.canvasEl.width = Math.round(this.vpWidth * this.dpr);
		this.canvasEl.height = Math.round(this.vpHeight * this.dpr);
		this.textEditor?.reposition();
		this.scheduleRender();
	}

	protected scheduleRender(): void {
		if (this.rafId !== null) return;
		this.rafId = this.win.requestAnimationFrame(() => {
			this.rafId = null;
			this.renderNow();
		});
	}

	private renderNow(): void {
		if (!this.ctx || !this.scene) return;
		const { ctx, vpWidth, vpHeight, dpr } = this;
		const { scrollX, scrollY, zoom, grid, gridSize } = this.scene.appState;
		const safeZoom = Math.max(0.1, zoom);
		const effScrollY = scrollY + this.floatOffsetY / safeZoom;

		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, vpWidth, vpHeight);

		// Сетка
		if (grid) {
			let step = gridSize || 24;
			while (step * safeZoom < 14) step *= 2;
			const scaled = step * safeZoom;
			const ox = ((scrollX * safeZoom) % scaled + scaled) % scaled;
			const oy = ((effScrollY * safeZoom) % scaled + scaled) % scaled;
			ctx.fillStyle = "rgba(180, 188, 210, 0.12)";
			for (let x = ox; x < vpWidth; x += scaled) {
				for (let y = oy; y < vpHeight; y += scaled) {
					ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
				}
			}
		}

		ctx.save();
		ctx.scale(safeZoom, safeZoom);
		ctx.translate(scrollX, effScrollY);

		// Фоновый скриншот заметки в мягкой стеклянной рамке
		const item = this.images[this.activeIndex];
		const img = item ? this.bgImages.get(item.name) : undefined;
		if (img && img.complete && img.naturalWidth > 0) {
			const w = img.naturalWidth;
			const h = img.naturalHeight;
			ctx.save();
			ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
			ctx.shadowBlur = 32;
			ctx.shadowOffsetY = 12;
			ctx.beginPath();
			ctx.roundRect(-8, -8, w + 16, h + 16, 16);
			ctx.fillStyle = "rgba(20, 22, 30, 0.72)";
			ctx.fill();
			ctx.shadowColor = "transparent";
			ctx.lineWidth = 1.5 / safeZoom;
			ctx.strokeStyle = this.accentColor;
			ctx.stroke();

			ctx.beginPath();
			ctx.roundRect(0, 0, w, h, 10);
			ctx.clip();
			ctx.drawImage(img, 0, 0, w, h);
			ctx.restore();
		}

		// Элементы сцены
		this.scene.elements.sort((a, b) => a.zIndex - b.zIndex);
		const byId = new Map<string, SceneElement>();
		for (const el of this.scene.elements) if (!el.isDeleted) byId.set(el.id, el);

		for (const el of this.scene.elements) {
			if (el.isDeleted || el.containerId) continue;
			const boundText = el.boundTextId ? byId.get(el.boundTextId) ?? null : null;
			const isEditing = this.editingElementId === el.id || (boundText !== null && this.editingElementId === boundText.id);
			renderSceneElement(ctx, el, { boundTextElement: boundText, isEditingText: isEditing });
		}

		if (this.bindingHighlight) {
			const t = this.bindingHighlight;
			ctx.save();
			ctx.strokeStyle = "#4aab80";
			ctx.lineWidth = 2.5 / safeZoom;
			ctx.strokeRect(t.x - 4, t.y - 4, t.width + 8, t.height + 8);
			ctx.restore();
		}

		if (this.snapGuides.length > 0) {
			ctx.save();
			ctx.strokeStyle = "#e06c75";
			ctx.lineWidth = 1 / safeZoom;
			ctx.setLineDash([4 / safeZoom, 4 / safeZoom]);
			for (const g of this.snapGuides) {
				ctx.beginPath();
				ctx.moveTo(g.x1, g.y1);
				ctx.lineTo(g.x2, g.y2);
				ctx.stroke();
			}
			ctx.restore();
		}

		const selected = getSelectionFrameElements(this.getSelectedElements());
		if (selected.length > 0 && this.interaction?.kind !== "create" && this.editingElementId === null) {
			this.drawSelectionOverlay(ctx, selected, safeZoom);
		}

		if (this.marqueeBox) {
			ctx.save();
			ctx.fillStyle = "rgba(92, 141, 246, 0.14)";
			ctx.strokeStyle = "#5c8df6";
			ctx.lineWidth = 1.2 / safeZoom;
			ctx.fillRect(this.marqueeBox.minX, this.marqueeBox.minY, this.marqueeBox.width, this.marqueeBox.height);
			ctx.strokeRect(this.marqueeBox.minX, this.marqueeBox.minY, this.marqueeBox.width, this.marqueeBox.height);
			ctx.restore();
		}

		if (this.eraserTrail.length > 1) {
			ctx.save();
			ctx.strokeStyle = "rgba(224, 108, 117, 0.65)";
			ctx.lineWidth = 8 / safeZoom;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(this.eraserTrail[0]!.x, this.eraserTrail[0]!.y);
			for (let i = 1; i < this.eraserTrail.length; i++) ctx.lineTo(this.eraserTrail[i]!.x, this.eraserTrail[i]!.y);
			ctx.stroke();
			ctx.restore();
		}

		ctx.restore();
		ctx.restore();
	}

	private drawSelectionOverlay(ctx: CanvasRenderingContext2D, selected: readonly SceneElement[], zoom: number): void {
		const inv = 1 / zoom;
		ctx.save();
		ctx.strokeStyle = "#5c8df6";
		ctx.lineWidth = 1.5 * inv;

		if (selected.length === 1) {
			const el = selected[0]!;
			if (!isPathElement(el)) {
				const cx = el.x + el.width / 2;
				const cy = el.y + el.height / 2;
				ctx.save();
				if (el.angle) {
					ctx.translate(cx, cy);
					ctx.rotate(el.angle);
					ctx.translate(-cx, -cy);
				}
				const pad = 4 * inv;
				ctx.strokeRect(el.x - pad, el.y - pad, el.width + pad * 2, el.height + pad * 2);
				if (!el.locked) {
					ctx.beginPath();
					ctx.moveTo(cx, el.y - pad);
					ctx.lineTo(cx, el.y - ROTATE_HANDLE_OFFSET_PX * inv);
					ctx.stroke();
				}
				ctx.restore();
			}
		} else {
			const box = getSelectionAABB(selected);
			if (box) {
				const pad = 6 * inv;
				ctx.strokeRect(box.minX - pad, box.minY - pad, box.width + pad * 2, box.height + pad * 2);
			}
		}

		const handles = getTransformHandles(selected, zoom);
		const size = 8 * inv;
		for (const h of handles) {
			ctx.fillStyle = h.kind === "midpoint" ? "rgba(92, 141, 246, 0.45)" : "#ffffff";
			ctx.strokeStyle = "#5c8df6";
			ctx.lineWidth = 1.6 * inv;
			if (h.kind === "rotate" || h.kind === "point" || h.kind === "midpoint") {
				ctx.beginPath();
				ctx.arc(h.x, h.y, (h.kind === "midpoint" ? 4.2 : 5.2) * inv, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			} else {
				ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size);
				ctx.strokeRect(h.x - size / 2, h.y - size / 2, size, size);
			}
		}
		ctx.restore();
	}

	private screenToWorld(clientX: number, clientY: number): ScenePoint {
		const rect = this.canvasEl.getBoundingClientRect();
		const z = Math.max(0.1, this.scene.appState.zoom);
		return {
			x: (clientX - rect.left) / z - this.scene.appState.scrollX,
			y: (clientY - rect.top) / z - this.scene.appState.scrollY
		};
	}

	protected getSelectedElements(): SceneElement[] {
		return this.scene.elements.filter((el) => !el.isDeleted && this.selectedIds.has(el.id));
	}

	private getElementById(id: string): SceneElement | undefined {
		return this.scene.elements.find((el) => el.id === id);
	}

	private getNextZIndex(): number {
		return this.scene.elements.reduce((m, e) => (e.isDeleted ? m : Math.max(m, e.zIndex)), -1) + 1;
	}

	private bindCanvasEvents(): void {
		this.canvasEl.addEventListener("dblclick", (e: MouseEvent) => {
			if (this.textEditor.isOpen()) return;
			const rect = this.canvasEl.getBoundingClientRect();
			const z = Math.max(0.1, this.scene.appState.zoom);
			const pt = {
				x: (e.clientX - rect.left) / z - this.scene.appState.scrollX,
				y: (e.clientY - rect.top) / z - this.scene.appState.scrollY
			};
			const hit = getElementAtPoint(this.scene.elements, pt, z);
			if (!hit) {
				this.createTextAt(pt);
			} else if (hit.type === "text") {
				this.selectedIds = new Set([hit.id]);
				this.beginTextEditing(hit, false);
			} else if (isTextContainer(hit)) {
				this.beginContainerText(hit);
			}
		});

		this.canvasEl.addEventListener("pointerdown", (e: PointerEvent) => {
			if (this.textEditor.isOpen()) this.textEditor.close(true);
			e.preventDefault();
			this.canvasEl.setPointerCapture(e.pointerId);
			const world = this.screenToWorld(e.clientX, e.clientY);

			if (e.button === 1 || this.spacePressed || this.activeTool === "hand") {
				this.interaction = { kind: "pan", pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
				this.syncFloatAnimation();
				this.updateCursor();
				return;
			}
			if (e.button !== 0) return;

			if (this.activeTool === "select") {
				const selected = this.getSelectedElements();
				const hitHandle = hitTestHandles(getTransformHandles(selected, this.scene.appState.zoom), world, this.scene.appState.zoom);
				if (hitHandle) {
					this.beginHandle(e.pointerId, world, hitHandle);
					return;
				}
				const hit = getElementAtPoint(this.scene.elements, world, this.scene.appState.zoom);
				if (hit) {
					if (e.shiftKey) {
						if (this.selectedIds.has(hit.id)) this.selectedIds.delete(hit.id);
						else this.selectWithBoundText(hit.id, false);
					} else if (!this.selectedIds.has(hit.id)) {
						this.selectWithBoundText(hit.id, true);
					}
					this.onSelectionOrSceneUpdated();
					this.scheduleRender();

					if (this.selectedIds.has(hit.id) && !hit.locked) {
						const movingIds = new Set(this.getSelectedElements().filter((x) => !x.locked).map((x) => x.id));
						const startMap = new Map<string, SceneElement>();
						for (const id of movingIds) {
							const el = this.getElementById(id);
							if (el) startMap.set(id, cloneSceneElement(el));
						}
						this.interaction = { kind: "move", pointerId: e.pointerId, startWorld: world, startElements: startMap, movingIds, didMove: false, started: false };
					}
					return;
				}
				const prev = new Set(this.selectedIds);
				if (!e.shiftKey) this.selectedIds.clear();
				this.onSelectionOrSceneUpdated();
				this.interaction = { kind: "marquee", pointerId: e.pointerId, startWorld: world, additive: e.shiftKey, prevSel: prev };
				this.marqueeBox = { minX: world.x, minY: world.y, maxX: world.x, maxY: world.y, width: 0, height: 0, cx: world.x, cy: world.y };
				this.scheduleRender();
				return;
			}

			if (this.activeTool === "text") {
				const hit = getElementAtPoint(this.scene.elements, world, this.scene.appState.zoom);
				if (hit?.type === "text") {
					this.selectedIds = new Set([hit.id]);
					this.beginTextEditing(hit, false);
				} else if (hit && isTextContainer(hit)) {
					this.beginContainerText(hit);
				} else {
					this.createTextAt(world);
				}
				return;
			}

			if (this.activeTool === "eraser") {
				const erased = this.eraseAt(world);
				this.eraserTrail = [world];
				this.interaction = { kind: "erase", pointerId: e.pointerId, didErase: erased };
				this.scheduleRender();
				return;
			}

			const elType = getElementTypeForTool(this.activeTool);
			if (elType) {
				this.history.beginTransaction(this.scene.elements, this.selectedIds);
				const el = createSceneElement(elType, world, this.scene.appState.currentStyle, this.getNextZIndex());
				this.scene.elements.push(el);
				this.selectedIds = new Set([el.id]);
				this.interaction = { kind: "create", pointerId: e.pointerId, startWorld: world, elementId: el.id, didMove: false };
				this.onSelectionOrSceneUpdated();
				this.scheduleRender();
			}
		});

		this.canvasEl.addEventListener("pointermove", (e: PointerEvent) => {
			const world = this.screenToWorld(e.clientX, e.clientY);
			const cur = this.interaction;
			if (!cur || cur.pointerId !== e.pointerId) {
				if (this.activeTool === "arrow" || this.activeTool === "line") {
					const m = findNearestBindingTarget(world, this.scene.elements, undefined, 24 / Math.max(0.1, this.scene.appState.zoom));
					if ((m?.element ?? null) !== this.bindingHighlight) {
						this.bindingHighlight = m?.element ?? null;
						this.scheduleRender();
					}
				}
				return;
			}

			if (cur.kind === "pan") {
				const z = Math.max(0.1, this.scene.appState.zoom);
				this.scene.appState.scrollX += (e.clientX - cur.lastX) / z;
				this.scene.appState.scrollY += (e.clientY - cur.lastY) / z;
				cur.lastX = e.clientX;
				cur.lastY = e.clientY;
				this.scheduleRender();
				return;
			}

			if (cur.kind === "create") {
				if (Math.hypot(world.x - cur.startWorld.x, world.y - cur.startWorld.y) > 3) cur.didMove = true;
				const el = this.getElementById(cur.elementId);
				if (el) {
					updateElementFromDrag(el, cur.startWorld, world, e.shiftKey);
					if (isPathElement(el)) {
						const m = findNearestBindingTarget(world, this.scene.elements, el.id, 24 / Math.max(0.1, this.scene.appState.zoom));
						this.bindingHighlight = m?.element ?? null;
					}
					this.scheduleRender();
				}
				return;
			}

			if (cur.kind === "move") {
				const dx = world.x - cur.startWorld.x;
				const dy = world.y - cur.startWorld.y;
				if (!cur.started) {
					if (Math.hypot(dx, dy) < 2) return;
					cur.started = true;
					cur.didMove = true;
					this.history.beginTransaction(this.scene.elements, this.selectedIds);
				}
				const sb = getSelectionAABB(Array.from(cur.startElements.values()));
				let mx = dx;
				let my = dy;
				this.snapGuides = [];
				if (sb) {
					const snap = computeSnapOffset(
						{ minX: sb.minX + dx, minY: sb.minY + dy, maxX: sb.maxX + dx, maxY: sb.maxY + dy, cx: sb.cx + dx, cy: sb.cy + dy },
						this.scene.elements,
						cur.movingIds,
						this.scene.appState.zoom
					);
					mx += snap.dx;
					my += snap.dy;
					this.snapGuides = snap.guides;
				}
				for (const [id, snapEl] of cur.startElements.entries()) {
					const el = this.getElementById(id);
					if (!el || el.locked) continue;
					el.x = snapEl.x + mx;
					el.y = snapEl.y + my;
					el.updated = Date.now();
					if (snapEl.points) el.points = snapEl.points.map((p) => ({ ...p }));
				}
				updateBoundElements(this.scene.elements);
				this.onSelectionOrSceneUpdated();
				this.scheduleRender();
				return;
			}

			if (cur.kind === "resize") {
				const h = cur.handle;
				if (!isResizeHandle(h.kind)) return;
				const ptr = { x: world.x + (h.x - cur.startWorld.x), y: world.y + (h.y - cur.startWorld.y) };
				const single = getSelectionFrameElements(Array.from(cur.startElements.values()));
				const elSnap = single.length === 1 ? single[0] : undefined;
				const ctx = getMeasureContext(this.doc);

				if (elSnap && elSnap.type === "text" && !elSnap.containerId && ctx) {
					const el = this.getElementById(elSnap.id);
					if (el) Object.assign(el, resizeTextFromHandle(ctx, elSnap, h.kind, ptr));
				} else if (elSnap && !elSnap.points) {
					const el = this.getElementById(elSnap.id);
					if (el) {
						const next = resizeBoxFromHandle({ x: elSnap.x, y: elSnap.y, width: elSnap.width, height: elSnap.height }, elSnap.angle || 0, h.kind, ptr, { keepRatio: e.shiftKey });
						el.x = next.x;
						el.y = next.y;
						el.width = next.width;
						el.height = next.height;
						el.updated = Date.now();
					}
				}
				updateBoundElements(this.scene.elements);
				this.onSelectionOrSceneUpdated();
				this.scheduleRender();
				return;
			}

			if (cur.kind === "rotate") {
				let delta = Math.atan2(world.y - cur.center.y, world.x - cur.center.x) - cur.startAngle;
				if (e.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
				for (const [id, snapEl] of cur.startElements.entries()) {
					const el = this.getElementById(id);
					if (!el || el.locked || isPathElement(el)) continue;
					const c = rotatePoint(snapEl.x + snapEl.width / 2, snapEl.y + snapEl.height / 2, cur.center.x, cur.center.y, delta);
					el.x = c.x - snapEl.width / 2;
					el.y = c.y - snapEl.height / 2;
					el.angle = snapEl.angle + delta;
					el.updated = Date.now();
				}
				updateBoundElements(this.scene.elements);
				this.scheduleRender();
				return;
			}

			if (cur.kind === "point") {
				const el = this.getElementById(cur.elementId);
				if (el?.points?.[cur.pointIndex]) {
					if (cur.pointIndex === 0) el.startBinding = null;
					if (cur.pointIndex === el.points.length - 1) el.endBinding = null;
					el.points[cur.pointIndex] = { x: world.x - el.x, y: world.y - el.y };
					normalizeElementBounds(el);
					updateBoundElements(this.scene.elements);
					this.scheduleRender();
				}
				return;
			}

			if (cur.kind === "marquee") {
				const minX = Math.min(cur.startWorld.x, world.x);
				const minY = Math.min(cur.startWorld.y, world.y);
				const maxX = Math.max(cur.startWorld.x, world.x);
				const maxY = Math.max(cur.startWorld.y, world.y);
				this.marqueeBox = { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
				this.scheduleRender();
				return;
			}

			if (cur.kind === "erase") {
				cur.didErase = this.eraseAt(world) || cur.didErase;
				this.eraserTrail.push(world);
				this.scheduleRender();
			}
		});

		const onUp = (e: PointerEvent) => {
			if (this.canvasEl.hasPointerCapture(e.pointerId)) this.canvasEl.releasePointerCapture(e.pointerId);
			const cur = this.interaction;
			if (!cur || cur.pointerId !== e.pointerId) return;
			const world = this.screenToWorld(e.clientX, e.clientY);

			if (cur.kind === "create") {
				const el = this.getElementById(cur.elementId);
				if (el) {
					finalizeElementSize(el, cur.startWorld, cur.didMove);
					if (isPathElement(el) && el.points && el.points.length >= 2) {
						const maxD = 24 / Math.max(0.1, this.scene.appState.zoom);
						const sM = findNearestBindingTarget(cur.startWorld, this.scene.elements, el.id, maxD);
						const last = el.points[el.points.length - 1]!;
						const eM = findNearestBindingTarget({ x: el.x + last.x, y: el.y + last.y }, this.scene.elements, el.id, maxD);
						el.startBinding = sM?.binding ?? null;
						el.endBinding = eM?.binding ?? null;
						updateBoundElements(this.scene.elements);
						normalizeElementBounds(el);
					}
					this.commitScene();
				} else {
					this.history.cancelTransaction();
				}
				if (!this.scene.appState.keepToolActive) this.setTool("select");
			} else if (cur.kind === "move") {
				if (cur.started) this.commitScene();
			} else if (cur.kind === "resize" || cur.kind === "rotate") {
				this.commitScene();
			} else if (cur.kind === "point") {
				const el = this.getElementById(cur.elementId);
				if (el && isPathElement(el) && el.points) {
					const maxD = 24 / Math.max(0.1, this.scene.appState.zoom);
					if (cur.pointIndex === 0) {
						const p0 = el.points[0]!;
						el.startBinding = findNearestBindingTarget({ x: el.x + p0.x, y: el.y + p0.y }, this.scene.elements, el.id, maxD)?.binding ?? null;
					} else if (cur.pointIndex === el.points.length - 1) {
						const pL = el.points[el.points.length - 1]!;
						el.endBinding = findNearestBindingTarget({ x: el.x + pL.x, y: el.y + pL.y }, this.scene.elements, el.id, maxD)?.binding ?? null;
					}
					updateBoundElements(this.scene.elements);
				}
				this.commitScene();
			} else if (cur.kind === "marquee" && this.marqueeBox) {
				const b = this.marqueeBox;
				this.selectedIds = cur.additive ? new Set(cur.prevSel) : new Set();
				for (const el of this.scene.elements) {
					if (el.isDeleted || el.containerId) continue;
					const eb = getElementAABB(el);
					if (eb.minX >= b.minX && eb.maxX <= b.maxX && eb.minY >= b.minY && eb.maxY <= b.maxY) {
						this.selectWithBoundText(el.id, false);
					}
				}
				this.onSelectionOrSceneUpdated();
			} else if (cur.kind === "erase" && cur.didErase) {
				this.commitScene();
			}

			this.interaction = null;
			this.marqueeBox = null;
			this.snapGuides = [];
			this.bindingHighlight = null;
			this.eraserTrail = [];
			this.updateCursor();
			this.syncFloatAnimation();
			this.scheduleRender();
		};

		this.canvasEl.addEventListener("pointerup", onUp);
		this.canvasEl.addEventListener("pointercancel", onUp);

		this.canvasEl.addEventListener(
			"wheel",
			(e: WheelEvent) => {
				e.preventDefault();
				const rect = this.canvasEl.getBoundingClientRect();
				const sx = e.clientX - rect.left;
				const sy = e.clientY - rect.top;
				const z = Math.max(0.1, this.scene.appState.zoom);
				const wx = sx / z - this.scene.appState.scrollX;
				const wy = sy / z - this.scene.appState.scrollY;
				const nextZ = clamp(z * (e.deltaY < 0 ? 1.12 : 0.89), 0.12, 8);
				this.scene.appState.zoom = nextZ;
				this.scene.appState.scrollX = sx / nextZ - wx;
				this.scene.appState.scrollY = sy / nextZ - wy;
				this.textEditor.reposition();
				this.onSelectionOrSceneUpdated();
				this.scheduleRender();
			},
			{ passive: false }
		);
	}

	private beginHandle(pointerId: number, world: ScenePoint, handle: HandleDescriptor): void {
		if (handle.kind === "point" || handle.kind === "midpoint") {
			const el = handle.elementId ? this.getElementById(handle.elementId) : undefined;
			if (!el || el.locked || !el.points) return;
			this.history.beginTransaction(this.scene.elements, this.selectedIds);
			const idx = handle.pointIndex ?? 0;
			if (handle.kind === "midpoint") {
				const prev = el.points[idx - 1];
				const next = el.points[idx];
				if (prev && next) el.points.splice(idx, 0, { x: (prev.x + next.x) / 2, y: (prev.y + next.y) / 2 });
			}
			this.interaction = { kind: "point", pointerId, elementId: el.id, pointIndex: idx };
			return;
		}
		const startMap = new Map<string, SceneElement>();
		for (const el of this.getSelectedElements()) startMap.set(el.id, cloneSceneElement(el));
		if (handle.kind === "rotate") {
			const b = getSelectionAABB(Array.from(startMap.values()));
			if (!b) return;
			this.history.beginTransaction(this.scene.elements, this.selectedIds);
			this.interaction = { kind: "rotate", pointerId, startElements: startMap, center: { x: b.cx, y: b.cy }, startAngle: Math.atan2(world.y - b.cy, world.x - b.cx) };
			return;
		}
		const b = getSelectionAABB(Array.from(startMap.values()));
		if (!b) return;
		this.history.beginTransaction(this.scene.elements, this.selectedIds);
		this.interaction = { kind: "resize", pointerId, startWorld: world, startElements: startMap, startBounds: b, handle };
	}

	private selectWithBoundText(id: string, clearFirst: boolean): void {
		if (clearFirst) this.selectedIds.clear();
		const el = this.getElementById(id);
		if (!el || el.isDeleted) return;
		this.selectedIds.add(id);
		if (el.boundTextId) this.selectedIds.add(el.boundTextId);
		if (el.containerId) this.selectedIds.add(el.containerId);
	}

	private eraseAt(pt: ScenePoint): boolean {
		const hit = getElementAtPoint(this.scene.elements, pt, this.scene.appState.zoom, false);
		if (!hit || hit.locked) return false;
		if (!this.history.hasPendingTransaction()) this.history.beginTransaction(this.scene.elements, this.selectedIds);
		hit.isDeleted = true;
		if (hit.boundTextId) {
			const bt = this.getElementById(hit.boundTextId);
			if (bt) bt.isDeleted = true;
		}
		this.selectedIds.delete(hit.id);
		updateBoundElements(this.scene.elements);
		return true;
	}

	private createTextAt(pt: ScenePoint): void {
		this.history.beginTransaction(this.scene.elements, this.selectedIds);
		const el = createSceneElement("text", pt, this.scene.appState.currentStyle, this.getNextZIndex());
		el.strokeColor = "#ffffff";
		el.text = "";
		el.width = 0;
		el.y = pt.y - el.height / 2;
		this.scene.elements.push(el);
		this.selectedIds = new Set([el.id]);
		this.beginTextEditing(el, true, true);
	}

	private beginContainerText(container: SceneElement): void {
		const bound = container.boundTextId ? this.getElementById(container.boundTextId) : undefined;
		if (bound && !bound.isDeleted) {
			this.selectWithBoundText(container.id, true);
			this.beginTextEditing(bound, false);
			return;
		}
		this.history.beginTransaction(this.scene.elements, this.selectedIds);
		const textEl = createSceneElement("text", { x: container.x, y: container.y }, this.scene.appState.currentStyle, this.getNextZIndex());
		const box = getContainerTextBox(container);
		textEl.strokeColor = "#ffffff";
		textEl.text = "";
		textEl.containerId = container.id;
		textEl.textAlign = "center";
		textEl.verticalAlign = "middle";
		textEl.autoResize = false;
		textEl.x = box.x;
		textEl.y = box.y;
		textEl.width = box.width;
		textEl.height = box.height;
		textEl.angle = container.angle;
		container.boundTextId = textEl.id;
		this.scene.elements.push(textEl);
		this.selectWithBoundText(container.id, true);
		this.beginTextEditing(textEl, true, true);
	}

	private beginTextEditing(el: SceneElement, isNew: boolean, txStarted = false): void {
		if (this.textEditor.isOpen()) this.textEditor.close(true);
		if (!txStarted) this.history.beginTransaction(this.scene.elements, this.selectedIds);
		this.textSession = { elementId: el.id, isNew, anchor: getTextAnchor(el) };
		this.editingElementId = el.id;
		this.textEditor.open({
			initialText: el.text ?? "",
			fontFamily: el.fontFamily,
			textAlign: el.textAlign,
			color: el.strokeColor || "#ffffff",
			computeLayout: (val) => this.computeTextLayout(el.id, val),
			onCommit: (val, reason) => this.finishTextEditing(val, reason),
			onWheel: (ev) => this.canvasEl.dispatchEvent(new WheelEvent("wheel", ev))
		});
		this.onSelectionOrSceneUpdated();
		this.scheduleRender();
	}

	private computeTextLayout(elId: string, val: string): TextEditorLayout | null {
		const el = this.getElementById(elId);
		const ctx = getMeasureContext(this.doc);
		if (!el || !ctx) return null;
		const { scrollX, scrollY, zoom } = this.scene.appState;
		const z = Math.max(0.1, zoom);
		const container = el.containerId ? this.getElementById(el.containerId) : null;

		if (!container) {
			const wrapW = el.autoResize === true ? null : getTextWrapWidth(el.width);
			const m = measureTextBlock(ctx, val, el.fontSize, el.fontFamily, wrapW);
			const x = wrapW === null && this.textSession ? getAnchoredTextX(this.textSession.anchor, el.textAlign, m.width) : el.x;
			return { left: (x + scrollX) * z, top: (el.y + scrollY) * z, width: m.width * z, height: m.height * z, fontSize: m.fontSize * z, wrap: wrapW !== null, angle: el.angle || 0 };
		}

		const box = getContainerTextBox(container);
		const m = measureTextBlock(ctx, val, el.fontSize, el.fontFamily, box.width);
		const offY = (box.height - m.height) / 2;
		const left = (box.x + scrollX) * z;
		const top = (box.y + offY + scrollY) * z;
		return {
			left,
			top,
			width: box.width * z,
			height: m.height * z,
			fontSize: m.fontSize * z,
			wrap: true,
			angle: container.angle || 0,
			originX: (container.x + container.width / 2 + scrollX) * z - left,
			originY: (container.y + container.height / 2 + scrollY) * z - top
		};
	}

	private finishTextEditing(val: string, _reason: TextEditorCloseReason): void {
		const s = this.textSession;
		if (!s) return;
		const el = this.getElementById(s.elementId);
		this.editingElementId = null;
		this.textSession = null;
		if (!el) {
			this.history.cancelTransaction();
			this.scheduleRender();
			return;
		}
		if (!val.trim()) {
			el.isDeleted = true;
			if (el.containerId) {
				const p = this.getElementById(el.containerId);
				if (p?.boundTextId === el.id) p.boundTextId = null;
			}
			this.selectedIds.delete(el.id);
			if (s.isNew) this.history.cancelTransaction();
			else this.commitScene();
		} else {
			el.text = val;
			const ctx = getMeasureContext(this.doc);
			if (ctx) fitTextElementToContent(ctx, el, s.anchor);
			el.updated = Date.now();
			updateBoundElements(this.scene.elements);
			this.commitScene();
		}
		if (!this.scene.appState.keepToolActive) this.setTool("select");
		this.onSelectionOrSceneUpdated();
		this.scheduleRender();
	}

	protected commitScene(): void {
		if (this.history.commitTransaction(this.scene.elements, this.selectedIds)) {
			this.store.scheduleSave(this.scenes);
		}
		this.onSelectionOrSceneUpdated();
		this.scheduleRender();
	}

	protected updateSelected(mutateEl: (el: SceneElement) => void, mutateStyle: (st: ElementStyleDefaults) => void): void {
		const selected = this.getSelectedElements();
		if (selected.length === 0) return;
		this.history.beginTransaction(this.scene.elements, this.selectedIds);
		const ctx = getMeasureContext(this.doc);
		for (const el of selected) {
			const anchor = getTextAnchor(el);
			mutateEl(el);
			if (ctx) fitTextElementToContent(ctx, el, anchor);
			el.updated = Date.now();
		}
		mutateStyle(this.scene.appState.currentStyle);
		updateBoundElements(this.scene.elements);
		this.commitScene();
	}

	protected deleteSelection(): void {
		const del = this.getSelectedElements().filter((el) => !el.locked);
		if (del.length === 0) return;
		this.history.beginTransaction(this.scene.elements, this.selectedIds);
		for (const el of del) {
			el.isDeleted = true;
			if (el.boundTextId) {
				const bt = this.getElementById(el.boundTextId);
				if (bt) bt.isDeleted = true;
			}
		}
		this.selectedIds.clear();
		updateBoundElements(this.scene.elements);
		this.commitScene();
	}

	protected duplicateSelection(): void {
		const sel = this.getSelectedElements();
		if (sel.length === 0) return;
		this.history.beginTransaction(this.scene.elements, this.selectedIds);
		const idMap = new Map<string, string>();
		for (const el of sel) idMap.set(el.id, generateElementId(el.type));
		const clones = sel.map((orig, i): SceneElement => {
			const c = cloneSceneElement(orig);
			c.id = idMap.get(orig.id)!;
			c.x += 20;
			c.y += 20;
			c.zIndex = this.getNextZIndex() + i;
			c.containerId = c.containerId ? idMap.get(c.containerId) ?? null : null;
			c.boundTextId = c.boundTextId ? idMap.get(c.boundTextId) ?? null : null;
			return c;
		});
		this.scene.elements.push(...clones);
		this.selectedIds = new Set(clones.map((c) => c.id));
		this.commitScene();
	}

	protected changeLayerOrder(dir: "front" | "back"): void {
		const active = this.scene.elements.filter((e) => !e.isDeleted).sort((a, b) => a.zIndex - b.zIndex);
		const sel = active.filter((e) => this.selectedIds.has(e.id));
		if (sel.length === 0) return;
		this.history.beginTransaction(this.scene.elements, this.selectedIds);
		const rest = active.filter((e) => !this.selectedIds.has(e.id));
		const next = dir === "front" ? [...rest, ...sel] : [...sel, ...rest];
		next.forEach((e, i) => {
			e.zIndex = i;
		});
		this.commitScene();
	}

	private undo(): void {
		const res = this.history.undo(this.scene.elements);
		if (!res) return;
		this.scene.elements = res.elements;
		this.selectedIds = res.selection;
		updateBoundElements(this.scene.elements);
		this.store.scheduleSave(this.scenes);
		this.onSelectionOrSceneUpdated();
		this.scheduleRender();
	}

	private redo(): void {
		const res = this.history.redo(this.scene.elements);
		if (!res) return;
		this.scene.elements = res.elements;
		this.selectedIds = res.selection;
		updateBoundElements(this.scene.elements);
		this.store.scheduleSave(this.scenes);
		this.onSelectionOrSceneUpdated();
		this.scheduleRender();
	}

	private updateHistoryButtons(): void {
		if (this.undoBtn) this.undoBtn.disabled = !this.history.canUndo();
		if (this.redoBtn) this.redoBtn.disabled = !this.history.canRedo();
	}

	private bindKeyboardEvents(): void {
		this.keyHandler = (e: KeyboardEvent) => {
			if (e.code === "Space" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName || "")) {
				e.preventDefault();
				this.spacePressed = true;
				this.updateCursor();
				return;
			}
			const tag = (e.target as HTMLElement | null)?.tagName ?? "";
			if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;

			const mod = e.ctrlKey || e.metaKey;
			if (mod) {
				if (e.code === "KeyZ") {
					e.preventDefault();
					if (e.shiftKey) this.redo();
					else this.undo();
				} else if (e.code === "KeyY") {
					e.preventDefault();
					this.redo();
				} else if (e.code === "KeyD") {
					e.preventDefault();
					this.duplicateSelection();
				}
				return;
			}
			const toolMap: Record<string, CanvasToolId> = { KeyH: "hand", KeyV: "select", KeyR: "rectangle", KeyD: "diamond", KeyO: "ellipse", KeyA: "arrow", KeyL: "line", KeyT: "text", KeyE: "eraser" };
			const t = toolMap[e.code];
			if (t) {
				e.preventDefault();
				this.setTool(t);
			} else if ((e.key === "Delete" || e.key === "Backspace") && this.selectedIds.size > 0) {
				e.preventDefault();
				this.deleteSelection();
			}
		};
		this.keyUpHandler = (e: KeyboardEvent) => {
			if (e.code === "Space") {
				this.spacePressed = false;
				this.updateCursor();
			}
		};
		this.win.addEventListener("keydown", this.keyHandler);
		this.win.addEventListener("keyup", this.keyUpHandler);
	}
}