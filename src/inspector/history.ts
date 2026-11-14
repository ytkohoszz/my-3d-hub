import { SceneElement, cloneSceneElement } from "./sceneTypes";

export interface ElementDelta {
	id: string;
	before: SceneElement | null;
	after: SceneElement | null;
}

export interface HistoryBatch {
	deltas: ElementDelta[];
	selectionBefore: string[];
	selectionAfter: string[];
}

const MAX_HISTORY = 150;

function elementsEqual(a: SceneElement | null, b: SceneElement | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return JSON.stringify(a) === JSON.stringify(b);
}

export class SceneHistory {
	private undoStack: HistoryBatch[] = [];
	private redoStack: HistoryBatch[] = [];
	private pendingSnapshot: Map<string, SceneElement> | null = null;
	private pendingSelection: string[] = [];

	public clear(): void {
		this.undoStack = [];
		this.redoStack = [];
		this.pendingSnapshot = null;
		this.pendingSelection = [];
	}

	public canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	public canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	public hasPendingTransaction(): boolean {
		return this.pendingSnapshot !== null;
	}

	public beginTransaction(elements: readonly SceneElement[], selectedIds: ReadonlySet<string>): void {
		const snap = new Map<string, SceneElement>();
		for (const el of elements) snap.set(el.id, cloneSceneElement(el));
		this.pendingSnapshot = snap;
		this.pendingSelection = Array.from(selectedIds);
	}

	public cancelTransaction(): void {
		this.pendingSnapshot = null;
		this.pendingSelection = [];
	}

	public commitTransaction(elements: readonly SceneElement[], selectedIds: ReadonlySet<string>): boolean {
		if (!this.pendingSnapshot) return false;
		const beforeMap = this.pendingSnapshot;
		this.pendingSnapshot = null;

		const afterMap = new Map<string, SceneElement>();
		for (const el of elements) afterMap.set(el.id, el);

		const allIds = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);
		const deltas: ElementDelta[] = [];

		for (const id of allIds) {
			const before = beforeMap.get(id) ?? null;
			const after = afterMap.get(id) ?? null;
			if (!elementsEqual(before, after)) {
				deltas.push({
					id,
					before: before ? cloneSceneElement(before) : null,
					after: after ? cloneSceneElement(after) : null
				});
			}
		}

		if (deltas.length === 0) return false;

		this.undoStack.push({
			deltas,
			selectionBefore: this.pendingSelection,
			selectionAfter: Array.from(selectedIds)
		});
		if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
		this.redoStack = [];
		return true;
	}

	public undo(current: readonly SceneElement[]): { elements: SceneElement[]; selection: Set<string> } | null {
		const batch = this.undoStack.pop();
		if (!batch) return null;
		this.redoStack.push(batch);
		return { elements: this.applyDeltas(current, batch.deltas, "before"), selection: new Set(batch.selectionBefore) };
	}

	public redo(current: readonly SceneElement[]): { elements: SceneElement[]; selection: Set<string> } | null {
		const batch = this.redoStack.pop();
		if (!batch) return null;
		this.undoStack.push(batch);
		return { elements: this.applyDeltas(current, batch.deltas, "after"), selection: new Set(batch.selectionAfter) };
	}

	private applyDeltas(
		current: readonly SceneElement[],
		deltas: ElementDelta[],
		side: "before" | "after"
	): SceneElement[] {
		const map = new Map<string, SceneElement>();
		for (const el of current) map.set(el.id, cloneSceneElement(el));
		for (const d of deltas) {
			const target = d[side];
			if (target === null) map.delete(d.id);
			else map.set(d.id, cloneSceneElement(target));
		}
		return Array.from(map.values()).sort((a, b) => a.zIndex - b.zIndex);
	}
}