import {
	AABB,
	CanvasToolId,
	ElementBinding,
	ElementStyleDefaults,
	HandleDescriptor,
	HandleKind,
	SceneElement,
	SceneElementType,
	ScenePoint,
	SnapGuideLine,
	hashStringSeed,
	generateElementId
} from "./sceneTypes";
import { getConnectorPolyline, getElementWorldPoints } from "./shapes";
import {
	MIN_TEXT_WRAP_WIDTH,
	TEXT_LINE_HEIGHT,
	clampFontSize,
	getContainerTextBox,
	getTextWrapWidth,
	measureTextBlock
} from "./text";

export const ROTATE_HANDLE_OFFSET_PX = 26;
export const HANDLE_HIT_RADIUS_PX = 8;
export const MIN_RESIZE_SIZE = 4;
export const BINDING_SNAP_DISTANCE = 24;
export const OBJECT_SNAP_THRESHOLD = 6;

export type ResizeHandleKind = Extract<HandleKind, "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w">;

const RESIZE_HANDLES: ReadonlySet<string> = new Set(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);

export function isResizeHandle(kind: HandleKind): kind is ResizeHandleKind {
	return RESIZE_HANDLES.has(kind);
}

export function rotatePoint(px: number, py: number, cx: number, cy: number, angleRad: number): ScenePoint {
	if (!angleRad) return { x: px, y: py };
	const cos = Math.cos(angleRad);
	const sin = Math.sin(angleRad);
	const dx = px - cx;
	const dy = py - cy;
	return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

export function unrotatePoint(px: number, py: number, cx: number, cy: number, angleRad: number): ScenePoint {
	return rotatePoint(px, py, cx, cy, -angleRad);
}

export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
	const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
	if (l2 === 0) return Math.hypot(px - x1, py - y1);
	let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

export function isPathElement(el: SceneElement): boolean {
	return el.type === "arrow" || el.type === "line";
}

export function normalizeElementBounds(el: SceneElement): void {
	if (!el.points || el.points.length === 0) return;
	const worldPoints = getElementWorldPoints(el);
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of worldPoints) {
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
	el.points = worldPoints.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

export function getElementAABB(el: SceneElement): AABB {
	if (isPathElement(el) && el.points && el.points.length > 0) {
		const points = getConnectorPolyline(el);
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const pt of points) {
			if (pt.x < minX) minX = pt.x;
			if (pt.y < minY) minY = pt.y;
			if (pt.x > maxX) maxX = pt.x;
			if (pt.y > maxY) maxY = pt.y;
		}
		if (!Number.isFinite(minX)) {
			minX = el.x;
			minY = el.y;
			maxX = el.x + el.width;
			maxY = el.y + el.height;
		}
		const w = Math.max(1, maxX - minX);
		const h = Math.max(1, maxY - minY);
		return { minX, minY, maxX, maxY, width: w, height: h, cx: minX + w / 2, cy: minY + h / 2 };
	}

	const cx = el.x + el.width / 2;
	const cy = el.y + el.height / 2;
	if (!el.angle) {
		return {
			minX: el.x,
			minY: el.y,
			maxX: el.x + el.width,
			maxY: el.y + el.height,
			width: el.width,
			height: el.height,
			cx,
			cy
		};
	}

	const corners = [
		rotatePoint(el.x, el.y, cx, cy, el.angle),
		rotatePoint(el.x + el.width, el.y, cx, cy, el.angle),
		rotatePoint(el.x + el.width, el.y + el.height, cx, cy, el.angle),
		rotatePoint(el.x, el.y + el.height, cx, cy, el.angle)
	];
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const c of corners) {
		if (c.x < minX) minX = c.x;
		if (c.y < minY) minY = c.y;
		if (c.x > maxX) maxX = c.x;
		if (c.y > maxY) maxY = c.y;
	}
	return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, cx, cy };
}

export function getSelectionAABB(elements: readonly SceneElement[]): AABB | null {
	if (elements.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const el of elements) {
		const b = getElementAABB(el);
		if (b.minX < minX) minX = b.minX;
		if (b.minY < minY) minY = b.minY;
		if (b.maxX > maxX) maxX = b.maxX;
		if (b.maxY > maxY) maxY = b.maxY;
	}
	if (!Number.isFinite(minX)) return null;
	const width = Math.max(1, maxX - minX);
	const height = Math.max(1, maxY - minY);
	return { minX, minY, maxX, maxY, width, height, cx: minX + width / 2, cy: minY + height / 2 };
}

function isTransparentColor(color: string | null | undefined): boolean {
	if (!color) return true;
	const v = color.trim().toLowerCase();
	return v === "" || v === "transparent" || v === "none";
}

function hasVisibleFill(el: SceneElement): boolean {
	return el.fillStyle !== "none" && !isTransparentColor(el.backgroundColor);
}

function isOutlineOnlyShape(el: SceneElement): boolean {
	return (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") && !hasVisibleFill(el);
}

function isInsideShape(el: SceneElement, local: ScenePoint, margin: number): boolean {
	const halfW = el.width / 2 + margin;
	const halfH = el.height / 2 + margin;
	if (halfW <= 0 || halfH <= 0) return false;
	const dx = local.x - (el.x + el.width / 2);
	const dy = local.y - (el.y + el.height / 2);
	if (el.type === "ellipse") return (dx * dx) / (halfW * halfW) + (dy * dy) / (halfH * halfH) <= 1;
	if (el.type === "diamond") return Math.abs(dx) / halfW + Math.abs(dy) / halfH <= 1;
	return Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;
}

function hitTestSolid(el: SceneElement, pt: ScenePoint, zoom: number): boolean {
	if (el.isDeleted) return false;
	const threshold = el.strokeWidth / 2 + 6 / Math.max(0.1, zoom);
	if (isPathElement(el)) {
		const pts = getConnectorPolyline(el);
		for (let i = 0; i < pts.length - 1; i++) {
			const p1 = pts[i]!;
			const p2 = pts[i + 1]!;
			if (distanceToSegment(pt.x, pt.y, p1.x, p1.y, p2.x, p2.y) <= threshold) return true;
		}
		return false;
	}
	const local = unrotatePoint(pt.x, pt.y, el.x + el.width / 2, el.y + el.height / 2, el.angle || 0);
	if (isOutlineOnlyShape(el)) {
		return isInsideShape(el, local, threshold) && !isInsideShape(el, local, -threshold);
	}
	return isInsideShape(el, local, threshold);
}

export function getElementAtPoint(
	elements: readonly SceneElement[],
	pt: ScenePoint,
	zoom = 1,
	includeEmptyInterior = true
): SceneElement | null {
	for (let i = elements.length - 1; i >= 0; i--) {
		const el = elements[i]!;
		if (el.isDeleted || el.containerId) continue;
		if (hitTestSolid(el, pt, zoom)) return el;
	}
	if (!includeEmptyInterior) return null;
	for (let i = elements.length - 1; i >= 0; i--) {
		const el = elements[i]!;
		if (el.isDeleted || el.containerId || !isOutlineOnlyShape(el)) continue;
		const local = unrotatePoint(pt.x, pt.y, el.x + el.width / 2, el.y + el.height / 2, el.angle || 0);
		if (isInsideShape(el, local, el.strokeWidth / 2 + 6 / Math.max(0.1, zoom))) return el;
	}
	return null;
}

export function getSelectionFrameElements(selected: readonly SceneElement[]): SceneElement[] {
	const ids = new Set(selected.map((el) => el.id));
	return selected.filter((el) => !(el.containerId && ids.has(el.containerId)));
}

export function getTransformHandles(selectedElements: readonly SceneElement[], zoom = 1): HandleDescriptor[] {
	const targets = getSelectionFrameElements(selectedElements);
	if (targets.length === 0) return [];

	if (targets.length === 1) {
		const el = targets[0]!;
		if (el.locked) return [];
		if (isPathElement(el)) {
			const pts = getElementWorldPoints(el);
			const handles: HandleDescriptor[] = [];
			for (let i = 0; i < pts.length; i++) {
				handles.push({ kind: "point", x: pts[i]!.x, y: pts[i]!.y, pointIndex: i, elementId: el.id });
				if (i < pts.length - 1) {
					const next = pts[i + 1]!;
					handles.push({
						kind: "midpoint",
						x: (pts[i]!.x + next.x) / 2,
						y: (pts[i]!.y + next.y) / 2,
						pointIndex: i + 1,
						elementId: el.id
					});
				}
			}
			return handles;
		}
		const cx = el.x + el.width / 2;
		const cy = el.y + el.height / 2;
		const angle = el.angle || 0;
		const rotOffset = ROTATE_HANDLE_OFFSET_PX / Math.max(0.1, zoom);
		const raw: Array<{ kind: HandleKind; x: number; y: number }> = [
			{ kind: "nw", x: el.x, y: el.y },
			{ kind: "n", x: cx, y: el.y },
			{ kind: "ne", x: el.x + el.width, y: el.y },
			{ kind: "e", x: el.x + el.width, y: cy },
			{ kind: "se", x: el.x + el.width, y: el.y + el.height },
			{ kind: "s", x: cx, y: el.y + el.height },
			{ kind: "sw", x: el.x, y: el.y + el.height },
			{ kind: "w", x: el.x, y: cy },
			{ kind: "rotate", x: cx, y: el.y - rotOffset }
		];
		return raw.map((h) => {
			const r = rotatePoint(h.x, h.y, cx, cy, angle);
			return { kind: h.kind, x: r.x, y: r.y, elementId: el.id };
		});
	}

	const box = getSelectionAABB(targets);
	if (!box) return [];
	const rotOffset = ROTATE_HANDLE_OFFSET_PX / Math.max(0.1, zoom);
	return [
		{ kind: "nw", x: box.minX, y: box.minY },
		{ kind: "n", x: box.cx, y: box.minY },
		{ kind: "ne", x: box.maxX, y: box.minY },
		{ kind: "e", x: box.maxX, y: box.cy },
		{ kind: "se", x: box.maxX, y: box.maxY },
		{ kind: "s", x: box.cx, y: box.maxY },
		{ kind: "sw", x: box.minX, y: box.maxY },
		{ kind: "w", x: box.minX, y: box.cy },
		{ kind: "rotate", x: box.cx, y: box.minY - rotOffset }
	];
}

export function hitTestHandles(handles: readonly HandleDescriptor[], pt: ScenePoint, zoom = 1): HandleDescriptor | null {
	const radius = (HANDLE_HIT_RADIUS_PX + 2) / Math.max(0.1, zoom);
	let best: HandleDescriptor | null = null;
	let bestDist = Infinity;
	for (const handle of handles) {
		const dist = Math.hypot(pt.x - handle.x, pt.y - handle.y);
		if (dist <= radius && dist < bestDist) {
			best = handle;
			bestDist = dist;
		}
	}
	return best;
}

export interface ResizeBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function placeBox(
	start: ResizeBox,
	angle: number,
	left: number,
	top: number,
	width: number,
	height: number
): ResizeBox {
	const center = rotatePoint(
		left + width / 2,
		top + height / 2,
		start.x + start.width / 2,
		start.y + start.height / 2,
		angle
	);
	return { x: center.x - width / 2, y: center.y - height / 2, width, height };
}

export function resizeBoxFromHandle(
	start: ResizeBox,
	angle: number,
	handle: ResizeHandleKind,
	pointer: ScenePoint,
	options: { keepRatio?: boolean; minSize?: number } = {}
): ResizeBox {
	const minSize = options.minSize ?? MIN_RESIZE_SIZE;
	const startCx = start.x + start.width / 2;
	const startCy = start.y + start.height / 2;
	const local = unrotatePoint(pointer.x, pointer.y, startCx, startCy, angle);

	let left = start.x;
	let right = start.x + start.width;
	let top = start.y;
	let bottom = start.y + start.height;
	if (handle.includes("w")) left = Math.min(local.x, right - minSize);
	if (handle.includes("e")) right = Math.max(local.x, left + minSize);
	if (handle.includes("n")) top = Math.min(local.y, bottom - minSize);
	if (handle.includes("s")) bottom = Math.max(local.y, top + minSize);

	if (options.keepRatio) {
		const ratio = start.width / Math.max(1, start.height);
		const width = right - left;
		const height = bottom - top;
		if (handle === "n" || handle === "s") {
			const nw = height * ratio;
			left = startCx - nw / 2;
			right = startCx + nw / 2;
		} else if (handle === "e" || handle === "w") {
			const nh = width / ratio;
			top = startCy - nh / 2;
			bottom = startCy + nh / 2;
		} else if (width / Math.max(1, height) > ratio) {
			const nh = width / ratio;
			if (handle.includes("n")) top = bottom - nh;
			else bottom = top + nh;
		} else {
			const nw = height * ratio;
			if (handle.includes("w")) left = right - nw;
			else right = left + nw;
		}
	}
	return placeBox(start, angle, left, top, right - left, bottom - top);
}

export function resizeTextFromHandle(
	ctx: CanvasRenderingContext2D,
	snapshot: SceneElement,
	kind: ResizeHandleKind,
	pointer: ScenePoint
): { x: number; y: number; width: number; height: number; fontSize: number; autoResize: boolean } {
	const start: ResizeBox = { x: snapshot.x, y: snapshot.y, width: snapshot.width, height: snapshot.height };
	const angle = snapshot.angle || 0;
	const text = snapshot.text ?? "";

	if (kind === "e" || kind === "w") {
		const next = resizeBoxFromHandle(start, angle, kind, pointer, { minSize: MIN_TEXT_WRAP_WIDTH });
		const metrics = measureTextBlock(ctx, text, snapshot.fontSize, snapshot.fontFamily, next.width);
		const left = kind === "w" ? start.x + start.width - metrics.width : start.x;
		const placed = placeBox(start, angle, left, start.y, metrics.width, metrics.height);
		return { x: placed.x, y: placed.y, width: metrics.width, height: metrics.height, fontSize: snapshot.fontSize, autoResize: false };
	}

	const next = resizeBoxFromHandle(start, angle, kind, pointer, { keepRatio: true });
	const fontSize = clampFontSize(snapshot.fontSize * (next.height / Math.max(1, start.height)));
	const factor = fontSize / Math.max(1, snapshot.fontSize);
	const autoResize = snapshot.autoResize === true;
	const metrics = measureTextBlock(
		ctx,
		text,
		fontSize,
		snapshot.fontFamily,
		autoResize ? null : getTextWrapWidth(snapshot.width * factor)
	);
	const left = kind.includes("w")
		? start.x + start.width - metrics.width
		: kind.includes("e")
			? start.x
			: start.x + (start.width - metrics.width) / 2;
	const top = kind.includes("n") ? start.y + start.height - metrics.height : start.y;
	const placed = placeBox(start, angle, left, top, metrics.width, metrics.height);
	return { x: placed.x, y: placed.y, width: metrics.width, height: metrics.height, fontSize, autoResize };
}

export function computeShapePerimeterPoint(target: SceneElement, externalPt: ScenePoint, gap = 4): ScenePoint {
	const cx = target.x + target.width / 2;
	const cy = target.y + target.height / 2;
	const localExt = unrotatePoint(externalPt.x, externalPt.y, cx, cy, target.angle || 0);
	const dx = localExt.x - cx;
	const dy = localExt.y - cy;
	if (Math.hypot(dx, dy) < 0.001) return { x: cx, y: target.y - gap };

	const hw = target.width / 2 + gap;
	const hh = target.height / 2 + gap;
	let localHit: ScenePoint;

	if (target.type === "ellipse") {
		const a = Math.atan2(dy, dx);
		localHit = { x: cx + hw * Math.cos(a), y: cy + hh * Math.sin(a) };
	} else if (target.type === "diamond") {
		const t = 1 / (Math.abs(dx) / Math.max(1, hw) + Math.abs(dy) / Math.max(1, hh));
		localHit = { x: cx + dx * t, y: cy + dy * t };
	} else {
		const t = Math.min(hw / Math.max(0.0001, Math.abs(dx)), hh / Math.max(0.0001, Math.abs(dy)));
		localHit = { x: cx + dx * t, y: cy + dy * t };
	}
	return rotatePoint(localHit.x, localHit.y, cx, cy, target.angle || 0);
}

export function findNearestBindingTarget(
	pt: ScenePoint,
	elements: readonly SceneElement[],
	excludeId?: string,
	maxDist = BINDING_SNAP_DISTANCE
): { element: SceneElement; binding: ElementBinding; snapPoint: ScenePoint } | null {
	let bestDist = maxDist;
	let best: { element: SceneElement; binding: ElementBinding; snapPoint: ScenePoint } | null = null;

	for (let i = elements.length - 1; i >= 0; i--) {
		const el = elements[i]!;
		if (el.isDeleted || el.id === excludeId || el.containerId || isPathElement(el)) continue;

		const cx = el.x + el.width / 2;
		const cy = el.y + el.height / 2;
		const perim = computeShapePerimeterPoint(el, pt, 4);
		const local = unrotatePoint(pt.x, pt.y, cx, cy, el.angle || 0);
		const inside = local.x >= el.x && local.x <= el.x + el.width && local.y >= el.y && local.y <= el.y + el.height;
		const dist = inside ? 0 : Math.hypot(pt.x - perim.x, pt.y - perim.y);

		if (dist < bestDist) {
			bestDist = dist;
			best = { element: el, binding: { elementId: el.id, focus: 0, gap: 4 }, snapPoint: perim };
		}
	}
	return best;
}

export function updateBoundElements(elements: SceneElement[]): void {
	const byId = new Map<string, SceneElement>();
	for (const el of elements) {
		if (!el.isDeleted) byId.set(el.id, el);
	}

	for (const el of elements) {
		if (el.isDeleted) continue;

		if (el.type === "text" && el.containerId) {
			const container = byId.get(el.containerId);
			if (!container) {
				el.containerId = null;
				continue;
			}
			const box = getContainerTextBox(container);
			el.x = box.x;
			el.y = box.y;
			el.width = box.width;
			el.height = box.height;
			el.angle = container.angle;
			continue;
		}
		if (el.boundTextId && !byId.has(el.boundTextId)) el.boundTextId = null;

		if (isPathElement(el) && el.points && el.points.length >= 2) {
			const pts = el.points;
			const firstW = { x: el.x + pts[0]!.x, y: el.y + pts[0]!.y };
			const lastIdx = pts.length - 1;
			const lastW = { x: el.x + pts[lastIdx]!.x, y: el.y + pts[lastIdx]!.y };
			let newFirst = firstW;
			let newLast = lastW;

			const startTarget = el.startBinding ? byId.get(el.startBinding.elementId) : undefined;
			const endTarget = el.endBinding ? byId.get(el.endBinding.elementId) : undefined;
			if (el.startBinding && !startTarget) el.startBinding = null;
			if (el.endBinding && !endTarget) el.endBinding = null;

			if (startTarget) {
				const ref =
					pts.length > 2
						? { x: el.x + pts[1]!.x, y: el.y + pts[1]!.y }
						: endTarget
							? { x: endTarget.x + endTarget.width / 2, y: endTarget.y + endTarget.height / 2 }
							: lastW;
				newFirst = computeShapePerimeterPoint(startTarget, ref, el.startBinding?.gap ?? 4);
			}
			if (endTarget) {
				const ref =
					pts.length > 2
						? { x: el.x + pts[lastIdx - 1]!.x, y: el.y + pts[lastIdx - 1]!.y }
						: startTarget
							? { x: startTarget.x + startTarget.width / 2, y: startTarget.y + startTarget.height / 2 }
							: firstW;
				newLast = computeShapePerimeterPoint(endTarget, ref, el.endBinding?.gap ?? 4);
			}
			if (startTarget || endTarget) {
				const worldPts = pts.map((p, i) =>
					i === 0 ? newFirst : i === lastIdx ? newLast : { x: el.x + p.x, y: el.y + p.y }
				);
				if (el.elbowed && worldPts.length === 4) {
					const midX = (newFirst.x + newLast.x) / 2;
					worldPts[1] = { x: midX, y: newFirst.y };
					worldPts[2] = { x: midX, y: newLast.y };
				}
				el.points = worldPts.map((wp) => ({ x: wp.x - el.x, y: wp.y - el.y }));
				normalizeElementBounds(el);
			}
		}
	}
}

export function computeSnapOffset(
	movingAABB: { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number },
	staticElements: readonly SceneElement[],
	movingIds: ReadonlySet<string>,
	zoom: number
): { dx: number; dy: number; guides: SnapGuideLine[] } {
	const guides: SnapGuideLine[] = [];
	const threshold = OBJECT_SNAP_THRESHOLD / Math.max(0.25, zoom);
	let dx = 0;
	let dy = 0;
	let bestX = threshold;
	let bestY = threshold;
	let guideX: SnapGuideLine | null = null;
	let guideY: SnapGuideLine | null = null;

	const mXs = [movingAABB.minX, movingAABB.cx, movingAABB.maxX];
	const mYs = [movingAABB.minY, movingAABB.cy, movingAABB.maxY];

	for (const el of staticElements) {
		if (el.isDeleted || movingIds.has(el.id) || el.containerId) continue;
		const b = getElementAABB(el);
		for (const mx of mXs) {
			for (const tx of [b.minX, b.cx, b.maxX]) {
				const d = Math.abs(mx - tx);
				if (d < bestX) {
					bestX = d;
					dx = tx - mx;
					guideX = { type: "vertical", x1: tx, y1: Math.min(movingAABB.minY, b.minY) - 14, x2: tx, y2: Math.max(movingAABB.maxY, b.maxY) + 14 };
				}
			}
		}
		for (const my of mYs) {
			for (const ty of [b.minY, b.cy, b.maxY]) {
				const d = Math.abs(my - ty);
				if (d < bestY) {
					bestY = d;
					dy = ty - my;
					guideY = { type: "horizontal", x1: Math.min(movingAABB.minX, b.minX) - 14, y1: ty, x2: Math.max(movingAABB.maxX, b.maxX) + 14, y2: ty };
				}
			}
		}
	}
	if (guideX) guides.push(guideX);
	if (guideY) guides.push(guideY);
	return { dx, dy, guides };
}

const TOOL_TO_TYPE: Partial<Record<CanvasToolId, SceneElementType>> = {
	rectangle: "rectangle",
	diamond: "diamond",
	ellipse: "ellipse",
	arrow: "arrow",
	line: "line",
	text: "text"
};

export function getElementTypeForTool(tool: CanvasToolId): SceneElementType | null {
	return TOOL_TO_TYPE[tool] ?? null;
}

export function createSceneElement(
	type: SceneElementType,
	point: ScenePoint,
	style: ElementStyleDefaults,
	zIndex: number
): SceneElement {
	const id = generateElementId(type);
	const isPath = type === "arrow" || type === "line";
	const isText = type === "text";
	return {
		id,
		type,
		x: point.x,
		y: point.y,
		width: 1,
		height: isText ? style.fontSize * TEXT_LINE_HEIGHT : 1,
		angle: 0,
		strokeColor: style.strokeColor,
		backgroundColor: style.backgroundColor,
		fillStyle: isPath || isText ? "none" : style.fillStyle,
		strokeWidth: style.strokeWidth,
		strokeStyle: style.strokeStyle,
		roughness: style.roughness,
		opacity: style.opacity,
		roundness: style.roundness,
		points: isPath ? [{ x: 0, y: 0 }] : undefined,
		startBinding: null,
		endBinding: null,
		startArrowhead: style.startArrowhead,
		endArrowhead: type === "arrow" ? style.endArrowhead : "none",
		curved: style.curved,
		elbowed: style.elbowed,
		fontFamily: style.fontFamily,
		fontSize: style.fontSize,
		textAlign: isText ? style.textAlign : "center",
		verticalAlign: isText ? "top" : "middle",
		autoResize: isText ? true : undefined,
		locked: false,
		isDeleted: false,
		zIndex,
		updated: Date.now(),
		seed: hashStringSeed(id)
	};
}

export function updateElementFromDrag(
	element: SceneElement,
	start: ScenePoint,
	current: ScenePoint,
	shiftKey: boolean
): void {
	if (isPathElement(element)) {
		let end = current;
		if (shiftKey) {
			const dx = current.x - start.x;
			const dy = current.y - start.y;
			const len = Math.hypot(dx, dy);
			if (len > 0.001) {
				const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
				end = { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len };
			}
		}
		element.x = start.x;
		element.y = start.y;
		element.points = [{ x: 0, y: 0 }, { x: end.x - start.x, y: end.y - start.y }];
		element.width = Math.max(1, Math.abs(end.x - start.x));
		element.height = Math.max(1, Math.abs(end.y - start.y));
		return;
	}

	let endX = current.x;
	let endY = current.y;
	if (shiftKey) {
		const side = Math.max(Math.abs(endX - start.x), Math.abs(endY - start.y), 1);
		endX = start.x + Math.sign(endX - start.x || 1) * side;
		endY = start.y + Math.sign(endY - start.y || 1) * side;
	}
	element.x = Math.min(start.x, endX);
	element.y = Math.min(start.y, endY);
	element.width = Math.max(1, Math.abs(endX - start.x));
	element.height = Math.max(1, Math.abs(endY - start.y));
	element.updated = Date.now();
}

export function finalizeElementSize(element: SceneElement, start: ScenePoint, didDrag: boolean): void {
	if (isPathElement(element)) {
		if (!didDrag) {
			element.x = start.x;
			element.y = start.y;
			element.points = [{ x: 0, y: 0 }, { x: 120, y: 0 }];
		}
		normalizeElementBounds(element);
		element.updated = Date.now();
		return;
	}
	if (didDrag) {
		element.width = Math.max(6, element.width);
		element.height = Math.max(6, element.height);
		return;
	}
	element.x = start.x;
	element.y = start.y;
	element.width = element.type === "text" ? 180 : 120;
	element.height = element.type === "text" ? 44 : 90;
	element.updated = Date.now();
}