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

export interface Hub3DSettings {
	targetFolder: string;
	virtualTopics: VirtualTopicEntry[];
	bubblePositions: Record<string, { x: number; y: number }>;
	bubbleLinks: BubbleLink[];
	clusterNames: Record<string, string>; // Ключ: отсортированный через "|" список ID узлов кластера
}

export const DEFAULT_SETTINGS: Hub3DSettings = {
	targetFolder: "Знания",
	virtualTopics: [],
	bubblePositions: {},
	bubbleLinks: [],
	clusterNames: {}
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