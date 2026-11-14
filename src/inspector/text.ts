import { FontFamilyType, SceneElement, TextAlignType } from "./sceneTypes";

export const TEXT_LINE_HEIGHT = 1.3;
export const TEXT_FONT_WEIGHT = 500;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 300;
export const MIN_TEXT_WRAP_WIDTH = 24;
export const CONTAINER_TEXT_PADDING = 12;

export const FONT_SIZE_PRESETS = { S: 16, M: 20, L: 28, XL: 36 } as const;

export function clampFontSize(size: number): number {
	if (!Number.isFinite(size)) return FONT_SIZE_PRESETS.M;
	return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
}

export function getCanvasFontFamily(family: FontFamilyType): string {
	switch (family) {
		case "hand":
			return '"Virgil", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive, sans-serif';
		case "mono":
			return '"JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, monospace';
		default:
			return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif';
	}
}

export function getTextFont(fontSize: number, family: FontFamilyType): string {
	return `${TEXT_FONT_WEIGHT} ${clampFontSize(fontSize)}px ${getCanvasFontFamily(family)}`;
}

export function isAutoSizeText(el: SceneElement): boolean {
	return el.type === "text" && !el.containerId && el.autoResize === true;
}

export function getTextWrapWidth(width: number): number {
	return Math.max(MIN_TEXT_WRAP_WIDTH, width);
}

export function wrapMultilineText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number
): string[] {
	const rawLines = text.split(/\r?\n/);
	const out: string[] = [];
	if (maxWidth <= 20) return rawLines;

	for (const paragraph of rawLines) {
		if (!paragraph) {
			out.push("");
			continue;
		}
		const words = paragraph.split(/\s+/);
		let currentLine = "";

		for (const word of words) {
			const candidate = currentLine ? `${currentLine} ${word}` : word;
			if (ctx.measureText(candidate).width <= maxWidth) {
				currentLine = candidate;
			} else {
				if (currentLine) out.push(currentLine);
				if (ctx.measureText(word).width > maxWidth) {
					let chunk = "";
					for (const ch of Array.from(word)) {
						if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
							out.push(chunk);
							chunk = ch;
						} else {
							chunk += ch;
						}
					}
					currentLine = chunk;
				} else {
					currentLine = word;
				}
			}
		}
		if (currentLine) out.push(currentLine);
	}
	return out.length > 0 ? out : [""];
}

export interface TextBlockMetrics {
	lines: string[];
	width: number;
	height: number;
	lineHeight: number;
	fontSize: number;
}

export function measureTextBlock(
	ctx: CanvasRenderingContext2D,
	text: string,
	fontSize: number,
	family: FontFamilyType,
	wrapWidth: number | null = null
): TextBlockMetrics {
	const size = clampFontSize(fontSize);
	ctx.font = getTextFont(size, family);
	const lines =
		wrapWidth === null
			? text.split(/\r?\n/)
			: wrapMultilineText(ctx, text, getTextWrapWidth(wrapWidth));
	let longest = 0;
	for (const line of lines) {
		longest = Math.max(longest, ctx.measureText(line).width);
	}
	const lineHeight = size * TEXT_LINE_HEIGHT;
	return {
		lines,
		width: wrapWidth === null ? longest : getTextWrapWidth(wrapWidth),
		height: lines.length * lineHeight,
		lineHeight,
		fontSize: size
	};
}

const measureContexts = new WeakMap<Document, CanvasRenderingContext2D | null>();

export function getMeasureContext(doc: Document): CanvasRenderingContext2D | null {
	if (measureContexts.has(doc)) return measureContexts.get(doc) ?? null;
	const ctx = doc.createElement("canvas").getContext("2d");
	measureContexts.set(doc, ctx);
	return ctx;
}

export interface TextAnchor {
	left: number;
	center: number;
	right: number;
}

export function getTextAnchor(el: Pick<SceneElement, "x" | "width">): TextAnchor {
	return { left: el.x, center: el.x + el.width / 2, right: el.x + el.width };
}

export function getAnchoredTextX(anchor: TextAnchor, align: TextAlignType, width: number): number {
	if (align === "center") return anchor.center - width / 2;
	if (align === "right") return anchor.right - width;
	return anchor.left;
}

export function fitTextElementToContent(
	ctx: CanvasRenderingContext2D,
	el: SceneElement,
	anchor?: TextAnchor
): void {
	if (el.type !== "text" || el.containerId) return;
	const fixedWidth = el.autoResize === true ? null : getTextWrapWidth(el.width);
	const metrics = measureTextBlock(ctx, el.text ?? "", el.fontSize, el.fontFamily, fixedWidth);
	if (fixedWidth === null && anchor) {
		el.x = getAnchoredTextX(anchor, el.textAlign, metrics.width);
	}
	el.width = metrics.width;
	el.height = metrics.height;
}

export function getContainerTextBox(
	container: Pick<SceneElement, "type" | "x" | "y" | "width" | "height">
): { x: number; y: number; width: number; height: number } {
	const pad = container.type === "diamond" ? Math.min(24, container.width * 0.18) : CONTAINER_TEXT_PADDING;
	return {
		x: container.x + pad,
		y: container.y + pad,
		width: Math.max(20, container.width - pad * 2),
		height: Math.max(20, container.height - pad * 2)
	};
}

export interface TextEditorLayout {
	left: number;
	top: number;
	width: number;
	height: number;
	fontSize: number;
	wrap: boolean;
	angle: number;
	originX?: number;
	originY?: number;
}

export type TextEditorCloseReason = "keyboard" | "blur" | "api";

export interface TextEditorOptions {
	initialText: string;
	fontFamily: FontFamilyType;
	textAlign: TextAlignType;
	color: string;
	computeLayout: (value: string) => TextEditorLayout | null;
	onCommit: (value: string, reason: TextEditorCloseReason) => void;
	onWheel?: (event: WheelEvent) => void;
}

const CARET_SLACK_PX = 2;
const ARM_DELAY_MS = 80;

export class CanvasTextEditor {
	private readonly host: HTMLElement;
	private textarea: HTMLTextAreaElement | null = null;
	private options: TextEditorOptions | null = null;
	private armTimer: number | null = null;
	private armed = false;

	constructor(host: HTMLElement) {
		this.host = host;
	}

	private get win(): Window & typeof globalThis {
		const win = this.host.ownerDocument.defaultView;
		if (!win) throw new Error("Не удалось определить окно редактора текста");
		return win;
	}

	public open(options: TextEditorOptions): HTMLTextAreaElement {
		this.finish(true, "api");
		const doc = this.host.ownerDocument;
		const textarea = doc.createElement("textarea");
		textarea.className = "hub3d-insp-text-overlay";
		textarea.value = options.initialText;
		textarea.rows = 1;
		textarea.spellcheck = false;

		const style = textarea.style;
		style.fontFamily = getCanvasFontFamily(options.fontFamily);
		style.fontWeight = String(TEXT_FONT_WEIGHT);
		style.lineHeight = String(TEXT_LINE_HEIGHT);
		style.textAlign = options.textAlign;
		style.color = options.color;
		style.caretColor = options.color;

		this.textarea = textarea;
		this.options = options;
		this.armed = false;

		textarea.addEventListener("keydown", this.onKeyDown);
		textarea.addEventListener("blur", this.onBlur);
		textarea.addEventListener("input", this.onInput);
		textarea.addEventListener("wheel", this.onWheel, { passive: false });
		this.host.appendChild(textarea);
		this.applyLayout();
		textarea.focus({ preventScroll: true });
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);

		this.armTimer = this.win.setTimeout(() => {
			this.armTimer = null;
			if (this.textarea !== textarea) return;
			this.armed = true;
			if (doc.activeElement !== textarea) textarea.focus({ preventScroll: true });
		}, ARM_DELAY_MS);

		return textarea;
	}

	public isOpen(): boolean {
		return this.textarea !== null;
	}

	public reposition(): void {
		this.applyLayout();
	}

	public close(commit: boolean): void {
		this.finish(commit, "api");
	}

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (event.isComposing) return;
		const commit =
			event.key === "Escape" ||
			(event.key === "Enter" && (event.ctrlKey || event.metaKey));
		if (!commit) return;
		event.preventDefault();
		event.stopPropagation();
		this.finish(true, "keyboard");
	};

	private readonly onBlur = (): void => {
		const textarea = this.textarea;
		if (!textarea) return;
		if (!this.armed) {
			this.win.setTimeout(() => {
				if (this.textarea === textarea) textarea.focus({ preventScroll: true });
			}, 0);
			return;
		}
		this.finish(true, "blur");
	};

	private readonly onInput = (): void => {
		this.applyLayout();
	};

	private readonly onWheel = (event: WheelEvent): void => {
		this.options?.onWheel?.(event);
	};

	private applyLayout(): void {
		const textarea = this.textarea;
		const options = this.options;
		if (!textarea || !options) return;
		const layout = options.computeLayout(textarea.value);
		if (!layout) return;

		const slack = layout.wrap ? 0 : CARET_SLACK_PX;
		const shift =
			options.textAlign === "right" ? slack : options.textAlign === "center" ? slack / 2 : 0;

		const style = textarea.style;
		style.left = `${layout.left - shift}px`;
		style.top = `${layout.top}px`;
		style.width = `${Math.max(1, layout.width + slack)}px`;
		style.height = `${Math.max(1, layout.height)}px`;
		style.fontSize = `${layout.fontSize}px`;
		style.whiteSpace = layout.wrap ? "pre-wrap" : "pre";
		style.overflowWrap = layout.wrap ? "break-word" : "normal";
		style.transformOrigin =
			layout.originX !== undefined && layout.originY !== undefined
				? `${layout.originX + shift}px ${layout.originY}px`
				: "50% 50%";
		style.transform = layout.angle ? `rotate(${layout.angle}rad)` : "";
		textarea.setAttribute("wrap", layout.wrap ? "soft" : "off");
	}

	private finish(commit: boolean, reason: TextEditorCloseReason): void {
		const textarea = this.textarea;
		const options = this.options;
		if (!textarea || !options) return;
		const value = textarea.value;
		this.detach();
		if (commit) options.onCommit(value, reason);
	}

	private detach(): void {
		const textarea = this.textarea;
		if (!textarea) return;
		textarea.removeEventListener("keydown", this.onKeyDown);
		textarea.removeEventListener("blur", this.onBlur);
		textarea.removeEventListener("input", this.onInput);
		textarea.removeEventListener("wheel", this.onWheel);
		if (this.armTimer !== null) {
			this.win.clearTimeout(this.armTimer);
			this.armTimer = null;
		}
		textarea.remove();
		this.textarea = null;
		this.options = null;
		this.armed = false;
	}
}