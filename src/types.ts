import { TFile } from "obsidian";

export interface Note3D {
file: TFile;
path: string;
title: string;
programs: string[];
rawTopics: string[];
topics: string[];
topicPaths: string[];
hasImages: boolean;
source: string;
pinned: boolean;
mtime: number;
}

export interface VirtualTopicEntry {
program: string;
topicPath: string;
}

export interface BubbleLink {
	from: string; // ID пузыря (например: "topic::Blender::Моделирование")
	to: string;   // ID целевого пузыря
}

export interface NoteStyle {
	icon?: string;
	iconImage?: string;
}

export interface Hub3DSettings {
	targetFolder: string;
	virtualTopics: VirtualTopicEntry[];
	bubblePositions: Record<string, { x: number; y: number }>;
	bubbleLinks: BubbleLink[];
	clusterNames: Record<string, string>; // Ключ: отсортированный через "|" список ID узлов кластера
	noteStyles: Record<string, NoteStyle>;
}

export const DEFAULT_SETTINGS: Hub3DSettings = {
	targetFolder: "Знания",
	virtualTopics: [],
	bubblePositions: {},
	bubbleLinks: [],
	clusterNames: {},
	noteStyles: {}
};

export const AREA_NAME = "3D";

export const PRESET_PROGRAMS: string[] = [
"Blender",
"Substance Painter",
"Gaea",
"SpeedTree",
"ZBrush",
"Marmoset",
"Unreal Engine",
"Maya"
];

export const PRESET_TOPICS: string[] = [
"Geometry Nodes",
"Моделирование",
"Текстурирование",
"UV-развёртка",
"Шейдеры",
"Окружение",
"Пайплайн",
"Рендер и свет",
"Запекание",
"Скульптинг",
"Анимация"
];

export const TOPIC_MAP: Record<string, string> = {
"Вода": "Окружение",
"Туман": "Окружение",
"Растительность": "Окружение",
"Ландшафт": "Окружение",
"Деревья": "Окружение",
"Импорт": "Пайплайн",
"Экспорт": "Пайплайн",
"Оптимизация": "Пайплайн",
"Ретопология": "Моделирование",
"Развёртка": "UV-развёртка",
"Свет": "Рендер и свет",
"Рендер": "Рендер и свет",
"Материалы": "Шейдеры"
};

export const PROGRAM_COLORS: Record<string, string> = {
"Blender": "#e5a158",
"Substance Painter": "#d85b57",
"Gaea": "#4aab80",
"SpeedTree": "#69b5aa",
"ZBrush": "#9c83e8",
"Marmoset": "#599ed6",
"Unreal Engine": "#5c8df6",
"Maya": "#d69852"
};

export function getProgramColor(name: string): string {
return PROGRAM_COLORS[name] || "#9c83e8";
}

export function getTopicAccentColor(baseHex: string, seed: string): string {
const clean = baseHex.replace("#", "");
if (clean.length !== 6) return baseHex;

const r = parseInt(clean.slice(0, 2), 16) / 255;
const g = parseInt(clean.slice(2, 4), 16) / 255;
const b = parseInt(clean.slice(4, 6), 16) / 255;

const max = Math.max(r, g, b);
const min = Math.min(r, g, b);
let h = 0;
let s = 0;
const l = (max + min) / 2;

if (max !== min) {
const d = max - min;
s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
else if (max === g) h = (b - r) / d + 2;
else h = (r - g) / d + 4;
h /= 6;
}

let hash = 2166136261;
for (let i = 0; i < seed.length; i++) {
hash ^= seed.charCodeAt(i);
hash = Math.imul(hash, 16777619);
}

const hueShift = (((hash >>> 0) % 68) - 34) / 360;
const satShift = ((((hash >>> 8) % 16) - 8) / 100);
const lightShift = ((((hash >>> 16) % 12) - 5) / 100);

const nh = (h + hueShift + 1) % 1;
const ns = Math.max(0.35, Math.min(0.88, s + satShift));
const nl = Math.max(0.50, Math.min(0.72, l + lightShift));

const hue2rgb = (p: number, q: number, t: number): number => {
let tt = t;
if (tt < 0) tt += 1;
if (tt > 1) tt -= 1;
if (tt < 1 / 6) return p + (q - p) * 6 * tt;
if (tt < 1 / 2) return q;
if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
return p;
};

const q = nl < 0.5 ? nl * (1 + ns) : nl + ns - nl * ns;
const p = 2 * nl - q;
const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");

return `#${toHex(hue2rgb(p, q, nh + 1 / 3))}${toHex(hue2rgb(p, q, nh))}${toHex(hue2rgb(p, q, nh - 1 / 3))}`;
}

export function topicParts(value: string): string[] {
return String(value || "")
.split("/")
.map((part) => part.trim())
.filter(Boolean);
}

export function mapTopic(value: string): string {
const parts = topicParts(value);
const first = parts[0];
if (!first) return "";
parts[0] = TOPIC_MAP[first] || first;
return parts.join("/");
}