import { TFile } from "obsidian";

export type SceneElementType =
	| "rectangle"
	| "diamond"
	| "ellipse"
	| "arrow"
	| "line"
	| "text";

export type FillStyle = "solid" | "hachure" | "cross-hatch" | "none";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type ArrowheadType = "none" | "arrow" | "triangle" | "circle" | "diamond" | "bar";
export type FontFamilyType = "hand" | "normal" | "mono";
export type TextAlignType = "left" | "center" | "right";
export type VerticalAlignType = "top" | "middle" | "bottom";

export type CanvasToolId =
	| "hand"
	| "select"
	| "rectangle"
	| "diamond"
	| "ellipse"
	| "arrow"
	| "line"
	| "text"
	| "eraser";

export interface ScenePoint {
	x: number;
	y: number;
}

export interface ElementBinding {
	elementId: string;
	focus: number;
	gap: number;
	anchor?: "top" | "bottom" | "left" | "right" | "center";
}

export interface SceneElement {
	id: string;
	type: SceneElementType;
	x: number;
	y: number;
	width: number;
	height: number;
	angle: number;
	strokeColor: string;
	backgroundColor: string;
	fillStyle: FillStyle;
	strokeWidth: number;
	strokeStyle: StrokeStyle;
	roughness: number;
	opacity: number;
	roundness: number;
	points?: ScenePoint[];
	startBinding?: ElementBinding | null;
	endBinding?: ElementBinding | null;
	startArrowhead?: ArrowheadType;
	endArrowhead?: ArrowheadType;
	elbowed?: boolean;
	curved?: boolean;
	text?: string;
	fontFamily: FontFamilyType;
	fontSize: number;
	textAlign: TextAlignType;
	verticalAlign: VerticalAlignType;
	autoResize?: boolean;
	containerId?: string | null;
	boundTextId?: string | null;
	locked: boolean;
	isDeleted: boolean;
	zIndex: number;
	updated: number;
	seed?: number;
}

export interface ElementStyleDefaults {
	strokeColor: string;
	backgroundColor: string;
	fillStyle: FillStyle;
	strokeWidth: number;
	strokeStyle: StrokeStyle;
	roughness: number;
	opacity: number;
	roundness: number;
	fontFamily: FontFamilyType;
	fontSize: number;
	textAlign: TextAlignType;
	verticalAlign: VerticalAlignType;
	startArrowhead: ArrowheadType;
	endArrowhead: ArrowheadType;
	curved: boolean;
	elbowed: boolean;
}

export interface SceneAppState {
	scrollX: number;
	scrollY: number;
	zoom: number;
	grid: boolean;
	gridSize: number;
	snapToObjects: boolean;
	keepToolActive: boolean;
	activeTool: CanvasToolId;
	currentStyle: ElementStyleDefaults;
}

export interface Scene {
	version: 2;
	elements: SceneElement[];
	appState: SceneAppState;
}

export interface AABB {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	width: number;
	height: number;
	cx: number;
	cy: number;
}

export type HandleKind =
	| "nw"
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "sw"
	| "w"
	| "rotate"
	| "point"
	| "midpoint";

export interface HandleDescriptor {
	kind: HandleKind;
	x: number;
	y: number;
	pointIndex?: number;
	elementId?: string;
}

export interface SnapGuideLine {
	type: "vertical" | "horizontal";
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface NodeImageItem {
	file: TFile;
	path: string;
	name: string;
	resourcePath: string;
}

export function createDefaultStyle(accentColor = "#9c83e8"): ElementStyleDefaults {
	return {
		strokeColor: accentColor,
		backgroundColor: "transparent",
		fillStyle: "solid",
		strokeWidth: 2,
		strokeStyle: "solid",
		roughness: 0,
		opacity: 100,
		roundness: 8,
		fontFamily: "normal",
		fontSize: 20,
		textAlign: "left",
		verticalAlign: "middle",
		startArrowhead: "none",
		endArrowhead: "arrow",
		curved: false,
		elbowed: false
	};
}

export function createDefaultAppState(accentColor = "#9c83e8"): SceneAppState {
	return {
		scrollX: 0,
		scrollY: 0,
		zoom: 1,
		grid: true,
		gridSize: 24,
		snapToObjects: true,
		keepToolActive: false,
		activeTool: "select",
		currentStyle: createDefaultStyle(accentColor)
	};
}

export function createEmptyScene(accentColor = "#9c83e8"): Scene {
	return {
		version: 2,
		elements: [],
		appState: createDefaultAppState(accentColor)
	};
}

export function cloneSceneElement(el: SceneElement): SceneElement {
	return {
		...el,
		points: el.points ? el.points.map((p) => ({ ...p })) : undefined,
		startBinding: el.startBinding ? { ...el.startBinding } : el.startBinding,
		endBinding: el.endBinding ? { ...el.endBinding } : el.endBinding
	};
}

export function generateElementId(prefix = "el"): string {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function hashStringSeed(id: string): number {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return Math.abs(h) || 1;
}