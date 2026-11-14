import { ArrowheadType, FillStyle, SceneElement, ScenePoint, StrokeStyle } from "./sceneTypes";
import {
	TEXT_LINE_HEIGHT,
	clampFontSize,
	getContainerTextBox,
	getTextFont,
	getTextWrapWidth,
	isAutoSizeText,
	wrapMultilineText
} from "./text";

class SeededRandom {
	private state: number;
	constructor(seed: number) {
		this.state = seed || 1;
	}
	public next(): number {
		let t = (this.state += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	public offset(maxAmp: number): number {
		return (this.next() - 0.5) * 2 * maxAmp;
	}
}

function drawRoughLine(
	ctx: CanvasRenderingContext2D,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	roughness: number,
	rng: SeededRandom
): void {
	if (roughness <= 0.05) {
		ctx.moveTo(x1, y1);
		ctx.lineTo(x2, y2);
		return;
	}
	const len = Math.hypot(x2 - x1, y2 - y1);
	const amp = Math.min(roughness * 1.4, Math.max(0.6, len * 0.02));
	const midX = (x1 + x2) / 2;
	const midY = (y1 + y2) / 2;

	ctx.moveTo(x1 + rng.offset(amp * 0.5), y1 + rng.offset(amp * 0.5));
	ctx.quadraticCurveTo(midX + rng.offset(amp), midY + rng.offset(amp), x2 + rng.offset(amp * 0.5), y2 + rng.offset(amp * 0.5));
	ctx.moveTo(x1 + rng.offset(amp * 0.4), y1 + rng.offset(amp * 0.4));
	ctx.quadraticCurveTo(midX + rng.offset(amp * 0.8), midY + rng.offset(amp * 0.8), x2 + rng.offset(amp * 0.4), y2 + rng.offset(amp * 0.4));
}

const patternPathCache = new Map<string, Path2D>();

function getCachedHatchPath(
	w: number,
	h: number,
	fillStyle: FillStyle,
	strokeWidth: number,
	roughness: number,
	seed: number
): Path2D | null {
	if (typeof Path2D === "undefined") return null;
	const key = `${Math.round(w)}|${Math.round(h)}|${fillStyle}|${strokeWidth}|${roughness}|${seed}`;
	const existing = patternPathCache.get(key);
	if (existing) return existing;

	const path = new Path2D();
	const rng = new SeededRandom(seed + 101);
	const step = Math.max(6, 9 + strokeWidth * 1.2);
	const diag = Math.hypot(w, h);

	const addLines = (angleRad: number) => {
		const cos = Math.cos(angleRad);
		const sin = Math.sin(angleRad);
		const tx = (px: number, py: number) => px * cos - py * sin;
		const ty = (px: number, py: number) => px * sin + py * cos;

		for (let pos = -diag; pos <= diag; pos += step) {
			if (roughness > 0) {
				const amp = Math.min(roughness * 0.84, Math.max(0.4, diag * 0.03));
				const x1 = -diag + rng.offset(amp * 0.5);
				const y1 = pos + rng.offset(amp * 0.5);
				const mx = rng.offset(amp);
				const my = pos + rng.offset(amp);
				const x2 = diag + rng.offset(amp * 0.5);
				const y2 = pos + rng.offset(amp * 0.5);
				path.moveTo(tx(x1, y1), ty(x1, y1));
				path.quadraticCurveTo(tx(mx, my), ty(mx, my), tx(x2, y2), ty(x2, y2));
			} else {
				path.moveTo(tx(-diag, pos), ty(-diag, pos));
				path.lineTo(tx(diag, pos), ty(diag, pos));
			}
		}
	};

	addLines(-Math.PI / 4);
	if (fillStyle === "cross-hatch") addLines(Math.PI / 4);

	if (patternPathCache.size >= 400) patternPathCache.clear();
	patternPathCache.set(key, path);
	return path;
}

function renderPatternFill(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	fillStyle: FillStyle,
	color: string,
	strokeWidth: number,
	roughness: number,
	seed: number
): void {
	if (fillStyle === "none" || !color || color === "transparent") return;
	if (fillStyle === "solid") {
		ctx.fillStyle = color;
		ctx.fill();
		return;
	}
	const cached = getCachedHatchPath(w, h, fillStyle, strokeWidth, roughness, seed);
	if (!cached) return;

	ctx.save();
	ctx.clip();
	ctx.strokeStyle = color;
	ctx.lineWidth = Math.max(1, strokeWidth * 0.65);
	ctx.setLineDash([]);
	ctx.translate(x + w / 2, y + h / 2);
	ctx.stroke(cached);
	ctx.restore();
}

function applyStrokeDash(ctx: CanvasRenderingContext2D, style: StrokeStyle, strokeWidth: number): void {
	if (style === "dashed") ctx.setLineDash([strokeWidth * 3.5, strokeWidth * 2.2]);
	else if (style === "dotted") ctx.setLineDash([strokeWidth * 1.1, strokeWidth * 2]);
	else ctx.setLineDash([]);
}

function buildRoundedRectPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
): void {
	const radius = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.beginPath();
	if (radius <= 0.5) {
		ctx.rect(x, y, w, h);
		return;
	}
	ctx.roundRect(x, y, w, h, radius);
}

function drawArrowhead(
	ctx: CanvasRenderingContext2D,
	type: ArrowheadType | undefined,
	tipX: number,
	tipY: number,
	fromX: number,
	fromY: number,
	strokeColor: string,
	strokeWidth: number
): void {
	if (!type || type === "none") return;
	const angle = Math.atan2(tipY - fromY, tipX - fromX);
	const size = Math.max(9, strokeWidth * 3.6);

	ctx.save();
	ctx.translate(tipX, tipY);
	ctx.rotate(angle);
	ctx.setLineDash([]);
	ctx.strokeStyle = strokeColor;
	ctx.fillStyle = strokeColor;
	ctx.lineWidth = Math.max(1.5, strokeWidth);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	if (type === "arrow") {
		ctx.beginPath();
		ctx.moveTo(-size, -size * 0.55);
		ctx.lineTo(0, 0);
		ctx.lineTo(-size, size * 0.55);
		ctx.stroke();
	} else if (type === "triangle") {
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(-size, -size * 0.58);
		ctx.lineTo(-size, size * 0.58);
		ctx.closePath();
		ctx.fill();
	} else if (type === "circle") {
		const r = size * 0.42;
		ctx.beginPath();
		ctx.arc(-r, 0, r, 0, Math.PI * 2);
		ctx.fill();
	} else if (type === "diamond") {
		const d = size * 0.55;
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(-d, -d * 0.65);
		ctx.lineTo(-d * 2, 0);
		ctx.lineTo(-d, d * 0.65);
		ctx.closePath();
		ctx.fill();
	} else if (type === "bar") {
		ctx.beginPath();
		ctx.moveTo(-2, -size * 0.6);
		ctx.lineTo(-2, size * 0.6);
		ctx.stroke();
	}
	ctx.restore();
}

export function getElementWorldPoints(el: SceneElement): ScenePoint[] {
	if (!el.points || el.points.length === 0) {
		return [
			{ x: el.x, y: el.y },
			{ x: el.x + el.width, y: el.y + el.height }
		];
	}
	return el.points.map((p) => ({ x: el.x + p.x, y: el.y + p.y }));
}

export function getConnectorPolyline(el: SceneElement): ScenePoint[] {
	const points = getElementWorldPoints(el);
	if (points.length < 2) return points;

	if (el.curved) {
		if (points.length === 2) {
			const s = points[0]!;
			const e = points[1]!;
			const dx = e.x - s.x;
			const dy = e.y - s.y;
			const len = Math.max(1, Math.hypot(dx, dy));
			const off = Math.min(120, len * 0.2);
			const nx = -dy / len;
			const ny = dx / len;
			const c1 = { x: s.x + dx / 3 + nx * off, y: s.y + dy / 3 + ny * off };
			const c2 = { x: s.x + (dx * 2) / 3 + nx * off, y: s.y + (dy * 2) / 3 + ny * off };
			const out: ScenePoint[] = [s];
			for (let i = 1; i <= 24; i++) {
				const t = i / 24;
				const inv = 1 - t;
				out.push({
					x: inv ** 3 * s.x + 3 * inv ** 2 * t * c1.x + 3 * inv * t ** 2 * c2.x + t ** 3 * e.x,
					y: inv ** 3 * s.y + 3 * inv ** 2 * t * c1.y + 3 * inv * t ** 2 * c2.y + t ** 3 * e.y
				});
			}
			return out;
		}
		const out: ScenePoint[] = [points[0]!];
		let cursor = points[0]!;
		for (let i = 1; i < points.length - 1; i++) {
			const ctrl = points[i]!;
			const next = points[i + 1]!;
			const end = { x: (ctrl.x + next.x) / 2, y: (ctrl.y + next.y) / 2 };
			for (let step = 1; step <= 12; step++) {
				const t = step / 12;
				const inv = 1 - t;
				out.push({
					x: inv * inv * cursor.x + 2 * inv * t * ctrl.x + t * t * end.x,
					y: inv * inv * cursor.y + 2 * inv * t * ctrl.y + t * t * end.y
				});
			}
			cursor = end;
		}
		const last = points[points.length - 1]!;
		const prev = points[points.length - 2]!;
		for (let step = 1; step <= 12; step++) {
			const t = step / 12;
			const inv = 1 - t;
			out.push({
				x: inv * inv * cursor.x + 2 * inv * t * prev.x + t * t * last.x,
				y: inv * inv * cursor.y + 2 * inv * t * prev.y + t * t * last.y
			});
		}
		return out;
	}

	if (el.elbowed && points.length === 2) {
		const s = points[0]!;
		const e = points[1]!;
		const midX = (s.x + e.x) / 2;
		return [s, { x: midX, y: s.y }, { x: midX, y: e.y }, e];
	}
	return points;
}

function renderTextContent(
	ctx: CanvasRenderingContext2D,
	el: SceneElement,
	bx: number,
	by: number,
	bw: number,
	bh: number,
	textStr: string,
	colorOverride?: string
): void {
	if (!textStr) return;
	ctx.save();
	const fontPx = clampFontSize(el.fontSize || 20);
	const lineHeight = fontPx * TEXT_LINE_HEIGHT;
	ctx.font = getTextFont(fontPx, el.fontFamily);
	ctx.fillStyle = colorOverride || el.strokeColor || "#ffffff";
	ctx.textBaseline = "middle";

	const lines = isAutoSizeText(el)
		? textStr.split(/\r?\n/)
		: wrapMultilineText(ctx, textStr, getTextWrapWidth(bw));
	const totalH = lines.length * lineHeight;

	let startY = by;
	if (el.verticalAlign === "middle") startY = by + (bh - totalH) / 2;
	else if (el.verticalAlign === "bottom") startY = by + bh - totalH;

	let tx = bx;
	if (el.textAlign === "center") {
		ctx.textAlign = "center";
		tx = bx + bw / 2;
	} else if (el.textAlign === "right") {
		ctx.textAlign = "right";
		tx = bx + bw;
	} else {
		ctx.textAlign = "left";
	}

	for (let i = 0; i < lines.length; i++) {
		ctx.fillText(lines[i]!, tx, startY + i * lineHeight + lineHeight / 2);
	}
	ctx.restore();
}

export function renderSceneElement(
	ctx: CanvasRenderingContext2D,
	el: SceneElement,
	opts: { boundTextElement?: SceneElement | null; isEditingText?: boolean }
): void {
	if (el.isDeleted) return;

	ctx.save();
	ctx.globalAlpha = Math.max(0.05, Math.min(1, (el.opacity ?? 100) / 100));

	const cx = el.x + el.width / 2;
	const cy = el.y + el.height / 2;
	if (el.angle) {
		ctx.translate(cx, cy);
		ctx.rotate(el.angle);
		ctx.translate(-cx, -cy);
	}

	const rng = new SeededRandom(el.seed ?? 1);
	ctx.strokeStyle = el.strokeColor || "#9c83e8";
	ctx.lineWidth = Math.max(1, el.strokeWidth || 2);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	applyStrokeDash(ctx, el.strokeStyle, ctx.lineWidth);

	if (el.type === "rectangle") {
		const r = el.roundness ?? 0;
		buildRoundedRectPath(ctx, el.x, el.y, el.width, el.height, r);
		renderPatternFill(ctx, el.x, el.y, el.width, el.height, el.fillStyle, el.backgroundColor, el.strokeWidth, el.roughness, el.seed ?? 1);

		if (el.roughness > 0 && r <= 2) {
			ctx.beginPath();
			drawRoughLine(ctx, el.x, el.y, el.x + el.width, el.y, el.roughness, rng);
			drawRoughLine(ctx, el.x + el.width, el.y, el.x + el.width, el.y + el.height, el.roughness, rng);
			drawRoughLine(ctx, el.x + el.width, el.y + el.height, el.x, el.y + el.height, el.roughness, rng);
			drawRoughLine(ctx, el.x, el.y + el.height, el.x, el.y, el.roughness, rng);
			ctx.stroke();
		} else {
			buildRoundedRectPath(ctx, el.x, el.y, el.width, el.height, r);
			ctx.stroke();
		}
	} else if (el.type === "diamond") {
		const top = { x: cx, y: el.y };
		const right = { x: el.x + el.width, y: cy };
		const bottom = { x: cx, y: el.y + el.height };
		const left = { x: el.x, y: cy };

		ctx.beginPath();
		ctx.moveTo(top.x, top.y);
		ctx.lineTo(right.x, right.y);
		ctx.lineTo(bottom.x, bottom.y);
		ctx.lineTo(left.x, left.y);
		ctx.closePath();

		renderPatternFill(ctx, el.x, el.y, el.width, el.height, el.fillStyle, el.backgroundColor, el.strokeWidth, el.roughness, el.seed ?? 1);

		if (el.roughness > 0) {
			ctx.beginPath();
			drawRoughLine(ctx, top.x, top.y, right.x, right.y, el.roughness, rng);
			drawRoughLine(ctx, right.x, right.y, bottom.x, bottom.y, el.roughness, rng);
			drawRoughLine(ctx, bottom.x, bottom.y, left.x, left.y, el.roughness, rng);
			drawRoughLine(ctx, left.x, left.y, top.x, top.y, el.roughness, rng);
			ctx.stroke();
		} else {
			ctx.stroke();
		}
	} else if (el.type === "ellipse") {
		const rx = Math.max(1, el.width / 2);
		const ry = Math.max(1, el.height / 2);
		ctx.beginPath();
		ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
		renderPatternFill(ctx, el.x, el.y, el.width, el.height, el.fillStyle, el.backgroundColor, el.strokeWidth, el.roughness, el.seed ?? 1);

		ctx.beginPath();
		ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
		ctx.stroke();
		if (el.roughness > 0) {
			const off = el.roughness * 1.1;
			ctx.beginPath();
			ctx.ellipse(cx + rng.offset(off), cy + rng.offset(off), Math.max(1, rx + rng.offset(off)), Math.max(1, ry + rng.offset(off)), rng.offset(0.04), 0, Math.PI * 2);
			ctx.stroke();
		}
	} else if (el.type === "arrow" || el.type === "line") {
		const pts = getConnectorPolyline(el);
		if (pts.length >= 2) {
			ctx.beginPath();
			if (el.roughness > 0) {
				for (let i = 0; i < pts.length - 1; i++) {
					drawRoughLine(ctx, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y, el.roughness, rng);
				}
				ctx.stroke();
			} else {
				ctx.moveTo(pts[0]!.x, pts[0]!.y);
				for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
				ctx.stroke();
			}
			if (el.type === "arrow") {
				const first = pts[0]!;
				const second = pts[1]!;
				const last = pts[pts.length - 1]!;
				const beforeLast = pts[pts.length - 2]!;
				drawArrowhead(ctx, el.startArrowhead, first.x, first.y, second.x, second.y, el.strokeColor, el.strokeWidth);
				drawArrowhead(ctx, el.endArrowhead ?? "arrow", last.x, last.y, beforeLast.x, beforeLast.y, el.strokeColor, el.strokeWidth);
			}
		}
	} else if (el.type === "text" && !el.containerId && !opts.isEditingText) {
		renderTextContent(ctx, el, el.x, el.y, el.width, el.height, el.text ?? "", el.strokeColor || "#ffffff");
	}

	if ((el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse") && !opts.isEditingText) {
		const textSource = opts.boundTextElement ?? (el.text ? el : null);
		if (textSource?.text) {
			const box = getContainerTextBox(el);
			renderTextContent(ctx, textSource, box.x, box.y, box.width, box.height, textSource.text, textSource.strokeColor || "#ffffff");
		}
	}

	ctx.restore();
}