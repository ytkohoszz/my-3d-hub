import { setIcon } from "obsidian";
import { getSelectionAABB, getSelectionFrameElements } from "./geometry";
import {
	ArrowheadType,
	ElementStyleDefaults,
	FontFamilyType,
	Scene,
	SceneElement,
	TextAlignType
} from "./sceneTypes";

const SVG_NS = "http://www.w3.org/2000/svg";

const STROKE_SWATCHES = [
	"#ffffff",
	"#cbd5e1",
	"#e5a158",
	"#e06c75",
	"#4aab80",
	"#599ed6",
	"#9c83e8",
	"#d882b6"
];

const BG_SWATCHES = [
	{ value: "transparent", preview: "transparent" },
	{ value: "rgba(229, 161, 88, 0.20)", preview: "#e5a158" },
	{ value: "rgba(224, 108, 117, 0.20)", preview: "#e06c75" },
	{ value: "rgba(74, 171, 128, 0.20)", preview: "#4aab80" },
	{ value: "rgba(89, 158, 214, 0.20)", preview: "#599ed6" },
	{ value: "rgba(156, 131, 232, 0.20)", preview: "#9c83e8" },
	{ value: "rgba(255, 255, 255, 0.10)", preview: "#cbd5e1" },
	{ value: "rgba(24, 27, 35, 0.78)", preview: "#2d3340" }
];

function clamp(v: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, v));
}

function normalizeHex(color: string): string {
	const c = color.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(c)) return c;
	return "#9c83e8";
}

function hexToRgba(hex: string, alpha: number): string {
	const clean = normalizeHex(hex).slice(1);
	const r = parseInt(clean.slice(0, 2), 16);
	const g = parseInt(clean.slice(2, 4), 16);
	const b = parseInt(clean.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface PropertiesHostApi {
	rootEl: HTMLElement;
	viewportEl: HTMLElement;
	accentColor: string;
	getScene: () => Scene;
	getSelected: () => SceneElement[];
	isBusy: () => boolean;
	updateSelected: (
		mutateEl: (el: SceneElement) => void,
		mutateStyle: (st: ElementStyleDefaults) => void
	) => void;
	onOpacityInput: (val: number) => void;
	onOpacityCommit: () => void;
	onDuplicate: () => void;
	onLayer: (dir: "front" | "back") => void;
	onDelete: () => void;
}

export class InspectorPropertiesController {
	private api: PropertiesHostApi;
	private doc: Document;
	private selBarEl: HTMLDivElement;
	private panelEl: HTMLDivElement;
	private panelOpen = false;

	constructor(api: PropertiesHostApi) {
		this.api = api;
		this.doc = api.rootEl.ownerDocument;

		this.selBarEl = this.doc.createElement("div");
		this.selBarEl.className = "hub3d-insp-sel-bar is-hidden";
		api.rootEl.appendChild(this.selBarEl);

		this.panelEl = this.doc.createElement("div");
		this.panelEl.className = "hub3d-insp-props-panel is-hidden";
		api.rootEl.appendChild(this.panelEl);
	}

	public destroy(): void {
		this.selBarEl.remove();
		this.panelEl.remove();
	}

	public refresh(): void {
		const selected = this.api.getSelected();
		const primaryList = selected.filter((e) => !e.containerId);
		const display = primaryList.length > 0 ? primaryList : selected;

		if (display.length === 0 || this.api.isBusy()) {
			this.selBarEl.classList.add("is-hidden");
			if (display.length === 0) {
				this.panelOpen = false;
				this.panelEl.classList.add("is-hidden");
			}
			return;
		}

		this.renderSelectionBar(display);
		if (this.panelOpen) {
			this.renderPanel(display, selected);
			this.panelEl.classList.remove("is-hidden");
		} else {
			this.panelEl.classList.add("is-hidden");
		}
	}

	private renderSelectionBar(display: SceneElement[]): void {
		const bounds = getSelectionAABB(getSelectionFrameElements(display));
		const vpRect = this.api.viewportEl.getBoundingClientRect();
		if (!bounds || vpRect.width <= 0 || vpRect.height <= 0) {
			this.selBarEl.classList.add("is-hidden");
			return;
		}

		this.selBarEl.replaceChildren();
		const makeBtn = (icon: string, title: string, onClick: () => void, active = false, danger = false) => {
			const btn = this.doc.createElement("button");
			btn.type = "button";
			btn.className = "hub3d-insp-sel-btn" + (active ? " is-active" : "") + (danger ? " is-danger" : "");
			btn.title = title;
			setIcon(btn, icon);
			btn.addEventListener("pointerdown", (e) => e.stopPropagation());
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				onClick();
			});
			this.selBarEl.appendChild(btn);
		};

		makeBtn(
			"palette",
			this.panelOpen ? "Скрыть свойства" : "Свойства элемента",
			() => {
				this.panelOpen = !this.panelOpen;
				this.refresh();
			},
			this.panelOpen
		);
		makeBtn("copy", "Дублировать (Ctrl+D)", () => this.api.onDuplicate());
		makeBtn("layers-2", "На передний план", () => this.api.onLayer("front"));
		makeBtn("layers", "На задний план", () => this.api.onLayer("back"));
		makeBtn("trash-2", "Удалить (Del)", () => this.api.onDelete(), false, true);

		this.selBarEl.classList.remove("is-hidden");

		const { scrollX, scrollY, zoom } = this.api.getScene().appState;
		const z = Math.max(0.1, zoom);
		const cx = (bounds.cx + scrollX) * z;
		const topY = (bounds.minY + scrollY) * z;
		const botY = (bounds.maxY + scrollY) * z;

		const barW = this.selBarEl.offsetWidth || 180;
		const barH = this.selBarEl.offsetHeight || 36;
		const left = clamp(cx - barW / 2, 12, Math.max(12, vpRect.width - barW - 12));
		let top = topY - barH - 28;
		if (top < 62) top = Math.min(vpRect.height - barH - 72, botY + 18);
		top = clamp(top, 60, Math.max(60, vpRect.height - barH - 72));

		this.selBarEl.style.left = `${Math.round(left)}px`;
		this.selBarEl.style.top = `${Math.round(top)}px`;
	}

	private renderPanel(display: SceneElement[], allSelected: SceneElement[]): void {
		this.panelEl.replaceChildren();
		const primary = display[0]!;
		const textSample = allSelected.find((e) => e.type === "text" || Boolean(e.text)) ?? primary;

		const hasFill = display.some((e) => e.type === "rectangle" || e.type === "diamond" || e.type === "ellipse");
		const hasLineGeom = display.some((e) => e.type !== "text");
const hasRound = display.some((e) => e.type === "rectangle" || e.type === "image");
		const hasPath = display.some((e) => e.type === "arrow" || e.type === "line");
		const hasArrowheads = display.some((e) => e.type === "arrow");
		const hasText = allSelected.some(
			(e) => e.type === "text" || e.type === "rectangle" || e.type === "diamond" || e.type === "ellipse"
		);

		const head = this.doc.createElement("div");
		head.className = "hub3d-insp-prop-head";
		const title = this.doc.createElement("span");
		title.textContent = display.length > 1 ? `Элементы (${display.length})` : this.getTitle(primary.type);
		const closeBtn = this.doc.createElement("button");
		closeBtn.type = "button";
		closeBtn.className = "hub3d-insp-prop-close";
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => {
			this.panelOpen = false;
			this.refresh();
		});
		head.append(title, closeBtn);
		this.panelEl.appendChild(head);

		// 1. Обводка / Цвет текста
		this.addStrokeSwatches(
			display.every((e) => e.type === "text") ? "Цвет текста" : "Обводка",
			primary.strokeColor,
			(color) => {
				this.api.updateSelected(
					(el) => {
						if (!el.containerId || display.every((d) => d.type === "text")) el.strokeColor = color;
					},
					(st) => {
						st.strokeColor = color;
					}
				);
			}
		);

		// 2. Фон и заливка
		if (hasFill) {
			this.addBgSwatches(primary.fillStyle === "none" ? "transparent" : primary.backgroundColor, (color) => {
				this.api.updateSelected(
					(el) => {
						if (el.containerId) return;
						el.backgroundColor = color;
						if (color === "transparent") el.fillStyle = "none";
						else if (el.fillStyle === "none") el.fillStyle = "solid";
					},
					(st) => {
						st.backgroundColor = color;
						if (color === "transparent") st.fillStyle = "none";
						else if (st.fillStyle === "none") st.fillStyle = "solid";
					}
				);
			});

			this.addSeg<SceneElement["fillStyle"]>(
				"Заливка",
				primary.fillStyle,
				[
					{ value: "solid", title: "Сплошная", path: "M4 4h12v12H4z", fill: "currentColor" },
					{ value: "hachure", title: "Штриховка", path: "M4 4h12v12H4z M5 14L14 5 M8 16l8-8 M4 10l6-6" },
					{ value: "cross-hatch", title: "Сетка", path: "M4 4h12v12H4z M5 15L15 5 M5 5l10 10" },
					{ value: "none", title: "Нет", path: "M4 4h12v12H4z M5 15L15 5" }
				],
				(fillStyle) => {
					this.api.updateSelected(
						(el) => {
							if (el.containerId) return;
							el.fillStyle = fillStyle;
							if (fillStyle !== "none" && (!el.backgroundColor || el.backgroundColor === "transparent")) {
								el.backgroundColor = hexToRgba(this.api.accentColor, 0.2);
							}
						},
						(st) => {
							st.fillStyle = fillStyle;
						}
					);
				}
			);
		}

		// 3. Толщина, стиль, рисовка
		if (hasLineGeom) {
			const wVal = primary.strokeWidth <= 1.5 ? 1 : primary.strokeWidth <= 3 ? 2 : 4;
			this.addSeg<number>(
				"Толщина",
				wVal,
				[
					{ value: 1, title: "Тонкая", label: "S" },
					{ value: 2, title: "Средняя", label: "M" },
					{ value: 4, title: "Толстая", label: "L" }
				],
				(strokeWidth) => {
					this.api.updateSelected(
						(el) => {
							if (!el.containerId) el.strokeWidth = strokeWidth;
						},
						(st) => {
							st.strokeWidth = strokeWidth;
						}
					);
				}
			);

			this.addSeg<SceneElement["strokeStyle"]>(
				"Стиль линии",
				primary.strokeStyle,
				[
					{ value: "solid", title: "Сплошная", label: "—" },
					{ value: "dashed", title: "Штрих", label: "- -" },
					{ value: "dotted", title: "Точки", label: "···" }
				],
				(strokeStyle) => {
					this.api.updateSelected(
						(el) => {
							if (!el.containerId) el.strokeStyle = strokeStyle;
						},
						(st) => {
							st.strokeStyle = strokeStyle;
						}
					);
				}
			);

			const rVal = primary.roughness <= 0.2 ? 0 : primary.roughness <= 1.3 ? 1 : 2;
			this.addSeg<number>(
				"Рисовка",
				rVal,
				[
					{ value: 0, title: "Чёткая", path: "M3 14L17 6" },
					{ value: 1, title: "От руки", path: "M3 13C7 8 13 12 17 7" },
					{ value: 2, title: "Эскиз", path: "M3 12C7 6 13 14 17 6 M3 15C8 9 12 16 17 9" }
				],
				(roughness) => {
					this.api.updateSelected(
						(el) => {
							if (!el.containerId) el.roughness = roughness;
						},
						(st) => {
							st.roughness = roughness;
						}
					);
				}
			);
		}

		if (hasRound) {
			const radVal = primary.roundness <= 2 ? 0 : primary.roundness <= 12 ? 8 : 20;
			this.addSeg<number>(
				"Углы",
				radVal,
				[
					{ value: 0, title: "Острые", path: "M5 15V5h10" },
					{ value: 8, title: "Мягкие", path: "M5 15V9a4 4 0 0 1 4-4h6" },
					{ value: 20, title: "Скруглённые", path: "M5 15V13a8 8 0 0 1 8-8h2" }
				],
				(roundness) => {
					this.api.updateSelected(
						(el) => {
							if (!el.containerId) el.roundness = roundness;
						},
						(st) => {
							st.roundness = roundness;
						}
					);
				}
			);
		}

		// 4. Стрелки и линии
		if (hasPath) {
			const route: "straight" | "curved" | "elbowed" = primary.curved ? "curved" : primary.elbowed ? "elbowed" : "straight";
			this.addSeg<"straight" | "curved" | "elbowed">(
				"Траектория",
				route,
				[
					{ value: "straight", title: "Прямая", path: "M4 15L16 5" },
					{ value: "curved", title: "Дуга", path: "M4 15C5 6 15 14 16 5" },
					{ value: "elbowed", title: "90°", path: "M4 15h6V5h6" }
				],
				(mode) => {
					this.api.updateSelected(
						(el) => {
							el.curved = mode === "curved";
							el.elbowed = mode === "elbowed";
						},
						(st) => {
							st.curved = mode === "curved";
							st.elbowed = mode === "elbowed";
						}
					);
				}
			);
		}

		if (hasArrowheads) {
			const heads: Array<{ value: ArrowheadType; title: string; label: string }> = [
				{ value: "none", title: "Нет", label: "—" },
				{ value: "arrow", title: "Стрелка", label: "→" },
				{ value: "triangle", title: "Треугольник", label: "▶" },
				{ value: "circle", title: "Точка", label: "●" },
				{ value: "bar", title: "Засечка", label: "⊣" }
			];
			this.addSeg<ArrowheadType>("Начало", primary.startArrowhead ?? "none", heads, (h) => {
				this.api.updateSelected(
					(el) => {
						el.startArrowhead = h;
					},
					(st) => {
						st.startArrowhead = h;
					}
				);
			});
			this.addSeg<ArrowheadType>("Конец", primary.endArrowhead ?? "arrow", heads, (h) => {
				this.api.updateSelected(
					(el) => {
						el.endArrowhead = h;
					},
					(st) => {
						st.endArrowhead = h;
					}
				);
			});
		}

		// 5. Типографика (3 шрифта + S/M/L/XL + выравнивание)
		if (hasText) {
			this.addSeg<FontFamilyType>(
				"Шрифт",
				textSample.fontFamily,
				[
					{ value: "normal", title: "Обычный", label: "Аа" },
					{ value: "hand", title: "Рукописный", label: "✍️" },
					{ value: "mono", title: "Моноширинный", label: "{}" }
				],
				(fontFamily) => {
					this.api.updateSelected(
						(el) => {
							el.fontFamily = fontFamily;
						},
						(st) => {
							st.fontFamily = fontFamily;
						}
					);
				}
			);

			const fSize = textSample.fontSize <= 17 ? 16 : textSample.fontSize <= 24 ? 20 : textSample.fontSize <= 32 ? 28 : 36;
			this.addSeg<number>(
				"Размер",
				fSize,
				[
					{ value: 16, title: "16 px", label: "S" },
					{ value: 20, title: "20 px", label: "M" },
					{ value: 28, title: "28 px", label: "L" },
					{ value: 36, title: "36 px", label: "XL" }
				],
				(fontSize) => {
					this.api.updateSelected(
						(el) => {
							el.fontSize = fontSize;
						},
						(st) => {
							st.fontSize = fontSize;
						}
					);
				}
			);

			this.addSeg<TextAlignType>(
				"Выравнивание",
				textSample.textAlign,
				[
					{ value: "left", title: "Слева", icon: "align-left" },
					{ value: "center", title: "По центру", icon: "align-center" },
					{ value: "right", title: "Справа", icon: "align-right" }
				],
				(textAlign) => {
					this.api.updateSelected(
						(el) => {
							el.textAlign = textAlign;
						},
						(st) => {
							st.textAlign = textAlign;
						}
					);
				}
			);
		}

		// 6. Прозрачность
		this.addOpacityRow(primary.opacity);
	}

private getTitle(type: SceneElement["type"]): string {
		const map: Record<SceneElement["type"], string> = {
			rectangle: "Прямоугольник",
			diamond: "Ромб",
			ellipse: "Эллипс",
			arrow: "Стрелка",
			line: "Линия",
			text: "Текст",
			image: "Картинка"
		};
		return map[type];
	}

	private createSection(label: string): HTMLDivElement {
		const sec = this.doc.createElement("div");
		sec.className = "hub3d-insp-prop-sec";
		const lbl = this.doc.createElement("div");
		lbl.className = "hub3d-insp-prop-lbl";
		lbl.textContent = label;
		sec.appendChild(lbl);
		this.panelEl.appendChild(sec);
		return sec;
	}

	private addStrokeSwatches(label: string, current: string, onSelect: (c: string) => void): void {
		const sec = this.createSection(label);
		const grid = this.doc.createElement("div");
		grid.className = "hub3d-insp-swatch-grid";
const palette = Array.from(new Set([this.api.accentColor, ...STROKE_SWATCHES])).slice(0, 5);
		const norm = current.trim().toLowerCase();

		for (const c of palette) {
			const btn = this.doc.createElement("button");
			btn.type = "button";
			btn.className = "hub3d-insp-swatch" + (c.toLowerCase() === norm ? " is-active" : "");
			btn.style.setProperty("--sw-color", c);
			btn.style.backgroundColor = c;
			btn.addEventListener("click", () => onSelect(c));
			grid.appendChild(btn);
		}

		const picker = this.doc.createElement("label");
		picker.className = "hub3d-insp-swatch is-picker";
		picker.style.setProperty("--sw-color", normalizeHex(current));
		const input = this.doc.createElement("input");
		input.type = "color";
		input.value = normalizeHex(current);
		input.addEventListener("change", () => onSelect(input.value));
		picker.appendChild(input);
		grid.appendChild(picker);
		sec.appendChild(grid);
	}

	private addBgSwatches(current: string, onSelect: (c: string) => void): void {
		const sec = this.createSection("Фон");
		const grid = this.doc.createElement("div");
		grid.className = "hub3d-insp-swatch-grid";
		const norm = (current || "transparent").trim().toLowerCase();

for (const item of BG_SWATCHES.slice(0, 5)) {
			const btn = this.doc.createElement("button");
			btn.type = "button";
			btn.className =
				"hub3d-insp-swatch" +
				(item.value === "transparent" ? " is-transparent" : "") +
				(item.value.toLowerCase() === norm ? " is-active" : "");
			if (item.value !== "transparent") {
				btn.style.setProperty("--sw-color", item.preview);
				btn.style.backgroundColor = item.preview;
			}
			btn.addEventListener("click", () => onSelect(item.value));
			grid.appendChild(btn);
		}

		const picker = this.doc.createElement("label");
		picker.className = "hub3d-insp-swatch is-picker";
		picker.style.setProperty("--sw-color", normalizeHex(current));
		const input = this.doc.createElement("input");
		input.type = "color";
		input.value = normalizeHex(current);
		input.addEventListener("change", () => onSelect(hexToRgba(input.value, 0.22)));
		picker.appendChild(input);
		grid.appendChild(picker);
		sec.appendChild(grid);
	}

	private addSeg<T extends string | number>(
		label: string,
		active: T,
		opts: Array<{ value: T; title: string; label?: string; icon?: string; path?: string; fill?: string }>,
		onSelect: (v: T) => void
	): void {
		const sec = this.createSection(label);
		const grp = this.doc.createElement("div");
		grp.className = "hub3d-insp-seg-grp";

		for (const o of opts) {
			const btn = this.doc.createElement("button");
			btn.type = "button";
			btn.className = "hub3d-insp-seg-btn" + (o.value === active ? " is-active" : "");
			btn.title = o.title;

			if (o.icon) {
				setIcon(btn, o.icon);
			} else if (o.path) {
				const svg = this.doc.createElementNS(SVG_NS, "svg");
				svg.setAttribute("viewBox", "0 0 20 20");
				svg.setAttribute("class", "hub3d-insp-seg-svg");
				const p = this.doc.createElementNS(SVG_NS, "path");
				p.setAttribute("d", o.path);
				p.setAttribute("stroke", "currentColor");
				p.setAttribute("stroke-width", "1.7");
				p.setAttribute("stroke-linecap", "round");
				p.setAttribute("stroke-linejoin", "round");
				p.setAttribute("fill", o.fill ?? "none");
				svg.appendChild(p);
				btn.appendChild(svg);
			} else if (o.label) {
				btn.textContent = o.label;
			}

			btn.addEventListener("click", () => onSelect(o.value));
			grp.appendChild(btn);
		}
		sec.appendChild(grp);
	}

	private addOpacityRow(current: number): void {
		const sec = this.createSection("Прозрачность");
		const row = this.doc.createElement("div");
		row.className = "hub3d-insp-opacity-row";
		const slider = this.doc.createElement("input");
		slider.type = "range";
		slider.min = "10";
		slider.max = "100";
		slider.step = "5";
		const val = clamp(Math.round(current), 10, 100);
		slider.value = String(val);

		const badge = this.doc.createElement("span");
		badge.className = "hub3d-insp-opacity-val";
		badge.textContent = `${val}%`;

		slider.addEventListener("input", () => {
			const next = clamp(Number(slider.value), 10, 100);
			badge.textContent = `${next}%`;
			this.api.onOpacityInput(next);
		});
		slider.addEventListener("change", () => this.api.onOpacityCommit());

		row.append(slider, badge);
		sec.appendChild(row);
	}
}